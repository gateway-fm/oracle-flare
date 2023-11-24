import { constants, expectEvent, expectRevert, time } from "@openzeppelin/test-helpers";
import { Contracts } from "../../../deployment/scripts/Contracts";
import { FlareDaemonWithInflationMockInstance, InflationAllocationInstance, InflationInstance, InflationReceiverAndTokenPoolMockInstance, SupplyInstance } from "../../../typechain-truffle";
import { getTestFile, GOVERNANCE_GENESIS_ADDRESS } from "../../utils/constants";
import { encodeContractNames, increaseTimeTo, toBN } from "../../utils/test-helpers";

const Supply = artifacts.require("Supply");
const Inflation = artifacts.require("Inflation");
const InflationAllocation = artifacts.require("InflationAllocation");
const InflationReceiverAndTokenPoolMock = artifacts.require("InflationReceiverAndTokenPoolMock");
const SuicidalMock = artifacts.require("SuicidalMock");
const FlareDaemonWithInflationMock = artifacts.require("FlareDaemonWithInflationMock");

function toBNFixed(x: number, decimals: number) {
  const prec = Math.min(decimals, 6);
  const s = x.toFixed(prec);
  const dot = s.indexOf('.');
  const bn = toBN(s.slice(0, dot) + s.slice(dot + 1));
  return prec === decimals ? bn : bn.mul(toBN(10).pow(toBN(decimals - prec)));
}

function usd(x: number) {
  return toBNFixed(x, 5);     // asset prices are multiplied by 10**5 (see Ftso.sol)
}

