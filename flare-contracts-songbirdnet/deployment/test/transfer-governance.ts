import { Contracts } from "../scripts/Contracts";
import {
  GovernedBaseContract,
} from "../../typechain-truffle";
import { ChainParameters } from "../chain-config/chain-parameters";

/**
 * This test assumes a chain is running with Flare allocated in accounts
 * listed in `./hardhat.config.ts`
 */
contract(`transfer-governance.ts system tests`, async accounts => {
  let contracts: Contracts;
  let parameters: ChainParameters;
  let GovernedBase: GovernedBaseContract;
  const SHOULD_HAVE_TRANSFERRED_GOVERNANCE = "Should have transferred governance";

  before(async () => {
    contracts = new Contracts();
    await contracts.deserialize(process.stdin);
    parameters = require("hardhat").getChainConfigParameters(process.env.CHAIN_CONFIG);
    GovernedBase = artifacts.require("GovernedBase");
  });

  async function checkGovernance(contractName: string) {
    // Assemble
    const governedBase = await GovernedBase.at(contracts.getContractAddress(contractName));
    // Act
    const governance = await governedBase.governance();
    // Assert
    assert.equal(governance.toLowerCase(), parameters.governancePublicKey.toLowerCase());
  }

  describe(Contracts.FLARE_DAEMON, async () => {
    it(SHOULD_HAVE_TRANSFERRED_GOVERNANCE, async () => {
      await checkGovernance(Contracts.FLARE_DAEMON);
    });
  });

  describe(Contracts.PRICE_SUBMITTER, async () => {
    it(SHOULD_HAVE_TRANSFERRED_GOVERNANCE, async () => {
      await checkGovernance(Contracts.PRICE_SUBMITTER);
    });
  });

  describe(Contracts.WNAT, async () => {
    it(SHOULD_HAVE_TRANSFERRED_GOVERNANCE, async () => {
      await checkGovernance(Contracts.WNAT);
    });
  });

});
