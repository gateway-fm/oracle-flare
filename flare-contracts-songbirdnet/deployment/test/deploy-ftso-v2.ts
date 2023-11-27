import { constants } from '@openzeppelin/test-helpers';
import { pascalCase } from 'pascal-case';
import {
  AddressUpdaterContract,
  AddressUpdaterInstance,
  AssetTokenContract, AssetTokenInstance, FtsoContract,
  FtsoInstance, FtsoManagerContract,
  FtsoManagerInstance,
  FtsoV2UpgraderContract,
  FtsoV2UpgraderInstance
} from "../../typechain-truffle";
import { Contracts } from "../scripts/Contracts";

const parameters = require(`../chain-config/${process.env.CHAIN_CONFIG}.json`);


/**
 * This test assumes a local chain is running with Flare allocated in accounts
 * listed in `./hardhat.config.ts`
 */
contract(`deploy-ftso-v2.ts system tests`, async accounts => {
  let contracts: Contracts;
  let governancePublicKey: string;

  before(async () => {
    contracts = new Contracts();
    await contracts.deserialize(process.stdin);
    governancePublicKey = require("hardhat").getChainConfigParameters(process.env.CHAIN_CONFIG).governancePublicKey;
  });

  describe(Contracts.FTSO_MANAGER, async () => {
    let FtsoManager: FtsoManagerContract;
    let ftsoManager: FtsoManagerInstance;

    before(async () => {
      FtsoManager = artifacts.require("FtsoManager");
      ftsoManager = await FtsoManager.at(contracts.getContractAddress(Contracts.FTSO_MANAGER));
    });

    it("Should have governance set to switcher contract", async () => {
      // Act
      const governance = await ftsoManager.governance();
      // Assert
      assert.equal(governance, contracts.getContractAddress(Contracts.FTSO_V2_UPGRADER));
    });

    it("Should know about PriceSubmitter", async () => {
      // Assemble
      // Act
      const address = await ftsoManager.priceSubmitter();
      // Assert
      assert.equal(address, contracts.getContractAddress(Contracts.PRICE_SUBMITTER));
    });

    it("Should know about old FtsoRegistry", async () => {
      // Assemble
      // Act
      const PriceSubmitter = artifacts.require("PriceSubmitter");
      const priceSubmitter = await PriceSubmitter.at(await ftsoManager.priceSubmitter());
      const oldFtsoRegistryAddress = await priceSubmitter.getFtsoRegistry();
      const address = await ftsoManager.ftsoRegistry();
      // Assert
      assert.equal(address, oldFtsoRegistryAddress);
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

  if (parameters.deployNATFtso) {
    describe(Contracts.FTSO_WNAT, async () => {
      let FtsoWnat: FtsoContract;
      let ftsoWnat: FtsoInstance;

      before(async () => {
        FtsoWnat = artifacts.require("Ftso");
        ftsoWnat = await FtsoWnat.at(contracts.getContractAddress(Contracts.FTSO_WNAT));
      });

      it("Should be on oracle for WNAT", async () => {
        // Assemble
        // Act
        const address = await ftsoWnat.wNat();
        // Assert
        assert.equal(address, contracts.getContractAddress(Contracts.WNAT));
      });

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
    });
  }

  for (let asset of parameters.assets) {
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
    });
  }

  describe(Contracts.ADDRESS_UPDATER, async () => {
    let AddressUpdater: AddressUpdaterContract;
    let addressUpdater: AddressUpdaterInstance;

    before(async () => {
      AddressUpdater = artifacts.require("AddressUpdater");
      addressUpdater = await AddressUpdater.at(contracts.getContractAddress(Contracts.ADDRESS_UPDATER));
    });

    it("Should have governance set to switcher contract", async () => {
      // Act
      const governance = await addressUpdater.governance();
      // Assert
      assert.equal(governance, contracts.getContractAddress(Contracts.FTSO_V2_UPGRADER));
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

  });

  describe(Contracts.FTSO_V2_UPGRADER, async () => {
    let FtsoV2Upgrader: FtsoV2UpgraderContract;
    let ftsoV2Upgrader: FtsoV2UpgraderInstance;

    before(async () => {
      FtsoV2Upgrader = artifacts.require("FtsoV2Upgrader");
      ftsoV2Upgrader = await FtsoV2Upgrader.at(contracts.getContractAddress(Contracts.FTSO_V2_UPGRADER));
    });

    it("Should have transferred governance", async () => {
      // Act
      const governance = await ftsoV2Upgrader.governance();
      // Assert
      assert.equal(governance.toLowerCase(), governancePublicKey.toLowerCase());
    });

    for (let asset of parameters.assets) {
      it(`Should know about the ${asset.assetSymbol} FTSO`, async () => {
        // Assemble
        // Act
        const found = await findFtso(ftsoV2Upgrader, contracts.getContractAddress(`Ftso${pascalCase(asset.assetSymbol)}`));
        // Assert
        assert(found);
      });
    }

    if (parameters.deployNATFtso) {
      it("Should know about WNAT FTSO", async () => {
        // Assemble
        // Act
        const found = await findFtso(ftsoV2Upgrader, contracts.getContractAddress(Contracts.FTSO_WNAT));
        // Assert
        assert(found);
      });

      for (let asset of parameters.NATMultiAssets) {
        it(`Should know about ${asset} Asset FTSO`, async () => {
          // Assemble
          // Act
          const found = await findAssetFtso(ftsoV2Upgrader, contracts.getContractAddress(`Ftso${pascalCase(asset)}`));
          // Assert
          assert(found);
        });
      }
    }
  });
});

export async function findAssetFtso(ftsoV2Upgrader: FtsoV2UpgraderInstance, address: string): Promise<boolean> {
  let xAssetFtsos = await ftsoV2Upgrader.getAssetFtsos();
  let found = false;
  xAssetFtsos.forEach((ftso) => {
    if (ftso == address) found = true;
  });
  return found;
}

async function findFtso(ftsoV2Upgrader: FtsoV2UpgraderInstance, address: string): Promise<boolean> {
  let ftsos = await ftsoV2Upgrader.getNewFtsos();
  let found = false;
  ftsos.forEach((ftso) => {
    if (ftso == address) found = true;
  });
  return found;
}
