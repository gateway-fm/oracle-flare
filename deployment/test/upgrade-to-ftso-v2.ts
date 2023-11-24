import { constants } from '@openzeppelin/test-helpers';
import { pascalCase } from 'pascal-case';
import { waitFinalize3 } from "../../test/utils/test-helpers";
import {
  AddressUpdaterContract,
  AddressUpdaterInstance,
  AssetTokenContract, AssetTokenInstance, CleanupBlockNumberManagerContract, CleanupBlockNumberManagerInstance, DummyAssetMinterContract, FlareDaemonContract, FlareDaemonInstance, FtsoContract,
  FtsoInstance, FtsoManagerContract,
  FtsoManagerInstance, FtsoRegistryContract, FtsoRegistryInstance, FtsoRewardManagerContract,
  FtsoRewardManagerInstance, GovernanceSettingsInstance, GovernedBaseContract, GovernedBaseV2Contract, PollingFoundationContract, PollingFoundationInstance, PriceSubmitterContract, PriceSubmitterInstance, VoterWhitelisterContract, VoterWhitelisterInstance
} from "../../typechain-truffle";
import { ChainParameters } from '../chain-config/chain-parameters';
import { Contracts } from "../scripts/Contracts";
import { findAssetFtso, findFtso } from '../scripts/deploy-utils';

const parameters = require(`../chain-config/${process.env.CHAIN_CONFIG}.json`) as ChainParameters;

/**
 * This test assumes a local chain is running with Flare allocated in accounts
 * listed in `./hardhat.config.ts`
 */
