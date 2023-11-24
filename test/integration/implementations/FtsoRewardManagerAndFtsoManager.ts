import {
    FtsoInstance,
    FtsoManagerInstance,
    FtsoRegistryInstance,
    FtsoRegistryProxyInstance,
    FtsoRewardManagerInstance,
    InflationMockInstance, MockContractInstance,
    WNatInstance
} from "../../../typechain-truffle";
import { setDefaultGovernanceParameters } from "../../utils/FtsoManager-test-utils";
import { setDefaultVPContract } from "../../utils/token-test-helpers";


import { constants, expectRevert, expectEvent, time } from '@openzeppelin/test-helpers';
import { defaultPriceEpochCyclicBufferSize } from "../../utils/constants";
import { createMockSupplyContract } from "../../utils/FTSO-test-utils";
import { encodeContractNames } from "../../utils/test-helpers";
import { Contracts } from "../../../deployment/scripts/Contracts";
const getTestFile = require('../../utils/constants').getTestFile;

const BN = web3.utils.toBN;

const FtsoRegistry = artifacts.require("FtsoRegistry");
const FtsoRewardManager = artifacts.require("FtsoRewardManager");
const DataProviderFee = artifacts.require("DataProviderFee" as any);
const FtsoManager = artifacts.require("FtsoManager");
const FtsoManagement = artifacts.require("FtsoManagement");
const Ftso = artifacts.require("Ftso");
const MockContract = artifacts.require("MockContract");
const WNAT = artifacts.require("WNat");
const InflationMock = artifacts.require("InflationMock");
const FtsoRegistryProxy = artifacts.require("FtsoRegistryProxy");

const PRICE_EPOCH_DURATION_S = 120;   // 2 minutes
const REVEAL_EPOCH_DURATION_S = 30;
const REWARD_EPOCH_DURATION_S = 2 * 24 * 60 * 60; // 2 days
const VOTE_POWER_BOUNDARY_FRACTION = 7;

