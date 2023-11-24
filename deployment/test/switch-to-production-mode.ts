import { Contracts } from "../scripts/Contracts";
import {
  GovernanceSettingsInstance,
  GovernedBaseV2Contract,
} from "../../typechain-truffle";
import { ChainParameters } from "../chain-config/chain-parameters";

/**
 * This test assumes a chain is running with Flare allocated in accounts
 * listed in `./hardhat.config.ts`
 */
contract(`switch-to-production-mode.ts system tests`, async accounts => {
  let contracts: Contracts;
  let parameters: ChainParameters;
  let GovernedBaseV2: GovernedBaseV2Contract;
  let governanceSettings: GovernanceSettingsInstance;
  const SHOULD_HAVE_TRANSFERRED_GOVERNANCE = "Should have transferred governance";

  before(async () => {
    contracts = new Contracts();
    await contracts.deserialize(process.stdin);
    parameters = require("hardhat").getChainConfigParameters(process.env.CHAIN_CONFIG);
    GovernedBaseV2 = artifacts.require("GovernedBaseV2");
    const GovernanceSettings = artifacts.require("GovernanceSettings");
    governanceSettings = await GovernanceSettings.at(contracts.getContractAddress("GovernanceSettings"));
  });

  async function checkGovernancePointerContract(contractName: string) {
    // Assemble
    const governedBase = await GovernedBaseV2.at(contracts.getContractAddress(contractName));
    // Act
    const governancePointer = await governedBase.governanceSettings();
    // Assert
    assert.equal(governancePointer, governanceSettings.address);
  }

  async function checkGovernance(contractName: string) {
    // Assemble
    const governedBase = await GovernedBaseV2.at(contracts.getContractAddress(contractName));
    // Act
    const governance = await governedBase.governance();
    // Assert
    assert.equal(governance.toLowerCase(), parameters.governancePublicKey.toLowerCase());
  }

  async function checkProductionMode(contractName: string) {
    // Assemble
    const governedBase = await GovernedBaseV2.at(contracts.getContractAddress(contractName));
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

  describe(Contracts.FTSO_REGISTRY, async () => {
    it(SHOULD_HAVE_TRANSFERRED_GOVERNANCE, async () => {
      await checkProductionSwitch(Contracts.FTSO_REGISTRY);
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

});
