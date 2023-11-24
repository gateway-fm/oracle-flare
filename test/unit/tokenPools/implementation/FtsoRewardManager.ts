import { constants, expectEvent, expectRevert, time } from '@openzeppelin/test-helpers';
import BN from "bn.js";
import { Contracts } from '../../../../deployment/scripts/Contracts';
import {
    DelegationAccountInstance,
    ClaimSetupManagerInstance,
    FtsoManagerContract,
    FtsoManagerInstance,
    FtsoManagerMockContract,
    FtsoManagerMockInstance,
    FtsoRewardManagerContract,
    FtsoRewardManagerInstance,
    InflationMockInstance,
    MockContractInstance,
    SuicidalMockInstance, WNatContract,
    WNatInstance
} from "../../../../typechain-truffle";
import { assertNumberEqual, compareArrays, compareNumberArrays, encodeContractNames, getAddressWithZeroBalance, toBN } from "../../../utils/test-helpers";
import { setDefaultVPContract } from "../../../utils/token-test-helpers";
import { calcGasCost } from '../../../utils/eth';

const getTestFile = require('../../../utils/constants').getTestFile;

const FtsoRewardManager = artifacts.require("FtsoRewardManager") as FtsoRewardManagerContract;
const DataProviderFee = artifacts.require("DataProviderFee" as any);
const FtsoManager = artifacts.require("FtsoManager") as FtsoManagerContract;
const FtsoManagement = artifacts.require("FtsoManagement");
const MockFtsoManager = artifacts.require("FtsoManagerMock") as FtsoManagerMockContract;
const WNAT = artifacts.require("WNat") as WNatContract;
const InflationMock = artifacts.require("InflationMock");
const SuicidalMock = artifacts.require("SuicidalMock");
const MockContract = artifacts.require("MockContract");
const GasConsumer = artifacts.require("GasConsumer2");
const ClaimSetupManager = artifacts.require("ClaimSetupManager");
const DelegationAccount = artifacts.require("DelegationAccount");

const PRICE_EPOCH_DURATION_S = 120;   // 2 minutes
const REVEAL_EPOCH_DURATION_S = 30;
const REWARD_EPOCH_DURATION_S = 2 * 24 * 60 * 60; // 2 days
const VOTE_POWER_BOUNDARY_FRACTION = 7;

// contains a fresh contract for each test
let ftsoRewardManager: FtsoRewardManagerInstance;
let ftsoManagerInterface: FtsoManagerInstance;
let startTs: BN;
let mockFtsoManager: FtsoManagerMockInstance;
let wNat: WNatInstance;
let mockInflation: InflationMockInstance;
let claimSetupManager: ClaimSetupManagerInstance;
let ADDRESS_UPDATER: string;
let libraryContract: DelegationAccountInstance;
let mockDistribution: MockContractInstance;

export async function distributeRewardsPDA(
    accounts: Truffle.Accounts,
    startTs: BN,
    currentRewardEpoch: number = 0,
    sendNats: boolean = true
) {
    let votePowerBlock = await web3.eth.getBlockNumber();
    // Assemble
    if (sendNats) {
        // give reward manager some nat to distribute...proxied through mock inflation
        await mockInflation.receiveInflation({ value: "2000000" });
    }

    // Price epochs remaining is 5040 (7 days worth at 2 minute price epochs)

    // Trigger price epoch finalization
    await mockFtsoManager.distributeRewardsCall(
        [accounts[40], accounts[50]],
        [25, 75],
        100,
        0,
        accounts[6],
        PRICE_EPOCH_DURATION_S,
        currentRewardEpoch,
        startTs.addn((currentRewardEpoch * REWARD_EPOCH_DURATION_S) + PRICE_EPOCH_DURATION_S - 1),
        votePowerBlock
    );

    await time.increaseTo((await time.latest()).addn(PRICE_EPOCH_DURATION_S));

    // Let's do another price epoch
    await mockFtsoManager.distributeRewardsCall(
        [accounts[40], accounts[50]],
        [25, 75],
        100,
        1,
        accounts[6],
        PRICE_EPOCH_DURATION_S,
        currentRewardEpoch,
        startTs.addn((currentRewardEpoch * REWARD_EPOCH_DURATION_S) + (PRICE_EPOCH_DURATION_S * 2) - 1),
        votePowerBlock
    );

    const getRewardEpochVotePowerBlock = ftsoManagerInterface.contract.methods.getRewardEpochVotePowerBlock(currentRewardEpoch).encodeABI();
    const getRewardEpochVotePowerBlockReturn = web3.eth.abi.encodeParameter('uint256', votePowerBlock);
    await mockFtsoManager.givenMethodReturn(getRewardEpochVotePowerBlock, getRewardEpochVotePowerBlockReturn);
}



export async function distributeRewards(
    accounts: Truffle.Accounts,
    startTs: BN,
    currentRewardEpoch: number = 0,
    sendNats: boolean = true
) {
    let votePowerBlock = await web3.eth.getBlockNumber();
    // Assemble
    if (sendNats) {
        // give reward manager some nat to distribute...proxied through mock inflation
        await mockInflation.receiveInflation({ value: "2000000" });
    }

    // Price epochs remaining is 5040 (7 days worth at 2 minute price epochs)

    // Trigger price epoch finalization
    await mockFtsoManager.distributeRewardsCall(
        [accounts[1], accounts[2]],
        [25, 75],
        100,
        0,
        accounts[6],
        PRICE_EPOCH_DURATION_S,
        currentRewardEpoch,
        startTs.addn((currentRewardEpoch * REWARD_EPOCH_DURATION_S) + PRICE_EPOCH_DURATION_S - 1),
        votePowerBlock
    );

    await time.increaseTo((await time.latest()).addn(PRICE_EPOCH_DURATION_S));

    // Let's do another price epoch
    await mockFtsoManager.distributeRewardsCall(
        [accounts[1], accounts[2]],
        [25, 75],
        100,
        1,
        accounts[6],
        PRICE_EPOCH_DURATION_S,
        currentRewardEpoch,
        startTs.addn((currentRewardEpoch * REWARD_EPOCH_DURATION_S) + (PRICE_EPOCH_DURATION_S * 2) - 1),
        votePowerBlock
    );

    const getRewardEpochVotePowerBlock = ftsoManagerInterface.contract.methods.getRewardEpochVotePowerBlock(currentRewardEpoch).encodeABI();
    const getRewardEpochVotePowerBlockReturn = web3.eth.abi.encodeParameter('uint256', votePowerBlock);
    await mockFtsoManager.givenMethodReturn(getRewardEpochVotePowerBlock, getRewardEpochVotePowerBlockReturn);
}

export async function expireRewardEpoch(rewardEpoch: number, ftsoRewardManager: FtsoRewardManagerInstance, deployer: string) {
    let currentFtsoManagerAddress = await ftsoRewardManager.ftsoManager();
    await ftsoRewardManager.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.CLAIM_SETUP_MANAGER]),
        [ADDRESS_UPDATER, mockInflation.address, deployer, wNat.address, claimSetupManager.address], { from: ADDRESS_UPDATER });
    await ftsoRewardManager.closeExpiredRewardEpoch(rewardEpoch);
    await ftsoRewardManager.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.CLAIM_SETUP_MANAGER]),
        [ADDRESS_UPDATER, mockInflation.address, currentFtsoManagerAddress, wNat.address, claimSetupManager.address], { from: ADDRESS_UPDATER });
}

export async function travelToAndSetNewRewardEpoch(newRewardEpoch: number, startTs: BN, ftsoRewardManager: FtsoRewardManagerInstance, deployer: string, closeAsYouGo = false) {
    // What reward epoch are we on based on current block time, given our startTs?
    const currentRewardEpoch = (await time.latest()).sub(startTs).div(toBN(REWARD_EPOCH_DURATION_S)).toNumber();
    for (let rewardEpoch = currentRewardEpoch; rewardEpoch < newRewardEpoch; rewardEpoch++) {
        // Time travel through each daily cycle as we work our way through to the next
        // reward epoch.
        for (let dailyCycle = 0; dailyCycle < (REWARD_EPOCH_DURATION_S / 86400); dailyCycle++) {
            try {
                await time.increaseTo(startTs.addn((rewardEpoch * REWARD_EPOCH_DURATION_S) + (dailyCycle * 86400)));
                await mockInflation.setDailyAuthorizedInflation(2000000);
            } catch (e) {
                if (e instanceof Error && e.message.includes("to a moment in the past")) {
                    // Assume that if this is being done in the past, then it does not need to be done again.
                    // So just skip.          
                } else {
                    throw e;
                }
            }
        }
        // Travel to reach next reward epoch
        await time.increaseTo(startTs.addn((rewardEpoch + 1) * REWARD_EPOCH_DURATION_S + 1));
        // workaround for modifiers due to mock
        if (closeAsYouGo) {
            await expireRewardEpoch(rewardEpoch, ftsoRewardManager, deployer);
        }
        await mockInflation.setDailyAuthorizedInflation(2000000);
    }
    // Fake Trigger reward epoch finalization
    const getCurrentRewardEpoch = ftsoManagerInterface.contract.methods.getCurrentRewardEpoch().encodeABI();
    const getCurrentRewardEpochReturn = web3.eth.abi.encodeParameter('uint256', newRewardEpoch);
    await mockFtsoManager.givenMethodReturn(getCurrentRewardEpoch, getCurrentRewardEpochReturn);
}