contract(`RewardManager.sol and FtsoManager.sol; ${ getTestFile(__filename) }; Reward manager and Ftso manager integration tests`, async accounts => {
    // contains a fresh contract for each test
    let ftsoRewardManager: FtsoRewardManagerInstance;
    let ftsoManager: FtsoManagerInstance;
    let startTs: BN;
    let mockFtso: MockContractInstance;
    let ftsoInterface: FtsoInstance;
    let wNat: WNatInstance;
    let mockInflation: InflationMockInstance;
    let ftsoRegistry: FtsoRegistryInstance;
    let mockPriceSubmitter: MockContractInstance;
    let mockVoterWhitelister: MockContractInstance;
    let mockSupply: MockContractInstance;
    let mockCleanupBlockNumberManager: MockContractInstance;
    let mockClaimSetupManager: MockContractInstance;
    var ftsoRegistryProxy: FtsoRegistryProxyInstance;
    var registry: FtsoRegistryInstance;

    before(async () => {
        FtsoManager.link(await FtsoManagement.new() as any);
        FtsoRewardManager.link(await DataProviderFee.new() as any);
    });

    beforeEach(async () => {
        const ADDRESS_UPDATER = accounts[16];
        mockFtso = await MockContract.new();
        ftsoRegistry = await FtsoRegistry.new();
        // proxy contract
        ftsoRegistryProxy = await FtsoRegistryProxy.new(accounts[0], ftsoRegistry.address);
        registry = await FtsoRegistry.at(ftsoRegistryProxy.address);
        await registry.initialiseRegistry(ADDRESS_UPDATER);
        ftsoInterface = await Ftso.new(
            "NAT",
            5,
            constants.ZERO_ADDRESS as any,
            constants.ZERO_ADDRESS as any,
            constants.ZERO_ADDRESS as any,
            0,
            120,
            60,
            0,
            1e10,
            defaultPriceEpochCyclicBufferSize
        );
        
        ftsoRewardManager = await FtsoRewardManager.new(
            accounts[0],
            ADDRESS_UPDATER,
            constants.ZERO_ADDRESS,
            3,
            0
            );

        // Get the timestamp for the just mined block
        startTs = await time.latest();
        
        mockPriceSubmitter = await MockContract.new();
        await mockPriceSubmitter.givenMethodReturnUint(
            web3.utils.sha3("addFtso(address)")!.slice(0,10),
            0
        )
        await mockPriceSubmitter.givenMethodReturnUint(
            web3.utils.sha3("removeFtso(address)")!.slice(0,10),
            0
        )

        mockVoterWhitelister = await MockContract.new();
        mockClaimSetupManager = await MockContract.new();

        mockSupply = await createMockSupplyContract(accounts[0], 10000);
        mockCleanupBlockNumberManager = await MockContract.new();

        ftsoManager = await FtsoManager.new(
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

        mockInflation = await InflationMock.new();
        await mockInflation.setInflationReceiver(ftsoRewardManager.address);

        await ftsoManager.updateContractAddresses(
            encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.PRICE_SUBMITTER, Contracts.FTSO_REWARD_MANAGER, Contracts.FTSO_REGISTRY, Contracts.VOTER_WHITELISTER, Contracts.SUPPLY, Contracts.CLEANUP_BLOCK_NUMBER_MANAGER]),
            [ADDRESS_UPDATER, mockPriceSubmitter.address, ftsoRewardManager.address, registry.address, mockVoterWhitelister.address, mockSupply.address, mockCleanupBlockNumberManager.address], {from: ADDRESS_UPDATER});
        
        await registry.updateContractAddresses(
            encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_MANAGER]),
            [ADDRESS_UPDATER, ftsoManager.address], {from: ADDRESS_UPDATER});
        
        wNat = await WNAT.new(accounts[0], "Wrapped NAT", "WNAT");
        await setDefaultVPContract(wNat, accounts[0]);

        await ftsoRewardManager.updateContractAddresses(
            encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.CLAIM_SETUP_MANAGER]),
            [ADDRESS_UPDATER, mockInflation.address, ftsoManager.address, wNat.address, mockClaimSetupManager.address], {from: ADDRESS_UPDATER});
        
        await mockInflation.setDailyAuthorizedInflation(BN(2000000));

        await ftsoRewardManager.activate();
    });

    describe("Price epochs, finalization", async () => {

        it("Should finalize price epoch and distribute unclaimed rewards", async () => {
            // Assemble
            // stub ftso finalizer
            const finalizePriceEpoch = ftsoInterface.contract.methods.finalizePriceEpoch(0, true).encodeABI();
            const finalizePriceEpochReturn = web3.eth.abi.encodeParameters(
                ['address[]', 'uint256[]', 'uint256'],
                [[accounts[1], accounts[2]], [25, 75], 100]);
            await mockFtso.givenMethodReturn(finalizePriceEpoch, finalizePriceEpochReturn);

            // give reward manager some nat to distribute
            await mockInflation.receiveInflation({ value: "2000000" } );

            await setDefaultGovernanceParameters(ftsoManager);
            // add fakey ftso
            await ftsoManager.addFtso(mockFtso.address, { from: accounts[0] });

            // activte ftso manager
            await ftsoManager.activate();
            // Time travel to price epoch initialization time
            await time.increaseTo(startTs.addn(REVEAL_EPOCH_DURATION_S));
            await ftsoManager.daemonize(); // initialize reward epoch
            await ftsoRewardManager.enableClaims();
            // Trigger price epoch initialization
            await ftsoManager.daemonize();

            // Time travel over the price epoch plus the reveal
            await time.increaseTo(startTs.addn(PRICE_EPOCH_DURATION_S + REVEAL_EPOCH_DURATION_S));

            // Act
            // Simulate the daemon tickling ftso manager to finalize the price epoch
            await ftsoManager.daemonize();

            // Assert
            // a1 should be (2000000 / 720) * 0.25 = 695
            // a2 should be = (2000000 / 5040) * 0.75 = 2777 - 695 = 2082
            // There is a remainder. It is not being allocated. It should get progressively
            // smaller using a double declining balance allocation.
            let a1UnclaimedReward = await ftsoRewardManager.getUnclaimedReward(0, accounts[1]);
            let a2UnclaimedReward = await ftsoRewardManager.getUnclaimedReward(0, accounts[2]);
            assert.equal(a1UnclaimedReward[0].toString(), "695");
            assert.equal(a2UnclaimedReward[0].toString(), "2082");
        });
    });

    describe("reward claiming", async () => {

        it("Should enable rewards to be claimed once reward epoch finalized", async () => {
            // deposit some wNats
            await wNat.deposit({ from: accounts[1], value: "100" });
            // Assemble
            // stub ftso finalizer
            const finalizePriceEpoch = ftsoInterface.contract.methods.finalizePriceEpoch(0, true).encodeABI();
            const finalizePriceEpochReturn = web3.eth.abi.encodeParameters(
                ['address[]', 'uint256[]', 'uint256'],
                [[accounts[1], accounts[2]], [25, 75], 100]);
            await mockFtso.givenMethodReturn(finalizePriceEpoch, finalizePriceEpochReturn);
            // Stub accounting system to make it balance with RM contract

            // give reward manager some nat to distribute
            await mockInflation.receiveInflation({ value: "2000000" } );

            await setDefaultGovernanceParameters(ftsoManager);
            // add fakey ftso
            await ftsoManager.addFtso(mockFtso.address, { from: accounts[0] });
            // activte ftso manager
            await ftsoManager.activate();
            // Time travel to price epoch initialization time
            await time.increaseTo(startTs.addn(REVEAL_EPOCH_DURATION_S));
            await ftsoManager.daemonize(); // initialize reward epoch
            await ftsoRewardManager.enableClaims();
            // Trigger price epoch initialization
            await ftsoManager.daemonize();
            // Time travel to price epoch finalization time
            await time.increaseTo(startTs.addn(PRICE_EPOCH_DURATION_S + REVEAL_EPOCH_DURATION_S));
            // Trigger price epoch finalization
            await ftsoManager.daemonize();
            // Trigger another price epoch initialization
            await ftsoManager.daemonize();
            // Time travel to reward epoch finalization time
            await time.increaseTo(startTs.addn(REWARD_EPOCH_DURATION_S + REVEAL_EPOCH_DURATION_S));
            // Trigger price epoch finalization and reward epoch finalization
            await ftsoManager.daemonize();
            await ftsoManager.daemonize();

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees
            let natOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimReward(accounts[3], [0], { from: accounts[1] });

            // Assert
            // a1 -> a3 claimed should be (2000000 / 720) * 0.25 * 2 finalizations = 695 * 2 = 1390
            let natClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(natClosingBalance.sub(natOpeningBalance).toNumber(), Math.ceil(2000000 / 720 * 0.25) * 2);
        });
    });
});
