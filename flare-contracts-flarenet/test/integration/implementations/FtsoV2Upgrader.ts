import { constants, time } from '@openzeppelin/test-helpers';
import { Contracts } from "../../../deployment/scripts/Contracts";
import {
    AddressUpdaterInstance,
    CleanupBlockNumberManagerInstance,
    FtsoInstance, FtsoManagerInstance, FtsoRegistryInstance, FtsoRewardManagerInstance, InflationMockInstance, MockContractInstance,
    PriceSubmitterInstance,
    TestableFlareDaemonInstance,
    VoterWhitelisterInstance,
    WNatInstance
} from "../../../typechain-truffle";
import { createMockSupplyContract } from "../../utils/FTSO-test-utils";
import { GOVERNANCE_GENESIS_ADDRESS, defaultPriceEpochCyclicBufferSize } from "../../utils/constants";
import { executeTimelockedGovernanceCall, testDeployGovernanceSettings } from '../../utils/contract-test-helpers';
import { setDefaultVPContract } from "../../utils/token-test-helpers";


const getTestFile = require('../../utils/constants').getTestFile;

const BN = web3.utils.toBN;

const AddressUpdater = artifacts.require("AddressUpdater");
const PriceSubmitter = artifacts.require("PriceSubmitter");
const VoterWhitelister = artifacts.require("VoterWhitelister");
const CleanupBlockNumberManager = artifacts.require("CleanupBlockNumberManager");
const FlareDaemon = artifacts.require("TestableFlareDaemon");
const FtsoRegistry = artifacts.require("FtsoRegistry");
const FtsoRewardManager = artifacts.require("FtsoRewardManager");
const DataProviderFee = artifacts.require("DataProviderFee" as any);
const FtsoManager = artifacts.require("FtsoManager");
const FtsoManagement = artifacts.require("FtsoManagement");
const Ftso = artifacts.require("Ftso");
const WNAT = artifacts.require("WNat");
const InflationMock = artifacts.require("InflationMock");
const FtsoV2Upgrader = artifacts.require("FtsoV2Upgrader");
const FtsoRegistryProxy = artifacts.require("FtsoRegistryProxy");
const MockContract = artifacts.require("MockContract");

const PRICE_EPOCH_DURATION_S = 120;   // 2 minutes
const REVEAL_EPOCH_DURATION_S = 30;
const REWARD_EPOCH_DURATION_S = 2 * 24 * 60 * 60; // 2 days
const VOTE_POWER_BOUNDARY_FRACTION = 7;

