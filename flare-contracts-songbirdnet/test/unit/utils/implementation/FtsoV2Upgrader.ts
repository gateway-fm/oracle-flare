import { constants, expectRevert, time } from '@openzeppelin/test-helpers';
import {
    AddressUpdaterInstance, FtsoManagerInstance, FtsoManagerV1MockInstance, FtsoRewardManagerInstance, FtsoV2UpgraderInstance, MockContractInstance
} from "../../../../typechain-truffle";
import { getTestFile, GOVERNANCE_GENESIS_ADDRESS, GOVERNANCE_SETTINGS_ADDRESS } from "../../../utils/constants";
import { testDeployGovernanceSettings } from '../../../utils/contract-test-helpers';
import { compareArrays, compareNumberArrays, encodeContractNames } from '../../../utils/test-helpers';

const MockContract = artifacts.require("MockContract");
const AddressUpdater = artifacts.require("AddressUpdater");
const PriceSubmitter = artifacts.require("PriceSubmitter");
const VoterWhitelister = artifacts.require("VoterWhitelister");
const CleanupBlockNumberManager = artifacts.require("CleanupBlockNumberManager");
const FlareDaemon = artifacts.require("TestableFlareDaemon");
const OldFtsoRegistry = artifacts.require("FtsoRegistryV1Mock");
const FtsoRewardManager = artifacts.require("FtsoRewardManager");
const OldFtsoManager = artifacts.require("FtsoManagerV1Mock");
const FtsoManagement = artifacts.require("FtsoManagement");
const FtsoManager = artifacts.require("FtsoManager");
const FtsoV2Upgrader = artifacts.require("FtsoV2Upgrader");
const DataProviderFee = artifacts.require("DataProviderFee" as any);

const PRICE_EPOCH_DURATION_S = 120;   // 2 minutes
const REVEAL_EPOCH_DURATION_S = 30;
const REWARD_EPOCH_DURATION_S = 2 * 24 * 60 * 60; // 2 days
const VOTE_POWER_BOUNDARY_FRACTION = 7;