contract(`Inflation.sol; ${getTestFile(__filename)}; gas consumption tests`, async accounts => {
  const governance = GOVERNANCE_GENESIS_ADDRESS;
  const ADDRESS_UPDATER = accounts[16];

  const dayDurationSec = 24 * 60 * 60;
  const monthDurationSec = 30 * dayDurationSec;

  let inflation: InflationInstance;
  let inflationAllocation: InflationAllocationInstance;
  let flareDaemon: FlareDaemonWithInflationMockInstance;

  let supply: SupplyInstance;
  let startTs: BN;
  let tokenPools: InflationReceiverAndTokenPoolMockInstance[];

  async function getCurrentDay(): Promise<number> {
    await time.advanceBlock();
    let timestamp = await time.latest();
    return Math.floor(timestamp.sub(startTs).toNumber() / dayDurationSec);
  }

  async function inflationGasBenchmarking(
    inflationReceiversSharingBIPS: number[],
    inflationReceiversTopupFactorX100: number[],
    noOfTokenPools: number,
    noOfDays: number
  ) {

    let inflationReceivers = [];
    tokenPools = [];

    const noOfInflationReceivers = inflationReceiversSharingBIPS.length;
    assert(noOfInflationReceivers == inflationReceiversTopupFactorX100.length);
    
    // Assemble
    for (let i = 0; i < noOfInflationReceivers + noOfTokenPools; i++) {

      const contract = await InflationReceiverAndTokenPoolMock.new(governance, inflation.address);
      if (i < noOfInflationReceivers) {
        inflationReceivers.push(contract);
        await inflation.setTopupConfiguration(contract.address, 0, inflationReceiversTopupFactorX100[i], {from: governance});
      }

      tokenPools.push(contract);
      await supply.addTokenPool(contract.address, 0, {from: governance});

    }
    await inflationAllocation.setSharingPercentages(inflationReceivers.map(ir => ir.address), inflationReceiversSharingBIPS, {from: governance});

    let normalDaemonizeCallTx = await flareDaemon.triggerDaemonize();
    console.log(`daemonize call with no work to do: ${normalDaemonizeCallTx.receipt.gasUsed}`);

    for (let j = 0; j < tokenPools.length; j++) {
      await tokenPools[j].receiveFoundationAllocatedFunds({ value: toBN(50), from: governance });
      await tokenPools[j].claimMock(constants.ZERO_ADDRESS, 10); // send to burn address
      let suicidalContract = await SuicidalMock.new(tokenPools[j].address);
      await web3.eth.sendTransaction({ from: accounts[0], to: suicidalContract.address, value: j == 0 ? 50_000 : 50 });
      await suicidalContract.die();
    }

    await increaseTimeTo(startTs.toNumber(), 'web3');

    // initialize first annum
    await expectRevert(inflation.getCurrentAnnum(), "no annum");
    await expectRevert(inflation.getAnnum(0), "no annum");
    let oldMintingRequest = await flareDaemon.totalMintingRequestedWei();
    let initializeFirstAnnumTx = await flareDaemon.triggerDaemonize();
    await expectEvent.notEmitted.inTransaction(initializeFirstAnnumTx.tx, supply, "AuthorizedInflationUpdateError");
    await inflation.getCurrentAnnum(); // should not revert
    console.log(`initialize first annum: ${initializeFirstAnnumTx.receipt.gasUsed}`);
    await flareDaemon.triggerReceiveMinting((await flareDaemon.totalMintingRequestedWei()).sub(oldMintingRequest));

    let currentDay = await getCurrentDay();
    assert(currentDay == 0, "currentDay != 0");

    for (let i = 1; i <= noOfDays; i++) {

      await increaseTimeTo(startTs.toNumber() + i * dayDurationSec, 'web3');

      for (let j = 0; j < tokenPools.length; j++) {
        await tokenPools[j].receiveFoundationAllocatedFunds({ value: toBN(50), from: governance });
        await tokenPools[j].claimMock(constants.ZERO_ADDRESS, 10); // send to burn address
        let suicidalContract = await SuicidalMock.new(tokenPools[j].address);
        await web3.eth.sendTransaction({ from: accounts[0], to: suicidalContract.address, value: j == 0 ? 50_000 : 50 });
        await suicidalContract.die();
      }

      console.log("day: " + i);
      oldMintingRequest = await flareDaemon.totalMintingRequestedWei();
      let updateSupplyAndReceiveInflation = await flareDaemon.triggerDaemonize();
      await expectEvent.notEmitted.inTransaction(updateSupplyAndReceiveInflation.tx, supply, "AuthorizedInflationUpdateError");
      console.log(`update supply contract and inflation: ${updateSupplyAndReceiveInflation.receipt.gasUsed}`);
      await flareDaemon.triggerReceiveMinting((await flareDaemon.totalMintingRequestedWei()).sub(oldMintingRequest));

      oldMintingRequest = await flareDaemon.totalMintingRequestedWei();
      normalDaemonizeCallTx = await flareDaemon.triggerDaemonize();
      console.log(`daemonize call with no work to do: ${normalDaemonizeCallTx.receipt.gasUsed}`);
      await flareDaemon.triggerReceiveMinting((await flareDaemon.totalMintingRequestedWei()).sub(oldMintingRequest));
    }

    for (let j = 0; j < tokenPools.length; j++) {
      await tokenPools[j].receiveFoundationAllocatedFunds({ value: toBN(50), from: governance });
      await tokenPools[j].claimMock(constants.ZERO_ADDRESS, 10); // send to burn address
      let suicidalContract = await SuicidalMock.new(tokenPools[j].address);
      await web3.eth.sendTransaction({ from: accounts[0], to: suicidalContract.address, value: j == 0 ? 50_000 : 50 });
      await suicidalContract.die();
    }

    // finalize first annum
    await increaseTimeTo(startTs.toNumber() + monthDurationSec, 'web3');
    oldMintingRequest = await flareDaemon.totalMintingRequestedWei();
    let finalizeAnnumTx = await flareDaemon.triggerDaemonize();
    console.log(`finalize annum: ${finalizeAnnumTx.receipt.gasUsed}`);
    await flareDaemon.triggerReceiveMinting((await flareDaemon.totalMintingRequestedWei()).sub(oldMintingRequest));
  }

  describe("Inflation gas benchmarking", async () => {

    beforeEach(async () => {

      // create inflation allocation
      inflationAllocation = await InflationAllocation.new(governance, ADDRESS_UPDATER, [1000]);

      // create flare daemon with inflation mock
      flareDaemon = await FlareDaemonWithInflationMock.new();
      await flareDaemon.initialiseFixedAddress();

      startTs = (await time.latest()).addn(500);
      // create inflation
      inflation = await Inflation.new(governance, flareDaemon.address, ADDRESS_UPDATER, startTs);
      
      // Supply contract
      supply = await Supply.new(
        governance,
        ADDRESS_UPDATER,
        10_000_000,
        0,
        []
      );

      // set contract addresses
      await supply.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION]),
        [ADDRESS_UPDATER, inflation.address], {from: ADDRESS_UPDATER});
      await flareDaemon.setInflation(inflation.address, { from: governance });
      await inflation.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.SUPPLY, Contracts.INFLATION_ALLOCATION]),
        [ADDRESS_UPDATER, supply.address, inflationAllocation.address], {from: ADDRESS_UPDATER});
      await inflationAllocation.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION]),
        [ADDRESS_UPDATER, inflation.address], {from: ADDRESS_UPDATER});

      // send flare daemon some initial balance
      let suicidalContract = await SuicidalMock.new(flareDaemon.address);
      await web3.eth.sendTransaction({ from: accounts[0], to: suicidalContract.address, value: 500_000 });
      await suicidalContract.die();
    });

    
    // real conditions
    it("Inflation daemonize calls for 5 inflation receivers and 6 additional token pools (10 days)", async () => {
      await inflationGasBenchmarking([2000, 3000, 2000, 1000, 2000], [300, 500, 200, 200, 700], 6, 10);
    });
  });
  
});
