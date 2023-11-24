import { Contracts } from "../scripts/Contracts";
import {
  GovernanceSettingsInstance,
  GovernedBaseContract,
} from "../../typechain-truffle";
import { ChainParameters } from "../chain-config/chain-parameters";

/**
 * This test assumes a chain is running with Flare allocated in accounts
 * listed in `./hardhat.config.ts`
 */
contract(`switch-to-production-mode.ts system tests`, async accounts => {
  let contracts: Contracts;
  let parameters: ChainParameters;
  let GovernedBase: GovernedBaseContract;
  let governanceSettings: GovernanceSettingsInstance;
  const SHOULD_HAVE_TRANSFERRED_GOVERNANCE = "Should have transferred governance";

  before(async () => {
    contracts = new Contracts();
    await contracts.deserialize(process.stdin);
    parameters = require("hardhat").getChainConfigParameters(process.env.CHAIN_CONFIG);
    GovernedBase = artifacts.require("GovernedBase");
    const GovernanceSettings = artifacts.require("GovernanceSettings");
    governanceSettings = await GovernanceSettings.at(contracts.getContractAddress("GovernanceSettings"));
  });

  async function checkGovernancePointerContract(contractName: string) {
    // Assemble
    const governedBase = await GovernedBase.at(contracts.getContractAddress(contractName));
    // Act
    const governancePointer = await governedBase.governanceSettings();
    // Assert
    assert.equal(governancePointer, governanceSettings.address);
  }

  async function checkGovernance(contractName: string) {
    // Assemble
    const governedBase = await GovernedBase.at(contracts.getContractAddress(contractName));
    // Act
    const governance = await governedBase.governance();
    // Assert
    assert.equal(governance.toLowerCase(), parameters.governancePublicKey.toLowerCase());
  }

  async function checkProductionMode(contractName: string) {
    // Assemble
    const governedBase = await GovernedBase.at(contracts.getContractAddress(contractName));
    // Act
    const productionMode = await governedBase.productionMode();
    // Assert
    assert.equal(productionMode, true);
  }

  async function checkProductionSwitch(contractName: string) {
    await checkProductionMode(contractName);
    await checkGovernance(contractName);
    await checkGovernancePointerContract(contractName);
  }

  describe(Contracts.ADDRESS_UPDATER, async () => {
    it(SHOULD_HAVE_TRANSFERRED_GOVERNANCE, async () => {
      await checkProductionSwitch(Contracts.ADDRESS_UPDATER);
    });
  });

  describe(Contracts.INFLATION_ALLOCATION, async () => {
    it(SHOULD_HAVE_TRANSFERRED_GOVERNANCE, async () => {
      await checkProductionSwitch(Contracts.INFLATION_ALLOCATION);
    });
  });

  describe(Contracts.FTSO_MANAGER, async () => {
    it(SHOULD_HAVE_TRANSFERRED_GOVERNANCE, async () => {
      await checkProductionSwitch(Contracts.FTSO_MANAGER);
    });
  });

  describe(Contracts.FLARE_DAEMON, async () => {
    it(SHOULD_HAVE_TRANSFERRED_GOVERNANCE, async () => {
      await checkProductionSwitch(Contracts.FLARE_DAEMON);
    });
  });

  describe(Contracts.INFLATION, async () => {
    it(SHOULD_HAVE_TRANSFERRED_GOVERNANCE, async () => {
      await checkProductionSwitch(Contracts.INFLATION);
    });
  });

  describe(Contracts.FTSO_REWARD_MANAGER, async () => {
    it(SHOULD_HAVE_TRANSFERRED_GOVERNANCE, async () => {
      await checkProductionSwitch(Contracts.FTSO_REWARD_MANAGER);
    });
  });

  describe(Contracts.PRICE_SUBMITTER, async () => {
    it(SHOULD_HAVE_TRANSFERRED_GOVERNANCE, async () => {
      await checkProductionSwitch(Contracts.PRICE_SUBMITTER);
    });
  });

  describe(Contracts.SUPPLY, async () => {
    it(SHOULD_HAVE_TRANSFERRED_GOVERNANCE, async () => {
      await checkProductionSwitch(Contracts.SUPPLY);
    });
  });

  describe(Contracts.VOTER_WHITELISTER, async () => {
    it(SHOULD_HAVE_TRANSFERRED_GOVERNANCE, async () => {
      await checkProductionSwitch(Contracts.VOTER_WHITELISTER);
    });
  });

  describe(Contracts.CLEANUP_BLOCK_NUMBER_MANAGER, async () => {
    it(SHOULD_HAVE_TRANSFERRED_GOVERNANCE, async () => {
      await checkProductionSwitch(Contracts.CLEANUP_BLOCK_NUMBER_MANAGER);
    });
  });

  describe(Contracts.DISTRIBUTION_TREASURY, async () => {
    it(SHOULD_HAVE_TRANSFERRED_GOVERNANCE, async () => {
      await checkProductionSwitch(Contracts.DISTRIBUTION_TREASURY);
    });
  });

  describe(Contracts.DISTRIBUTION_TO_DELEGATORS, async () => {
    it(SHOULD_HAVE_TRANSFERRED_GOVERNANCE, async function() {
      await checkProductionSwitch(Contracts.DISTRIBUTION_TO_DELEGATORS);
    });
  });

  describe(Contracts.INCENTIVE_POOL_TREASURY, async () => {
    it(SHOULD_HAVE_TRANSFERRED_GOVERNANCE, async () => {
      await checkProductionSwitch(Contracts.INCENTIVE_POOL_TREASURY);
    });
  });

  describe(Contracts.INCENTIVE_POOL, async () => {
    it(SHOULD_HAVE_TRANSFERRED_GOVERNANCE, async () => {
      await checkProductionSwitch(Contracts.INCENTIVE_POOL);
    });
  });

  describe(Contracts.INCENTIVE_POOL_ALLOCATION, async () => {
    it(SHOULD_HAVE_TRANSFERRED_GOVERNANCE, async () => {
      await checkProductionSwitch(Contracts.INCENTIVE_POOL_ALLOCATION);
    });
  });

  describe(Contracts.INITIAL_AIRDROP, async () => {
    it(SHOULD_HAVE_TRANSFERRED_GOVERNANCE, async () => {
      await checkProductionSwitch(Contracts.INITIAL_AIRDROP);
    });
  });

  describe(Contracts.FTSO_REGISTRY, async () => {
    it(SHOULD_HAVE_TRANSFERRED_GOVERNANCE, async () => {
      await checkProductionSwitch(Contracts.FTSO_REGISTRY);
    });
  });

  describe(Contracts.WNAT, async () => {
    it(SHOULD_HAVE_TRANSFERRED_GOVERNANCE, async () => {
      await checkProductionSwitch(Contracts.WNAT);
    });
  });

  describe(Contracts.ESCROW, async () => {
    it(SHOULD_HAVE_TRANSFERRED_GOVERNANCE, async () => {
      await checkProductionSwitch(Contracts.ESCROW);
    });
  });

  describe(Contracts.VALIDATOR_REGISTRY, async () => {
    it(SHOULD_HAVE_TRANSFERRED_GOVERNANCE, async () => {
      await checkProductionSwitch(Contracts.VALIDATOR_REGISTRY);
    });
  });

  describe(Contracts.VALIDATOR_REWARD_MANAGER, async () => {
    it(SHOULD_HAVE_TRANSFERRED_GOVERNANCE, async () => {
      await checkProductionSwitch(Contracts.VALIDATOR_REWARD_MANAGER);
    });
  });

  describe(Contracts.POLLING_FOUNDATION, async () => {
    it(SHOULD_HAVE_TRANSFERRED_GOVERNANCE, async () => {
      await checkProductionSwitch(Contracts.POLLING_FOUNDATION);
    });
  });

  describe(Contracts.FLARE_ASSET_REGISTRY, async () => {
    it(SHOULD_HAVE_TRANSFERRED_GOVERNANCE, async () => {
      await checkProductionSwitch(Contracts.FLARE_ASSET_REGISTRY);
    });
  });

  describe(Contracts.CLAIM_SETUP_MANAGER, async () => {
    it(SHOULD_HAVE_TRANSFERRED_GOVERNANCE, async function() {
      await checkProductionSwitch(Contracts.CLAIM_SETUP_MANAGER);
    });
  });

  describe(Contracts.POLLING_FTSO, async () => {
    it(SHOULD_HAVE_TRANSFERRED_GOVERNANCE, async () => {
      await checkProductionSwitch(Contracts.POLLING_FTSO);
    });
  });

  describe(Contracts.P_CHAIN_STAKE_MIRROR_MULTI_SIG_VOTING, async () => {
    it(SHOULD_HAVE_TRANSFERRED_GOVERNANCE, async () => {
      await checkProductionSwitch(Contracts.P_CHAIN_STAKE_MIRROR_MULTI_SIG_VOTING);
    });
  });

  describe(Contracts.P_CHAIN_STAKE_MIRROR, async () => {
    it(SHOULD_HAVE_TRANSFERRED_GOVERNANCE, async () => {
      await checkProductionSwitch(Contracts.P_CHAIN_STAKE_MIRROR);
    });
  });

});