contract(`FtsoV2Upgrader.sol; ${ getTestFile(__filename) }; FtsoV2Upgrader unit tests`, async accounts => {

    const governance = GOVERNANCE_GENESIS_ADDRESS;
    let startTs: BN;
    let addressUpdater: AddressUpdaterInstance;
    let oldFtsoManagerMock: MockContractInstance;
    let oldFtsoRegistryMock: MockContractInstance;
    let ftsoV2Upgrader: FtsoV2UpgraderInstance;
    
    let ftsoManagerInterface: FtsoManagerInstance;
    let oldFtsoManagerInterface: FtsoManagerV1MockInstance;
    let ftsoRewardManagerInterface: FtsoRewardManagerInstance;

    before(async () => {
        FtsoManager.link(await FtsoManagement.new() as any);
        FtsoRewardManager.link(await DataProviderFee.new() as any);
        await testDeployGovernanceSettings(governance, 1, [governance]);
    });

    beforeEach(async () => {
        oldFtsoManagerMock = await MockContract.new();
        oldFtsoRegistryMock = await MockContract.new();
        ftsoV2Upgrader = await FtsoV2Upgrader.new(governance, oldFtsoManagerMock.address);
        addressUpdater = await AddressUpdater.new(ftsoV2Upgrader.address);

        // Get the timestamp for the just mined block
        startTs = await time.latest();

        ftsoManagerInterface = await FtsoManager.new(
            governance,
            accounts[0],
            accounts[0],
            constants.ZERO_ADDRESS,
            startTs,
            PRICE_EPOCH_DURATION_S,
            REVEAL_EPOCH_DURATION_S,
            startTs.addn(REVEAL_EPOCH_DURATION_S),
            REWARD_EPOCH_DURATION_S,
            VOTE_POWER_BOUNDARY_FRACTION
        );

        oldFtsoManagerInterface = await OldFtsoManager.new(
            governance,
            accounts[0],
            constants.ZERO_ADDRESS,
            constants.ZERO_ADDRESS,
            startTs,
            PRICE_EPOCH_DURATION_S,
            REVEAL_EPOCH_DURATION_S,
            startTs.addn(REVEAL_EPOCH_DURATION_S),
            REWARD_EPOCH_DURATION_S);

        ftsoRewardManagerInterface = await FtsoRewardManager.new(
            governance,
            addressUpdater.address,
            constants.ZERO_ADDRESS,
            3,
            2000
        );
    });

    it("Should know about governance", async () => {
        // Assemble
        // Act
        // Assert
        assert.equal(await ftsoV2Upgrader.governance(), governance);
    });

    it("Should set upgrade data", async() => {
        // Assemble
        const ftsos = [accounts[1], accounts[2], accounts[3], accounts[4]];
        const elasticBandWidths = [200, 20, 100, 50];
        const assetFtsos = [accounts[2], accounts[3]];
        // Act
        await ftsoV2Upgrader.setUpgradeData(ftsos, elasticBandWidths, accounts[1], assetFtsos, { from: governance });
        // Assert
        compareArrays(await ftsoV2Upgrader.getNewFtsos(), ftsos);
        compareNumberArrays(await ftsoV2Upgrader.getElasticBandRewardWidthsPPM(), elasticBandWidths);
        expect(await ftsoV2Upgrader.getNativeFtso()).to.equals(accounts[1]);
        compareArrays(await ftsoV2Upgrader.getAssetFtsos(), assetFtsos);
    });

    it("Should revert setting ftsos if not from governance", async() => {
        // Assemble
        const ftsos = [accounts[1], accounts[2], accounts[3], accounts[4]];
        const elasticBandWidths = [200, 20, 100, 50];
        const assetFtsos = [accounts[2], accounts[3]];
        // Act
        const setPromise = ftsoV2Upgrader.setUpgradeData(ftsos, elasticBandWidths, accounts[1], assetFtsos);
        // Assert
        await expectRevert(setPromise, "only governance")
    });

    it("Should revert calling upgrade if not from governance", async() => {
        // Assemble
        const ftsos = [accounts[1], accounts[2], accounts[3], accounts[4]];
        const elasticBandWidths = [200, 20, 100, 50];
        const assetFtsos = [accounts[2], accounts[3]];
        await ftsoV2Upgrader.setUpgradeData(ftsos, elasticBandWidths, accounts[1], assetFtsos, { from: governance });
        // Act
        const upgradePromise = ftsoV2Upgrader.upgrade();
        // Assert
        await expectRevert(upgradePromise, "only governance")
    });

    it("Should revert calling upgrade if new address updater is not set", async() => {
        // Assemble
        const ftsos = [accounts[1], accounts[2], accounts[3], accounts[4]];
        const elasticBandWidths = [200, 20, 100, 50];
        const assetFtsos = [accounts[2], accounts[3]];
        await ftsoV2Upgrader.setUpgradeData(ftsos, elasticBandWidths, accounts[1], assetFtsos, { from: governance });
        // Act
        const upgradePromise = ftsoV2Upgrader.upgrade({ from: governance });
        // Assert
        await expectRevert(upgradePromise, "Transaction reverted: function call to a non-contract account")
    });

    it("Should revert calling upgrade if contracts on new address updater are not set", async() => {
        // Assemble
        await ftsoV2Upgrader.setAddressUpdater(addressUpdater.address, { from: governance });
        const ftsos = [accounts[1], accounts[2], accounts[3], accounts[4]];
        const elasticBandWidths = [200, 20, 100, 50];
        const assetFtsos = [accounts[2], accounts[3]];
        await ftsoV2Upgrader.setUpgradeData(ftsos, elasticBandWidths, accounts[1], assetFtsos, { from: governance });
        // Act
        const upgradePromise = ftsoV2Upgrader.upgrade({ from: governance });
        // Assert
        await expectRevert(upgradePromise, "Transaction reverted: function call to a non-contract account")
    });

    it("Should revert calling upgrade if reward epoch start does not match", async() => {
        // Assemble
        const oldFtsoManagerMock = await MockContract.new();
        const ftsoManagerMock = await MockContract.new();
        await ftsoV2Upgrader.setAddressUpdater(addressUpdater.address, { from: governance });
        const ftsos = [accounts[1], accounts[2], accounts[3], accounts[4]];
        const elasticBandWidths = [200, 20, 100, 50];
        const assetFtsos = [accounts[2], accounts[3]];
        await ftsoV2Upgrader.setUpgradeData(ftsos, elasticBandWidths, accounts[1], assetFtsos, { from: governance });

        // Rig the expected return using web3 abi encoder
        const rewardEpochsStartTs = oldFtsoManagerInterface.contract.methods.rewardEpochsStartTs().encodeABI();
        await oldFtsoManagerMock.givenMethodReturnUint(rewardEpochsStartTs, startTs.addn(1));

        const getRewardEpochConfiguration = ftsoManagerInterface.contract.methods.getRewardEpochConfiguration().encodeABI();
        const getRewardEpochConfigurationReturn = web3.eth.abi.encodeParameters(['uint256', 'uint256'], [startTs, 0]);
        await ftsoManagerMock.givenMethodReturn(getRewardEpochConfiguration, getRewardEpochConfigurationReturn);

        await ftsoV2Upgrader.updateContractsUsingAddressUpdater(["FtsoManager"], [ftsoManagerMock.address], [], { from: governance });
        // Act
        const upgradePromise = ftsoV2Upgrader.upgrade({ from: governance });
        // Assert
        await expectRevert(upgradePromise, "reward epoch start does not match")
    });

    it("Should upgrade successfully", async() => {
        // Assemble
        const ftsoManagerMock = await MockContract.new();
        const priceSubmitterMock = await MockContract.new();
        const ftsoRewardManagerMock = await MockContract.new();
        const ftsoRegistryMock = await MockContract.new();
        const voterWhitelisterMock = await MockContract.new();
        const cleanupBlockNumberManagerMock = await MockContract.new();
        const flareDaemonMock = await MockContract.new();
        const inflationMock = await MockContract.new();
        const wNatMock = await MockContract.new();

        // Rig the expected return using web3 abi encoder
        const rewardEpochsStartTs = oldFtsoManagerInterface.contract.methods.rewardEpochsStartTs().encodeABI();
        await oldFtsoManagerMock.givenMethodReturnUint(rewardEpochsStartTs, startTs);
        const rewardEpochDurationSeconds = oldFtsoManagerInterface.contract.methods.rewardEpochDurationSeconds().encodeABI();
        await oldFtsoManagerMock.givenMethodReturnUint(rewardEpochDurationSeconds, REWARD_EPOCH_DURATION_S);
        const getCurrentRewardEpoch = oldFtsoManagerInterface.contract.methods.getCurrentRewardEpoch().encodeABI();
        await oldFtsoManagerMock.givenMethodReturnUint(getCurrentRewardEpoch, 100);

        const getRewardEpochConfiguration = ftsoManagerInterface.contract.methods.getRewardEpochConfiguration().encodeABI();
        const getRewardEpochConfigurationReturn = web3.eth.abi.encodeParameters(['uint256', 'uint256'], [startTs, 0]);
        await ftsoManagerMock.givenMethodReturn(getRewardEpochConfiguration, getRewardEpochConfigurationReturn);

        const getRewardEpochToExpireNext = ftsoRewardManagerInterface.contract.methods.getRewardEpochToExpireNext().encodeABI();
        await ftsoRewardManagerMock.givenMethodReturnUint(getRewardEpochToExpireNext, 5);

        // set address updater data
        await ftsoV2Upgrader.setAddressUpdater(addressUpdater.address, { from: governance });
        await ftsoV2Upgrader.updateContractsUsingAddressUpdater(
            ["AddressUpdater", "FtsoManager", "PriceSubmitter", "FtsoRewardManager", "FtsoRegistry", "VoterWhitelister", "CleanupBlockNumberManager", "FlareDaemon", "Inflation", "WNat"],
            [addressUpdater.address, ftsoManagerMock.address, priceSubmitterMock.address, ftsoRewardManagerMock.address, ftsoRegistryMock.address, voterWhitelisterMock.address, cleanupBlockNumberManagerMock.address, flareDaemonMock.address, inflationMock.address, wNatMock.address],
            [],
            { from: governance });

        // set upgrader data
        const ftsos = [accounts[1], accounts[2], accounts[3], accounts[4]];
        const elasticBandWidths = [200, 20, 100, 50];
        const assetFtsos = [accounts[2], accounts[3]];
        await ftsoV2Upgrader.setUpgradeData(ftsos, elasticBandWidths, accounts[1], assetFtsos, { from: governance });

        expect(await ftsoV2Upgrader.upgraded()).to.equals(false);

        // Act
        await ftsoV2Upgrader.upgrade({ from: governance });

        // Assert
        // set new addresses
        let setAddresses = ftsoManagerInterface.contract.methods.updateContractAddresses(
            encodeContractNames(["AddressUpdater", "FtsoManager", "PriceSubmitter", "FtsoRewardManager", "FtsoRegistry", "VoterWhitelister", "CleanupBlockNumberManager", "FlareDaemon", "Inflation", "WNat"]),
            [addressUpdater.address, ftsoManagerMock.address, priceSubmitterMock.address, ftsoRewardManagerMock.address, ftsoRegistryMock.address, voterWhitelisterMock.address, cleanupBlockNumberManagerMock.address, flareDaemonMock.address, inflationMock.address, wNatMock.address]
            ).encodeABI();
        assert.equal((await ftsoManagerMock.invocationCountForCalldata.call(setAddresses)).toNumber(), 1);

        // set initial reward data
        const setInitialRewardData = ftsoManagerInterface.contract.methods.setInitialRewardData(5, 101, startTs.addn(101 * REWARD_EPOCH_DURATION_S)).encodeABI();
        assert.equal((await ftsoManagerMock.invocationCountForCalldata.call(setInitialRewardData)).toNumber(), 1);

        // activate
        const activate = ftsoManagerInterface.contract.methods.activate().encodeABI();
        assert.equal((await ftsoManagerMock.invocationCountForCalldata.call(activate)).toNumber(), 1);

        // replace ftsos
        const replaceFtsosBulk = ftsoManagerInterface.contract.methods.replaceFtsosBulk(ftsos, true, false).encodeABI();
        assert.equal((await ftsoManagerMock.invocationCountForCalldata.call(replaceFtsosBulk)).toNumber(), 1);
        const deactivateFtsos = ftsoManagerInterface.contract.methods.deactivateFtsos(ftsos).encodeABI();
        assert.equal((await ftsoManagerMock.invocationCountForCalldata.call(deactivateFtsos)).toNumber(), 1);
        const addFtsosBulk = ftsoManagerInterface.contract.methods.addFtsosBulk(ftsos).encodeABI();
        assert.equal((await ftsoManagerMock.invocationCountForCalldata.call(addFtsosBulk)).toNumber(), 1);
        const setFtsoAssetFtsos = ftsoManagerInterface.contract.methods.setFtsoAssetFtsos(ftsos[0], assetFtsos).encodeABI();
        assert.equal((await ftsoManagerMock.invocationCountForCalldata.call(setFtsoAssetFtsos)).toNumber(), 1);

        // switch to production mode
        const switchToProductionMode = ftsoManagerInterface.contract.methods.switchToProductionMode().encodeABI(); // all encoded calls are the same
        assert.equal((await ftsoManagerMock.invocationCountForCalldata.call(switchToProductionMode)).toNumber(), 1);
        assert.equal(await addressUpdater.governance(), governance);

        // should be upgraded
        assert.equal(await ftsoV2Upgrader.upgraded(), true);
    });
});
