import { InflationInstance } from "../../typechain-truffle";
import { ChainParameters } from "../chain-config/chain-parameters";
import { Contracts } from "../scripts/Contracts";

const Inflation = artifacts.require("Inflation");
const BN = web3.utils.toBN;

function calculateAuthorizedInflationWei(parameters: any, totalAuthorizedDailyInflationWei: BN, contractName: string): BN {
  let divisorRemaining = 10000;
  for (let i = 0; i < parameters.inflationReceivers.length; i++) {
    let serviceAuthInflationWei = totalAuthorizedDailyInflationWei.muln(parameters.inflationSharingBIPS[i]).divn(divisorRemaining);
    if (parameters.inflationReceivers[i] == contractName) {
      return serviceAuthInflationWei;
    } else {
      totalAuthorizedDailyInflationWei = totalAuthorizedDailyInflationWei.sub(serviceAuthInflationWei);
      divisorRemaining -= parameters.inflationSharingBIPS[i];
    }
  }
  return BN(0);
}

/**
 * This test assumes a local chain is running with Flare allocated in accounts
 * listed in `./hardhat.config.ts`
 */
contract(`final-verification.ts system tests`, async accounts => {
  let contracts: Contracts;
  let parameters: ChainParameters;
  let inflation: InflationInstance;

  before(async () => {
    contracts = new Contracts();
    await contracts.deserialize(process.stdin);
    parameters = require("hardhat").getChainConfigParameters(process.env.CHAIN_CONFIG);
    inflation = await Inflation.at(contracts.getContractAddress(Contracts.INFLATION));
  });

  describe(Contracts.INFLATION, async () => {
    it("validate first inflation annum is initialized with correct inflation percentage", async () => {
      // Assemble

      // Act
      const inflationAnnum = await inflation.getCurrentAnnum();
      const inflationWei = BN(inflationAnnum.recognizedInflationWei.toString());
      const calculatedInflationWei = BN(parameters.totalNativeSupplyNAT).sub(BN(parameters.totalExcludedSupplyNAT)).mul(BN(10).pow(BN(18))).sub(BN(parameters.incentivePoolWei.replace(/\s/g, '')))
        .muln(parameters.scheduledInflationPercentageBIPS[0]).divn(10000).divn(12);
      // Assert
      assert(inflationWei.eq(calculatedInflationWei));
    });
  });

  describe(Contracts.FTSO_REWARD_MANAGER, async () => {
    it("Should have correct authorized inflation and balance", async () => {
      // Assemble
      const FtsoRewardManager = artifacts.require("FtsoRewardManager");
      const ftsoRewardManager = await FtsoRewardManager.at(contracts.getContractAddress(Contracts.FTSO_REWARD_MANAGER));
      // Act
      const { 5: authorizedInflationWei } = await ftsoRewardManager.getTotals();
      const balanceWei = await web3.eth.getBalance(ftsoRewardManager.address);
      const inflationAnnum = await inflation.getCurrentAnnum();
      const dailyInflationWei = BN(inflationAnnum.recognizedInflationWei.toString()).div(BN(30));
      const calculatedAuthorizedInflationWei = calculateAuthorizedInflationWei(parameters, dailyInflationWei, Contracts.FTSO_REWARD_MANAGER);

      // Assert
      assert(authorizedInflationWei.eq(calculatedAuthorizedInflationWei));
      assert.equal(authorizedInflationWei.toString(), balanceWei);
    });
  });

});