contract(`upgrade-to-ftso-v2.ts system tests`, async accounts => {
  let contracts: Contracts;
  let GovernedBase: GovernedBaseContract;
  let GovernedBaseV2: GovernedBaseV2Contract;
  let governanceSettings: GovernanceSettingsInstance;
  let governancePublicKey: string;
  const SHOULD_HAVE_TRANSFERRED_GOVERNANCE = "Should have transferred governance";

  before(async () => {
    contracts = new Contracts();
    await contracts.deserialize(process.stdin);
    governancePublicKey = require("hardhat").getChainConfigParameters(process.env.CHAIN_CONFIG).governancePublicKey;
    GovernedBase = artifacts.require("GovernedBase");
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

  async function checkGovernanceV2(contractName: string) {
    // Assemble
    const governedBase = await GovernedBaseV2.at(contracts.getContractAddress(contractName));
    // Act
    const governance = await governedBase.governance();
    // Assert
    assert.equal(governance.toLowerCase(), governancePublicKey.toLowerCase());
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
    await checkGovernanceV2(contractName);
    await checkGovernancePointerContract(contractName);
  }

  async function checkGovernance(contractName: string) {
    // Assemble
    const governedBase = await GovernedBase.at(contracts.getContractAddress(contractName));
    // Act
    const governance = await governedBase.governance();
    // Assert
    assert.equal(governance.toLowerCase(), governancePublicKey.toLowerCase());
  }

  describe(Contracts.FLARE_DAEMON, async () => {
    let FlareDaemon: FlareDaemonContract;
    let flareDaemon: FlareDaemonInstance;

    before(async () => {
      FlareDaemon = artifacts.require("FlareDaemon") as FlareDaemonContract;
      flareDaemon = await FlareDaemon.at(contracts.getContractAddress(Contracts.FLARE_DAEMON));
    });

    it("Should be daemonizing inflation and new ftso manager", async () => {
      // Assemble
      // Act
      if (flareDaemon.address != parameters.flareDaemonAddress) {
        await flareDaemon.trigger();
      }
      const daemonizedContractsData = await flareDaemon.getDaemonizedContractsData();
      // Assert
      assert.equal(daemonizedContractsData[0][0], contracts.getContractAddress(Contracts.INFLATION));
      assert.equal(daemonizedContractsData[0][1], contracts.getContractAddress(Contracts.FTSO_MANAGER));
    });

    it(SHOULD_HAVE_TRANSFERRED_GOVERNANCE, async () => {
      await checkGovernance(Contracts.FLARE_DAEMON);
    });
  });

  describe(Contracts.FTSO_MANAGER, async () => {
    let FtsoManager: FtsoManagerContract;
    let ftsoManager: FtsoManagerInstance;

    before(async () => {
      FtsoManager = artifacts.require("FtsoManager");
      ftsoManager = await FtsoManager.at(contracts.getContractAddress(Contracts.FTSO_MANAGER));
    });

    it(SHOULD_HAVE_TRANSFERRED_GOVERNANCE, async () => {
      await checkProductionSwitch(Contracts.FTSO_MANAGER);
    });

    it("Should be activated", async () => {
      assert(await ftsoManager.active());
    });

    it("Should return old reward epoch data", async () => {
      // Assemble

      // Act
      const startBlock = (await ftsoManager.getRewardEpochData(0)).votepowerBlock;
      // Assert
      assert.notEqual(startBlock.toString(), "0");
    });

    it("Should know about PriceSubmitter", async () => {
      // Assemble
      // Act
      const address = await ftsoManager.priceSubmitter();
      // Assert
      assert.equal(address, contracts.getContractAddress(Contracts.PRICE_SUBMITTER));
    });

    it("Should know about FtsoRegistry", async () => {
      // Assemble
      // Act
      const address = await ftsoManager.ftsoRegistry();
      // Assert
      assert.equal(address, contracts.getContractAddress(Contracts.FTSO_REGISTRY));
    });

    it("Should know about FtsoRewardManager", async () => {
      // Assemble
      // Act
      const address = await ftsoManager.rewardManager();
      // Assert
      assert.equal(address, contracts.getContractAddress(Contracts.FTSO_REWARD_MANAGER));
    });

    it("Should know about CleanupBlockNumberManager", async () => {
      // Assemble
      // Act
      const address = await ftsoManager.cleanupBlockNumberManager();
      // Assert
      assert.equal(address, contracts.getContractAddress(Contracts.CLEANUP_BLOCK_NUMBER_MANAGER));
    });

    it("Should know about VoterWhitelister", async () => {
      // Assemble
      // Act
      const address = await ftsoManager.voterWhitelister();
      // Assert
      assert.equal(address, contracts.getContractAddress(Contracts.VOTER_WHITELISTER));
    });

    it("Should know about AddressUpdater", async () => {
      // Assemble
      // Act
      const address = await ftsoManager.getAddressUpdater();
      // Assert
      assert.equal(address, contracts.getContractAddress(Contracts.ADDRESS_UPDATER));
    });

    it("Should know about Supply", async () => {
      // Assemble
      // Act
      const address = await ftsoManager.supply();
      // Assert
      assert.equal(address, contracts.getContractAddress(Contracts.SUPPLY));
    });
  });

  describe(Contracts.FTSO_REWARD_MANAGER, async () => {
    let FtsoRewardManager: FtsoRewardManagerContract;
    let ftsoRewardManager: FtsoRewardManagerInstance;

    before(async () => {
      FtsoRewardManager = artifacts.require("FtsoRewardManager");
      ftsoRewardManager = await FtsoRewardManager.at(contracts.getContractAddress(Contracts.FTSO_REWARD_MANAGER));
    });

    it("Should know about the FTSO manager", async () => {
      // Assemble
      // Act
      const ftsoManager = await ftsoRewardManager.ftsoManager();
      // Assert
      assert.equal(ftsoManager, contracts.getContractAddress(Contracts.FTSO_MANAGER));
    });

    it(SHOULD_HAVE_TRANSFERRED_GOVERNANCE, async () => {
      await checkGovernance(Contracts.FTSO_REWARD_MANAGER);
    });
  });

  describe(Contracts.FTSO_REGISTRY, async () => {
    let FtsoRegistry: FtsoRegistryContract;
    let ftsoRegistry: FtsoRegistryInstance;

    before(async () => {
      FtsoRegistry = artifacts.require("FtsoRegistry");
      ftsoRegistry = await FtsoRegistry.at(contracts.getContractAddress(Contracts.FTSO_REGISTRY));
    });

    it("Should know about the FTSO manager", async () => {
      // Assemble
      // Act
      const ftsoManager = await ftsoRegistry.ftsoManager();
      // Assert
      assert.equal(ftsoManager, contracts.getContractAddress(Contracts.FTSO_MANAGER));
    });

    it(SHOULD_HAVE_TRANSFERRED_GOVERNANCE, async () => {
      await checkProductionSwitch(Contracts.FTSO_REGISTRY);
    });
  });

  describe(Contracts.POLLING_FOUNDATION, async () => {
    let PollingFoundation: PollingFoundationContract;
    let pollingFoundation: PollingFoundationInstance;

    before(async () => {
      PollingFoundation = artifacts.require("PollingFoundation");
      pollingFoundation = await PollingFoundation.at(contracts.getContractAddress(Contracts.POLLING_FOUNDATION));
    });

    it("Should know about the FTSO manager", async () => {
      // Assemble
      // Act
      const ftsoManager = await pollingFoundation.ftsoManager();
      // Assert
      assert.equal(ftsoManager, contracts.getContractAddress(Contracts.FTSO_MANAGER));
    });

    it("Should know about the FTSO registry", async () => {
      // Assemble
      // Act
      const ftsoRegistry = await pollingFoundation.ftsoRegistry();
      // Assert
      assert.equal(ftsoRegistry, contracts.getContractAddress(Contracts.FTSO_REGISTRY));
    });

    it("Should know about Supply", async () => {
      // Assemble
      // Act
      const address = await pollingFoundation.supply();
      // Assert
      assert.equal(address, contracts.getContractAddress(Contracts.SUPPLY));
    });

    it("Should know about GovernanceVotePower", async () => {
      // Assemble
      // Act
      const address = await pollingFoundation.votePower();
      // Assert
      assert.equal(address, contracts.getContractAddress(Contracts.GOVERNANCE_VOTE_POWER));
    });

    it(SHOULD_HAVE_TRANSFERRED_GOVERNANCE, async () => {
      await checkProductionSwitch(Contracts.POLLING_FOUNDATION);
    });
  });

  describe(Contracts.CLEANUP_BLOCK_NUMBER_MANAGER, async () => {
    let CleanupBlockNumberManager: CleanupBlockNumberManagerContract;
    let cleanupBlockNumberManager: CleanupBlockNumberManagerInstance;

    before(async () => {
      CleanupBlockNumberManager = artifacts.require("CleanupBlockNumberManager");
      cleanupBlockNumberManager = await CleanupBlockNumberManager.at(contracts.getContractAddress(Contracts.CLEANUP_BLOCK_NUMBER_MANAGER));
    });

    it("Should be triggered by the FTSO manager", async () => {
      // Assemble
      // Act
      const ftsoManager = await cleanupBlockNumberManager.triggerContract();
      // Assert
      assert.equal(ftsoManager, contracts.getContractAddress(Contracts.FTSO_MANAGER));
    });

    it(SHOULD_HAVE_TRANSFERRED_GOVERNANCE, async () => {
      await checkGovernance(Contracts.CLEANUP_BLOCK_NUMBER_MANAGER);
    });
  });

  describe(Contracts.VOTER_WHITELISTER, async () => {
    let VoterWhitelister: VoterWhitelisterContract;
    let voterWhitelister: VoterWhitelisterInstance;

    before(async () => {
      VoterWhitelister = artifacts.require("VoterWhitelister");
      voterWhitelister = await VoterWhitelister.at(contracts.getContractAddress(Contracts.VOTER_WHITELISTER));
    });

    it("Should know about the FTSO manager", async () => {
      // Assemble
      // Act
      const ftsoManager = await voterWhitelister.ftsoManager();
      // Assert
      assert.equal(ftsoManager, contracts.getContractAddress(Contracts.FTSO_MANAGER));
    });

    it("Should know about the FTSO registry", async () => {
      // Assemble
      // Act
      const ftsoRegistry = await voterWhitelister.ftsoRegistry();
      // Assert
      assert.equal(ftsoRegistry, contracts.getContractAddress(Contracts.FTSO_REGISTRY));
    });

    it(SHOULD_HAVE_TRANSFERRED_GOVERNANCE, async () => {
      await checkGovernance(Contracts.VOTER_WHITELISTER);
    });
  });

  describe(Contracts.PRICE_SUBMITTER, async () => {
    let PriceSubmitter: PriceSubmitterContract;
    let priceSubmitter: PriceSubmitterInstance;

    before(async () => {
      PriceSubmitter = artifacts.require("PriceSubmitter");
      priceSubmitter = await PriceSubmitter.at(contracts.getContractAddress(Contracts.PRICE_SUBMITTER));
    });

    it("Should know about the FTSO manager", async () => {
      // Assemble
      // Act
      const ftsoManager = await priceSubmitter.getFtsoManager();
      // Assert
      assert.equal(ftsoManager, contracts.getContractAddress(Contracts.FTSO_MANAGER));
    });

    it("Should know about the FTSO registry", async () => {
      // Assemble
      // Act
      const ftsoRegistry = await priceSubmitter.getFtsoRegistry();
      // Assert
      assert.equal(ftsoRegistry, contracts.getContractAddress(Contracts.FTSO_REGISTRY));
    });

    it(SHOULD_HAVE_TRANSFERRED_GOVERNANCE, async () => {
      await checkGovernance(Contracts.PRICE_SUBMITTER);
    });
  });

  if (parameters.deployNATFtso) {
    describe(Contracts.FTSO_WNAT, async () => {
      let FtsoWnat: FtsoContract;
      let ftsoWnat: FtsoInstance;

      before(async () => {
        FtsoWnat = artifacts.require("Ftso");
        ftsoWnat = await FtsoWnat.at(contracts.getContractAddress(Contracts.FTSO_WNAT));
      });

      if (parameters.deployNATFtso) {
        it("Should be on oracle for WNAT", async () => {
          // Assemble
          // Act
          const address = await ftsoWnat.wNat();
          // Assert
          assert.equal(address, contracts.getContractAddress(Contracts.WNAT));
        });
      }

      it("Should be managed", async () => {
        // Assemble
        // Act
        const ftsoManager = await ftsoWnat.ftsoManager();
        // Assert
        assert.equal(ftsoManager, contracts.getContractAddress(Contracts.FTSO_MANAGER));
      });

      it("Should know about PriceSubmitter", async () => {
        // Assemble
        // Act
        const priceSubmitter = await ftsoWnat.priceSubmitter();
        // Assert
        assert.equal(priceSubmitter, contracts.getContractAddress(Contracts.PRICE_SUBMITTER));
      });

      it("Should represent ftso decimals correctly", async () => {
        // Assemble
        // Act
        const decimals = await ftsoWnat.ASSET_PRICE_USD_DECIMALS();
        // Assert
        assert.equal(decimals.toNumber(), parameters.nativeFtsoDecimals);
      });

      it("Should have correct elastic band width set", async () => {
        // Assemble
        // Act
        const epochsConfiguration = await ftsoWnat.epochsConfiguration();
        // Assert
        assert.equal(epochsConfiguration[7].toNumber(), parameters.nativeElasticBandWidthPPM);
      });

      for (let asset of parameters.NATMultiAssets) {
        it(`Should know about ${asset} Asset FTSO`, async () => {
          // Assemble
          // Act
          const found = await findAssetFtso(ftsoWnat, contracts.getContractAddress(`Ftso${pascalCase(asset)}`));
          // Assert
          assert(found);
        });
      }
    });
  }

  for (let asset of [...parameters.assets]) {
    describe(pascalCase(`FTSO ${asset.assetSymbol}`), async () => {
      let FtsoAsset: FtsoContract;
      let ftsoAsset: FtsoInstance;

      before(async () => {
        FtsoAsset = artifacts.require("Ftso");
        ftsoAsset = await FtsoAsset.at(contracts.getContractAddress(`Ftso${pascalCase(asset.assetSymbol)}`));
      });

      it(`Should be on oracle for ${asset.assetSymbol}`, async () => {
        // Assemble
        // Act
        const address = await ftsoAsset.getAsset();
        // Assert
        assert.equal(address, constants.ZERO_ADDRESS);
      });

      it("Should be managed", async () => {
        // Assemble
        // Act
        const ftsoManager = await ftsoAsset.ftsoManager();
        // Assert
        assert.equal(ftsoManager, contracts.getContractAddress(Contracts.FTSO_MANAGER));
      });

      it("Should know about PriceSubmitter", async () => {
        // Assemble
        // Act
        const priceSubmitter = await ftsoAsset.priceSubmitter();
        // Assert
        assert.equal(priceSubmitter, contracts.getContractAddress(Contracts.PRICE_SUBMITTER));
      });

      it("Should represent ftso decimals correctly", async () => {
        // Assemble
        // Act
        const decimals = await ftsoAsset.ASSET_PRICE_USD_DECIMALS();
        // Assert
        assert.equal(decimals.toNumber(), asset.ftsoDecimals);
      });

      it("Should have correct elastic band width set", async () => {
        // Assemble
        // Act
        const epochsConfiguration = await ftsoAsset.epochsConfiguration();
        // Assert
        assert.equal(epochsConfiguration[7].toNumber(), asset.elasticBandWidthPPM);
      });
    });
  }

  describe(Contracts.FTSO_MANAGER, async () => {
    let FtsoManager: FtsoManagerContract;
    let ftsoManager: FtsoManagerInstance;

    before(async () => {
      FtsoManager = artifacts.require("FtsoManager");
      ftsoManager = await FtsoManager.at(contracts.getContractAddress(Contracts.FTSO_MANAGER));
    });

    for (let asset of parameters.assets) {
      it(`Should be managing an ${asset.assetSymbol} FTSO`, async () => {
        // Assemble
        // Act
        const found = await findFtso(ftsoManager, contracts.getContractAddress(`Ftso${pascalCase(asset.assetSymbol)}`));
        // Assert
        assert(found);
      });
    }

    if (parameters.deployNATFtso) {
      it("Should be managing a WNAT FTSO", async () => {
        // Assemble
        // Act
        const found = await findFtso(ftsoManager, contracts.getContractAddress(Contracts.FTSO_WNAT));
        // Assert
        assert(found);
      });
    }

    it("Should have goveranance parameters set", async () => {
      // Assemble
      const settings = await ftsoManager.getGovernanceParameters();
      // Act
      const maxVotePowerNatThresholdFraction = settings[0];
      const maxVotePowerAssetThresholdFraction = settings[1];
      const lowAssetThresholdUSDDec5 = settings[2];
      const highAssetThresholdUSDDec5 = settings[3];
      const highAssetTurnoutThresholdBIPS = settings[4];
      const lowNatTurnoutThresholdBIPS = settings[5];
      const elasticBandRewardBIPS = settings[6];
      // Assert
      assert.equal(maxVotePowerNatThresholdFraction.toNumber(), parameters.maxVotePowerNatThresholdFraction);
      assert.equal(maxVotePowerAssetThresholdFraction.toNumber(), parameters.maxVotePowerAssetThresholdFraction);
      assert.equal(lowAssetThresholdUSDDec5.toNumber(), parameters.lowAssetThresholdUSDDec5);
      assert.equal(highAssetThresholdUSDDec5.toNumber(), parameters.highAssetThresholdUSDDec5);
      assert.equal(highAssetTurnoutThresholdBIPS.toNumber(), parameters.highAssetTurnoutThresholdBIPS);
      assert.equal(lowNatTurnoutThresholdBIPS.toNumber(), parameters.lowNatTurnoutThresholdBIPS);
      assert.equal(elasticBandRewardBIPS.toNumber(), parameters.elasticBandRewardBIPS);
    });
  });

  describe(Contracts.ADDRESS_UPDATER, async () => {
    let AddressUpdater: AddressUpdaterContract;
    let addressUpdater: AddressUpdaterInstance;

    before(async () => {
      AddressUpdater = artifacts.require("AddressUpdater");
      addressUpdater = await AddressUpdater.at(contracts.getContractAddress(Contracts.ADDRESS_UPDATER));
    });

    it("Should know about all contracts", async () => {
      let contractNames = [Contracts.STATE_CONNECTOR, Contracts.FLARE_DAEMON, Contracts.PRICE_SUBMITTER, Contracts.WNAT,
        Contracts.FTSO_REWARD_MANAGER, Contracts.CLEANUP_BLOCK_NUMBER_MANAGER, Contracts.FTSO_REGISTRY, Contracts.VOTER_WHITELISTER,
        Contracts.SUPPLY, Contracts.INFLATION_ALLOCATION, Contracts.INFLATION, Contracts.ADDRESS_UPDATER, Contracts.FTSO_MANAGER,
        Contracts.GOVERNANCE_VOTE_POWER, Contracts.GOVERNANCE_SETTINGS, Contracts.POLLING_FOUNDATION];

      for (let name of contractNames) {
        // Act
        const address = await addressUpdater.getContractAddress(name);
        // Assert
        assert.equal(address, contracts.getContractAddress(name));
      }
    });

    it(SHOULD_HAVE_TRANSFERRED_GOVERNANCE, async () => {
      await checkProductionSwitch(Contracts.ADDRESS_UPDATER);
    });
  });
});
