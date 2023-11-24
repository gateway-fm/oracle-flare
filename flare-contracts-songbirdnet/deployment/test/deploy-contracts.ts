import { constants, time } from '@openzeppelin/test-helpers';
import { pascalCase } from 'pascal-case';
import { waitFinalize3 } from "../../test/utils/test-helpers";
import {
  AddressUpdatableContract,
  AddressUpdaterContract,
  AddressUpdaterInstance,
  AssetTokenContract, AssetTokenInstance, DummyAssetMinterContract,
  FlareDaemonContract, FlareDaemonInstance, FtsoContract,
  FtsoInstance, FtsoManagerContract,
  FtsoManagerInstance, FtsoRewardManagerContract,
  FtsoRewardManagerInstance, GovernanceSettingsContract, GovernanceSettingsInstance, GovernanceVotePowerContract, GovernanceVotePowerInstance, InflationAllocationContract,
  InflationAllocationInstance, InflationContract,
  InflationInstance, SupplyContract,
  SupplyInstance, WNatContract, WNatInstance
} from "../../typechain-truffle";
import { ChainParameters } from '../chain-config/chain-parameters';
import { Contracts } from "../scripts/Contracts";
import { findAssetFtso, findFtso } from '../scripts/deploy-utils';

const parameters = require("hardhat").getChainConfigParameters(process.env.CHAIN_CONFIG) as ChainParameters;
const BN = web3.utils.toBN;

/**
 * This test assumes a local chain is running with Flare allocated in accounts
 * listed in `./hardhat.config.ts`
 */
