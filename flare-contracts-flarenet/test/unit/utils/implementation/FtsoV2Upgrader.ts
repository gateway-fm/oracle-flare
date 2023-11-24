import { constants, expectRevert, time } from '@openzeppelin/test-helpers';
import { FtsoManagerInstance, FtsoV2UpgraderInstance, MockContractInstance } from "../../../../typechain-truffle";
import { getTestFile, GOVERNANCE_GENESIS_ADDRESS } from "../../../utils/constants";
import { testDeployGovernanceSettings } from '../../../utils/contract-test-helpers';
import { compareArrays, compareNumberArrays } from '../../../utils/test-helpers';

const MockContract = artifacts.require("MockContract");
const FtsoManagement = artifacts.require("FtsoManagement");
const FtsoManager = artifacts.require("FtsoManager");
const FtsoV2Upgrader = artifacts.require("FtsoV2Upgrader");

const PRICE_EPOCH_DURATION_S = 120;   // 2 minutes
const REVEAL_EPOCH_DURATION_S = 30;
const REWARD_EPOCH_DURATION_S = 2 * 24 * 60 * 60; // 2 days
const VOTE_POWER_BOUNDARY_FRACTION = 7;

contract(`FtsoV2Upgrader.sol; ${ getTestFile(__filename) }; FtsoV2Upgrader unit tests`, async accounts => {
    const ADDRESS_UPDATER = accounts[16];
    const governance = GOVERNANCE_GENESIS_ADDRESS;
    let startTs: BN;
    let oldFtsoManagerMock: MockContractInstance;
    let ftsoV2Upgrader: FtsoV2UpgraderInstance;

    let ftsoManagerInterface: FtsoManagerInstance;

    before(async () => {
        FtsoManager.link(await FtsoManagement.new() as any);
        await testDeployGovernanceSettings(governance, 1, [governance]);
    });

    beforeEach(async () => {
        oldFtsoManagerMock = await MockContract.new();
        ftsoV2Upgrader = await FtsoV2Upgrader.new(governance);

        // Get the timestamp for the just mined block
        startTs = await time.latest();

        ftsoManagerInterface = await FtsoManager.new(
            governance,
            accounts[0],
            ADDRESS_UPDATER,
            constants.ZERO_ADDRESS,
            startTs,
            PRICE_EPOCH_DURATION_S,
            REVEAL_EPOCH_DURATION_S,
            startTs.addn(REVEAL_EPOCH_DURATION_S),
            REWARD_EPOCH_DURATION_S,
            VOTE_POWER_BOUNDARY_FRACTION
        );

    });

    it("Should know about governance", async () => {
        // Assemble
        // Act
        // Assert
        assert.equal(await ftsoV2Upgrader.governance(), governance);
    });

    it("Should set governance parameters", async() => {
        // Assemble
        const ftsoManagerMock = await MockContract.new();
        // Act
        await ftsoV2Upgrader.setGovernanceParametersOnFtsoManager(ftsoManagerMock.address, 10, 10, 5000, 500000, 5000, 500, 3000, 90000, [], { from: governance });
        // Assert
        const setGovernanceParameters = ftsoManagerInterface.contract.methods.setGovernanceParameters(0, 10, 10, 5000, 500000, 5000, 500, 3000, 90000, []).encodeABI();
        assert.equal((await ftsoManagerMock.invocationCountForCalldata.call(setGovernanceParameters)).toNumber(), 1);
    });

    it("Should revert setting governance parameters if not from governance", async() => {
        // Assemble
        const ftsoManagerMock = await MockContract.new();
        // Act
        const setPromise = ftsoV2Upgrader.setGovernanceParametersOnFtsoManager(ftsoManagerMock.address, 10, 10, 5000, 500000, 5000, 500, 3000, 90000, []);
        // Assert
        await expectRevert(setPromise, "only governance")
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
        const upgradePromise = ftsoV2Upgrader.upgrade(ftsoManagerInterface.address);
        // Assert
        await expectRevert(upgradePromise, "only governance")
    });

    it("Should revert calling upgrade if reward epoch start does not match", async() => {
        // Assemble
        const oldFtsoManagerMock = await MockContract.new();
        const ftsoManagerMock = await MockContract.new();
        const ftsos = [accounts[1], accounts[2], accounts[3], accounts[4]];
        const elasticBandWidths = [200, 20, 100, 50];
        const assetFtsos = [accounts[2], accounts[3]];
        await ftsoV2Upgrader.setUpgradeData(ftsos, elasticBandWidths, accounts[1], assetFtsos, { from: governance });

        // Rig the expected return using web3 abi encoder
        const oldFtsoManager = ftsoManagerInterface.contract.methods.oldFtsoManager().encodeABI();
        const rewardEpochsStartTs = ftsoManagerInterface.contract.methods.rewardEpochsStartTs().encodeABI();
        await oldFtsoManagerMock.givenMethodReturnUint(rewardEpochsStartTs, startTs.addn(1));
        await ftsoManagerMock.givenMethodReturnUint(rewardEpochsStartTs, startTs);
        await ftsoManagerMock.givenMethodReturnAddress(oldFtsoManager, oldFtsoManagerMock.address)

        // Act
        const upgradePromise = ftsoV2Upgrader.upgrade(ftsoManagerMock.address, { from: governance });
        // Assert
        await expectRevert(upgradePromise, "reward epoch start does not match")
    });

    it("Should upgrade successfully", async() => {
        // Assemble
        const ftsoManagerMock = await MockContract.new();

        // Rig the expected return using web3 abi encoder
        const rewardEpochsStartTs = ftsoManagerInterface.contract.methods.rewardEpochsStartTs().encodeABI();
        await oldFtsoManagerMock.givenMethodReturnUint(rewardEpochsStartTs, startTs);
        const rewardEpochDurationSeconds = ftsoManagerInterface.contract.methods.rewardEpochDurationSeconds().encodeABI();
        await oldFtsoManagerMock.givenMethodReturnUint(rewardEpochDurationSeconds, REWARD_EPOCH_DURATION_S);
        const getCurrentRewardEpoch = ftsoManagerInterface.contract.methods.getCurrentRewardEpoch().encodeABI();
        await oldFtsoManagerMock.givenMethodReturnUint(getCurrentRewardEpoch, 100);

        const oldFtsoManager = ftsoManagerInterface.contract.methods.oldFtsoManager().encodeABI();
        await ftsoManagerMock.givenMethodReturnUint(rewardEpochsStartTs, startTs);
        await ftsoManagerMock.givenMethodReturnAddress(oldFtsoManager, oldFtsoManagerMock.address)

        const getRewardEpochToExpireNext = ftsoManagerInterface.contract.methods.getRewardEpochToExpireNext().encodeABI();
        await oldFtsoManagerMock.givenMethodReturnUint(getRewardEpochToExpireNext, 5);

        // set upgrader data
        const ftsos = [accounts[1], accounts[2], accounts[3], accounts[4]];
        const elasticBandWidths = [200, 20, 100, 50];
        const assetFtsos = [accounts[2], accounts[3]];
        await ftsoV2Upgrader.setUpgradeData(ftsos, elasticBandWidths, accounts[1], assetFtsos, { from: governance });
        await ftsoV2Upgrader.setGovernanceParametersOnFtsoManager(ftsoManagerMock.address, 10, 10, 5000, 500000, 5000, 500, 3000, 90000, [], { from: governance });

        expect(await ftsoV2Upgrader.upgraded()).to.equals(false);

        // Act
        await ftsoV2Upgrader.upgrade(ftsoManagerMock.address, { from: governance });

        // Assert
        // set initial reward data
        const setInitialRewardData = ftsoManagerInterface.contract.methods.setInitialRewardData(5, 101, startTs.addn(101 * REWARD_EPOCH_DURATION_S)).encodeABI();
        assert.equal((await ftsoManagerMock.invocationCountForCalldata.call(setInitialRewardData)).toNumber(), 1);

        // activate
        const activate = ftsoManagerInterface.contract.methods.activate().encodeABI();
        assert.equal((await ftsoManagerMock.invocationCountForCalldata.call(activate)).toNumber(), 1);

        // replace ftsos
        const replaceFtsosBulk = ftsoManagerInterface.contract.methods.replaceFtsosBulk(ftsos, true, false).encodeABI();
        assert.equal((await ftsoManagerMock.invocationCountForCalldata.call(replaceFtsosBulk)).toNumber(), 1);
        const setFtsoAssetFtsos = ftsoManagerInterface.contract.methods.setFtsoAssetFtsos(ftsos[0], assetFtsos).encodeABI();
        assert.equal((await ftsoManagerMock.invocationCountForCalldata.call(setFtsoAssetFtsos)).toNumber(), 1);

        // switch to production mode
        const switchToProductionMode = ftsoManagerInterface.contract.methods.switchToProductionMode().encodeABI(); // all encoded calls are the same
        assert.equal((await ftsoManagerMock.invocationCountForCalldata.call(switchToProductionMode)).toNumber(), 1);

        // should be upgraded
        assert.equal(await ftsoV2Upgrader.upgraded(), true);
    });
});