contract(`FtsoRewardManager.sol; ${getTestFile(__filename)}; Ftso reward manager unit tests`, async accounts => {

    let mockSuicidal: SuicidalMockInstance;
    const EXECUTOR_MIN_FEE = "0";
    const EXECUTOR_MAX_FEE = "500";
    const EXECUTOR_REGISTER_FEE = "100";
    const burnAddress = "0x000000000000000000000000000000000000dEaD";

    ADDRESS_UPDATER = accounts[16];

    before(async () => {
        FtsoManager.link(await FtsoManagement.new() as any);
        FtsoRewardManager.link(await DataProviderFee.new() as any);
    });

    beforeEach(async () => {
        mockFtsoManager = await MockFtsoManager.new();
        mockInflation = await InflationMock.new();
        // mockClaimSetupManager = await MockContract.new();

        // deploy clone factory
        claimSetupManager = await ClaimSetupManager.new(
            accounts[0],
            ADDRESS_UPDATER,
            3,
            EXECUTOR_MIN_FEE,
            EXECUTOR_MAX_FEE,
            EXECUTOR_REGISTER_FEE
        );

        // deploy library contract
        libraryContract = await DelegationAccount.new();
        await claimSetupManager.setLibraryAddress(libraryContract.address);

        ftsoRewardManager = await FtsoRewardManager.new(
            accounts[0],
            ADDRESS_UPDATER,
            constants.ZERO_ADDRESS,
            3,
            0
        );

        await mockInflation.setInflationReceiver(ftsoRewardManager.address);

        // Get the timestamp for the just mined block
        startTs = await time.latest();

        ftsoManagerInterface = await FtsoManager.new(
            accounts[0],
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

        mockDistribution = await MockContract.new();

        wNat = await WNAT.new(accounts[0], "Wrapped NAT", "WNAT");
        await setDefaultVPContract(wNat, accounts[0]);

        await ftsoRewardManager.updateContractAddresses(
            encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.CLAIM_SETUP_MANAGER]),
            [ADDRESS_UPDATER, mockInflation.address, mockFtsoManager.address, wNat.address, claimSetupManager.address], { from: ADDRESS_UPDATER });
        await ftsoRewardManager.enableClaims();

        await claimSetupManager.updateContractAddresses(
            encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.FTSO_REWARD_MANAGER, Contracts.DISTRIBUTION_TO_DELEGATORS]),
            [ADDRESS_UPDATER, mockFtsoManager.address, wNat.address, ftsoRewardManager.address, mockDistribution.address], { from: ADDRESS_UPDATER });

        // set the daily authorized inflation...this proxies call to ftso reward manager
        await mockInflation.setDailyAuthorizedInflation(2000000);

        mockSuicidal = await SuicidalMock.new(ftsoRewardManager.address);

        await mockFtsoManager.setRewardManager(ftsoRewardManager.address);

        let activate = await ftsoRewardManager.activate();
        expectEvent(activate, "FtsoRewardManagerActivated", { ftsoRewardManager: ftsoRewardManager.address });
    });

    describe("basic", async () => {
        it("Should revert calling activate if contracts are not set", async () => {
            ftsoRewardManager = await FtsoRewardManager.new(
                accounts[0],
                ADDRESS_UPDATER,
                constants.ZERO_ADDRESS,
                3,
                0
            );

            await expectRevert(ftsoRewardManager.activate(), "addresses not set");
        });

        it("Should revert calling activate if not from governance", async () => {
            await expectRevert(ftsoRewardManager.activate({ from: accounts[1] }), "only governance");
        });

        it("Should revert calling enableClaims if not from governance", async () => {
            await expectRevert(ftsoRewardManager.enableClaims({ from: accounts[1] }), "only governance");
        });

        it("Should revert calling enableClaims twice", async () => {
            await expectRevert(ftsoRewardManager.enableClaims(), "already enabled");
        });

        it("Should deactivate and disable claiming rewards", async () => {
            let deactivate = await ftsoRewardManager.deactivate();
            expectEvent(deactivate, "FtsoRewardManagerDeactivated", { ftsoRewardManager: ftsoRewardManager.address });

            await expectRevert(ftsoRewardManager.claimReward(accounts[2], [0]), "reward manager deactivated");
            await expectRevert(ftsoRewardManager.claimRewardFromDataProviders(accounts[2], [0], [accounts[1]]), "reward manager deactivated");
        });

        it("Should revert calling deactivate if not from governance", async () => {
            await expectRevert(ftsoRewardManager.deactivate({ from: accounts[1] }), "only governance");
        });

        it("Should revert calling updateContractAddresses if not from address updater", async () => {
            await expectRevert(ftsoRewardManager.updateContractAddresses(
                encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.CLAIM_SETUP_MANAGER]),
                [ADDRESS_UPDATER, mockInflation.address, mockFtsoManager.address, wNat.address, claimSetupManager.address], { from: accounts[1] }), "only address updater");
        });

        it("Should update ftso manager", async () => {
            expect(await ftsoRewardManager.ftsoManager()).to.equals(mockFtsoManager.address);
            await ftsoRewardManager.updateContractAddresses(
                encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.CLAIM_SETUP_MANAGER]),
                [ADDRESS_UPDATER, mockInflation.address, accounts[8], wNat.address, claimSetupManager.address], { from: ADDRESS_UPDATER });
            expect(await ftsoRewardManager.ftsoManager()).to.equals(accounts[8]);
        });

        it("Should revert updating ftso manager if setting to address(0)", async () => {
            await expectRevert(ftsoRewardManager.updateContractAddresses(
                encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.CLAIM_SETUP_MANAGER]),
                [ADDRESS_UPDATER, mockInflation.address, constants.ZERO_ADDRESS, wNat.address, claimSetupManager.address], { from: ADDRESS_UPDATER }), "address zero");
        });

        it("Should update WNAT", async () => {
            expect(await ftsoRewardManager.wNat()).to.equals(wNat.address);
            await ftsoRewardManager.updateContractAddresses(
                encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.CLAIM_SETUP_MANAGER]),
                [ADDRESS_UPDATER, mockInflation.address, mockFtsoManager.address, accounts[8], claimSetupManager.address], { from: ADDRESS_UPDATER });
            expect(await ftsoRewardManager.wNat()).to.equals(accounts[8]);
        });

        it("Should revert updating wNAt if setting to address(0)", async () => {
            await expectRevert(ftsoRewardManager.updateContractAddresses(
                encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.CLAIM_SETUP_MANAGER]),
                [ADDRESS_UPDATER, mockInflation.address, mockFtsoManager.address, constants.ZERO_ADDRESS, claimSetupManager.address], { from: ADDRESS_UPDATER }), "address zero");
        });

        it("Should update inflation", async () => {
            expect(await ftsoRewardManager.getInflationAddress()).to.equals(mockInflation.address);
            await ftsoRewardManager.updateContractAddresses(
                encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.CLAIM_SETUP_MANAGER]),
                [ADDRESS_UPDATER, accounts[8], mockFtsoManager.address, wNat.address, claimSetupManager.address], { from: ADDRESS_UPDATER });
            expect(await ftsoRewardManager.getInflationAddress()).to.equals(accounts[8]);
        });

        it("Should issue event when daily authorized inflation is set", async () => {
            const txReceipt = await mockInflation.setDailyAuthorizedInflation(2000000);
            await expectEvent.inTransaction(
                txReceipt.tx,
                ftsoRewardManager,
                "DailyAuthorizedInflationSet", { authorizedAmountWei: toBN(2000000) }
            );
        });

        it("Should revert updating inflation if setting to address(0)", async () => {
            await expectRevert(ftsoRewardManager.updateContractAddresses(
                encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.CLAIM_SETUP_MANAGER]),
                [ADDRESS_UPDATER, constants.ZERO_ADDRESS, mockFtsoManager.address, wNat.address, claimSetupManager.address], { from: ADDRESS_UPDATER }), "address zero");
        });

        it("Should get epoch to expire next", async () => {
            expect((await ftsoRewardManager.getRewardEpochToExpireNext()).toNumber()).to.equals(0);
            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);
            expect((await ftsoRewardManager.getRewardEpochToExpireNext()).toNumber()).to.equals(0);
            // expire reward epoch 0
            await expireRewardEpoch(0, ftsoRewardManager, accounts[0]);
            // advance, but not expire epoch 1            
            await travelToAndSetNewRewardEpoch(2, startTs, ftsoRewardManager, accounts[0]);
            expect((await ftsoRewardManager.getRewardEpochToExpireNext()).toNumber()).to.equals(1);
            expect((await ftsoRewardManager.nextClaimableRewardEpoch(accounts[2])).toNumber()).to.equals(1);
        });

        it("Should get current reward epoch", async () => {
            expect((await ftsoRewardManager.getCurrentRewardEpoch()).toNumber()).to.equals(0);

            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);
            expect((await ftsoRewardManager.getCurrentRewardEpoch()).toNumber()).to.equals(1);

            await travelToAndSetNewRewardEpoch(2, startTs, ftsoRewardManager, accounts[0]);
            expect((await ftsoRewardManager.getCurrentRewardEpoch()).toNumber()).to.equals(2);
            await ftsoRewardManager.getRewardEpochVotePowerBlock(2);
        });

        it("Should set initial reward data", async () => {
            let oldFtsoRewardManager = await MockContract.new();
            ftsoRewardManager = await FtsoRewardManager.new(
                accounts[0],
                ADDRESS_UPDATER,
                oldFtsoRewardManager.address,
                3,
                0
            );

            const getRewardEpochToExpireNext = web3.utils.sha3("getRewardEpochToExpireNext()")!.slice(0, 10); // first 4 bytes is function selector
            const getCurrentRewardEpoch = web3.utils.sha3("getCurrentRewardEpoch()")!.slice(0, 10); // first 4 bytes is function selector
            await mockFtsoManager.givenMethodReturnUint(getRewardEpochToExpireNext, 5);
            await mockFtsoManager.givenMethodReturnUint(getCurrentRewardEpoch, 20);

            await ftsoRewardManager.updateContractAddresses(
                encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.CLAIM_SETUP_MANAGER]),
                [ADDRESS_UPDATER, mockInflation.address, mockFtsoManager.address, wNat.address, claimSetupManager.address], { from: ADDRESS_UPDATER });
            await ftsoRewardManager.enableClaims();

            expect((await ftsoRewardManager.getInitialRewardEpoch()).toNumber()).to.equals(0);

            const firstClaimableRewardEpoch = ftsoRewardManager.contract.methods.firstClaimableRewardEpoch().encodeABI();
            await oldFtsoRewardManager.givenMethodReturnUint(firstClaimableRewardEpoch, 2);

            await ftsoRewardManager.setInitialRewardData();

            expect((await ftsoRewardManager.getRewardEpochToExpireNext()).toNumber()).to.equals(5);
            expect((await ftsoRewardManager.getInitialRewardEpoch()).toNumber()).to.equals(20);
            expect((await ftsoRewardManager.firstClaimableRewardEpoch()).toNumber()).to.equals(2);
            expect((await ftsoRewardManager.nextClaimableRewardEpoch(accounts[2])).toNumber()).to.equals(20);
        });

        it("Should revert calling setInitialRewardData twice", async () => {
            ftsoRewardManager = await FtsoRewardManager.new(
                accounts[0],
                ADDRESS_UPDATER,
                (await MockContract.new()).address,
                3,
                0
            );

            await ftsoRewardManager.updateContractAddresses(
                encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.CLAIM_SETUP_MANAGER]),
                [ADDRESS_UPDATER, mockInflation.address, mockFtsoManager.address, wNat.address, claimSetupManager.address], { from: ADDRESS_UPDATER });
            await ftsoRewardManager.enableClaims();

            await ftsoRewardManager.setInitialRewardData();

            await expectRevert(ftsoRewardManager.setInitialRewardData(), "not initial state");
        });

        it("Should revert calling setInitialRewardData if not from governance", async () => {
            await expectRevert(ftsoRewardManager.setInitialRewardData({ from: accounts[1] }), "only governance");
        });

        it("Should revert calling setInitialRewardData if already activated", async () => {
            await expectRevert(ftsoRewardManager.setInitialRewardData(), "not initial state");
        });

        it("Should revert calling setInitialRewardData if old ftso reward manager is not set", async () => {
            ftsoRewardManager = await FtsoRewardManager.new(
                accounts[0],
                ADDRESS_UPDATER,
                constants.ZERO_ADDRESS,
                3,
                0
            );
            await expectRevert(ftsoRewardManager.setInitialRewardData(), "not initial state");
        });

        it("Should set new ftso reward manager", async () => {
            expect(await ftsoRewardManager.newFtsoRewardManager()).to.equals(constants.ZERO_ADDRESS);
            await ftsoRewardManager.setNewFtsoRewardManager(accounts[2]);
            expect(await ftsoRewardManager.newFtsoRewardManager()).to.equals(accounts[2]);
        });

        it("Should revert calling setNewFtsoRewardManager if not from governance", async () => {
            await expectRevert(ftsoRewardManager.setNewFtsoRewardManager(accounts[2], { from: accounts[1] }), "only governance");
        });

        it("Should revert calling setNewFtsoRewardManager twice", async () => {
            await ftsoRewardManager.setNewFtsoRewardManager(accounts[2]);
            await expectRevert(ftsoRewardManager.setNewFtsoRewardManager(accounts[2]), "already set");
        });

        it("Should revert calling setNewFtsoRewardManager with address zero", async () => {
            await expectRevert(ftsoRewardManager.setNewFtsoRewardManager(constants.ZERO_ADDRESS), "address zero");
        });

        it("Should return contract name", async () => {
            expect(await ftsoRewardManager.getContractName()).to.equals(Contracts.FTSO_REWARD_MANAGER);
        });

        it("Should return fee percentage update offset", async () => {
            expect((await ftsoRewardManager.feePercentageUpdateOffset()).toNumber()).to.equals(3);
        });

        it("Should return default fee percentage", async () => {
            expect((await ftsoRewardManager.defaultFeePercentage()).toNumber()).to.equals(0);
        });
    });

    describe("Price epochs, finalization", async () => {
        it("Should finalize price epoch and distribute unclaimed rewards", async () => {
            await mockFtsoManager.distributeRewardsCall(
                [accounts[1], accounts[2]],
                [25, 75],
                100,
                0,
                accounts[6],
                PRICE_EPOCH_DURATION_S,
                0,
                startTs.addn(PRICE_EPOCH_DURATION_S - 1),
                0
            );

            // Assert
            // 2 minute price epochs yield 720 price epochs per day
            // 2000000 / 720 = 2777.77 rewards to award. Decimal will get truncated.
            // a1 should be 2777 * 0.25 = 694.25
            // a2 should be = (2000000 / 5040) * 0.75 = 2082.75
            // Price epoch awarding should be accumulated and used in double declining balance
            // allocation such that rounding at the end of a daily cycle is not an issue.
            // Not tested here, but decimal truncation for this particular test is valid.
            let a1UnclaimedReward = await ftsoRewardManager.getUnclaimedReward(0, accounts[1]);
            let a2UnclaimedReward = await ftsoRewardManager.getUnclaimedReward(0, accounts[2]);
            assert.equal(a1UnclaimedReward[0].toNumber(), 695);
            assert.equal(a2UnclaimedReward[0].toNumber(), 2082);

            let a1RewardInfo = await ftsoRewardManager.getDataProviderPerformanceInfo(0, accounts[1]);
            let a2RewardInfo = await ftsoRewardManager.getDataProviderPerformanceInfo(0, accounts[2]);
            assert.equal(a1RewardInfo[0].toNumber(), 695);
            assert.equal(a2RewardInfo[0].toNumber(), 2082);
        });

        it("Should finalize price epoch and distribute all authorized rewards for 7 daily cycle, revert later", async () => {
            const dailyStartTs = await time.latest();

            // Time travel to the end of the daily cycle, distributing rewards along the way.
            // Make longer price epochs here so this test does not take as long to run.
            const MY_LONGER_PRICE_EPOCH_SEC = 3600;
            for (let i = 1; i <= (86400 / MY_LONGER_PRICE_EPOCH_SEC); i++) {
                await mockFtsoManager.distributeRewardsCall(
                    [accounts[1], accounts[2]],
                    [25, 75],
                    100,
                    0,
                    accounts[6],
                    MY_LONGER_PRICE_EPOCH_SEC,
                    0,
                    startTs.addn(MY_LONGER_PRICE_EPOCH_SEC * i - 1),
                    0
                );
                await time.increaseTo(dailyStartTs.addn(MY_LONGER_PRICE_EPOCH_SEC * i));
            }

            // Assert
            let a1UnclaimedReward = await ftsoRewardManager.getUnclaimedReward(0, accounts[1]);
            let a2UnclaimedReward = await ftsoRewardManager.getUnclaimedReward(0, accounts[2]);
            assert.equal(a1UnclaimedReward[0].toNumber() + a2UnclaimedReward[0].toNumber(), 2000000);

            let a1RewardInfo = await ftsoRewardManager.getDataProviderPerformanceInfo(0, accounts[1]);
            let a2RewardInfo = await ftsoRewardManager.getDataProviderPerformanceInfo(0, accounts[2]);
            assert.equal(a1RewardInfo[0].toNumber() + a2RewardInfo[0].toNumber(), 2000000);

            const promise = mockFtsoManager.distributeRewardsCall(
                [accounts[1], accounts[2]],
                [25, 75],
                100,
                0,
                accounts[6],
                MY_LONGER_PRICE_EPOCH_SEC,
                0,
                dailyStartTs.addn(7 * 86400 - 1),
                0
            );
            await expectRevert.unspecified(promise);
        });

        it("Should only be called from ftso manager", async () => {
            await expectRevert(ftsoRewardManager.distributeRewards(
                [accounts[1], accounts[2]],
                [25, 75],
                100,
                0,
                accounts[6],
                REVEAL_EPOCH_DURATION_S,
                0,
                startTs.addn(PRICE_EPOCH_DURATION_S - 1),
                0
            ), "ftso manager only");
        });
    });

    describe("Price epochs, finalization in fallback", async () => {
        it("Should only be called from ftso manager", async () => {
            await expectRevert(ftsoRewardManager.accrueUnearnedRewards(
                0,
                REVEAL_EPOCH_DURATION_S,
                startTs.addn(PRICE_EPOCH_DURATION_S - 1)
            ), "ftso manager only");
        });

        it("Should accrue unearned rewards", async () => {
            // Act
            await mockFtsoManager.accrueUnearnedRewardsCall(
                0,
                PRICE_EPOCH_DURATION_S,
                startTs.addn(PRICE_EPOCH_DURATION_S - 1)
            );
            // Assert
            // 2 minute price epochs yield 720 price epochs per day
            // 2000000 / 720 = 2777.78 unearned rewards to burn. Decimal will get truncated.
            const { 3: totalUnearnedWei } = await ftsoRewardManager.getTotals();
            assert.equal(totalUnearnedWei.toNumber(), 2777);
        });

        it("Should evenly distribute rewards once unearned rewards have accrued", async () => {
            // Assemble
            // Simulate ftso in fallback by accruing unearned rewards for first price epoch
            await mockFtsoManager.accrueUnearnedRewardsCall(
                0,
                PRICE_EPOCH_DURATION_S,
                startTs.addn(PRICE_EPOCH_DURATION_S - 1)
            );

            // Act
            // Total awardable should now be 2000000 - 2777
            // Distribute rewards for next price epoch 
            await mockFtsoManager.distributeRewardsCall(
                [accounts[1]],
                [100],
                100,
                0,
                accounts[6],
                PRICE_EPOCH_DURATION_S,
                0,
                startTs.addn((PRICE_EPOCH_DURATION_S * 2) - 1),
                0
            );

            // Assert
            // 2 minute price epochs yield 720 price epochs per day
            // (2000000 - 2777 unearned) / (720 - 1) = 2777.78, rewards awarded. Decimal will get truncated.
            // Total "awarded" should now be 396 for actual rewards distributed.
            const { 0: totalAwardedWei, 3: totalUnearnedWei } = await ftsoRewardManager.getTotals();
            assert.equal(totalAwardedWei.toNumber(), 2777);
            assert.equal(totalUnearnedWei.toNumber(), 2777);
        });

        it("Should burn unearned rewards when inflation received", async () => {
            // Assemble
            const burnAddress = "0x000000000000000000000000000000000000dEaD";
            let burnAddressOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(burnAddress));
            // Simulate ftso in fallback by accruing unearned rewards for first price epoch
            await mockFtsoManager.accrueUnearnedRewardsCall(
                0,
                PRICE_EPOCH_DURATION_S,
                startTs.addn(PRICE_EPOCH_DURATION_S - 1)
            );

            // Act
            // Receive inflation. 
            // Inflation must call ftso reward manager during funding, and this proxy does it.
            const txReceipt = await mockInflation.receiveInflation({ value: "2000000" });

            // Assert
            let ftsoRewardManagerBalance = web3.utils.toBN(await web3.eth.getBalance(ftsoRewardManager.address));
            assert.equal(ftsoRewardManagerBalance.toNumber(), 1999604 - 2777 + 396);
            // Since supply is stubbed out, the burn address will default to 0x0.
            let burnAddressClosingBalance = web3.utils.toBN(await web3.eth.getBalance(burnAddress));
            assert.equal(burnAddressClosingBalance.sub(burnAddressOpeningBalance).toNumber(), 2777);
            // Check total unearned accural
            const { 3: totalUnearnedWei } = await ftsoRewardManager.getTotals();
            assert.equal(totalUnearnedWei.toNumber(), 2777);
        });

        it("Should limit the unearned rewards burned on any given receive inflation event", async () => {
            // Assemble
            const burnAddress = "0x000000000000000000000000000000000000dEaD";
            let burnAddressOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(burnAddress));
            // Simulate ftso in fallback by accruing unearned rewards for many price epochs
            // Should be 2777 * 150 = 416550
            for (var p = 1; p < 157; p++) {
                await mockFtsoManager.accrueUnearnedRewardsCall(
                    0,
                    PRICE_EPOCH_DURATION_S,
                    startTs.addn((PRICE_EPOCH_DURATION_S * p) - 1)
                );
            }

            // Act
            // Receive inflation. 
            // Inflation must call ftso reward manager during funding, and this proxy does it.
            const txReceipt = await mockInflation.receiveInflation({ value: "2000000" });

            // Amount burned should be limited to 20% of received inflation;
            let burnAddressClosingBalance = web3.utils.toBN(await web3.eth.getBalance(burnAddress));
            assert.equal(burnAddressClosingBalance.sub(burnAddressOpeningBalance).toNumber(), 400000, "Burn address does not contain correct balance");
            // Check totalBurnedWei()
            const { 4: totalBurnedWei } = await ftsoRewardManager.getTotals();
            assert.equal(totalBurnedWei.toNumber(), 400000, "FtsoRewardManager.totalBurnedWei does not contain correct balance");
        });
    });

    describe("getters and setters", async () => {
        it("Should get token pool supply data", async () => {
            // deposit some wnats
            await wNat.deposit({ from: accounts[1], value: "100" });

            let data = await ftsoRewardManager.getTokenPoolSupplyData();
            expect(data[0].toNumber()).to.equals(0);
            expect(data[1].toNumber()).to.equals(2000000);
            expect(data[2].toNumber()).to.equals(0);

            await distributeRewards(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0], false);

            await ftsoRewardManager.claimReward(accounts[1], [0], { from: accounts[1] });

            data = await ftsoRewardManager.getTokenPoolSupplyData();
            expect(data[0].toNumber()).to.equals(0);
            expect(data[1].toNumber()).to.equals(6000000);
            expect(data[2].toNumber()).to.equals(1390);
        });

        it("Should set and update data provider fee percentage", async () => {
            await ftsoRewardManager.setDataProviderFeePercentage(5, { from: accounts[2] });
            expect((await ftsoRewardManager.getDataProviderCurrentFeePercentage(accounts[1])).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderCurrentFeePercentage(accounts[2])).toNumber()).to.equals(0);

            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);
            await ftsoRewardManager.setDataProviderFeePercentage(10, { from: accounts[2] });
            expect((await ftsoRewardManager.getDataProviderCurrentFeePercentage(accounts[1])).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderCurrentFeePercentage(accounts[2])).toNumber()).to.equals(0);

            await travelToAndSetNewRewardEpoch(2, startTs, ftsoRewardManager, accounts[0]);
            await ftsoRewardManager.setDataProviderFeePercentage(8, { from: accounts[2] });
            await ftsoRewardManager.setDataProviderFeePercentage(15, { from: accounts[2] });
            expect((await ftsoRewardManager.getDataProviderCurrentFeePercentage(accounts[1])).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderCurrentFeePercentage(accounts[2])).toNumber()).to.equals(0);

            await travelToAndSetNewRewardEpoch(3, startTs, ftsoRewardManager, accounts[0]);
            expect((await ftsoRewardManager.getDataProviderCurrentFeePercentage(accounts[1])).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderCurrentFeePercentage(accounts[2])).toNumber()).to.equals(5);

            await travelToAndSetNewRewardEpoch(4, startTs, ftsoRewardManager, accounts[0]);
            expect((await ftsoRewardManager.getDataProviderCurrentFeePercentage(accounts[1])).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderCurrentFeePercentage(accounts[2])).toNumber()).to.equals(10);

            await travelToAndSetNewRewardEpoch(5, startTs, ftsoRewardManager, accounts[0]);
            expect((await ftsoRewardManager.getDataProviderCurrentFeePercentage(accounts[1])).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderCurrentFeePercentage(accounts[2])).toNumber()).to.equals(15);
        });

        it("Should get data provider fee percentage", async () => {
            await ftsoRewardManager.setDataProviderFeePercentage(5, { from: accounts[2] });
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[1], 0)).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[2], 0)).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[1], 1)).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[2], 1)).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[1], 2)).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[2], 2)).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[1], 3)).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[2], 3)).toNumber()).to.equals(5);
            await expectRevert(ftsoRewardManager.getDataProviderFeePercentage(accounts[1], 4), "invalid reward epoch");
            await expectRevert(ftsoRewardManager.getDataProviderFeePercentage(accounts[2], 4), "invalid reward epoch");

            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);
            await ftsoRewardManager.setDataProviderFeePercentage(10, { from: accounts[2] });
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[1], 0)).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[2], 0)).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[1], 1)).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[2], 1)).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[1], 2)).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[2], 2)).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[1], 3)).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[2], 3)).toNumber()).to.equals(5);
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[1], 4)).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[2], 4)).toNumber()).to.equals(10);
            await expectRevert(ftsoRewardManager.getDataProviderFeePercentage(accounts[1], 5), "invalid reward epoch");
            await expectRevert(ftsoRewardManager.getDataProviderFeePercentage(accounts[2], 5), "invalid reward epoch");

            await ftsoRewardManager.setDataProviderFeePercentage(8, { from: accounts[2] });
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[1], 0)).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[2], 0)).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[1], 1)).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[2], 1)).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[1], 2)).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[2], 2)).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[1], 3)).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[2], 3)).toNumber()).to.equals(5);
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[1], 4)).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[2], 4)).toNumber()).to.equals(8);
            await expectRevert(ftsoRewardManager.getDataProviderFeePercentage(accounts[1], 5), "invalid reward epoch");
            await expectRevert(ftsoRewardManager.getDataProviderFeePercentage(accounts[2], 5), "invalid reward epoch");
        });

        it("Should not get data provider fee percentage from old ftso reward manager", async () => {
            ftsoRewardManager = await FtsoRewardManager.new(
                accounts[0],
                ADDRESS_UPDATER,
                (await MockContract.new()).address,
                3,
                0
            );

            const getRewardEpochToExpireNext = web3.utils.sha3("getRewardEpochToExpireNext()")!.slice(0, 10); // first 4 bytes is function selector
            const getCurrentRewardEpoch = web3.utils.sha3("getCurrentRewardEpoch()")!.slice(0, 10); // first 4 bytes is function selector
            await mockFtsoManager.givenMethodReturnUint(getRewardEpochToExpireNext, 0);
            await mockFtsoManager.givenMethodReturnUint(getCurrentRewardEpoch, 2);

            await ftsoRewardManager.updateContractAddresses(
                encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.CLAIM_SETUP_MANAGER]),
                [ADDRESS_UPDATER, mockInflation.address, mockFtsoManager.address, wNat.address, claimSetupManager.address], { from: ADDRESS_UPDATER });
            await ftsoRewardManager.enableClaims();

            await ftsoRewardManager.setInitialRewardData();
            await ftsoRewardManager.setDataProviderFeePercentage(5, { from: accounts[2] });
            await expectRevert(ftsoRewardManager.getDataProviderFeePercentage(accounts[1], 0), "invalid reward epoch");
            await expectRevert(ftsoRewardManager.getDataProviderFeePercentage(accounts[2], 0), "invalid reward epoch");
            await expectRevert(ftsoRewardManager.getDataProviderFeePercentage(accounts[1], 1), "invalid reward epoch");
            await expectRevert(ftsoRewardManager.getDataProviderFeePercentage(accounts[2], 1), "invalid reward epoch");
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[1], 2)).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[2], 2)).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[1], 3)).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[2], 3)).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[1], 4)).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[2], 4)).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[1], 5)).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[2], 5)).toNumber()).to.equals(5);
            await expectRevert(ftsoRewardManager.getDataProviderFeePercentage(accounts[1], 6), "invalid reward epoch");
            await expectRevert(ftsoRewardManager.getDataProviderFeePercentage(accounts[2], 6), "invalid reward epoch");
        });

        it("Should get scheduled fee percentage", async () => {
            let data;

            data = await ftsoRewardManager.getDataProviderScheduledFeePercentageChanges(accounts[1]);
            expect(data[0].length).to.equals(0);
            expect(data[1].length).to.equals(0);
            expect(data[2].length).to.equals(0);

            await ftsoRewardManager.setDataProviderFeePercentage(5, { from: accounts[1] });
            data = await ftsoRewardManager.getDataProviderScheduledFeePercentageChanges(accounts[1]);
            compareNumberArrays(data[0], [5]);
            compareNumberArrays(data[1], [3]);
            compareArrays(data[2], [false]);

            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);
            expectEvent(await ftsoRewardManager.setDataProviderFeePercentage(10, { from: accounts[1] }), "FeePercentageChanged",
                { dataProvider: accounts[1], value: toBN(10), validFromEpoch: toBN(4) });
            data = await ftsoRewardManager.getDataProviderScheduledFeePercentageChanges(accounts[1]);
            compareNumberArrays(data[0], [5, 10]);
            compareNumberArrays(data[1], [3, 4]);
            compareArrays(data[2], [true, false]);

            await travelToAndSetNewRewardEpoch(2, startTs, ftsoRewardManager, accounts[0]);
            await ftsoRewardManager.setDataProviderFeePercentage(8, { from: accounts[1] });
            data = await ftsoRewardManager.getDataProviderScheduledFeePercentageChanges(accounts[1]);
            compareNumberArrays(data[0], [5, 10, 8]);
            compareNumberArrays(data[1], [3, 4, 5]);
            compareArrays(data[2], [true, true, false]);
            await ftsoRewardManager.setDataProviderFeePercentage(15, { from: accounts[1] });
            data = await ftsoRewardManager.getDataProviderScheduledFeePercentageChanges(accounts[1]);
            compareNumberArrays(data[0], [5, 10, 15]);
            compareNumberArrays(data[1], [3, 4, 5]);
            compareArrays(data[2], [true, true, false]);

            await travelToAndSetNewRewardEpoch(3, startTs, ftsoRewardManager, accounts[0]);
            data = await ftsoRewardManager.getDataProviderScheduledFeePercentageChanges(accounts[1]);
            compareNumberArrays(data[0], [10, 15]);
            compareNumberArrays(data[1], [4, 5]);
            compareArrays(data[2], [true, true]);

            await travelToAndSetNewRewardEpoch(4, startTs, ftsoRewardManager, accounts[0]);
            data = await ftsoRewardManager.getDataProviderScheduledFeePercentageChanges(accounts[1]);
            compareNumberArrays(data[0], [15]);
            compareNumberArrays(data[1], [5]);
            compareArrays(data[2], [true]);

            await travelToAndSetNewRewardEpoch(5, startTs, ftsoRewardManager, accounts[0]);
            data = await ftsoRewardManager.getDataProviderScheduledFeePercentageChanges(accounts[1]);
            expect(data[0].length).to.equals(0);
            expect(data[1].length).to.equals(0);
            expect(data[2].length).to.equals(0);
        });

        it("Should get epoch reward and claimed reward info", async () => {
            // deposit some wnats
            await wNat.deposit({ from: accounts[1], value: "100" });

            let data = await ftsoRewardManager.getTokenPoolSupplyData();
            expect(data[0].toNumber()).to.equals(0);
            expect(data[1].toNumber()).to.equals(2000000);
            expect(data[2].toNumber()).to.equals(0);

            await distributeRewards(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0], false);

            // Assert
            // 2 minute price epochs yield 720 price epochs per day
            // 2000000 / 720 = 2777.78, rewards to award. Decimal will get truncated.
            // a1 should be 2777 * 0.25 = 694.25
            // a2 should be 2777 * 0.75 = 2082.75
            // in distributeRewards this is done 2x
            let rewardEpochBeforeClaim = await ftsoRewardManager.getEpochReward(0);
            assert.equal(rewardEpochBeforeClaim[0].toNumber(), 2777 * 2);
            assert.equal(rewardEpochBeforeClaim[1].toNumber(), 0);

            let claimedRewardBeforeClaim = await ftsoRewardManager.getClaimedReward(0, accounts[1], accounts[1]);
            assert.equal(claimedRewardBeforeClaim[0], false);
            assert.equal(claimedRewardBeforeClaim[1].toNumber(), 0);

            let claimedRewardBeforeClaim2 = await ftsoRewardManager.getClaimedReward(0, accounts[1], accounts[2]);
            assert.equal(claimedRewardBeforeClaim2[0], false);
            assert.equal(claimedRewardBeforeClaim2[1].toNumber(), 0);

            let consumer = await GasConsumer.new(3);
            let tx = ftsoRewardManager.claimReward(consumer.address, [0], { from: accounts[1] });
            await expectRevert(tx, "claim failed");
            let tx2 = ftsoRewardManager.claimReward(constants.ZERO_ADDRESS, [0], { from: accounts[1] });
            await expectRevert(tx2, "recipient zero");

            await ftsoRewardManager.claimReward(accounts[1], [0], { from: accounts[1] });

            await ftsoRewardManager.claim(accounts[99], accounts[1], 0, true, { from: accounts[99] });
            expect((await ftsoRewardManager.nextClaimableRewardEpoch(accounts[99])).toNumber()).to.equals(1);

            let rewardEpochAfterClaim = await ftsoRewardManager.getEpochReward(0);
            assert.equal(rewardEpochAfterClaim[0].toNumber(), 2777 * 2);
            assert.equal(rewardEpochAfterClaim[1].toNumber(), 695 * 2);

            let claimedRewardAfterClaim = await ftsoRewardManager.getClaimedReward(0, accounts[1], accounts[1]);
            assert.equal(claimedRewardAfterClaim[0], true);
            assert.equal(claimedRewardAfterClaim[1].toNumber(), 0);     // always returns 0 for percentage delegation - TODO: should delete this useless method now?
        });

        it("Should revert if fee percentage > max bips", async () => {
            await expectRevert(ftsoRewardManager.setDataProviderFeePercentage(15000, { from: accounts[1] }), "invalid fee percentage value");
        });

        it("Should get state of rewards", async () => {
            let data;
            // deposit some wnats
            await wNat.deposit({ from: accounts[1], value: "100" });

            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            expect(data[0].length).to.equals(0);
            expect(data[1].length).to.equals(0);
            expect(data[2].length).to.equals(0);
            expect(data[3]).to.equals(false);

            // get some rewards
            await distributeRewards(accounts, startTs);

            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            compareArrays(data[0], [accounts[1]]);
            compareNumberArrays(data[1], [1390]);
            compareArrays(data[2], [false]);
            expect(data[3]).to.equals(false);

            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0], false);
            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            compareArrays(data[0], [accounts[1]]);
            compareNumberArrays(data[1], [1390]);
            compareArrays(data[2], [false]);
            expect(data[3]).to.equals(true);

            await ftsoRewardManager.claimReward(accounts[1], [0], { from: accounts[1] });
            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            // in new version, once the percentage delegation is claimed, getStateOfRewards returns empty array
            expect(data[0].length).to.equals(0);
            expect(data[1].length).to.equals(0);
            expect(data[2].length).to.equals(0);
            expect(data[3]).to.equals(true);

            // expire reward epoch 0
            await expireRewardEpoch(0, ftsoRewardManager, accounts[0]);
            // advance, but not expire epoch 1
            await travelToAndSetNewRewardEpoch(2, startTs, ftsoRewardManager, accounts[0], false);
            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            expect(data[0].length).to.equals(0);
            expect(data[1].length).to.equals(0);
            expect(data[2].length).to.equals(0);
            expect(data[3]).to.equals(false);
        });

        it("Should get state of rewards - delegator only", async () => {
            let data;
            // deposit some wnats
            await wNat.deposit({ from: accounts[1], value: "100" });
            await wNat.deposit({ from: accounts[4], value: "200" });

            // delegate some wnats
            await wNat.delegate(accounts[1], 5000, { from: accounts[4] });

            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            expect(data[0].length).to.equals(0);
            expect(data[1].length).to.equals(0);
            expect(data[2].length).to.equals(0);
            expect(data[3]).to.equals(false);

            data = await ftsoRewardManager.getStateOfRewards(accounts[4], 0);
            expect(data[0].length).to.equals(0);
            expect(data[1].length).to.equals(0);
            expect(data[2].length).to.equals(0);
            expect(data[3]).to.equals(false);

            // get some rewards
            await distributeRewards(accounts, startTs);

            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            compareArrays(data[0], [accounts[1]]);
            compareNumberArrays(data[1], [695]);
            compareArrays(data[2], [false]);
            expect(data[3]).to.equals(false);

            data = await ftsoRewardManager.getStateOfRewards(accounts[4], 0);
            compareArrays(data[0], [accounts[1]]);
            compareNumberArrays(data[1], [695]);
            compareArrays(data[2], [false]);
            expect(data[3]).to.equals(false);

            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);
            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            compareArrays(data[0], [accounts[1]]);
            compareNumberArrays(data[1], [695]);
            compareArrays(data[2], [false]);
            expect(data[3]).to.equals(true);

            data = await ftsoRewardManager.getStateOfRewards(accounts[4], 0);
            compareArrays(data[0], [accounts[1]]);
            compareNumberArrays(data[1], [695]);
            compareArrays(data[2], [false]);
            expect(data[3]).to.equals(true);

            let a1RewardInfoBeforeClaim = await ftsoRewardManager.getDataProviderPerformanceInfo(0, accounts[1]);

            await ftsoRewardManager.claimReward(accounts[1], [0], { from: accounts[1] });

            // reward for epoch 2 is not yet claimbale
            let claim = await ftsoRewardManager.contract.methods.claimReward(accounts[1], [2]).call({ from: accounts[0] });
            await ftsoRewardManager.claimReward(accounts[1], [2], { from: accounts[1] });
            expect(claim).to.equals('0');
            
            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            expect(data[0].length).to.equals(0);    // once the percentage delegation is claimed, getStateOfRewards returns empty array
            expect(data[1].length).to.equals(0);
            expect(data[2].length).to.equals(0);
            expect(data[3]).to.equals(true);

            data = await ftsoRewardManager.getStateOfRewards(accounts[4], 0);
            compareArrays(data[0], [accounts[1]]);
            compareNumberArrays(data[1], [695]);
            compareArrays(data[2], [false]);
            expect(data[3]).to.equals(true);

            let a1RewardInfoAfterClaim = await ftsoRewardManager.getDataProviderPerformanceInfo(0, accounts[1]);

            expect(a1RewardInfoBeforeClaim[0].toNumber()).to.equals(695 + 695);
            expect(a1RewardInfoBeforeClaim[1].toNumber()).to.equals(200);
            expect(a1RewardInfoBeforeClaim[0].toNumber()).to.equals(a1RewardInfoAfterClaim[0].toNumber());
            expect(a1RewardInfoBeforeClaim[1].toNumber()).to.equals(a1RewardInfoAfterClaim[1].toNumber());

            await ftsoRewardManager.claimReward(accounts[4], [0], { from: accounts[4] });

            data = await ftsoRewardManager.getStateOfRewards(accounts[4], 0);
            expect(data[0].length).to.equals(0);    // once the percentage delegation is claimed, getStateOfRewards returns empty array
            expect(data[1].length).to.equals(0);
            expect(data[2].length).to.equals(0);
            expect(data[3]).to.equals(true);

            // expire reward epoch 0
            await expireRewardEpoch(0, ftsoRewardManager, accounts[0]);
            // advance, but not expire epoch 1            
            await travelToAndSetNewRewardEpoch(2, startTs, ftsoRewardManager, accounts[0]);
            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            expect(data[0].length).to.equals(0);
            expect(data[1].length).to.equals(0);
            expect(data[2].length).to.equals(0);
            expect(data[3]).to.equals(false);

            data = await ftsoRewardManager.getStateOfRewards(accounts[4], 0);
            expect(data[0].length).to.equals(0);
            expect(data[1].length).to.equals(0);
            expect(data[2].length).to.equals(0);
            expect(data[3]).to.equals(false);
        });

        it("Should get state of rewards - delegator and provider - percentage", async () => {
            let data;
            // deposit some wnats
            await wNat.deposit({ from: accounts[1], value: "100" });
            await wNat.deposit({ from: accounts[2], value: "200" });

            // delegate some wnats
            await wNat.delegate(accounts[1], 5000, { from: accounts[2] });

            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            expect(data[0].length).to.equals(0);
            expect(data[1].length).to.equals(0);
            expect(data[2].length).to.equals(0);
            expect(data[3]).to.equals(false);

            data = await ftsoRewardManager.getStateOfRewards(accounts[2], 0);
            expect(data[0].length).to.equals(0);
            expect(data[1].length).to.equals(0);
            expect(data[2].length).to.equals(0);
            expect(data[3]).to.equals(false);

            // get some rewards
            await distributeRewards(accounts, startTs);

            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            compareArrays(data[0], [accounts[1]]);
            compareNumberArrays(data[1], [695]);
            compareArrays(data[2], [false]);
            expect(data[3]).to.equals(false);

            data = await ftsoRewardManager.getStateOfRewards(accounts[2], 0);
            compareArrays(data[0], [accounts[2], accounts[1]]);
            compareNumberArrays(data[1], [4164, 695]);
            compareArrays(data[2], [false, false]);
            expect(data[3]).to.equals(false);

            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);
            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            compareArrays(data[0], [accounts[1]]);
            compareNumberArrays(data[1], [695]);
            compareArrays(data[2], [false]);
            expect(data[3]).to.equals(true);

            data = await ftsoRewardManager.getStateOfRewards(accounts[2], 0);
            compareArrays(data[0], [accounts[2], accounts[1]]);
            compareNumberArrays(data[1], [4164, 695]);
            compareArrays(data[2], [false, false]);
            expect(data[3]).to.equals(true);

            expectEvent(await ftsoRewardManager.claimReward(accounts[5], [0], { from: accounts[1] }), "RewardClaimed",
                { dataProvider: accounts[1], whoClaimed: accounts[1], sentTo: accounts[5], rewardEpoch: toBN(0), amount: toBN(695) });
            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            expect(data[0].length).to.equals(0);    // once the percentage delegation is claimed, getStateOfRewards returns empty array
            expect(data[1].length).to.equals(0);
            expect(data[2].length).to.equals(0);
            expect(data[3]).to.equals(true);

            data = await ftsoRewardManager.getStateOfRewards(accounts[2], 0);
            compareArrays(data[0], [accounts[2], accounts[1]]);
            compareNumberArrays(data[1], [4164, 695]);
            compareArrays(data[2], [false, false]);
            expect(data[3]).to.equals(true);

            let tx = await ftsoRewardManager.claimReward(accounts[2], [0], { from: accounts[2] });
            expect(tx.logs[0].event).to.equals("RewardClaimed");
            expect(tx.logs[1].event).to.equals("RewardClaimed");

            data = await ftsoRewardManager.getStateOfRewards(accounts[2], 0);
            expect(data[0].length).to.equals(0);    // once the percentage delegation is claimed, getStateOfRewards returns empty array
            expect(data[1].length).to.equals(0);
            expect(data[2].length).to.equals(0);
            expect(data[3]).to.equals(true);

            // expire reward epoch 0
            await expireRewardEpoch(0, ftsoRewardManager, accounts[0]);
            // advance, but not expire epoch 1            
            await travelToAndSetNewRewardEpoch(2, startTs, ftsoRewardManager, accounts[0]);
            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            expect(data[0].length).to.equals(0);
            expect(data[1].length).to.equals(0);
            expect(data[2].length).to.equals(0);
            expect(data[3]).to.equals(false);

            data = await ftsoRewardManager.getStateOfRewards(accounts[2], 0);
            expect(data[0].length).to.equals(0);
            expect(data[1].length).to.equals(0);
            expect(data[2].length).to.equals(0);
            expect(data[3]).to.equals(false);
        });

        it("Should revert at get state of rewards if delegated explicitly", async () => {
            let data;
            // deposit some wnats
            await wNat.deposit({ from: accounts[1], value: "100" });
            await wNat.deposit({ from: accounts[2], value: "200" });

            // delegate some wnats
            await wNat.delegateExplicit(accounts[1], 100, { from: accounts[2] });

            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            expect(data[0].length).to.equals(0);
            expect(data[1].length).to.equals(0);
            expect(data[2].length).to.equals(0);
            expect(data[3]).to.equals(false);

            await expectRevert(ftsoRewardManager.getStateOfRewards(accounts[2], 0), "delegatesOf does not work in AMOUNT delegation mode");
        });

        it("Should get state of rewards - delegator and provider - explicit", async () => {
            let data;
            // deposit some wnats
            await wNat.deposit({ from: accounts[1], value: "100" });
            await wNat.deposit({ from: accounts[2], value: "200" });

            // delegate some wnats
            await wNat.delegateExplicit(accounts[1], 100, { from: accounts[2] });

            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            expect(data[0].length).to.equals(0);
            expect(data[1].length).to.equals(0);
            expect(data[2].length).to.equals(0);
            expect(data[3]).to.equals(false);

            data = await ftsoRewardManager.getStateOfRewardsFromDataProviders(accounts[1], 0, [accounts[1], accounts[2]]);
            compareNumberArrays(data[0], [0, 0]);
            compareArrays(data[1], [false, false]);
            expect(data[2]).to.equals(false);

            data = await ftsoRewardManager.getStateOfRewardsFromDataProviders(accounts[2], 0, [accounts[1], accounts[2]]);
            compareNumberArrays(data[0], [0, 0]);
            compareArrays(data[1], [false, false]);
            expect(data[2]).to.equals(false);

            // get some rewards
            await distributeRewards(accounts, startTs);

            data = await ftsoRewardManager.getStateOfRewardsFromDataProviders(accounts[1], 0, [accounts[1], accounts[2]]);
            compareNumberArrays(data[0], [695, 0]);
            compareArrays(data[1], [false, false]);
            expect(data[2]).to.equals(false);

            data = await ftsoRewardManager.getStateOfRewardsFromDataProviders(accounts[2], 0, [accounts[1], accounts[2]]);
            compareNumberArrays(data[0], [695, 4164]);
            compareArrays(data[1], [false, false]);
            expect(data[2]).to.equals(false);

            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);
            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            compareArrays(data[0], [accounts[1]]);
            compareNumberArrays(data[1], [695]);
            compareArrays(data[2], [false]);
            expect(data[3]).to.equals(true);

            data = await ftsoRewardManager.getStateOfRewardsFromDataProviders(accounts[1], 0, [accounts[1], accounts[2]]);
            compareNumberArrays(data[0], [695, 0]);
            compareArrays(data[1], [false, false]);
            expect(data[2]).to.equals(true);

            data = await ftsoRewardManager.getStateOfRewardsFromDataProviders(accounts[2], 0, [accounts[1], accounts[2]]);
            compareNumberArrays(data[0], [695, 4164]);
            compareArrays(data[1], [false, false]);
            expect(data[2]).to.equals(true);

            expectEvent(await ftsoRewardManager.claimReward(accounts[5], [0], { from: accounts[1] }), "RewardClaimed",
                { dataProvider: accounts[1], whoClaimed: accounts[1], sentTo: accounts[5], rewardEpoch: toBN(0), amount: toBN(695) });
            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            expect(data[0].length).to.equals(0);    // once the percentage delegation is claimed, getStateOfRewards returns empty array
            expect(data[1].length).to.equals(0);
            expect(data[2].length).to.equals(0);
            expect(data[3]).to.equals(true);

            data = await ftsoRewardManager.getStateOfRewardsFromDataProviders(accounts[1], 0, [accounts[1], accounts[2]]);
            compareNumberArrays(data[0], [0, 0]);   // percentage delegated claimed rewards are set to 0
            compareArrays(data[1], [true, true]);   // once percentage claimed, all are true
            expect(data[2]).to.equals(true);

            data = await ftsoRewardManager.getStateOfRewardsFromDataProviders(accounts[2], 0, [accounts[1], accounts[2]]);
            compareNumberArrays(data[0], [695, 4164]);
            compareArrays(data[1], [false, false]);
            expect(data[2]).to.equals(true);

            expectEvent(await ftsoRewardManager.claimRewardFromDataProviders(accounts[2], [0], [accounts[1]], { from: accounts[2] }), "RewardClaimed",
                { dataProvider: accounts[1], whoClaimed: accounts[2], sentTo: accounts[2], rewardEpoch: toBN(0), amount: toBN(695) });

            data = await ftsoRewardManager.getStateOfRewardsFromDataProviders(accounts[2], 0, [accounts[1], accounts[2]]);
            compareNumberArrays(data[0], [695, 4164]);
            compareArrays(data[1], [true, false]);
            expect(data[2]).to.equals(true);

            expectEvent(await ftsoRewardManager.claimRewardFromDataProviders(accounts[2], [0], [accounts[2]], { from: accounts[2] }), "RewardClaimed",
                { dataProvider: accounts[2], whoClaimed: accounts[2], sentTo: accounts[2], rewardEpoch: toBN(0), amount: toBN(4164) });

            data = await ftsoRewardManager.getStateOfRewardsFromDataProviders(accounts[2], 0, [accounts[1], accounts[2]]);
            compareNumberArrays(data[0], [695, 4164]);
            compareArrays(data[1], [true, true]);
            expect(data[2]).to.equals(true);

            // expire reward epoch 0
            await expireRewardEpoch(0, ftsoRewardManager, accounts[0]);
            // advance, but not expire epoch 1            
            await travelToAndSetNewRewardEpoch(2, startTs, ftsoRewardManager, accounts[0]);
            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            expect(data[0].length).to.equals(0);
            expect(data[1].length).to.equals(0);
            expect(data[2].length).to.equals(0);
            expect(data[3]).to.equals(false);

            data = await ftsoRewardManager.getStateOfRewardsFromDataProviders(accounts[1], 0, [accounts[1], accounts[2]]);
            expect(data[0].length).to.equals(0);
            expect(data[1].length).to.equals(0);
            expect(data[2]).to.equals(false);

            data = await ftsoRewardManager.getStateOfRewardsFromDataProviders(accounts[2], 0, [accounts[1], accounts[2]]);
            expect(data[0].length).to.equals(0);
            expect(data[1].length).to.equals(0);
            expect(data[2]).to.equals(false);
        });

        it("Should get state of rewards - no reward", async () => {
            let data;
            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            expect(data[0].length).to.equals(0);
            expect(data[1].length).to.equals(0);
            expect(data[2].length).to.equals(0);
            expect(data[3]).to.equals(false);

            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);
            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            expect(data[0].length).to.equals(0);
            expect(data[1].length).to.equals(0);
            expect(data[2].length).to.equals(0);
            expect(data[3]).to.equals(true);

            await ftsoRewardManager.claimReward(accounts[1], [0], { from: accounts[1] });
            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            expect(data[0].length).to.equals(0);
            expect(data[1].length).to.equals(0);
            expect(data[2].length).to.equals(0);
            expect(data[3]).to.equals(true);

            // expire reward epoch 0
            await expireRewardEpoch(0, ftsoRewardManager, accounts[0]);
            // advance, but not expire epoch 1                         
            await travelToAndSetNewRewardEpoch(2, startTs, ftsoRewardManager, accounts[0]);
            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            expect(data[0].length).to.equals(0);
            expect(data[1].length).to.equals(0);
            expect(data[2].length).to.equals(0);
            expect(data[3]).to.equals(false);
        });

        it("Should get state of rewards from data providers - no reward", async () => {
            let data;
            data = await ftsoRewardManager.getStateOfRewardsFromDataProviders(accounts[1], 0, [accounts[1], accounts[2]]);
            compareNumberArrays(data[0], [0, 0]);
            compareArrays(data[1], [false, false]);
            expect(data[2]).to.equals(false);

            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);
            data = await ftsoRewardManager.getStateOfRewardsFromDataProviders(accounts[1], 0, [accounts[1], accounts[2]]);
            compareNumberArrays(data[0], [0, 0]);
            compareArrays(data[1], [false, false]);
            expect(data[2]).to.equals(true);

            await ftsoRewardManager.claimReward(accounts[1], [0], { from: accounts[1] });
            data = await ftsoRewardManager.getStateOfRewardsFromDataProviders(accounts[1], 0, [accounts[1], accounts[2]]);
            compareNumberArrays(data[0], [0, 0]);
            compareArrays(data[1], [true, true]);   // once percentage claimed, all are true
            expect(data[2]).to.equals(true);

            await expectRevert(ftsoRewardManager.claimRewardFromDataProviders(accounts[1], [0], [accounts[1], accounts[2]], { from: accounts[1] }),
                "explicit delegation only");

            // expire reward epoch 0
            await expireRewardEpoch(0, ftsoRewardManager, accounts[0]);
            // advance, but not expire epoch 1            
            await travelToAndSetNewRewardEpoch(2, startTs, ftsoRewardManager, accounts[0]);
            data = await ftsoRewardManager.getStateOfRewardsFromDataProviders(accounts[1], 0, [accounts[1], accounts[2]]);
            expect(data[0].length).to.equals(0);
            expect(data[1].length).to.equals(0);
            expect(data[2]).to.equals(false);
        });

        it("Should get epochs with claimable / unclaimed rewards", async () => {
            let data;
            // deposit some wnats
            await wNat.deposit({ from: accounts[1], value: "100" });
            await wNat.deposit({ from: accounts[3], value: "300" });
            await wNat.deposit({ from: accounts[4], value: "200" });

            // delegate some wnats
            await wNat.delegate(accounts[1], 5000, { from: accounts[3] });
            await wNat.delegate(accounts[1], 5000, { from: accounts[4] });

            await expectRevert(ftsoRewardManager.getEpochsWithClaimableRewards(), "no epoch with claimable rewards");
            await expectRevert(ftsoRewardManager.getEpochsWithUnclaimedRewards(accounts[1]), "no epoch with claimable rewards");
            await expectRevert(ftsoRewardManager.getEpochsWithUnclaimedRewards(accounts[2]), "no epoch with claimable rewards");
            await expectRevert(ftsoRewardManager.getEpochsWithUnclaimedRewards(accounts[3]), "no epoch with claimable rewards");
            await expectRevert(ftsoRewardManager.getEpochsWithUnclaimedRewards(accounts[4]), "no epoch with claimable rewards");

            // get some rewards
            await distributeRewards(accounts, startTs);

            await expectRevert(ftsoRewardManager.getEpochsWithClaimableRewards(), "no epoch with claimable rewards");
            await expectRevert(ftsoRewardManager.getEpochsWithUnclaimedRewards(accounts[1]), "no epoch with claimable rewards");
            await expectRevert(ftsoRewardManager.getEpochsWithUnclaimedRewards(accounts[2]), "no epoch with claimable rewards");
            await expectRevert(ftsoRewardManager.getEpochsWithUnclaimedRewards(accounts[3]), "no epoch with claimable rewards");
            await expectRevert(ftsoRewardManager.getEpochsWithUnclaimedRewards(accounts[4]), "no epoch with claimable rewards");

            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);

            data = await ftsoRewardManager.getEpochsWithClaimableRewards();
            expect(data[0].toNumber()).to.equals(0);
            expect(data[1].toNumber()).to.equals(0);

            data = await ftsoRewardManager.getEpochsWithUnclaimedRewards(accounts[1]);
            compareNumberArrays(data, [0]);

            data = await ftsoRewardManager.getEpochsWithUnclaimedRewards(accounts[2]);
            compareNumberArrays(data, []);

            data = await ftsoRewardManager.getEpochsWithUnclaimedRewards(accounts[3]);
            compareNumberArrays(data, [0]);

            data = await ftsoRewardManager.getEpochsWithUnclaimedRewards(accounts[4]);
            compareNumberArrays(data, [0]);

            await ftsoRewardManager.claimReward(accounts[1], [0], { from: accounts[1] });

            data = await ftsoRewardManager.getEpochsWithUnclaimedRewards(accounts[1]);
            compareNumberArrays(data, []);

            data = await ftsoRewardManager.getEpochsWithUnclaimedRewards(accounts[2]);
            compareNumberArrays(data, []);

            data = await ftsoRewardManager.getEpochsWithUnclaimedRewards(accounts[3]);
            compareNumberArrays(data, [0]);

            data = await ftsoRewardManager.getEpochsWithUnclaimedRewards(accounts[4]);
            compareNumberArrays(data, [0]);

            await ftsoRewardManager.claimReward(accounts[4], [0], { from: accounts[4] });

            data = await ftsoRewardManager.getEpochsWithUnclaimedRewards(accounts[1]);
            compareNumberArrays(data, []);

            data = await ftsoRewardManager.getEpochsWithUnclaimedRewards(accounts[2]);
            compareNumberArrays(data, []);

            data = await ftsoRewardManager.getEpochsWithUnclaimedRewards(accounts[3]);
            compareNumberArrays(data, [0]);

            data = await ftsoRewardManager.getEpochsWithUnclaimedRewards(accounts[4]);
            compareNumberArrays(data, []);

            // expire reward epoch 0
            await expireRewardEpoch(0, ftsoRewardManager, accounts[0]);
            // advance, but not expire epoch 1            
            await travelToAndSetNewRewardEpoch(2, startTs, ftsoRewardManager, accounts[0]);

            data = await ftsoRewardManager.getEpochsWithClaimableRewards();
            expect(data[0].toNumber()).to.equals(1);
            expect(data[1].toNumber()).to.equals(1);

            data = await ftsoRewardManager.getEpochsWithUnclaimedRewards(accounts[1]);
            compareNumberArrays(data, []);

            data = await ftsoRewardManager.getEpochsWithUnclaimedRewards(accounts[2]);
            compareNumberArrays(data, []);

            data = await ftsoRewardManager.getEpochsWithUnclaimedRewards(accounts[3]);
            compareNumberArrays(data, []);

            data = await ftsoRewardManager.getEpochsWithUnclaimedRewards(accounts[4]);
            compareNumberArrays(data, []);
        });

    });

    describe("reward claiming", async () => {
        it("Should accept NAT", async () => {
            // Assemble
            // Act
            // Inflation must call ftso reward manager during funding, and this proxy does it.
            const txReceipt = await mockInflation.receiveInflation({ value: "2000000" });
            await expectEvent.inTransaction(txReceipt.tx,
                ftsoRewardManager,
                "InflationReceived", { amountReceivedWei: toBN(2000000) }
            );

            // Assert
            let balance = web3.utils.toBN(await web3.eth.getBalance(ftsoRewardManager.address));
            assert.equal(balance.toNumber(), 2000000);
        });

        it("Should gracefully receive self-destruct proceeds", async () => {
            // Assemble
            // Give suicidal some NAT
            let balanceBefore = await web3.eth.getBalance(burnAddress);
            await web3.eth.sendTransaction({ from: accounts[0], to: mockSuicidal.address, value: 1 });
            // Sneak it into ftso reward manager
            await mockSuicidal.die();
            assert.equal(await web3.eth.getBalance(ftsoRewardManager.address), "1");
            // Act
            await mockInflation.receiveInflation({ value: "1" });
            // Assert
            assert.equal(await web3.eth.getBalance(ftsoRewardManager.address), "1");
            let balanceAfter = await web3.eth.getBalance(burnAddress);
            assert.equal(parseInt(balanceAfter) - parseInt(balanceBefore), 1);
        });

        it("Should gracefully receive self-destruct proceeds - initial balance > 0", async () => {
            assert.equal((await ftsoRewardManager.getExpectedBalance()).toString(), "0");
            // Add some initial balance (inflation)
            let balanceBefore = await web3.eth.getBalance(burnAddress);
            await mockInflation.receiveInflation({ value: "1" });
            assert.equal((await ftsoRewardManager.getExpectedBalance()).toString(), "1");
            assert.equal(await web3.eth.getBalance(ftsoRewardManager.address), "1");
            // Assemble
            // Give suicidal some NAT
            await web3.eth.sendTransaction({ from: accounts[0], to: mockSuicidal.address, value: 1 });
            // Sneak it into ftso reward manager
            await mockSuicidal.die();
            assert.equal(await web3.eth.getBalance(ftsoRewardManager.address), "2");
            assert.equal((await ftsoRewardManager.getExpectedBalance()).toString(), "1");
            // Act
            await mockInflation.receiveInflation({ value: "1" });
            // Assert
            assert.equal(await web3.eth.getBalance(ftsoRewardManager.address), "2");
            assert.equal((await ftsoRewardManager.getExpectedBalance()).toString(), "2");
            let balanceAfter = await web3.eth.getBalance(burnAddress);
            assert.equal(parseInt(balanceAfter) - parseInt(balanceBefore), 1);
        });

        it("Should not accept NAT unless from inflation", async () => {
            // Assemble
            // Act
            const receivePromise = ftsoRewardManager.receiveInflation({ value: "2000000" });
            // Assert
            await expectRevert(receivePromise, "inflation only");
        });

        it("Should enable rewards to be claimed once reward epoch finalized - percentage", async () => {

            // deposit some wnats
            await wNat.deposit({ from: accounts[1], value: "100" });

            await distributeRewards(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);
            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let natOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimReward(accounts[3], [0], { from: accounts[1] });
            // Assert
            // a1 -> a3 claimed should be (2000000 / 720) * 0.25 * 2 price epochs = 1390
            let natClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(natClosingBalance.sub(natOpeningBalance).toNumber(), 1390);
        });

        it("Should enable rewards to be claimed by delegator once reward epoch finalized - percentage", async () => {

            // deposit some wnats
            await wNat.deposit({ from: accounts[4], value: "100" });

            // delegate some wnats
            await wNat.delegate(accounts[1], 10000, { from: accounts[4] });

            await distributeRewards(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let natOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimReward(accounts[3], [0], { from: accounts[4] });
            // Assert
            // a4 -> a3 claimed should be ((2000000 / 720) * 0.25 *) 2 price epochs = 695 * 2 = 1390
            let natClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(natClosingBalance.sub(natOpeningBalance).toNumber(), 1390);
        });

        it("Should enable rewards to be claimed by delegator and data provider once reward epoch finalized - percentage", async () => {

            // deposit some wnats
            await wNat.deposit({ from: accounts[1], value: "100" });
            await wNat.deposit({ from: accounts[4], value: "100" });

            // delegate some wnats
            await wNat.delegate(accounts[1], 10000, { from: accounts[4] });

            await distributeRewards(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let natOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimReward(accounts[3], [0], { from: accounts[4] });
            // Assert
            // a4 -> a3 claimed should be (2000000 / 720) * 0.25 * 2 price epochs / 2 (half vote power was delegated) = 695
            let natClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(natClosingBalance.sub(natOpeningBalance).toNumber(), 695);

            // Act
            // Claim reward to a5 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let natOpeningBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            await ftsoRewardManager.claimReward(accounts[5], [0], { from: accounts[1] });
            // a1 -> a5 claimed should be (2000000 / 720) * 0.25 * 2 price epochs / 2 (half vote power was delegated) = 695
            let natClosingBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            assert.equal(natClosingBalance2.sub(natOpeningBalance2).toNumber(), 695);
        });

        it("Should enable rewards to be claimed by delegator and data provider once reward epoch finalized - with self-destruct proceeds", async () => {
            // deposit some wnats
            await wNat.deposit({ from: accounts[1], value: "100" });
            await wNat.deposit({ from: accounts[4], value: "100" });

            // delegate some wnats
            await wNat.delegate(accounts[1], 10000, { from: accounts[4] });

            await distributeRewards(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);

            let balance1 = await web3.eth.getBalance(burnAddress);
            // Give suicidal some NAT
            await web3.eth.sendTransaction({ from: accounts[0], to: mockSuicidal.address, value: 1 });
            // Sneak it into ftso reward manager
            await mockSuicidal.die();

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let natOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimReward(accounts[3], [0], { from: accounts[4] });
            // Assert
            // a4 -> a3 claimed should be (2000000 / 720) * 0.25 * 2 price epochs / 2 (half vote power was delegated) = 695
            let natClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(natClosingBalance.sub(natOpeningBalance).toNumber(), 695);
            let balance2 = await web3.eth.getBalance(burnAddress);
            assert.equal(parseInt(balance2) - parseInt(balance1), 1);

            // Create another suicidal
            const anotherMockSuicidal = await SuicidalMock.new(ftsoRewardManager.address);
            // Give suicidal some NAT
            await web3.eth.sendTransaction({ from: accounts[0], to: anotherMockSuicidal.address, value: 1 });
            // Sneak it into ftso reward manager
            await anotherMockSuicidal.die();

            // Act
            // Claim reward to a5 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let natOpeningBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            await ftsoRewardManager.claimReward(accounts[5], [0], { from: accounts[1] });
            // a1 -> a5 claimed should be (2000000 / 720) * 0.25 * 2 price epochs / 2 (half vote power was delegated) = 695
            let natClosingBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            assert.equal(natClosingBalance2.sub(natOpeningBalance2).toNumber(), 695);
            let balance3 = await web3.eth.getBalance(burnAddress);
            assert.equal(parseInt(balance3) - parseInt(balance2), 1);
        });

        it("Should enable rewards to be claimed by delegator and data provider once reward epoch finalized - percentage - should not claim twice", async () => {

            // deposit some wnats
            await wNat.deposit({ from: accounts[1], value: "100" });
            await wNat.deposit({ from: accounts[4], value: "100" });

            // delegate some wnats
            await wNat.delegate(accounts[1], 10000, { from: accounts[4] });

            await distributeRewards(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let natOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimReward(accounts[3], [0], { from: accounts[4] });
            // Assert
            // a4 -> a3 claimed should be (2000000 / 720) * 0.25 * 2 price epochs / 2 (half vote power was delegated) = 695
            let natClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(natClosingBalance.sub(natOpeningBalance).toNumber(), 695);

            // if claiming again, get 0
            let natOpeningBalance1 = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimReward(accounts[3], [0], { from: accounts[4] });
            let natClosingBalance1 = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(natClosingBalance1.sub(natOpeningBalance1).toNumber(), 0);

            // Act
            // Claim reward to a5 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let natOpeningBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            await ftsoRewardManager.claimReward(accounts[5], [0], { from: accounts[1] });
            // a1 -> a5 claimed should be (2000000 / 720) * 0.25 * 2 price epochs / 2 (half vote power was delegated) = 695
            let natClosingBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            assert.equal(natClosingBalance2.sub(natOpeningBalance2).toNumber(), 695);

            // if claiming again, get 0
            let natOpeningBalance3 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            await ftsoRewardManager.claimReward(accounts[5], [0], { from: accounts[1] });
            let natClosingBalance3 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            assert.equal(natClosingBalance3.sub(natOpeningBalance3).toNumber(), 0);
        });

        it("Should enable rewards to be claimed by delegator and data provider once reward epoch finalized - percentage - get 0 if not rewarded ftso", async () => {

            // deposit some wnats
            await wNat.deposit({ from: accounts[1], value: "100" });
            await wNat.deposit({ from: accounts[4], value: "100" });

            // delegate some wnats
            await wNat.delegate(accounts[1], 10000, { from: accounts[4] });

            let votePowerBlock = await web3.eth.getBlockNumber();
            const getRewardEpochVotePowerBlock = ftsoManagerInterface.contract.methods.getRewardEpochVotePowerBlock(0).encodeABI();
            const getRewardEpochVotePowerBlockReturn = web3.eth.abi.encodeParameter('uint256', votePowerBlock);
            await mockFtsoManager.givenMethodReturn(getRewardEpochVotePowerBlock, getRewardEpochVotePowerBlockReturn);
            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let natOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.getStateOfRewards(accounts[4], 0, { from: accounts[4] });
            await ftsoRewardManager.claimReward(accounts[3], [0], { from: accounts[4] });
            // Assert
            let natClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(natClosingBalance.sub(natOpeningBalance).toNumber(), 0);

            // Act
            // Claim reward to a5 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let natOpeningBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            await ftsoRewardManager.getStateOfRewards(accounts[1], 0, { from: accounts[1] });
            await ftsoRewardManager.claimReward(accounts[5], [0], { from: accounts[1] });
            let natClosingBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            assert.equal(natClosingBalance2.sub(natOpeningBalance2).toNumber(), 0);
        });

        it("Should enable rewards to be claimed by delegator and data provider (fee 5%) once reward epoch finalized - percentage", async () => {
            // Assemble
            // set delegator fee
            await ftsoRewardManager.setDataProviderFeePercentage(500, { from: accounts[1] });
            // travel 3 reward epochs
            await travelToAndSetNewRewardEpoch(3, startTs, ftsoRewardManager, accounts[0]);

            // deposit some wnats
            await wNat.deposit({ from: accounts[1], value: "100" });
            await wNat.deposit({ from: accounts[4], value: "100" });

            // delegate some wnats
            await wNat.delegate(accounts[1], 10000, { from: accounts[4] });

            await distributeRewards(accounts, startTs, 3);
            await travelToAndSetNewRewardEpoch(4, startTs, ftsoRewardManager, accounts[0]);

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let natOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimReward(accounts[3], [3], { from: accounts[4] });

            // Assert
            // Note: 3 reward epochs passed (starting epoch 0), no rewards allocated, then 1 more daily allocation.
            // So, 14000000 rewards to distribute starting in epoch 3 (two dailies in a reward epoch).
            // a4 -> a3 claimed should be (14000000 / 720) * 0.25 * 2 price epochs / 2 (half vote power was delegated) * 0.95 (fee) = 4617
            let natClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(natClosingBalance.sub(natOpeningBalance).toNumber(), 4617);

            // Act
            // Claim reward to a5 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let natOpeningBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            await ftsoRewardManager.claimReward(accounts[5], [3], { from: accounts[1] });

            // Assert
            // a1 -> a5 claimed should be (14000000 / 720) * 0.25 * 2 price epochs / 2 (half vote power was delegated) * 1.05 (fee) + 1 = 5105
            let natClosingBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            assert.equal(natClosingBalance2.sub(natOpeningBalance2).toNumber(), 5105);
        });

        it("Should enable rewards to be claimed by delegator and data provider (fee 5%) once reward epoch finalized 2 - percentage", async () => {

            // set delegator fee
            await ftsoRewardManager.setDataProviderFeePercentage(500, { from: accounts[1] });
            // travel 3 reward epochs
            await travelToAndSetNewRewardEpoch(3, startTs, ftsoRewardManager, accounts[0]);

            // deposit some wnats
            await wNat.deposit({ from: accounts[1], value: "1000" });
            await wNat.deposit({ from: accounts[4], value: "1" });

            // delegate some wnats
            await wNat.delegate(accounts[1], 10000, { from: accounts[4] });

            await distributeRewards(accounts, startTs, 3);
            await travelToAndSetNewRewardEpoch(4, startTs, ftsoRewardManager, accounts[0]);

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let natOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimReward(accounts[3], [3], { from: accounts[4] });

            // Assert
            // Note: 3 reward epochs passed (starting epoch 0), no rewards allocated, then 1 more daily allocation.
            // So, 14000000 rewards to distribute starting in epoch 3 (two dailies in a reward epoch).
            // a4 -> a3 claimed should be (14000000 / 720) * 0.25 * 2 price epochs * (1 / 1001) * 0.95 (fee) = 9
            let natClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(natClosingBalance.sub(natOpeningBalance).toNumber(), 9);

            // Act
            // Claim reward to a5 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let natOpeningBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            await ftsoRewardManager.claimReward(accounts[5], [3], { from: accounts[1] });

            // Assert
            // a1 -> a5 claimed should be (14000000 / 720) * 0.25 * 2 price epochs * (1000/1001 + 1/1001 * 0.05) (fee) = 9713
            let natClosingBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            assert.equal(natClosingBalance2.sub(natOpeningBalance2).toNumber(), 9713);
        });

        it("Should not decrease claimer's next claimable epoch and allow claiming twice", async () => {
            // set delegator fee
            await ftsoRewardManager.setDataProviderFeePercentage(500, { from: accounts[1] });
            // travel 3 reward epochs
            await travelToAndSetNewRewardEpoch(3, startTs, ftsoRewardManager, accounts[0]);

            // deposit some wnats
            await wNat.deposit({ from: accounts[1], value: "1000" });
            await wNat.deposit({ from: accounts[4], value: "1" });

            // delegate some wnats
            await wNat.delegate(accounts[1], 10000, { from: accounts[4] });

            await distributeRewards(accounts, startTs, 3);
            await travelToAndSetNewRewardEpoch(4, startTs, ftsoRewardManager, accounts[0]);

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees
            expect((await ftsoRewardManager.nextClaimableRewardEpoch(accounts[4])).toNumber()).to.equals(0);            
            let natOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimReward(accounts[3], [3], { from: accounts[4] });
            expect((await ftsoRewardManager.nextClaimableRewardEpoch(accounts[4])).toNumber()).to.equals(4);            

            let natClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(natClosingBalance.sub(natOpeningBalance).toNumber(), 9);

            let natOpeningBalance1 = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimReward(accounts[3], [2], { from: accounts[4] });
            let natClosingBalance1 = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(natClosingBalance1.sub(natOpeningBalance1).toNumber(), 0);
            // next claimable reward epoch should not be decreased to 3
            expect((await ftsoRewardManager.nextClaimableRewardEpoch(accounts[4])).toNumber()).to.equals(4);            

            let natOpeningBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimReward(accounts[3], [3], { from: accounts[4] });
            let natClosingBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(natClosingBalance2.sub(natOpeningBalance2).toNumber(), 0);
            expect((await ftsoRewardManager.nextClaimableRewardEpoch(accounts[4])).toNumber()).to.equals(4);            
        });

        it("Should enable rewards to be claimed once reward epoch finalized - explicit", async () => {

            // deposit some wnats
            await wNat.deposit({ from: accounts[5], value: "100" });
            await wNat.delegateExplicit(accounts[1], 100, { from: accounts[5] });

            await distributeRewards(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let natOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimRewardFromDataProviders(accounts[3], [0], [accounts[1]], { from: accounts[5] });
            // Assert
            // a1 -> a3 claimed should be (2000000 / 720) * 0.25 * 2 price epochs = 695 * 2 = 1390
            let natClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(natClosingBalance.sub(natOpeningBalance).toNumber(), 1390);
        });

        it("Should not claim from the same provider twice in one call", async () => {

            // deposit some wnats
            await wNat.deposit({ from: accounts[5], value: "100" });
            await wNat.delegateExplicit(accounts[1], 100, { from: accounts[5] });

            await distributeRewards(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let natOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await expectRevert(ftsoRewardManager.claimRewardFromDataProviders(accounts[3], [0], [accounts[1], accounts[1]], { from: accounts[5] }), 
                "already claimed");
        });

        it("Should revert at claiming rewards (not using claimRewardFromDataProviders) once reward epoch finalized - explicit", async () => {

            // deposit some wnats
            await wNat.deposit({ from: accounts[2], value: "100" });

            // delegate some wnats
            await wNat.delegateExplicit(accounts[1], 100, { from: accounts[2] });

            await distributeRewards(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);

            await expectRevert(ftsoRewardManager.claimReward(accounts[3], [0], { from: accounts[2] }), "delegatesOf does not work in AMOUNT delegation mode");
        });

        it("Should enable rewards to be claimed by delegator once reward epoch finalized - explicit", async () => {

            // deposit some wnats
            await wNat.deposit({ from: accounts[4], value: "100" });

            // delegate some wnats
            await wNat.delegateExplicit(accounts[1], 100, { from: accounts[4] });

            await distributeRewards(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let natOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimRewardFromDataProviders(accounts[3], [0], [accounts[1]], { from: accounts[4] });
            // Assert
            // a4 -> a3 claimed should be (2000000 / 720) * 0.25 * 2 price epochs = 695 * 2 = 1390
            let natClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(natClosingBalance.sub(natOpeningBalance).toNumber(), 1390);
        });

        it("Should enable rewards to be claimed by delegator once reward epoch finalized - with self-destruct proceeds", async () => {
            // Assemble
            // deposit some wnats
            await wNat.deposit({ from: accounts[4], value: "100" });

            // delegate some wnats
            await wNat.delegateExplicit(accounts[1], 100, { from: accounts[4] });

            await distributeRewards(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);

            let balance1 = await web3.eth.getBalance(burnAddress);
            // Give suicidal some NAT
            await web3.eth.sendTransaction({ from: accounts[0], to: mockSuicidal.address, value: 1 });
            // Sneak it into ftso reward manager
            await mockSuicidal.die();

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let natOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimRewardFromDataProviders(accounts[3], [0], [accounts[1]], { from: accounts[4] });
            // Assert
            // a4 -> a3 claimed should be (2000000 / 720) * 0.25 * 2 price epochs = 695 * 2 = 1390
            let natClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(natClosingBalance.sub(natOpeningBalance).toNumber(), 1390);
            let balance2 = await web3.eth.getBalance(burnAddress);
            assert.equal(parseInt(balance2) - parseInt(balance1), 1);
        });

        it("Should enable rewards to be claimed by delegator and data provider once reward epoch finalized - explicit", async () => {

            // deposit some wnats
            await wNat.deposit({ from: accounts[1], value: "100" });
            await wNat.deposit({ from: accounts[4], value: "100" });

            // delegate some wnats
            await wNat.delegateExplicit(accounts[1], 100, { from: accounts[4] });

            await distributeRewards(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let natOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimRewardFromDataProviders(accounts[3], [0], [accounts[1]], { from: accounts[4] });
            // Assert
            // a4 -> a3 claimed should be (2000000 / 720) * 0.25 * 2 price epochs / 2 (half vote power was delegated) = 695
            let natClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(natClosingBalance.sub(natOpeningBalance).toNumber(), 695);

            // Act
            // Claim reward to a5 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let natOpeningBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            await ftsoRewardManager.claimReward(accounts[5], [0], { from: accounts[1] });
            // a1 -> a5 claimed should be (2000000 / 720) * 0.25 * 2 price epochs / 2 (half vote power was delegated) = 695
            let natClosingBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            assert.equal(natClosingBalance2.sub(natOpeningBalance2).toNumber(), 695);
        });

        it("Should enable rewards to be claimed by delegator and data provider once reward epoch finalized - explicit - should not claim twice", async () => {

            // deposit some wnats
            await wNat.deposit({ from: accounts[1], value: "100" });
            await wNat.deposit({ from: accounts[4], value: "100" });

            // delegate some wnats
            await wNat.delegateExplicit(accounts[1], 100, { from: accounts[4] });

            await distributeRewards(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let natOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimRewardFromDataProviders(accounts[3], [0], [accounts[1]], { from: accounts[4] });
            // Assert
            // a4 -> a3 claimed should be (2000000 / 720) * 0.25 * 2 price epochs / 2 (half vote power was delegated) = 695
            let natClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(natClosingBalance.sub(natOpeningBalance).toNumber(), 695);

            // if claiming again, get 0
            let natOpeningBalance1 = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimRewardFromDataProviders(accounts[3], [0], [accounts[1]], { from: accounts[4] });
            let natClosingBalance1 = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(natClosingBalance1.sub(natOpeningBalance1).toNumber(), 0);

            // Act
            // Claim reward to a5 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let natOpeningBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            await ftsoRewardManager.claimReward(accounts[5], [0], { from: accounts[1] });
            // a1 -> a5 claimed should be (2000000 / 720) * 0.25 * 2 price epochs / 2 (half vote power was delegated) = 695
            let natClosingBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            assert.equal(natClosingBalance2.sub(natOpeningBalance2).toNumber(), 695);

            // if claiming again, get 0
            let natOpeningBalance3 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            await ftsoRewardManager.claimReward(accounts[5], [0], { from: accounts[1] });
            // a1 -> a5 claimed should be (2000000 / 720) * 0.25 * 2 price epochs / 2 (half vote power was delegated) = 695
            let natClosingBalance3 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            assert.equal(natClosingBalance3.sub(natOpeningBalance3).toNumber(), 0);
        });

        it("Should enable rewards to be claimed by delegator and data provider once reward epoch finalized - explicit - get 0 if not rewarded ftso", async () => {

            // deposit some wnats
            await wNat.deposit({ from: accounts[1], value: "100" });
            await wNat.deposit({ from: accounts[4], value: "100" });

            // delegate some wnats
            await wNat.delegateExplicit(accounts[1], 100, { from: accounts[4] });
            let votePowerBlock = await web3.eth.getBlockNumber();
            const getRewardEpochVotePowerBlock = ftsoManagerInterface.contract.methods.getRewardEpochVotePowerBlock(0).encodeABI();
            const getRewardEpochVotePowerBlockReturn = web3.eth.abi.encodeParameter('uint256', votePowerBlock);
            await mockFtsoManager.givenMethodReturn(getRewardEpochVotePowerBlock, getRewardEpochVotePowerBlockReturn);
            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let natOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.getStateOfRewardsFromDataProviders(accounts[4], 0, [accounts[1]], { from: accounts[4] });
            await ftsoRewardManager.claimRewardFromDataProviders(accounts[3], [0], [accounts[1]], { from: accounts[4] });
            // Assert
            let natClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(natClosingBalance.sub(natOpeningBalance).toNumber(), 0);

            // Act
            // Claim reward to a5 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let natOpeningBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            await ftsoRewardManager.getStateOfRewards(accounts[1], 0, { from: accounts[1] });
            await ftsoRewardManager.claimReward(accounts[5], [0], { from: accounts[1] });
            let natClosingBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            assert.equal(natClosingBalance2.sub(natOpeningBalance2).toNumber(), 0);
        });

        it("Should enable rewards to be claimed by delegator and data provider (fee 5%) once reward epoch finalized - explicit", async () => {
            // Assemble
            // set delegator fee
            await ftsoRewardManager.setDataProviderFeePercentage(500, { from: accounts[1] });
            // travel 3 reward epochs
            await travelToAndSetNewRewardEpoch(3, startTs, ftsoRewardManager, accounts[0]);

            // deposit some wnats
            await wNat.deposit({ from: accounts[1], value: "100" });
            await wNat.deposit({ from: accounts[4], value: "100" });

            // delegate some wnats
            await wNat.delegateExplicit(accounts[1], 100, { from: accounts[4] });

            await distributeRewards(accounts, startTs, 3);
            await travelToAndSetNewRewardEpoch(4, startTs, ftsoRewardManager, accounts[0]);

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid having to calc gas fees
            let natOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimRewardFromDataProviders(accounts[3], [3], [accounts[1]], { from: accounts[4] });

            // Assert
            // Note: 3 reward epochs passed (starting epoch 0), no rewards allocated, then 1 more daily allocation.
            // So, 14000000 rewards to distribute starting in epoch 3 (two dailies in a reward epoch).
            // a4 -> a3 claimed should be (14000000 / 720) * 0.25 * 2 price epochs / 2 (half vote power was delegated) * 0.95 (fee) = 4617
            let natClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(natClosingBalance.sub(natOpeningBalance).toNumber(), 4617);

            // Act
            // Claim reward to a5 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let natOpeningBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            await ftsoRewardManager.claimReward(accounts[5], [3], { from: accounts[1] });

            // Assert
            // a1 -> a5 claimed should be (14000000 / 720) * 0.25 * 2 price epochs / 2 (half vote power was delegated) * 1.05 (fee) + 1 (dust) = 5105
            let natClosingBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            assert.equal(natClosingBalance2.sub(natOpeningBalance2).toNumber(), 5105);
        });

        it("Should enable rewards to be claimed by delegator and data provider (fee 5%) once reward epoch finalized 2 - explicit", async () => {
            // Assemble
            // set delegator fee
            await ftsoRewardManager.setDataProviderFeePercentage(500, { from: accounts[1] });
            // travel 3 reward epochs
            await travelToAndSetNewRewardEpoch(3, startTs, ftsoRewardManager, accounts[0]);

            // deposit some wnats
            await wNat.deposit({ from: accounts[1], value: "1000" });
            await wNat.deposit({ from: accounts[4], value: "1" });

            // delegate some wnats
            await wNat.delegateExplicit(accounts[1], 1, { from: accounts[4] });

            await distributeRewards(accounts, startTs, 3);
            await travelToAndSetNewRewardEpoch(4, startTs, ftsoRewardManager, accounts[0]);

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let natOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimRewardFromDataProviders(accounts[3], [3], [accounts[1]], { from: accounts[4] });

            // Assert
            // Note: 3 reward epochs passed (starting epoch 0), no rewards allocated, then 1 more daily allocation.
            // So, 14000000 rewards to distribute starting in epoch 3 (two dailies in a reward epoch).
            // a4 -> a3 claimed should be (14000000 / 720) * 0.25 * 2 price epochs * (1 / 1001) * 0.95 (fee) = 9
            let natClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(natClosingBalance.sub(natOpeningBalance).toNumber(), 9);

            // Act
            // Claim reward to a5 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let natOpeningBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            await ftsoRewardManager.claimReward(accounts[5], [3], { from: accounts[1] });

            // Assert
            // a1 -> a5 claimed should be (14000000 / 720) * 0.25 * 2 price epochs * (1000/1001 + 1/1001 * 0.05) (fee) = 9713
            let natClosingBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            assert.equal(natClosingBalance2.sub(natOpeningBalance2).toNumber(), 9713);
        });

        it("Should claim from multiple reward epochs - get nothing for reward epochs not finalized", async () => {
            await wNat.deposit({ from: accounts[1], value: "100" });

            await distributeRewards(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);
            await distributeRewards(accounts, startTs, 1, false);
            await travelToAndSetNewRewardEpoch(2, startTs, ftsoRewardManager, accounts[0]);
            await distributeRewards(accounts, startTs, 2, false);

            // can claim Math.floor(2000000 / 720) + Math.ceil((2000000 - 397 * 7) / (720 - 1)) = 5554
            let natOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimReward(accounts[3], [0, 1, 2, 3], { from: accounts[1] });

            let natClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(natClosingBalance.sub(natOpeningBalance).toNumber(), 5554);
        });

        it("Should claim from multiple reward epochs - get nothing for reward epochs not finalized - explicit", async () => {
            await wNat.deposit({ from: accounts[5], value: "100" });
            await wNat.delegateExplicit(accounts[1], 100, { from: accounts[5] });

            await distributeRewards(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);
            await distributeRewards(accounts, startTs, 1, false);
            await travelToAndSetNewRewardEpoch(2, startTs, ftsoRewardManager, accounts[0]);
            await distributeRewards(accounts, startTs, 2, false);

            // can claim Math.floor(2000000 / 720) + Math.ceil((2000000 - 397 * 7) / (720 - 1)) = 5554
            let natOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimRewardFromDataProviders(accounts[3], [0, 1, 2, 3], [accounts[1], accounts[2]], { from: accounts[5] });

            let natClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(natClosingBalance.sub(natOpeningBalance).toNumber(), 5554);
        });

        it("Should enable rewards to be claimed and wrapped once reward epoch finalized - percentage", async () => {
            // deposit some wnats
            await wNat.deposit({ from: accounts[1], value: "100" });

            await distributeRewards(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let wNatOpeningBalance = await wNat.votePowerOf(accounts[3]);
            let natOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claim(accounts[1], accounts[3], 0, true, { from: accounts[1] });
            // Assert
            // a1 -> a3 claimed should be (2000000 / 720) * 0.25 * 2 price epochs = 695 * 2 = 1390
            let wNatClosingBalance = await wNat.votePowerOf(accounts[3]);
            let natClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(wNatClosingBalance.sub(wNatOpeningBalance).toNumber(), 1390);
            assert(natOpeningBalance.eq(natClosingBalance));
        });

        it("Should enable rewards to be claimed (by executor) once reward epoch finalized - percentage", async () => {
            // deposit some wnats
            await wNat.deposit({ from: accounts[1], value: "100" });

            await distributeRewards(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);

            // Act
            await claimSetupManager.registerExecutor(0, { from: accounts[3], value: "100" })
            await claimSetupManager.setAutoClaiming([accounts[5]], false, { from: accounts[1] });

            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let wNatOpeningBalance = await wNat.votePowerOf(accounts[1]);
            let natOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[1]));
            await ftsoRewardManager.claim(accounts[1], accounts[1], 0, false, { from: accounts[5] });
            // Assert
            // a1 -> a3 claimed should be (2000000 / 720) * 0.25 * 2 price epochs = 695 * 2 = 1390
            let wNatClosingBalance = await wNat.votePowerOf(accounts[1]);
            let natClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[1]));
            assert.equal(natClosingBalance.sub(natOpeningBalance).toNumber(), 1390);
            assert(wNatOpeningBalance.eq(wNatClosingBalance));
        });


        it("Should enable rewards to be claimed and wrapped (by executor) once reward epoch finalized - percentage", async () => {

            // deposit some wnats
            await wNat.deposit({ from: accounts[1], value: "100" });

            await distributeRewards(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);

            // Act
            await claimSetupManager.setClaimExecutors([accounts[5]], { from: accounts[1] });

            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let wNatOpeningBalance = await wNat.votePowerOf(accounts[1]);
            let natOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[1]));
            await ftsoRewardManager.claim(accounts[1], accounts[1], 0, true, { from: accounts[5] });
            // Assert
            // a1 -> a3 claimed should be (2000000 / 720) * 0.25 * 2 price epochs = 695 * 2 = 1390
            let wNatClosingBalance = await wNat.votePowerOf(accounts[1]);
            let natClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[1]));
            assert.equal(wNatClosingBalance.sub(wNatOpeningBalance).toNumber(), 1390);
            assert(natOpeningBalance.eq(natClosingBalance));
        });

        it("Should enable rewards to be claimed and wrapped by multiple executors to other accounts once reward epoch finalized - percentage", async () => {

            // deposit some wnats
            await wNat.deposit({ from: accounts[1], value: "100" });

            await distributeRewards(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);

            // Act
            await claimSetupManager.setClaimExecutors([accounts[5], accounts[6]], { from: accounts[1] });
            await claimSetupManager.setAllowedClaimRecipients([accounts[7], accounts[8]], { from: accounts[1] });

            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let wNatOpeningBalance = await wNat.votePowerOf(accounts[7]);
            let natOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[7]));
            await ftsoRewardManager.claim(accounts[1], accounts[7], 0, true, { from: accounts[5] });
            // Assert
            // a1 -> a3 claimed should be (2000000 / 720) * 0.25 * 2 price epochs = 395 * 2 = 1390
            let wNatClosingBalance = await wNat.votePowerOf(accounts[7]);
            let natClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[7]));
            assert.equal(wNatClosingBalance.sub(wNatOpeningBalance).toNumber(), 1390);
            assert(natOpeningBalance.eq(natClosingBalance));

            await distributeRewards(accounts, startTs, 1, false);
            await travelToAndSetNewRewardEpoch(2, startTs, ftsoRewardManager, accounts[0]);

            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let wNatOpeningBalance1 = await wNat.votePowerOf(accounts[8]);
            let natOpeningBalance1 = web3.utils.toBN(await web3.eth.getBalance(accounts[8]));
            await ftsoRewardManager.claim(accounts[1], accounts[8], 1, true, { from: accounts[6] });
            // Assert
            // a1 -> a3 claimed should be (2000000 / 720) * 0.25 * 2 price epochs = 1390
            let wNatClosingBalance1 = await wNat.votePowerOf(accounts[8]);
            let natClosingBalance1 = web3.utils.toBN(await web3.eth.getBalance(accounts[8]));
            assert.equal(wNatClosingBalance1.sub(wNatOpeningBalance1).toNumber(), 4164);
            assert(natOpeningBalance1.eq(natClosingBalance1));

        });

        it("Executors and recipients should match allowed - percentage", async () => {
            // deposit some wnats
            await wNat.deposit({ from: accounts[1], value: "100" });

            await distributeRewards(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);

            // Act
            await claimSetupManager.setClaimExecutors([accounts[5], accounts[6]], { from: accounts[1] });
            await claimSetupManager.setAllowedClaimRecipients([accounts[7], accounts[8]], { from: accounts[1] });

            // Assert

            // not an executor
            await expectRevert(ftsoRewardManager.claim(accounts[1], accounts[8], 1, true, { from: accounts[7] }),
                "only owner or executor");

            // not a valid recipient
            await expectRevert(ftsoRewardManager.claim(accounts[1], accounts[6], 1, true, { from: accounts[5] }),
                "recipient not allowed");

            // owner is always valid recipient
            let wNatOpeningBalance = await wNat.votePowerOf(accounts[1]);
            await ftsoRewardManager.claim(accounts[1], accounts[1], 0, true, { from: accounts[5] });
            let wNatClosingBalance = await wNat.votePowerOf(accounts[1]);
            assert.equal(wNatClosingBalance.sub(wNatOpeningBalance).toNumber(), 1390);
        });

        it("Executor must be allowed to be able to claim for the reward owner - percentage", async () => {

            // deposit some wnats
            await wNat.deposit({ from: accounts[1], value: "100" });

            await distributeRewards(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);

            // Act
            // Assert
            await expectRevert(ftsoRewardManager.claim(accounts[1], accounts[1], 0, false, { from: accounts[5] }),
                "only owner or executor");
        });

        it("Executor must not be removed to be able to claim for the reward owner - percentage", async () => {

            // deposit some wnats
            await wNat.deposit({ from: accounts[1], value: "100" });

            await distributeRewards(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);

            // Act
            await claimSetupManager.setClaimExecutors([accounts[5]], { from: accounts[1] });
            await claimSetupManager.setClaimExecutors([], { from: accounts[1] });

            // Assert
            await expectRevert(ftsoRewardManager.claim(accounts[1], accounts[1], 0, true, { from: accounts[5] }),
                "only owner or executor");
        });

        it("Should enable rewards to be claimed and wrapped once reward epoch finalized - explicit", async () => {

            // deposit some wnats
            await wNat.deposit({ from: accounts[5], value: "100" });
            await wNat.delegateExplicit(accounts[1], 100, { from: accounts[5] });

            await distributeRewards(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let wNatOpeningBalance = await wNat.votePowerOf(accounts[3]);
            let natOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimFromDataProviders(accounts[5], accounts[3], [0], [accounts[1]], true, { from: accounts[5] });
            // Assert
            // a1 -> a3 claimed should be (2000000 / 720) * 0.25 * 2 price epochs = 695 * 2 = 1390
            let wNatClosingBalance = await wNat.votePowerOf(accounts[3]);
            let natClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(wNatClosingBalance.sub(wNatOpeningBalance).toNumber(), 1390);
            assert(natOpeningBalance.eq(natClosingBalance));
        });

        it("Should enable rewards to be claimed (by executor) once reward epoch finalized - explicit", async () => {

            // deposit some wnats
            await wNat.deposit({ from: accounts[4], value: "100" });
            await wNat.delegateExplicit(accounts[1], 100, { from: accounts[4] });

            await distributeRewards(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);

            // Act
            await claimSetupManager.setClaimExecutors([accounts[5]], { from: accounts[4] });
            await claimSetupManager.setAllowedClaimRecipients([accounts[1]], { from: accounts[4] });

            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let wNatOpeningBalance = await wNat.votePowerOf(accounts[1]);
            let natOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[1]));
            await ftsoRewardManager.claimFromDataProviders(accounts[4], accounts[1], [0], [accounts[1]], false, { from: accounts[5] });
            // Assert
            // a1 -> a3 claimed should be (2000000 / 720) * 0.25 * 2 price epochs = 695 * 2
            let wNatClosingBalance = await wNat.votePowerOf(accounts[1]);
            let natClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[1]));
            assert.equal(natClosingBalance.sub(natOpeningBalance).toNumber(), 1390);
            assert(wNatOpeningBalance.eq(wNatClosingBalance));
        });

        it("Should enable rewards to be claimed and wrapped (by executor) once reward epoch finalized - explicit", async () => {

            // deposit some wnats
            await wNat.deposit({ from: accounts[4], value: "100" });
            await wNat.delegateExplicit(accounts[1], 100, { from: accounts[4] });

            await distributeRewards(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);

            // Act
            await claimSetupManager.setClaimExecutors([accounts[5]], { from: accounts[4] });
            await claimSetupManager.setAllowedClaimRecipients([accounts[1]], { from: accounts[4] });

            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let wNatOpeningBalance = await wNat.votePowerOf(accounts[1]);
            let natOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[1]));
            await ftsoRewardManager.claimFromDataProviders(accounts[4], accounts[1], [0], [accounts[1]], true, { from: accounts[5] });
            // Assert
            // a1 -> a3 claimed should be (2000000 / 720) * 0.25 * 2 price epochs = 695 * 2 = 1390
            let wNatClosingBalance = await wNat.votePowerOf(accounts[1]);
            let natClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[1]));
            assert.equal(wNatClosingBalance.sub(wNatOpeningBalance).toNumber(), 1390);
            assert(natOpeningBalance.eq(natClosingBalance));
        });

        it("Executor must be allowed to be able to claim for the reward owner - explicit", async () => {

            // deposit some wnats
            await wNat.deposit({ from: accounts[1], value: "100" });

            await distributeRewards(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);

            // Act
            // Assert
            await expectRevert(ftsoRewardManager.claimFromDataProviders(accounts[1], accounts[1], [0], [accounts[1]], false, { from: accounts[5] }),
                "only owner or executor");

            await expectRevert(ftsoRewardManager.claimFromDataProviders(accounts[1], accounts[1], [0], [accounts[1]], true, { from: accounts[5] }),
                "only owner or executor");
        });

        it("Executor change emits event", async () => {
            const res = await claimSetupManager.setClaimExecutors([accounts[2], accounts[3], accounts[6]], { from: accounts[1] });
            expectEvent(res, 'ClaimExecutorsChanged', { executors: [accounts[2], accounts[3], accounts[6]] });
            compareArrays(await claimSetupManager.claimExecutors(accounts[1]), [accounts[2], accounts[3], accounts[6]]);
        });

        it("Recipient change emits event", async () => {
            const res = await claimSetupManager.setAllowedClaimRecipients([accounts[2], accounts[3], accounts[6]], { from: accounts[1] });
            expectEvent(res, 'AllowedClaimRecipientsChanged', { recipients: [accounts[2], accounts[3], accounts[6]] });
            compareArrays(await claimSetupManager.allowedClaimRecipients(accounts[1]), [accounts[2], accounts[3], accounts[6]]);
        });

        it("Can change executors multiple times", async () => {
            // deposit some wnats
            await wNat.deposit({ from: accounts[1], value: "100" });
            await distributeRewards(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);

            // can set
            await claimSetupManager.setClaimExecutors([accounts[5]], { from: accounts[1] });
            compareArrays(await claimSetupManager.claimExecutors(accounts[1]), [accounts[5]]);

            // can replace
            await claimSetupManager.setClaimExecutors([accounts[2], accounts[3], accounts[6]], { from: accounts[1] });
            compareArrays(await claimSetupManager.claimExecutors(accounts[1]), [accounts[2], accounts[3], accounts[6]]);

            // can clear
            await claimSetupManager.setClaimExecutors([], { from: accounts[1] });
            compareArrays(await claimSetupManager.claimExecutors(accounts[1]), []);

            // duplicates are ignored
            await claimSetupManager.setClaimExecutors([accounts[2], accounts[3], accounts[6], accounts[3], accounts[2]], { from: accounts[1] });
            compareArrays(await claimSetupManager.claimExecutors(accounts[1]), [accounts[2], accounts[3], accounts[6]]);

            // only last value should be used
            await claimSetupManager.setClaimExecutors([accounts[5]], { from: accounts[1] });
            // all other than 1 and 5 should succeed            
            for (let i = 0; i < 10; i++) {
                if (i !== 1 && i !== 5) {
                    await expectRevert(ftsoRewardManager.claim(accounts[1], accounts[1], 0, true, { from: accounts[i] }),
                        "only owner or executor");
                }
            }
            // 5 should succeed
            let wNatOpeningBalance = await wNat.votePowerOf(accounts[1]);
            await ftsoRewardManager.claim(accounts[1], accounts[1], 0, true, { from: accounts[5] });
            let wNatClosingBalance = await wNat.votePowerOf(accounts[1]);
            assert.equal(wNatClosingBalance.sub(wNatOpeningBalance).toNumber(), 1390);
        });

        it("Can change recipients multiple times", async () => {
            // deposit some wnats
            await wNat.deposit({ from: accounts[1], value: "100" });
            await distributeRewards(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);

            // can set
            await claimSetupManager.setAllowedClaimRecipients([accounts[5]], { from: accounts[1] });
            compareArrays(await claimSetupManager.allowedClaimRecipients(accounts[1]), [accounts[5]]);

            // can replace
            await claimSetupManager.setAllowedClaimRecipients([accounts[2], accounts[3], accounts[6]], { from: accounts[1] });
            compareArrays(await claimSetupManager.allowedClaimRecipients(accounts[1]), [accounts[2], accounts[3], accounts[6]]);

            // can clear
            await claimSetupManager.setAllowedClaimRecipients([], { from: accounts[1] });
            compareArrays(await claimSetupManager.allowedClaimRecipients(accounts[1]), []);

            // duplicates are ignored
            await claimSetupManager.setAllowedClaimRecipients([accounts[2], accounts[3], accounts[6], accounts[3], accounts[2]], { from: accounts[1] });
            compareArrays(await claimSetupManager.allowedClaimRecipients(accounts[1]), [accounts[2], accounts[3], accounts[6]]);

            // only last value should be used
            await claimSetupManager.setClaimExecutors([accounts[2]], { from: accounts[1] });
            await claimSetupManager.setAllowedClaimRecipients([accounts[5]], { from: accounts[1] });
            // on other than 5 should succeed            
            for (let i = 0; i < 10; i++) {
                if (i !== 5 && i !== 1) {   // 5 is allowed, 1 is owner (always allowed)
                    await expectRevert(ftsoRewardManager.claim(accounts[1], accounts[i], 0, true, { from: accounts[2] }),
                        "recipient not allowed");
                }
            }
            // 5 should succeed
            let wNatOpeningBalance = await wNat.votePowerOf(accounts[5]);
            await ftsoRewardManager.claim(accounts[1], accounts[5], 0, true, { from: accounts[2] });
            let wNatClosingBalance = await wNat.votePowerOf(accounts[5]);
            assert.equal(wNatClosingBalance.sub(wNatOpeningBalance).toNumber(), 1390);
        });

        it("Should not be able to claim expired reward epoch", async () => {
            // deposit some wnats
            await wNat.deposit({ from: accounts[1], value: "100" });
            await wNat.deposit({ from: accounts[4], value: "100" });

            // delegate some wnats
            await wNat.delegate(accounts[1], 10000, { from: accounts[4] });

            await distributeRewards(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);

            await expireRewardEpoch(0, ftsoRewardManager, accounts[0]);
            await expireRewardEpoch(1, ftsoRewardManager, accounts[0]);
            await travelToAndSetNewRewardEpoch(2, startTs, ftsoRewardManager, accounts[0]);
            // await ftsoRewardManager.claimReward(accounts[4], [1], { from: accounts[4] });

            let claim = await ftsoRewardManager.contract.methods.claimReward(accounts[4], [1]).call({ from: accounts[4] });
            await ftsoRewardManager.claimReward(accounts[4], [1], { from: accounts[4] });
            expect(claim).to.equals('0');
        });
    });

    describe("close expired reward epochs", async () => {
        it("Should update expired rewards", async () => {
            // deposit some wnats
            await wNat.deposit({ from: accounts[1], value: "100" });

            await distributeRewards(accounts, startTs);

            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);
            await ftsoRewardManager.claimReward(accounts[1], [0], { from: accounts[1] });

            await travelToAndSetNewRewardEpoch(2, startTs, ftsoRewardManager, accounts[0]);
            const { 2: rewardExpired } = await ftsoRewardManager.getTotals();
            assert.equal(rewardExpired.toNumber(), 0);

            // expire reward epoch 0
            await expireRewardEpoch(0, ftsoRewardManager, accounts[0]);
            // advance, but not expire epoch 1            
            await travelToAndSetNewRewardEpoch(3, startTs, ftsoRewardManager, accounts[0]);
            const { 2: rewardExpired1 } = await ftsoRewardManager.getTotals();
            assert.equal(rewardExpired1.toNumber(), 4164);
        });

        it("Should only be called from ftso manager or new ftso reward manager", async () => {
            await expectRevert(ftsoRewardManager.closeExpiredRewardEpoch(0), "only managers");
        });

        it("Should only expire correct reward epoch and proceed - ftso manager", async () => {
            // update ftso manager to accounts[0] to be able to call closeExpiredRewardEpoch
            await ftsoRewardManager.updateContractAddresses(
                encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.CLAIM_SETUP_MANAGER]),
                [ADDRESS_UPDATER, mockInflation.address, accounts[0], wNat.address, claimSetupManager.address], { from: ADDRESS_UPDATER });

            await ftsoRewardManager.closeExpiredRewardEpoch(0); // should work
            await expectRevert(ftsoRewardManager.closeExpiredRewardEpoch(0), "wrong epoch id");
            await expectRevert(ftsoRewardManager.closeExpiredRewardEpoch(2), "wrong epoch id");
            await ftsoRewardManager.closeExpiredRewardEpoch(1); // should work
        });

        it("Should only expire correct reward epoch and proceed - new ftso reward manager", async () => {
            await ftsoRewardManager.setNewFtsoRewardManager(accounts[2]);

            await ftsoRewardManager.closeExpiredRewardEpoch(0, { from: accounts[2] }); // should work
            await expectRevert(ftsoRewardManager.closeExpiredRewardEpoch(0, { from: accounts[2] }), "wrong epoch id");
            await expectRevert(ftsoRewardManager.closeExpiredRewardEpoch(2, { from: accounts[2] }), "wrong epoch id");
            await ftsoRewardManager.closeExpiredRewardEpoch(1, { from: accounts[2] }); // should work
        });

        it("Should forward closeExpiredRewardEpoch to old ftso reward manager", async () => {
            let oldFtsoRewardManager = await MockContract.new();
            ftsoRewardManager = await FtsoRewardManager.new(
                accounts[0],
                ADDRESS_UPDATER,
                oldFtsoRewardManager.address,
                3,
                0
            );

            await ftsoRewardManager.updateContractAddresses(
                encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.CLAIM_SETUP_MANAGER]),
                [ADDRESS_UPDATER, mockInflation.address, mockFtsoManager.address, wNat.address, claimSetupManager.address], { from: ADDRESS_UPDATER });
            await ftsoRewardManager.enableClaims();

            await ftsoRewardManager.setInitialRewardData();
            await ftsoRewardManager.setNewFtsoRewardManager(accounts[2]);

            await ftsoRewardManager.closeExpiredRewardEpoch(0, { from: accounts[2] }); // should work
            await ftsoRewardManager.closeExpiredRewardEpoch(1, { from: accounts[2] }); // should work

            const closeExpiredRewardEpoch = ftsoRewardManager.contract.methods.closeExpiredRewardEpoch(0).encodeABI();

            const invocationCountForCalldata = await oldFtsoRewardManager.invocationCountForCalldata.call(closeExpiredRewardEpoch);
            assert.equal(invocationCountForCalldata.toNumber(), 1);

            const invocationCountForMethod = await oldFtsoRewardManager.invocationCountForMethod.call(closeExpiredRewardEpoch);
            assert.equal(invocationCountForMethod.toNumber(), 2);
        });
    });

    describe("Automatic claiming and claim for PDA", async () => {
        let delegationAccount1: DelegationAccountInstance;
        let delAcc1Address: string;
        let delegationAccount2: DelegationAccountInstance;
        let delAcc2Address: string;
        let delegationAccount3: DelegationAccountInstance;
        let delAcc3Address: string;

        beforeEach(async () => {
            let create1 = await claimSetupManager.enableDelegationAccount({ from: accounts[1] });
            delAcc1Address = await claimSetupManager.accountToDelegationAccount(accounts[1]);
            delegationAccount1 = await DelegationAccount.at(delAcc1Address);
            expectEvent(create1, "DelegationAccountCreated", { delegationAccount: delAcc1Address, owner: accounts[1] });
            await expectEvent.inTransaction(create1.tx, delegationAccount1, "Initialize", {
                owner: accounts[1],
                manager: claimSetupManager.address
            });

            let create2 = await claimSetupManager.enableDelegationAccount({ from: accounts[2] });
            delAcc2Address = await claimSetupManager.accountToDelegationAccount(accounts[2]);
            delegationAccount2 = await DelegationAccount.at(delAcc2Address);
            expectEvent(create2, "DelegationAccountCreated", { delegationAccount: delAcc2Address, owner: accounts[2] });

            let create3 = await claimSetupManager.enableDelegationAccount({ from: accounts[3] });
            delAcc3Address = await claimSetupManager.accountToDelegationAccount(accounts[3]);
            delegationAccount3 = await DelegationAccount.at(delAcc3Address);
            expectEvent(create3, "DelegationAccountCreated", { delegationAccount: delAcc3Address, owner: accounts[3] });

        });

        it("Should delegate and auto-claim ftso reward", async () => {
            const executor = accounts[4];
            // "deposit" some wnats
            await web3.eth.sendTransaction({ from: accounts[1], to: delAcc1Address, value: 100 });
            await web3.eth.sendTransaction({ from: accounts[2], to: wNat.address, value: 100 });
            await web3.eth.sendTransaction({ from: accounts[3], to: delAcc3Address, value: 50 });
            await web3.eth.sendTransaction({ from: accounts[3], to: wNat.address, value: 150 });

            // delegate some wnats to ac40
            await claimSetupManager.delegate(accounts[40], 10000, { from: accounts[1] });
            let delegates1 = await wNat.delegatesOf(delAcc1Address);
            expect(delegates1[0][0]).to.equals(accounts[40]);
            expect(delegates1[1][0].toString()).to.equals("10000");

            await wNat.delegate(accounts[40], 10000, { from: accounts[2] });
            let delegates2 = await wNat.delegatesOf(accounts[2]);
            expect(delegates2[0][0]).to.equals(accounts[40]);
            expect(delegates2[1][0].toString()).to.equals("10000");

            await claimSetupManager.delegate(accounts[40], 10000, { from: accounts[3] });
            let delegates3 = await wNat.delegatesOf(delAcc3Address);
            expect(delegates3[0][0]).to.equals(accounts[40]);
            expect(delegates3[1][0].toString()).to.equals("10000");

            await wNat.delegate(accounts[40], 10000, { from: accounts[3] });
            let delegates4 = await wNat.delegatesOf(accounts[3]);
            expect(delegates4[0][0]).to.equals(accounts[40]);
            expect(delegates4[1][0].toString()).to.equals("10000");

            // set claim executors
            // await ftsoRewardManager.setClaimExecutors([delAcc2Address], { from: accounts[2] });
            // let executors2 = await ftsoRewardManager.claimExecutors(accounts[2]);
            // expect(executors2[0]).to.equals(delAcc2Address);

            // await ftsoRewardManager.setClaimExecutors([delAcc3Address], { from: accounts[3] });
            // let executors3 = await ftsoRewardManager.claimExecutors(accounts[3]);
            // expect(executors3[0]).to.equals(delAcc3Address);
            await claimSetupManager.registerExecutor(10, { from: executor, value: EXECUTOR_REGISTER_FEE });
            let balanceBeforeExecutor = toBN(await web3.eth.getBalance(executor));
            await claimSetupManager.setClaimExecutors([executor], { from: accounts[3], value: "10" });
            let balanceAfterExecutor = toBN(await web3.eth.getBalance(executor));
            expect(balanceAfterExecutor.sub(balanceBeforeExecutor).toString()).to.be.equal("10");

            await distributeRewardsPDA(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);

            // add (mock) reward manager which will revert without message
            const mockRewardManager = await MockContract.new();
            const claimReward = ftsoRewardManager.contract.methods.claim(delegationAccount1.address, delegationAccount1.address, [0], false).encodeABI();
            await mockRewardManager.givenMethodRunOutOfGas(claimReward);

            await claimSetupManager.updateContractAddresses(
                encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.FTSO_REWARD_MANAGER, Contracts.DISTRIBUTION_TO_DELEGATORS]),
                [ADDRESS_UPDATER, mockFtsoManager.address, wNat.address], { from: ADDRESS_UPDATER });

            // add (mock) reward manager which will revert with message
            const mockRewardManager1 = await MockContract.new();
            const claimReward1 = ftsoRewardManager.contract.methods.claim(delegationAccount1.address, delegationAccount1.address, [0], false).encodeABI();
            await mockRewardManager1.givenMethodRevertWithMessage(claimReward1, "unable to claim");

            await claimSetupManager.updateContractAddresses(
                encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.FTSO_REWARD_MANAGER, Contracts.DISTRIBUTION_TO_DELEGATORS]),
                [ADDRESS_UPDATER, mockFtsoManager.address, wNat.address], { from: ADDRESS_UPDATER });

            let claim1 = await ftsoRewardManager.autoClaim([accounts[1]], 0, { from: accounts[1] });

            // delegationAccount1 claim should be (2000000 / 720) * 0.25 * 2 price epochs / 4 = 347
            expect((await wNat.balanceOf(delAcc1Address)).toString()).to.equals((100 + 347).toString());

            let claim2 = await ftsoRewardManager.autoClaim([accounts[2]], 0, { from: accounts[2] });
            // accounts[2] claim should be (2000000 / 720) * 0.25 * 2 price epochs / 4 = 347
            expect((await wNat.balanceOf(delAcc2Address)).toString()).to.equals((347).toString());
            const executorOpeningBalance = toBN(await web3.eth.getBalance(executor));
            let claim3 = await ftsoRewardManager.autoClaim([accounts[3]], 0, { from: executor });
            const executorClosingBalance = toBN(await web3.eth.getBalance(executor));
            // delegationAccount3 and accounts[3] claim should be (2000000 / 720) * 0.25 * 2 price epochs - 2 * 347 = 1390 - 2 * 347 = 696
            expect((await wNat.balanceOf(delAcc3Address)).toString()).to.equals((50 + 696 - 10).toString());
            const gasCost = await calcGasCost(claim3);
            expect(executorClosingBalance.add(gasCost).sub(executorOpeningBalance).toString()).to.be.equal("10");
            console.log(claim3.receipt.gasUsed);
        });

        it("Should enable rewards to be claimed for PDA and wrapped once reward epoch finalized - percentage", async () => {
            // deposit some wnats
            await wNat.deposit({ from: accounts[1], value: "100" });
            await wNat.transfer(delAcc1Address, 100, { from: accounts[1] });
            await claimSetupManager.delegate(accounts[1], 10000, { from: accounts[1] });

            await distributeRewards(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);

            // Act
            await claimSetupManager.setClaimExecutors([accounts[5]], { from: accounts[1] });

            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let wNatOpeningBalance = await wNat.votePowerOf(accounts[1]);
            let natOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[1]));
            await ftsoRewardManager.claim(delAcc1Address, accounts[1], 0, true, { from: accounts[5] });
            // Assert
            // a1 -> a3 claimed should be (2000000 / 720) * 0.25 * 2 price epochs = 695 * 2 = 1390
            let wNatClosingBalance = await wNat.votePowerOf(accounts[1]);
            let natClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[1]));
            assert.equal(wNatClosingBalance.sub(wNatOpeningBalance).toNumber(), 1390);
            assert(natOpeningBalance.eq(natClosingBalance));
        });

        it("Should enable rewards to be claimed for executor's PDA and wrapped once reward epoch finalized - percentage", async () => {
            // deposit some wnats
            await wNat.deposit({ from: accounts[1], value: "100" });
            await wNat.transfer(delAcc1Address, 100, { from: accounts[1] });
            await claimSetupManager.delegate(accounts[1], 10000, { from: accounts[1] });

            await distributeRewards(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);

            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let wNatOpeningBalance = await wNat.votePowerOf(accounts[1]);
            let natOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[1]));
            await ftsoRewardManager.claim(delAcc1Address, accounts[1], 0, true, { from: accounts[1] });
            // Assert
            // a1 -> a3 claimed should be (2000000 / 720) * 0.25 * 2 price epochs = 695 * 2 = 1390
            let wNatClosingBalance = await wNat.votePowerOf(accounts[1]);
            let natClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[1]));
            assert.equal(wNatClosingBalance.sub(wNatOpeningBalance).toNumber(), 1390);
            assert(natOpeningBalance.gte(natClosingBalance));
        });

        it("Should delegate and batch auto-claim ftso rewards; and disable delegation account", async () => {
            const executor = accounts[4];
            // "deposit" some wnats
            await web3.eth.sendTransaction({ from: accounts[2], to: wNat.address, value: 100 });
            await web3.eth.sendTransaction({ from: accounts[3], to: delAcc3Address, value: 50 });
            await web3.eth.sendTransaction({ from: accounts[3], to: wNat.address, value: 150 });


            // delegate some wnats to ac40
            await wNat.delegate(accounts[40], 10000, { from: accounts[2] });
            await claimSetupManager.delegate(accounts[40], 10000, { from: accounts[3] });
            await wNat.delegate(accounts[40], 10000, { from: accounts[3] });

            await claimSetupManager.registerExecutor(10, { from: executor, value: EXECUTOR_REGISTER_FEE });
            let balanceBeforeExecutor = toBN(await web3.eth.getBalance(executor));
            await claimSetupManager.setAutoClaiming([executor], true, { from: accounts[3], value: "10" });
            await claimSetupManager.setClaimExecutors([executor], { from: accounts[2], value: "10" });
            await claimSetupManager.setAutoClaiming([executor], true, { from: accounts[55], value: "10" });
            let balanceAfterExecutor = toBN(await web3.eth.getBalance(executor));
            expect(balanceAfterExecutor.sub(balanceBeforeExecutor).toString()).to.be.equal("30");

            await claimSetupManager.delegate(accounts[40], 10000, { from: accounts[55] });
            let delAcc55Address = await claimSetupManager.accountToDelegationAccount(accounts[55]);
            await web3.eth.sendTransaction({ from: accounts[55], to: delAcc55Address, value: 100 });


            await distributeRewardsPDA(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);

            await claimSetupManager.updateContractAddresses(
                encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.FTSO_REWARD_MANAGER, Contracts.DISTRIBUTION_TO_DELEGATORS]),
                [ADDRESS_UPDATER, mockFtsoManager.address, wNat.address], { from: ADDRESS_UPDATER });

            // add (mock) reward manager which will revert with message
            const mockRewardManager1 = await MockContract.new();
            const claimReward1 = ftsoRewardManager.contract.methods.claim(delegationAccount1.address, delegationAccount1.address, [0], false).encodeABI();
            await mockRewardManager1.givenMethodRevertWithMessage(claimReward1, "unable to claim");

            await claimSetupManager.updateContractAddresses(
                encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.FTSO_REWARD_MANAGER, Contracts.DISTRIBUTION_TO_DELEGATORS]),
                [ADDRESS_UPDATER, mockFtsoManager.address, wNat.address], { from: ADDRESS_UPDATER });

            let claim = await ftsoRewardManager.autoClaim([accounts[55], accounts[2], accounts[3]], 0, { from: executor });

            // delegationAccount1 claim should be (2000000 / 720) * 0.25 * 2 price epochs / 4 = 1390 / 4 = 347
            expect((await wNat.balanceOf(delAcc55Address)).toString()).to.equals((100 + 347 - 10).toString());

            // accounts[2] claim should be (2000000 / 720) * 0.25 * 2 price epochs / 4 = 1390 / 4 = 347
            expect((await wNat.balanceOf(delAcc2Address)).toString()).to.equals((347 - 10).toString());
            // delegationAccount3 and accounts[3] claim should be (2000000 / 720) * 0.25 * 2 price epochs - 2 * 347 = 696
            expect((await wNat.balanceOf(delAcc3Address)).toString()).to.equals((50 + 696 - 10).toString());

            let claim1 = ftsoRewardManager.autoClaim([accounts[1], accounts[2], accounts[3]], 2, { from: executor });
            await expectRevert(claim1, "not claimable");

            // disable delegation account; funds are transferred to owner
            await claimSetupManager.disableDelegationAccount({ from: accounts[55] });
            expect((await wNat.balanceOf(delAcc55Address)).toString()).to.equals((0).toString());
            expect((await wNat.balanceOf(accounts[55])).toString()).to.equals((437).toString());
        });

        it("Should not claim ftso reward if fee is equal to reward amount", async () => {
            const executor = accounts[4];
            // "deposit" some wnats
            await web3.eth.sendTransaction({ from: accounts[1], to: delAcc1Address, value: 100 });
            await web3.eth.sendTransaction({ from: accounts[2], to: wNat.address, value: 100 });
            await web3.eth.sendTransaction({ from: accounts[3], to: delAcc3Address, value: 50 });
            await web3.eth.sendTransaction({ from: accounts[3], to: wNat.address, value: 150 });

            // delegate some wnats to ac40
            await claimSetupManager.delegate(accounts[40], 10000, { from: accounts[1] });

            await wNat.delegate(accounts[40], 10000, { from: accounts[2] });

            await claimSetupManager.delegate(accounts[40], 10000, { from: accounts[3] });
            await wNat.delegatesOf(delAcc3Address);

            await wNat.delegate(accounts[40], 10000, { from: accounts[3] });

            await claimSetupManager.registerExecutor(49, { from: executor, value: EXECUTOR_REGISTER_FEE });
            await claimSetupManager.setClaimExecutors([executor], { from: accounts[1], value: "49" });

            await distributeRewardsPDA(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);

            await claimSetupManager.updateContractAddresses(
                encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.FTSO_REWARD_MANAGER, Contracts.DISTRIBUTION_TO_DELEGATORS]),
                [ADDRESS_UPDATER, mockFtsoManager.address, wNat.address], { from: ADDRESS_UPDATER });

            // add (mock) reward manager which will revert with message
            const mockRewardManager1 = await MockContract.new();
            const claimReward1 = ftsoRewardManager.contract.methods.claim(delegationAccount1.address, delegationAccount1.address, [0], false).encodeABI();
            await mockRewardManager1.givenMethodRevertWithMessage(claimReward1, "unable to claim");

            await claimSetupManager.updateContractAddresses(
                encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.FTSO_REWARD_MANAGER, Contracts.DISTRIBUTION_TO_DELEGATORS]),
                [ADDRESS_UPDATER, mockFtsoManager.address, wNat.address], { from: ADDRESS_UPDATER });

            let claim = await ftsoRewardManager.autoClaim([accounts[1]], 0, { from: executor });

            // delegationAccount1 claim should be (2000000 / 720) * 0.25 * 2 price epochs / 4 = 1390 / 4 = 347
            expect((await wNat.balanceOf(delAcc1Address)).toString()).to.equals((100 + 347 - 49).toString());
        });

        it("Should delegate and auto-claim ftso rewards only for owner", async () => {
            const executor = accounts[4];
            // "deposit" some wnats
            await wNat.deposit({ from: accounts[1], value: "100" });
            await claimSetupManager.disableDelegationAccount({ from: accounts[1] });

            await web3.eth.sendTransaction({ from: accounts[1], to: delAcc1Address, value: 100 });
            await web3.eth.sendTransaction({ from: accounts[2], to: wNat.address, value: 100 });
            await web3.eth.sendTransaction({ from: accounts[3], to: delAcc3Address, value: 50 });
            await web3.eth.sendTransaction({ from: accounts[3], to: wNat.address, value: 150 });

            // delegate some wnats to ac40
            await wNat.delegate(accounts[40], 10000, { from: accounts[1] });
            await wNat.delegate(accounts[40], 10000, { from: accounts[2] });

            await claimSetupManager.delegate(accounts[40], 10000, { from: accounts[3] });
            await wNat.delegate(accounts[40], 10000, { from: accounts[3] });

            await claimSetupManager.registerExecutor(10, { from: executor, value: EXECUTOR_REGISTER_FEE });
            await claimSetupManager.setClaimExecutors([executor], { from: accounts[1], value: "10" });

            await distributeRewardsPDA(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);

            await claimSetupManager.updateContractAddresses(
                encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.FTSO_REWARD_MANAGER, Contracts.DISTRIBUTION_TO_DELEGATORS]),
                [ADDRESS_UPDATER, mockFtsoManager.address, wNat.address], { from: ADDRESS_UPDATER });

            await claimSetupManager.updateContractAddresses(
                encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.FTSO_REWARD_MANAGER, Contracts.DISTRIBUTION_TO_DELEGATORS]),
                [ADDRESS_UPDATER, mockFtsoManager.address, wNat.address], { from: ADDRESS_UPDATER });

            let claim = await ftsoRewardManager.autoClaim([accounts[1]], 0, { from: executor });

            expect((await wNat.balanceOf(accounts[1])).toString()).to.equals((100 + 347 - 10).toString());
        });

        it("Should correctly check executors", async () => {
            const executor = accounts[4];
            // deposit some wnats
            await wNat.depositTo(delAcc1Address, { from: accounts[1], value: "100" });
            await wNat.deposit({ from: accounts[2], value: "100" });
            await wNat.depositTo(delAcc3Address, { from: accounts[3], value: "50" });
            await wNat.deposit({ from: accounts[3], value: "150" });

            // delegate some wnats to ac40
            await claimSetupManager.delegate(accounts[40], 10000, { from: accounts[1] });
            await wNat.delegatesOf(delAcc1Address);

            await wNat.delegate(accounts[40], 10000, { from: accounts[2] });
            await wNat.delegatesOf(accounts[2]);

            await claimSetupManager.delegate(accounts[40], 10000, { from: accounts[3] });
            await wNat.delegatesOf(delAcc3Address);

            await wNat.delegate(accounts[40], 10000, { from: accounts[3] });
            await wNat.delegatesOf(accounts[3]);

            await claimSetupManager.registerExecutor(10, { from: executor, value: EXECUTOR_REGISTER_FEE });
            await claimSetupManager.setClaimExecutors([executor], { from: accounts[3], value: "10" });

            await distributeRewardsPDA(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);

            // claim should succeed if claiming for self (any recipient)
            await ftsoRewardManager.claim(accounts[2], accounts[52], 0, true, { from: accounts[2] });

            // claim should succeed if claiming for own PDA (any recipient)
            await ftsoRewardManager.claim(delAcc1Address, accounts[51], 0, true, { from: accounts[1] });

            // claim should fail if not executor (claim for self)
            await expectRevert(ftsoRewardManager.claim(accounts[3], accounts[53], 0, true, { from: accounts[8] }),
                "only owner or executor");

            // claim should fail if not executor (claim for own PDA)
            await expectRevert(ftsoRewardManager.claim(delAcc3Address, accounts[53], 0, true, { from: accounts[8] }),
                "only owner or executor");

            // claim should succeed for executor (claim for owner)
            await ftsoRewardManager.claim(accounts[3], accounts[3], 0, true, { from: executor });

            // claim should succeed for executor (claim for owner's PDA)
            await ftsoRewardManager.claim(delAcc3Address, delAcc3Address, 0, true, { from: executor });
        });

        it("Should correctly check recipients", async () => {
            const executor = accounts[4];

            // deposit wNat
            await wNat.deposit({ from: accounts[1], value: "100" });
            await wNat.depositTo(delAcc1Address, { from: accounts[1], value: "100" });
            await wNat.deposit({ from: accounts[2], value: "100" });
            await wNat.depositTo(delAcc2Address, { from: accounts[2], value: "100" });
            await wNat.deposit({ from: accounts[3], value: "100" });
            await wNat.depositTo(delAcc3Address, { from: accounts[3], value: "100" });

            // delegate
            await wNat.delegate(accounts[40], 10000, { from: accounts[1] });
            await claimSetupManager.delegate(accounts[40], 10000, { from: accounts[1] });
            await wNat.delegate(accounts[40], 10000, { from: accounts[2] });
            await claimSetupManager.delegate(accounts[40], 10000, { from: accounts[2] });
            await wNat.delegate(accounts[40], 10000, { from: accounts[3] });
            await claimSetupManager.delegate(accounts[40], 10000, { from: accounts[3] });

            // set executor
            await claimSetupManager.registerExecutor(10, { from: executor, value: EXECUTOR_REGISTER_FEE });
            await claimSetupManager.setClaimExecutors([executor], { from: accounts[1], value: "10" });
            await claimSetupManager.setClaimExecutors([executor], { from: accounts[2], value: "10" });
            await claimSetupManager.setClaimExecutors([executor], { from: accounts[3], value: "10" });

            // set allowed recipients
            await claimSetupManager.setAllowedClaimRecipients([accounts[11], accounts[12]], { from: accounts[1] });
            await claimSetupManager.setAllowedClaimRecipients([accounts[21], accounts[22]], { from: accounts[2] });
            await claimSetupManager.setAllowedClaimRecipients([accounts[31], accounts[32]], { from: accounts[3] });

            await distributeRewardsPDA(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);

            // claim should fail if claiming from user to random account
            await expectRevert(ftsoRewardManager.claim(accounts[1], accounts[50], 0, true, { from: executor }),
                "recipient not allowed");

            // claim should fail if claiming from PDA to random account
            await expectRevert(ftsoRewardManager.claim(delAcc1Address, accounts[50], 0, true, { from: executor }),
                "recipient not allowed");

            // claim should fail if claiming from PDA to some other PDA
            await expectRevert(ftsoRewardManager.claim(delAcc1Address, delAcc2Address, 0, true, { from: executor }),
                "recipient not allowed");

            // claim should fail if claiming from PDA to some unrelated allowed address
            await expectRevert(ftsoRewardManager.claim(delAcc3Address, accounts[11], 0, true, { from: executor }),
                "recipient not allowed");

            // claim should succeed if claiming from owner to self
            await ftsoRewardManager.claim(accounts[1], accounts[1], 0, true, { from: executor });

            // claim should succeed if claiming from PDA to self
            await ftsoRewardManager.claim(delAcc1Address, delAcc1Address, 0, true, { from: executor });

            // claim should succeed if claiming from owner to PDA
            await ftsoRewardManager.claim(accounts[2], delAcc2Address, 0, true, { from: executor });

            // claim should succeed if claiming from PDA to owner
            await ftsoRewardManager.claim(delAcc2Address, accounts[2], 0, true, { from: executor });

            // claim should succeed if claiming from owner to an allowed recipient
            await ftsoRewardManager.claim(accounts[3], accounts[31], 0, true, { from: executor });

            // claim should succeed if claiming from PDA to an allowed recipient
            await ftsoRewardManager.claim(delAcc3Address, accounts[32], 0, true, { from: executor });
        });

        it("Should delegate and auto-claim to multiple addresses and delegation accounts", async () => {
            const executor = accounts[5];
            
            // deposit some wnats
            await wNat.depositTo(delAcc1Address, { from: accounts[1], value: "100" });
            await wNat.deposit({ from: accounts[2], value: "100" });
            await wNat.depositTo(delAcc3Address, { from: accounts[3], value: "50" });
            await wNat.deposit({ from: accounts[3], value: "150" });
            await wNat.deposit({ from: accounts[4], value: "100" });

            // delegate some wnats to ac40
            await claimSetupManager.delegate(accounts[40], 10000, { from: accounts[1] });
            await wNat.delegate(accounts[40], 10000, { from: accounts[2] });
            await claimSetupManager.delegate(accounts[40], 10000, { from: accounts[3] });
            await wNat.delegate(accounts[40], 10000, { from: accounts[3] });
            await wNat.delegate(accounts[40], 10000, { from: accounts[4] });

            // set executors
            await claimSetupManager.registerExecutor(10, { from: executor, value: EXECUTOR_REGISTER_FEE });
            await claimSetupManager.setClaimExecutors([executor], { from: accounts[1], value: "10" });
            await claimSetupManager.setClaimExecutors([executor], { from: accounts[2], value: "10" });
            await claimSetupManager.setClaimExecutors([executor], { from: accounts[3], value: "10" });
            await claimSetupManager.setClaimExecutors([executor], { from: accounts[4], value: "10" });

            // produce rewards
            await distributeRewardsPDA(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);

            const executorOpeningBalance = toBN(await web3.eth.getBalance(executor));
            let claim = await ftsoRewardManager.autoClaim([accounts[1], accounts[2], accounts[3], accounts[4]], 0, { from: executor });
            const executorClosingBalance = toBN(await web3.eth.getBalance(executor));
            
            // delegationAccount1 claim should be (2000000 / 720) * 0.25 * 2 price epochs / 5 = 1390 / 5 = 278 and should go to delAcc1
            assertNumberEqual(await wNat.balanceOf(accounts[1]), 0);
            assertNumberEqual(await wNat.balanceOf(delAcc1Address), 100 + 278 - 10);

            // accounts[2] claim should be (2000000 / 720) * 0.25 * 2 price epochs / 5 = 1390 / 5 = 278 and should go to delAcc2
            assertNumberEqual(await wNat.balanceOf(accounts[2]), 100);
            assertNumberEqual(await wNat.balanceOf(delAcc2Address), 278 - 10);

            // accounts[3] claim should be (2000000 / 720) * 0.25 * 2 price epochs / 5 * 2 = 278 * 2 = 556 and should go to delAcc3
            assertNumberEqual(await wNat.balanceOf(accounts[3]), 150);
            assertNumberEqual(await wNat.balanceOf(delAcc3Address), 50 + 556 - 10);

            // accounts[4] claim should be (2000000 / 5040) * 0.25 * 2 price epochs / 5 = 278 and should go to accounts[4]
            assertNumberEqual(await wNat.balanceOf(accounts[4]), 100 + 278 - 10);
            
            // expect executor to get 40 fee
            const gasCost = await calcGasCost(claim);
            assertNumberEqual(executorClosingBalance.add(gasCost).sub(executorOpeningBalance), 40);
        });
        
    });

});