contract(`deploy-contracts.ts system tests`, async accounts => {
  let contracts: Contracts;
  let deployerAccountAddress = accounts[0];

  before(async () => {
    contracts = new Contracts();
    await contracts.deserialize(process.stdin);
  });

  describe(Contracts.GOVERNANCE_SETTINGS, async () => {
    let GovernanceSettings: GovernanceSettingsContract;
    let governanceSettings: GovernanceSettingsInstance;

    beforeEach(async () => {
      GovernanceSettings = artifacts.require("GovernanceSettings");
      governanceSettings = await GovernanceSettings.at(contracts.getContractAddress(Contracts.GOVERNANCE_SETTINGS));
    });

    it("Should have correct governance address", async () => {
      // Assemble
      // Act
      const governance = await governanceSettings.getGovernanceAddress();
      // Assert
      assert.equal(governance, parameters.governancePublicKey);
    });

    it("Should have correct timelock", async () => {
      // Assemble
      // Act
      const timelock = await governanceSettings.getTimelock();
      // Assert
      assert.equal(Number(timelock), parameters.governanceTimelock);
    });

    it("Should have correct initial executors", async () => {
      // Assemble
      // Act
      const executors = await governanceSettings.getExecutors();
      // Assert
      assert.isTrue(executors.length === 1 || executors.length === 2);
      assert.equal(executors[0], parameters.governancePublicKey);
      if (executors.length === 2) {
        assert.equal(executors[1], parameters.governanceExecutorPublicKey);
      }
    });
  });

  describe(Contracts.SUPPLY, async () => {
    let Supply: SupplyContract;
    let supply: SupplyInstance;

    beforeEach(async () => {
      Supply = artifacts.require("Supply");
      supply = await Supply.at(contracts.getContractAddress(Contracts.SUPPLY));
    });

    it("Should have an inflatable balance > 0", async () => {
      // Assemble
      // Act
      const inflatableBalance = await supply.getInflatableBalance();
      // Assert
      assert(inflatableBalance.gt(BN(0)));
    });
  });

  describe(Contracts.INFLATION_ALLOCATION, async () => {
    let InflationAllocation: InflationAllocationContract;
    let inflationAllocation: InflationAllocationInstance;
    let FtsoRewardManager: FtsoRewardManagerContract;
    let ftsoRewardManager: FtsoRewardManagerInstance;

    beforeEach(async () => {
      InflationAllocation = artifacts.require("InflationAllocation");
      inflationAllocation = await InflationAllocation.at(contracts.getContractAddress(Contracts.INFLATION_ALLOCATION));
      if (parameters.inflationReceivers.indexOf("FtsoRewardManager") >= 0) {
        FtsoRewardManager = artifacts.require("FtsoRewardManager");
        ftsoRewardManager = await FtsoRewardManager.at(contracts.getContractAddress(Contracts.FTSO_REWARD_MANAGER));
      }
    });

    it("Should have reward managers set", async () => {
      // Assemble
      // Act
      const sharingPctData = await inflationAllocation.getSharingPercentages();
      // console.log(sharingPctData);
      // Assert
      for (let i = 0; i < parameters.inflationReceivers.length; i++) {
        let receiverName = parameters.inflationReceivers[i];
        let receiverSharingBIPS = parameters.inflationSharingBIPS[i];
        let receiverAddress = "";
        switch (receiverName) {
          case "FtsoRewardManager":
            receiverAddress = ftsoRewardManager.address
            break;
          default:
            throw Error(`Unknown inflation receiver name ${receiverName}`)
        }
        assert.equal(receiverAddress, sharingPctData[i].inflationReceiver);
        assert.equal(BN(receiverSharingBIPS), sharingPctData[i].percentBips);

      }
    });

    it("Should fetch last time slot inflation percentage", async () => {
      // Assemble
      // Act
      const percentage = await inflationAllocation.lastTimeSlotInflationPercentageBips();
      // Assert
      assert(percentage.gt(BN(0)));
    });

    it("Should new time slot inflation percentage be correct", async () => {
      // Assemble
      // Act
      const percentage = await inflationAllocation.timeSlotInflationPercentagesBips(0);
      const percentage2 = await inflationAllocation.lastTimeSlotInflationPercentageBips();
      // Assert
      assert(percentage.eq(BN(parameters.scheduledInflationPercentageBIPS[0])));
      assert(percentage2.eq(BN(parameters.scheduledInflationPercentageBIPS[0])));
    });
  });

  describe(Contracts.FLARE_DAEMON, async () => {
    let FlareDaemon: FlareDaemonContract;
    let flareDaemon: FlareDaemonInstance;

    beforeEach(async () => {
      FlareDaemon = artifacts.require("FlareDaemon") as FlareDaemonContract;
      flareDaemon = await FlareDaemon.at(contracts.getContractAddress(Contracts.FLARE_DAEMON));
    });

    it("Should know about Inflation", async () => {
      // Assemble
      // Act
      const address = await flareDaemon.inflation();
      // Assert
      assert.equal(address, contracts.getContractAddress(Contracts.INFLATION));
    });

    it("Should be daemonizing", async () => {
      // Assemble
      // Act
      if (flareDaemon.address != parameters.flareDaemonAddress) {
        await flareDaemon.trigger();
      }
      const systemLastTriggeredAt = await flareDaemon.systemLastTriggeredAt();
      // Assert
      assert(systemLastTriggeredAt.toNumber() > 0);
    });

    it("Should have block holdoff set", async () => {
      // Assemble
      // Act
      const blockHoldoff = await flareDaemon.blockHoldoff();
      // Assert
      assert.equal(blockHoldoff.toString(), parameters.flareDaemonGasExceededHoldoffBlocks.toString());
    })
  });

  describe(Contracts.FTSO_MANAGER, async () => {
    let FtsoManager: FtsoManagerContract;
    let ftsoManager: FtsoManagerInstance;

    beforeEach(async () => {
      FtsoManager = artifacts.require("FtsoManager");
      ftsoManager = await FtsoManager.at(contracts.getContractAddress(Contracts.FTSO_MANAGER));
    });

    it("Should have a reward epoch if rewarding started and being daemonized by daemon", async () => {
      // Assemble
      const startTs = await time.latest();
      const rewardEpochStartTs = (await ftsoManager.getRewardEpochConfiguration())[0];
      if (rewardEpochStartTs.lt(startTs) && await ftsoManager.active()) {
        // Act
        const startBlock = (await ftsoManager.getRewardEpochData(0)).votepowerBlock;
        // Assert
        // If the daemon is calling daemonize on the RewardManager, then there should be
        // an active reward epoch.
        assert(startBlock.toNumber() != 0);
      }
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

  describe(Contracts.INFLATION, async () => {
    let Inflation: InflationContract;
    let inflation: InflationInstance;
    let Supply: SupplyContract;
    let supply: SupplyInstance;
    let FlareDaemon: FlareDaemonContract;
    let flareDaemon: FlareDaemonInstance;

    beforeEach(async () => {
      Inflation = artifacts.require("Inflation");
      inflation = await Inflation.at(contracts.getContractAddress(Contracts.INFLATION));
      Supply = artifacts.require("Supply");
      supply = await Supply.at(contracts.getContractAddress(Contracts.SUPPLY));
      FlareDaemon = artifacts.require("FlareDaemon");
      flareDaemon = await FlareDaemon.at(contracts.getContractAddress(Contracts.FLARE_DAEMON));
    });

    it("Should know about supply contract", async () => {
      // Assemble
      // Act
      const address = await inflation.supply();
      // Assert
      assert.equal(address, supply.address);
    });

    it("Should know about flare daemon contract", async () => {
      // Assemble
      // Act
      const address = await inflation.flareDaemon();
      // Assert
      assert.equal(address, flareDaemon.address);
    });
  });

  describe(Contracts.FTSO_REWARD_MANAGER, async () => {
    let FtsoRewardManager: FtsoRewardManagerContract;
    let ftsoRewardManager: FtsoRewardManagerInstance;

    beforeEach(async () => {
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
  });

  describe(Contracts.GOVERNANCE_VOTE_POWER, async () => {
    let GovernanceVotePower: GovernanceVotePowerContract;
    let governanceVotePower: GovernanceVotePowerInstance;

    beforeEach(async () => {
      GovernanceVotePower = artifacts.require("GovernanceVotePower") ;
      governanceVotePower = await GovernanceVotePower.at(contracts.getContractAddress(Contracts.GOVERNANCE_VOTE_POWER));
    });

    it("Should know about WNat", async () => {
      // Assemble
      // Act
      const address = await governanceVotePower.ownerToken();
      // Assert
      assert.equal(address, contracts.getContractAddress(Contracts.WNAT));
    });
  });

  describe(Contracts.WNAT, async () => {
    let WNAT: WNatContract;
    let wnat: WNatInstance;

    beforeEach(async () => {
      WNAT = artifacts.require("WNat") ;
      wnat = await WNAT.at(contracts.getContractAddress(Contracts.WNAT));
    });

    it("Should accept deposits", async () => {
      // Assemble
      const openingBalance = await wnat.balanceOf(deployerAccountAddress)
      // Act
      await waitFinalize3(deployerAccountAddress, () => wnat.deposit({ from: deployerAccountAddress, value: BN(10) }));
      // Assert
      const balance = await wnat.balanceOf(deployerAccountAddress)
      assert.equal(balance.toNumber() - openingBalance.toNumber(), 10);
    });

    it("Should know about GovernanceVotePower", async () => {
      // Assemble
      // Act
      const governanceVotePower = await wnat.governanceVotePower();
      // Assert
      assert.equal(governanceVotePower, contracts.getContractAddress(Contracts.GOVERNANCE_VOTE_POWER));
    });
  });

  if (parameters.deployDummyXAssetTokensAndMinters) {
    for (let asset of parameters.assets) {
      describe(`Dummy${asset.xAssetSymbol}minter`, async () => {
        it("Should mint ", async () => {
          // Assemble
          const DummyAssetMinter = artifacts.require("DummyAssetMinter") as DummyAssetMinterContract;
          const dummyAssetMinter = await DummyAssetMinter.at(contracts.getContractAddress(`Dummy${asset.xAssetSymbol}minter`));
          const FAsset = artifacts.require("AssetToken") as AssetTokenContract;
          const fAsset = await FAsset.at(contracts.getContractAddress(asset.xAssetSymbol));
          const openingBalance = await fAsset.balanceOf(accounts[1])
          // Act
          await waitFinalize3(accounts[0], () => dummyAssetMinter.mintRequest(10, accounts[1], constants.ZERO_ADDRESS));
          // Assert
          const balance = await fAsset.balanceOf(accounts[1])
          assert.equal(balance.toNumber() - openingBalance.toNumber(), 10);
        });
      });
    }
  }

  if (parameters.deployNATFtso) {
    describe(Contracts.FTSO_WNAT, async () => {
      let FtsoWnat: FtsoContract;
      let ftsoWnat: FtsoInstance;

      beforeEach(async () => {
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

  for (let asset of parameters.assets) {
    describe(pascalCase(`FTSO ${asset.assetSymbol}`), async () => {
      let FtsoAsset: FtsoContract;
      let ftsoAsset: FtsoInstance;

      beforeEach(async () => {
        FtsoAsset = artifacts.require("Ftso");
        ftsoAsset = await FtsoAsset.at(contracts.getContractAddress(`Ftso${pascalCase(asset.assetSymbol)}`));
      });

      it(`Should be on oracle for ${asset.assetSymbol}`, async () => {
        // Assemble
        // Act
        const address = await ftsoAsset.getAsset();
        // Assert
        if (parameters.deployDummyXAssetTokensAndMinters) {
          assert.equal(address, contracts.getContractAddress(asset.xAssetSymbol));
        } else {
          assert.equal(address, constants.ZERO_ADDRESS);
        }
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

  if (parameters.deployDummyXAssetTokensAndMinters) {
    for (let asset of parameters.assets) {
      describe(`${asset.xAssetSymbol}`, async () => {
        let FAsset: AssetTokenContract;
        let fAsset: AssetTokenInstance;

        beforeEach(async () => {
          FAsset = artifacts.require("AssetToken");
          fAsset = await FAsset.at(contracts.getContractAddress(`${asset.xAssetSymbol}`));
        });

        it(`Should be an asset representing ${asset.assetSymbol}`, async () => {
          // Assemble
          // Act
          const symbol = await fAsset.symbol();
          // Assert
          assert.equal(symbol, asset.xAssetSymbol);
        });

        it(`Should represent ${asset.assetSymbol} decimals correctly`, async () => {
          // Assemble
          // Act
          const decimals = await fAsset.decimals();
          // Assert
          assert.equal(decimals.toNumber(), asset.assetDecimals);
        });
      });
    }
  }

  describe(Contracts.FTSO_MANAGER, async () => {
    let FtsoManager: FtsoManagerContract;
    let ftsoManager: FtsoManagerInstance;

    beforeEach(async () => {
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

      it(`Should have correct elastic band width set for ${asset.assetSymbol} FTSO`, async () => {
        // Assemble
        // Act
        const elasticBandWidthPPM = await ftsoManager.getElasticBandWidthPPMFtso(contracts.getContractAddress(`Ftso${pascalCase(asset.assetSymbol)}`));
        // Assert
        assert.equal(elasticBandWidthPPM.toNumber(), asset.elasticBandWidthPPM);
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

      it("Should have correct elastic band width set fro WNAT FTSO", async () => {
        // Assemble
        // Act
        const elasticBandWidthPPM = await ftsoManager.getElasticBandWidthPPMFtso(contracts.getContractAddress(Contracts.FTSO_WNAT));
        // Assert
        assert.equal(elasticBandWidthPPM.toNumber(), parameters.nativeElasticBandWidthPPM);
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
    let AddressUpdatable: AddressUpdatableContract;

    beforeEach(async () => {
      AddressUpdater = artifacts.require("AddressUpdater");
      AddressUpdatable = artifacts.require("AddressUpdatable");
      addressUpdater = await AddressUpdater.at(contracts.getContractAddress(Contracts.ADDRESS_UPDATER));
    });

    it("Should know about all contracts", async () => {
      let contractNames = [Contracts.STATE_CONNECTOR, Contracts.FLARE_DAEMON, Contracts.PRICE_SUBMITTER, Contracts.WNAT,
        Contracts.FTSO_REWARD_MANAGER, Contracts.CLEANUP_BLOCK_NUMBER_MANAGER, Contracts.FTSO_REGISTRY, Contracts.VOTER_WHITELISTER, Contracts.CLAIM_SETUP_MANAGER,
        Contracts.SUPPLY, Contracts.INFLATION_ALLOCATION, Contracts.INFLATION, Contracts.ADDRESS_UPDATER, Contracts.FTSO_MANAGER, Contracts.GOVERNANCE_VOTE_POWER, Contracts.FLARE_CONTRACT_REGISTRY,
        Contracts.GOVERNANCE_SETTINGS, Contracts.POLLING_FOUNDATION, Contracts.FLARE_ASSET_REGISTRY, Contracts.POLLING_FTSO];

      for (let name of contractNames) {
        // Act
        const address = await addressUpdater.getContractAddress(name);
        // Assert
        assert.equal(address, contracts.getContractAddress(name));
      }
    });

    it("Address updatable contracts should know about address updater", async () => {
      let contractNames = [Contracts.FTSO_REWARD_MANAGER, Contracts.CLEANUP_BLOCK_NUMBER_MANAGER, Contracts.CLAIM_SETUP_MANAGER, Contracts.FLARE_CONTRACT_REGISTRY,
        Contracts.FTSO_REGISTRY, Contracts.VOTER_WHITELISTER, Contracts.SUPPLY, Contracts.INFLATION_ALLOCATION, Contracts.INFLATION, Contracts.FTSO_MANAGER,
        Contracts.POLLING_FOUNDATION, Contracts.WNAT_REGISTRY_PROVIDER, Contracts.POLLING_FTSO];

      for (let name of contractNames) {
        // Act
        let addressUpdatable = await AddressUpdatable.at(contracts.getContractAddress(name));
        // Assert
        assert.equal(await addressUpdatable.getAddressUpdater(), addressUpdater.address);
      }
    });
  });
});