contract(`FtsoV2Upgrader.sol; ${ getTestFile(__filename) }; FtsoV2Upgrader integration tests`, async accounts => {

    const governance = accounts[1];
    const deployerAccount = accounts[2];

    // contains a fresh contract for each test
    let addressUpdater: AddressUpdaterInstance;
    let priceSubmitter: PriceSubmitterInstance;
    let voterWhitelister: VoterWhitelisterInstance;
    let cleanupBlockNumberManager: CleanupBlockNumberManagerInstance;
    let flareDaemon: TestableFlareDaemonInstance;
    let ftsoRegistry: FtsoRegistryInstance;
    let ftsoRewardManager: FtsoRewardManagerInstance;
    let oldFtsoManager: FtsoManagerInstance;
    let startTs: BN;
    let wNat: WNatInstance;
    let mockInflation: InflationMockInstance;
    let mockSupply: MockContractInstance;
    let mockClaimSetupManager: MockContractInstance;

    async function createFtso(ftsoManagerAddress: string, symbol: string, initialPrice: number = 0): Promise<FtsoInstance> {
        return await Ftso.new(
            symbol,
            5,
            priceSubmitter.address,
            wNat.address,
            ftsoManagerAddress,
            startTs,
            PRICE_EPOCH_DURATION_S,
            REVEAL_EPOCH_DURATION_S,
            initialPrice,
            1e10,
            defaultPriceEpochCyclicBufferSize
        );
    }

    before(async () => {
        FtsoManager.link(await FtsoManagement.new() as any);
        FtsoRewardManager.link(await DataProviderFee.new() as any);
        await testDeployGovernanceSettings(governance, 1, [governance]);
    });

    beforeEach(async () => {
        addressUpdater = await AddressUpdater.new(deployerAccount);
        priceSubmitter = await PriceSubmitter.new();
        await priceSubmitter.initialiseFixedAddress();
        voterWhitelister = await VoterWhitelister.new(deployerAccount, addressUpdater.address, priceSubmitter.address, 10, constants.ZERO_ADDRESS);
        cleanupBlockNumberManager = await CleanupBlockNumberManager.new(deployerAccount, addressUpdater.address, "FtsoManager");
        flareDaemon = await FlareDaemon.new();
        await flareDaemon.initialiseFixedAddress();
        ftsoRewardManager = await FtsoRewardManager.new(
            deployerAccount,
            addressUpdater.address,
            constants.ZERO_ADDRESS,
            3,
            0
        );
        wNat = await WNAT.new(deployerAccount, "Wrapped NAT", "WNAT");

        mockInflation = await InflationMock.new();
        await mockInflation.setInflationReceiver(ftsoRewardManager.address);
        const getContractName = web3.utils.sha3("getContractName()")!.slice(0, 10); // first 4 bytes is function selector
        const getContractNameReturn = web3.eth.abi.encodeParameter('string', 'Inflation');
        await mockInflation.givenMethodReturn(getContractName, getContractNameReturn);

        mockSupply = await createMockSupplyContract(deployerAccount, 10000);
        mockClaimSetupManager = await MockContract.new();

        const ftsoRegistryImpl = await FtsoRegistry.new();
        const ftsoRegistryProxy = await FtsoRegistryProxy.new(deployerAccount, ftsoRegistryImpl.address);
        ftsoRegistry = await FtsoRegistry.at(ftsoRegistryProxy.address);
        await ftsoRegistry.initialiseRegistry(addressUpdater.address, { from: deployerAccount });

        // Get the timestamp for the just mined block
        startTs = await time.latest();

        oldFtsoManager = await FtsoManager.new(
            deployerAccount,
            flareDaemon.address,
            addressUpdater.address,
            constants.ZERO_ADDRESS,
            startTs,
            PRICE_EPOCH_DURATION_S,
            REVEAL_EPOCH_DURATION_S,
            startTs.addn(REVEAL_EPOCH_DURATION_S),
            REWARD_EPOCH_DURATION_S,
            4);

        await oldFtsoManager.setGovernanceParameters(0, 10, 10, 500, 100000, 5000, 300, 0, 50000, [], {from: deployerAccount});
        await oldFtsoManager.activate({from: deployerAccount});

        await setDefaultVPContract(wNat, deployerAccount);

        await flareDaemon.setAddressUpdater(addressUpdater.address, {from: GOVERNANCE_GENESIS_ADDRESS});
        await priceSubmitter.setAddressUpdater(addressUpdater.address, {from: GOVERNANCE_GENESIS_ADDRESS});

        await addressUpdater.update(
            [Contracts.ADDRESS_UPDATER, Contracts.PRICE_SUBMITTER, Contracts.INFLATION, Contracts.FTSO_REWARD_MANAGER, Contracts.FTSO_REGISTRY, Contracts.VOTER_WHITELISTER, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.SUPPLY, Contracts.CLEANUP_BLOCK_NUMBER_MANAGER, Contracts.CLAIM_SETUP_MANAGER],
            [addressUpdater.address, priceSubmitter.address, mockInflation.address, ftsoRewardManager.address, ftsoRegistry.address, voterWhitelister.address, oldFtsoManager.address, wNat.address, mockSupply.address, cleanupBlockNumberManager.address, mockClaimSetupManager.address],
            [flareDaemon.address, priceSubmitter.address, ftsoRewardManager.address, oldFtsoManager.address, ftsoRegistry.address, voterWhitelister.address, cleanupBlockNumberManager.address], {from: deployerAccount});

        await mockInflation.setDailyAuthorizedInflation(BN(1000000));
        await ftsoRewardManager.activate({from: deployerAccount});

        const registrations = [
            { daemonizedContract: mockInflation.address, gasLimit: 2000000 },
            { daemonizedContract: oldFtsoManager.address, gasLimit: 40000000 }
        ];
        await flareDaemon.registerToDaemonize(registrations, {from: GOVERNANCE_GENESIS_ADDRESS});

        await addressUpdater.switchToProductionMode({from: deployerAccount});
        await priceSubmitter.switchToProductionMode({from: GOVERNANCE_GENESIS_ADDRESS});
        await voterWhitelister.switchToProductionMode({from: deployerAccount});
        await cleanupBlockNumberManager.switchToProductionMode({from: deployerAccount});
        await flareDaemon.switchToProductionMode({from: GOVERNANCE_GENESIS_ADDRESS});
        await ftsoRewardManager.switchToProductionMode({from: deployerAccount});
        await ftsoRegistry.switchToProductionMode({from: deployerAccount});
    });

    it("Should upgrade to ftso V2", async () => {
        // Assemble
        // add ftso to old ftso manager
        let oldFtso1 = await createFtso(oldFtsoManager.address, "NAT", 1);
        await oldFtsoManager.addFtso(oldFtso1.address, { from: deployerAccount });
        let oldFtso2 = await createFtso(oldFtsoManager.address, "TEST", 2);
        await oldFtsoManager.addFtso(oldFtso2.address, { from: deployerAccount });
        let oldFtso3 = await createFtso(oldFtsoManager.address, "TEST1", 3);
        await oldFtsoManager.addFtso(oldFtso3.address, { from: deployerAccount });
        let oldFtso4 = await createFtso(oldFtsoManager.address, "TEST2", 4);
        await oldFtsoManager.addFtso(oldFtso4.address, { from: deployerAccount });
        await oldFtsoManager.setFtsoAssetFtsos(oldFtso4.address, [oldFtso1.address, oldFtso2.address, oldFtso3.address], { from: deployerAccount });
        await oldFtsoManager.switchToProductionMode({from: deployerAccount});

        // Time travel to first reward epoch initialization time
        await time.increaseTo(startTs.addn(REVEAL_EPOCH_DURATION_S));
        await flareDaemon.trigger(); // initialize first reward epoch

        // Time travel to second reward epoch
        await time.increaseTo(startTs.addn(REVEAL_EPOCH_DURATION_S + REWARD_EPOCH_DURATION_S));
        await flareDaemon.trigger(); // initialize second reward epoch

        // create ftso v2 upgrader contract
        const ftsoV2Upgrader = await FtsoV2Upgrader.new(deployerAccount);

        // create new ftso manager, set governance to ftsoV2Upgrader account
        const ftsoManager = await FtsoManager.new(
            ftsoV2Upgrader.address,
            flareDaemon.address,
            addressUpdater.address,
            oldFtsoManager.address,
            startTs,
            PRICE_EPOCH_DURATION_S,
            REVEAL_EPOCH_DURATION_S,
            startTs.addn(REVEAL_EPOCH_DURATION_S),
            REWARD_EPOCH_DURATION_S,
            VOTE_POWER_BOUNDARY_FRACTION
        );

        await addressUpdater.updateContractAddresses([ftsoManager.address], {from: governance});

        // set governance parameters
        await ftsoV2Upgrader.setGovernanceParametersOnFtsoManager(ftsoManager.address, 10, 10, 500, 100000, 5000, 300, 0, 50000, [], {from: deployerAccount});

        // create new ftsos
        const newFtso1 = await createFtso(ftsoManager.address, "NAT");
        const newFtso2 = await createFtso(ftsoManager.address, "TEST");
        const newFtso3 = await createFtso(ftsoManager.address, "TEST1");
        const newFtso4 = await createFtso(ftsoManager.address, "TEST2");

        // set upgrade data
        await ftsoV2Upgrader.setUpgradeData([newFtso1.address, newFtso2.address, newFtso3.address, newFtso4.address], [100, 200, 500, 150], newFtso4.address, [newFtso1.address, newFtso2.address, newFtso3.address], {from: deployerAccount});

        // switch to production mode
        await ftsoV2Upgrader.switchToProductionMode({from: deployerAccount});

        // upgrade
        await executeTimelockedGovernanceCall(addressUpdater, (governance) => addressUpdater.update([Contracts.FTSO_MANAGER], [ftsoManager.address],
            [flareDaemon.address, priceSubmitter.address, ftsoRewardManager.address, ftsoRegistry.address, voterWhitelister.address, cleanupBlockNumberManager.address], {from: governance}));

        const tx = await ftsoV2Upgrader.upgrade(ftsoManager.address, {from: governance});
        console.log("Gas used: " + tx.receipt.gasUsed.toString())
        expect(await ftsoV2Upgrader.upgraded()).to.equals(true);

        // Assert
        expect(await ftsoManager.governance()).to.equals(governance);
        expect(await flareDaemon.governance()).to.equals(governance);
        expect(await ftsoRegistry.governance()).to.equals(governance);
        expect(await ftsoRewardManager.governance()).to.equals(governance);
        expect(await cleanupBlockNumberManager.governance()).to.equals(governance);
        expect(await voterWhitelister.governance()).to.equals(governance);
        expect(await addressUpdater.governance()).to.equals(governance);
        expect(await priceSubmitter.governance()).to.equals(governance);

        expect(await ftsoRegistry.getFtsoBySymbol("NAT")).to.equals(newFtso1.address);
        expect((await ftsoRegistry.getFtsoIndex("NAT")).toString()).to.equals('0');
        expect(await ftsoRegistry.getFtsoBySymbol("TEST")).to.equals(newFtso2.address);
        expect((await ftsoRegistry.getFtsoIndex("TEST")).toString()).to.equals('1');
        expect(await oldFtso1.active()).to.be.true;
        expect(await oldFtso2.active()).to.be.true;
        expect(await newFtso1.active()).to.be.true;
        expect(await newFtso2.active()).to.be.true;
        expect((await newFtso4.getAssetFtsos()).length).to.equals(3);
        expect((await newFtso1.getCurrentPrice())[0].toNumber()).to.equals(1);
        expect((await newFtso2.getCurrentPrice())[0].toNumber()).to.equals(2);
        expect((await ftsoManager.getElasticBandWidthPPMFtso(newFtso1.address)).toNumber()).to.equals(100);
        expect((await ftsoManager.getElasticBandWidthPPMFtso(newFtso2.address)).toNumber()).to.equals(200);
        expect((await ftsoManager.getElasticBandWidthPPMFtso(newFtso3.address)).toNumber()).to.equals(500);
        expect((await ftsoManager.getElasticBandWidthPPMFtso(newFtso4.address)).toNumber()).to.equals(150);

        expect((await flareDaemon.getDaemonizedContractsData())[0][0]).to.equals(mockInflation.address);
        expect((await flareDaemon.getDaemonizedContractsData())[0][1]).to.equals(ftsoManager.address);
        expect((await flareDaemon.getDaemonizedContractsData())[0].length).to.equals(2);

        expect(await priceSubmitter.getFtsoManager()).to.equals(ftsoManager.address);
        expect(await ftsoRegistry.ftsoManager()).to.equals(ftsoManager.address);
        expect(await ftsoRewardManager.ftsoManager()).to.equals(ftsoManager.address);
        expect(await voterWhitelister.ftsoManager()).to.equals(ftsoManager.address);
        expect(await cleanupBlockNumberManager.triggerContract()).to.equals(ftsoManager.address);

        expect((await oldFtsoManager.rewardEpochs(0))[0].toString()).to.equals((await ftsoManager.getRewardEpochData(0)).votepowerBlock.toString());
        expect((await oldFtsoManager.rewardEpochs(0))[1].toString()).to.equals((await ftsoManager.getRewardEpochData(0)).startBlock.toString());
        expect((await oldFtsoManager.rewardEpochs(0))[2].toString()).to.equals((await ftsoManager.getRewardEpochData(0)).startTimestamp.toString());

        expect((await oldFtsoManager.rewardEpochs(1))[0].toString()).to.equals((await ftsoManager.getRewardEpochData(1)).votepowerBlock.toString());
        expect((await oldFtsoManager.rewardEpochs(1))[1].toString()).to.equals((await ftsoManager.getRewardEpochData(1)).startBlock.toString());
        expect((await oldFtsoManager.rewardEpochs(1))[2].toString()).to.equals((await ftsoManager.getRewardEpochData(1)).startTimestamp.toString());


        // Time travel to third reward epoch
        await time.increaseTo(startTs.addn(REVEAL_EPOCH_DURATION_S + 2 * REWARD_EPOCH_DURATION_S));
        await flareDaemon.trigger(); // initialize third reward epoch

        expect(BN((await ftsoManager.getRewardEpochData(2)).votepowerBlock.toString()).toNumber()).to.be.gt(BN((await ftsoManager.getRewardEpochData(1)).votepowerBlock.toString()).toNumber());
        expect(BN((await ftsoManager.getRewardEpochData(2)).startBlock.toString()).toNumber()).to.be.gt(BN((await ftsoManager.getRewardEpochData(1)).startBlock.toString()).toNumber());
        expect(BN((await ftsoManager.getRewardEpochData(2)).startTimestamp.toString()).toNumber()).to.be.gt(BN((await ftsoManager.getRewardEpochData(1)).startTimestamp.toString()).toNumber());

        expect((await ftsoManager.currentRewardEpochEnds()).toNumber()).to.equals(startTs.addn(REVEAL_EPOCH_DURATION_S + 3 * REWARD_EPOCH_DURATION_S).toNumber());
        expect(await ftsoManager.active()).to.be.true;
    });
});
