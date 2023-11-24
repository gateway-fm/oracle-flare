import { constants, time } from '@openzeppelin/test-helpers';
import { Contracts } from "../../../deployment/scripts/Contracts";
import {
    CleanupBlockNumberManagerInstance,
    FtsoInstance, FtsoManagerV1MockInstance, FtsoRewardManagerInstance, InflationMockInstance, MockContractInstance,
    PriceSubmitterInstance,
    TestableFlareDaemonInstance,
    VoterWhitelisterInstance,
    WNatInstance
} from "../../../typechain-truffle";
import { FtsoRegistryV1MockInstance } from '../../../typechain-truffle/FtsoRegistryV1Mock';
import { defaultPriceEpochCyclicBufferSize, GOVERNANCE_GENESIS_ADDRESS } from "../../utils/constants";
import { testDeployGovernanceSettings } from '../../utils/contract-test-helpers';
import { createMockSupplyContract } from "../../utils/FTSO-test-utils";
import { toBN, encodeContractNames } from '../../utils/test-helpers';
import { setDefaultVPContract } from "../../utils/token-test-helpers";
const hardhat = require('hardhat');


const getTestFile = require('../../utils/constants').getTestFile;

const BN = web3.utils.toBN;

const AddressUpdater = artifacts.require("AddressUpdater");
const PriceSubmitter = artifacts.require("PriceSubmitter");
const VoterWhitelister = artifacts.require("VoterWhitelister");
const CleanupBlockNumberManager = artifacts.require("CleanupBlockNumberManager");
const FlareDaemon = artifacts.require("TestableFlareDaemon");
const FtsoRegistry = artifacts.require("FtsoRegistry");
const FtsoRewardManager = artifacts.require("FtsoRewardManager");
const OldFtsoManager = artifacts.require("FtsoManagerV1Mock");
const OldFtsoRegistry = artifacts.require("FtsoRegistryV1Mock");
const FtsoManager = artifacts.require("FtsoManager");
const FtsoManagement = artifacts.require("FtsoManagement");
const Ftso = artifacts.require("Ftso");
const WNAT = artifacts.require("WNat");
const InflationMock = artifacts.require("InflationMock");
const FtsoV2Upgrader = artifacts.require("FtsoV2Upgrader");
const MockContract = artifacts.require("MockContract");
const FtsoRegistryProxy = artifacts.require("FtsoRegistryProxy");
const PollingFoundation = artifacts.require("PollingFoundation");
const DataProviderFee = artifacts.require("DataProviderFee" as any);

const PRICE_EPOCH_DURATION_S = 120;   // 2 minutes
const REVEAL_EPOCH_DURATION_S = 30;
const REWARD_EPOCH_DURATION_S = 2 * 24 * 60 * 60; // 2 days
const VOTE_POWER_BOUNDARY_FRACTION = 7;

contract(`FtsoV2Upgrader.sol; ${ getTestFile(__filename) }; FtsoV2Upgrader integration tests`, async accounts => {

    const governance = GOVERNANCE_GENESIS_ADDRESS;
    const deployerAccount = accounts[2];
    const ADDRESS_UPDATER = accounts[16];

    // contains a fresh contract for each test
    let priceSubmitter: PriceSubmitterInstance;
    let voterWhitelister: VoterWhitelisterInstance;
    let cleanupBlockNumberManager: CleanupBlockNumberManagerInstance;
    let flareDaemon: TestableFlareDaemonInstance;
    let oldFtsoRegistry: FtsoRegistryV1MockInstance;
    let ftsoRewardManager: FtsoRewardManagerInstance;
    let oldFtsoManager: FtsoManagerV1MockInstance;
    let startTs: BN;
    let wNat: WNatInstance;
    let mockInflation: InflationMockInstance;
    let mockSupply: MockContractInstance;
    let mockClaimSetupManager: MockContractInstance;
    let mockGovernanceVotePower: MockContractInstance;

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
        FtsoRewardManager.link(await DataProviderFee.new() as any);
    });

    beforeEach(async () => {
        priceSubmitter = await PriceSubmitter.new();
        await priceSubmitter.initialiseFixedAddress();
        voterWhitelister = await VoterWhitelister.new(governance, ADDRESS_UPDATER, priceSubmitter.address, 10, constants.ZERO_ADDRESS);
        cleanupBlockNumberManager = await CleanupBlockNumberManager.new(governance, ADDRESS_UPDATER, "FtsoManager");
        flareDaemon = await FlareDaemon.new();
        await flareDaemon.initialiseFixedAddress();
        oldFtsoRegistry = await OldFtsoRegistry.new(governance);
        ftsoRewardManager = await FtsoRewardManager.new(
            governance,
            ADDRESS_UPDATER,
            constants.ZERO_ADDRESS,
            3,
            0
        );
        wNat = await WNAT.new(governance, "Wrapped NAT", "WNAT");

        mockInflation = await InflationMock.new();
        await mockInflation.setInflationReceiver(ftsoRewardManager.address);

        mockSupply = await createMockSupplyContract(governance, 10000);
        mockClaimSetupManager = await MockContract.new();

        mockGovernanceVotePower = await MockContract.new();

        // Get the timestamp for the just mined block
        startTs = await time.latest();

        oldFtsoManager = await OldFtsoManager.new(
            governance,
            flareDaemon.address,
            oldFtsoRegistry.address,
            voterWhitelister.address,
            startTs,
            PRICE_EPOCH_DURATION_S,
            REVEAL_EPOCH_DURATION_S,
            startTs.addn(REVEAL_EPOCH_DURATION_S),
            REWARD_EPOCH_DURATION_S);

        await setDefaultVPContract(wNat, governance);

        await flareDaemon.setInflation(mockInflation.address, {from: governance});
        await priceSubmitter.setContractAddresses(oldFtsoRegistry.address, voterWhitelister.address, oldFtsoManager.address, {from: governance});
        await ftsoRewardManager.updateContractAddresses(
            encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.CLAIM_SETUP_MANAGER]),
            [ADDRESS_UPDATER, mockInflation.address, oldFtsoManager.address, wNat.address, mockClaimSetupManager.address], {from: ADDRESS_UPDATER});

        await oldFtsoRegistry.setFtsoManagerAddress(oldFtsoManager.address, {from: governance});
        await voterWhitelister.updateContractAddresses(
            encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_REGISTRY, Contracts.FTSO_MANAGER]),
            [ADDRESS_UPDATER, oldFtsoRegistry.address, oldFtsoManager.address], {from: ADDRESS_UPDATER});
        await cleanupBlockNumberManager.updateContractAddresses(
            encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_MANAGER]),
            [ADDRESS_UPDATER, oldFtsoManager.address], {from: ADDRESS_UPDATER});

        await mockInflation.setDailyAuthorizedInflation(BN(1000000));
        await ftsoRewardManager.activate({from: governance});

        const registrations = [
            { daemonizedContract: mockInflation.address, gasLimit: 2000000 },
            { daemonizedContract: oldFtsoManager.address, gasLimit: 40000000 }
        ];
        await flareDaemon.registerToDaemonize(registrations, {from: governance});

        await testDeployGovernanceSettings(governance, 1, [governance]);
    });

    it("Should upgrade to ftso V2", async () => {
        // Assemble
        // add ftso to old ftso manager
        let oldFtso1 = await createFtso(oldFtsoManager.address, "NAT", 1);
        await oldFtsoManager.addFtso(oldFtso1.address, { from: governance });
        let oldFtso2 = await createFtso(oldFtsoManager.address, "TEST", 2);
        await oldFtsoManager.addFtso(oldFtso2.address, { from: governance });
        let oldFtso3 = await createFtso(oldFtsoManager.address, "TEST1", 3);
        await oldFtsoManager.addFtso(oldFtso3.address, { from: governance });
        let oldFtso4 = await createFtso(oldFtsoManager.address, "TEST2", 4);
        await oldFtsoManager.addFtso(oldFtso4.address, { from: governance });
        await oldFtsoManager.setFtsoAssetFtsos(oldFtso1.address, [oldFtso2.address, oldFtso3.address, oldFtso4.address], { from: governance });

        // Time travel to first reward epoch initialization time
        await time.increaseTo(startTs.addn(REVEAL_EPOCH_DURATION_S));
        await flareDaemon.trigger(); // initialize first reward epoch

        // Time travel to second reward epoch
        await time.increaseTo(startTs.addn(REVEAL_EPOCH_DURATION_S + REWARD_EPOCH_DURATION_S));
        await flareDaemon.trigger(); // initialize second reward epoch

        // create ftso v2 upgrader contract
        const ftsoV2Upgrader = await FtsoV2Upgrader.new(deployerAccount, oldFtsoManager.address);

        // create new address updater
        const addressUpdater = await AddressUpdater.new(ftsoV2Upgrader.address);

        // tell FtsoV2Upgrader about addressUpdater
        await ftsoV2Upgrader.setAddressUpdater(addressUpdater.address, { from: deployerAccount });

        // create polling foundation
        const pollingFoundation = await PollingFoundation.new(deployerAccount, addressUpdater.address, []);

        // create new ftso registry
        const ftsoRegistryImpl = await FtsoRegistry.new();
        const ftsoRegistryProxy = await FtsoRegistryProxy.new(deployerAccount, ftsoRegistryImpl.address);
        const ftsoRegistry = await FtsoRegistry.at(ftsoRegistryProxy.address);
        await ftsoRegistry.initialiseRegistry(addressUpdater.address, { from: deployerAccount });

        // create new ftso manager, set governance to ftsoV2Upgrader account
        FtsoManager.link(await FtsoManagement.new() as any);
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

        // set address updater data
        await ftsoV2Upgrader.updateContractsUsingAddressUpdater(
            [
                Contracts.ADDRESS_UPDATER,
                Contracts.FTSO_REWARD_MANAGER,
                Contracts.FTSO_REGISTRY,
                Contracts.VOTER_WHITELISTER,
                Contracts.SUPPLY,
                Contracts.CLEANUP_BLOCK_NUMBER_MANAGER,
                Contracts.FLARE_DAEMON,
                Contracts.PRICE_SUBMITTER,
                Contracts.FTSO_MANAGER,
                Contracts.INFLATION,
                Contracts.WNAT,
                Contracts.GOVERNANCE_VOTE_POWER
            ],
            [
                addressUpdater.address,
                ftsoRewardManager.address,
                oldFtsoRegistry.address,
                voterWhitelister.address,
                mockSupply.address,
                cleanupBlockNumberManager.address,
                flareDaemon.address,
                priceSubmitter.address,
                ftsoManager.address,
                mockInflation.address,
                wNat.address,
                mockGovernanceVotePower.address
            ],
            [
                ftsoManager.address,
                ftsoRegistry.address
            ], {from: deployerAccount});
        await ftsoV2Upgrader.updateContractsUsingAddressUpdater([Contracts.FTSO_REGISTRY], [ftsoRegistry.address], [pollingFoundation.address], {from: deployerAccount});

        // set governance parameters
        await ftsoV2Upgrader.setGovernanceParametersOnFtsoManager(10, 10, 500, 100000, 5000, 300, 0, 50000, [], {from: deployerAccount});

        // create new ftsos
        const newFtso1 = await createFtso(ftsoManager.address, "NAT");
        const newFtso2 = await createFtso(ftsoManager.address, "TEST");
        const newFtso3 = await createFtso(ftsoManager.address, "TEST1");
        const newFtso4 = await createFtso(ftsoManager.address, "TEST2");
        // set upgrader data
        await ftsoV2Upgrader.setUpgradeData([newFtso1.address, newFtso2.address, newFtso3.address, newFtso4.address], [100, 200, 500, 150], newFtso1.address, [newFtso2.address, newFtso3.address, newFtso4.address], {from: deployerAccount});

        // switch to production mode
        await ftsoV2Upgrader.switchToProductionMode({from: deployerAccount});
        await pollingFoundation.switchToProductionMode({from: deployerAccount});
        await ftsoRegistry.switchToProductionMode({ from: deployerAccount });

        // call upgrade method
        await time.increaseTo(startTs.addn(REVEAL_EPOCH_DURATION_S + REWARD_EPOCH_DURATION_S + 2 * PRICE_EPOCH_DURATION_S));
        await flareDaemon.trigger();
        expect(await ftsoV2Upgrader.upgraded()).to.equals(false);

        await time.increaseTo(startTs.addn(REVEAL_EPOCH_DURATION_S + REWARD_EPOCH_DURATION_S + 3 * PRICE_EPOCH_DURATION_S));
        await flareDaemon.trigger();
        expect(await ftsoV2Upgrader.upgraded()).to.equals(false);

        await time.increaseTo(startTs.addn(REVEAL_EPOCH_DURATION_S + REWARD_EPOCH_DURATION_S + 4 * PRICE_EPOCH_DURATION_S));
        await flareDaemon.trigger();
        expect(await ftsoV2Upgrader.upgraded()).to.equals(false);

        expect((await flareDaemon.getDaemonizedContractsData())[0][0]).to.equals(mockInflation.address);
        expect((await flareDaemon.getDaemonizedContractsData())[0][1]).to.equals(oldFtsoManager.address);

        await time.increaseTo(startTs.addn(REVEAL_EPOCH_DURATION_S + REWARD_EPOCH_DURATION_S + 5 * PRICE_EPOCH_DURATION_S - 2));
        await flareDaemon.trigger();
        expect(await ftsoV2Upgrader.upgraded()).to.equals(false);
        console.log("should upgrade");
        let gasUsed = toBN(0);
        // update addresses
        let tx: any = await ftsoRewardManager.updateContractAddresses(
            encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.CLAIM_SETUP_MANAGER]),
            [ADDRESS_UPDATER, mockInflation.address, ftsoManager.address, wNat.address, mockClaimSetupManager.address], {from: ADDRESS_UPDATER});
        gasUsed = gasUsed.add(toBN(tx.receipt.gasUsed));
        tx = await priceSubmitter.setContractAddresses(ftsoRegistry.address, voterWhitelister.address, ftsoManager.address, { from: governance });
        gasUsed = gasUsed.add(toBN(tx.receipt.gasUsed));
        tx = await voterWhitelister.updateContractAddresses(
            encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_REGISTRY, Contracts.FTSO_MANAGER]),
            [ADDRESS_UPDATER, oldFtsoRegistry.address, ftsoManager.address], {from: ADDRESS_UPDATER});
        gasUsed = gasUsed.add(toBN(tx.receipt.gasUsed));
        tx = await cleanupBlockNumberManager.updateContractAddresses(
            encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_MANAGER]),
            [ADDRESS_UPDATER, ftsoManager.address], {from: ADDRESS_UPDATER});
        gasUsed = gasUsed.add(toBN(tx.receipt.gasUsed));
        tx = await oldFtsoRegistry.setFtsoManagerAddress(ftsoManager.address, { from: governance });
        gasUsed = gasUsed.add(toBN(tx.receipt.gasUsed));

        // upgrade
        tx = await ftsoV2Upgrader.upgrade({from: governance});
        gasUsed = gasUsed.add(toBN(tx.receipt.gasUsed));
        const registrations2 = [
            { daemonizedContract: mockInflation.address, gasLimit: 2000000 },
            { daemonizedContract: ftsoManager.address, gasLimit: 40000000 }
        ];
        tx = await flareDaemon.registerToDaemonize(registrations2, { from: governance });
        gasUsed = gasUsed.add(toBN(tx.receipt.gasUsed));
        console.log("Gas used: " + gasUsed.toString())
        expect(await ftsoV2Upgrader.upgraded()).to.equals(true);

        // Assert
        expect(await ftsoManager.governance()).to.equals(governance);
        expect(await flareDaemon.governance()).to.equals(governance);
        expect(await ftsoRegistry.governance()).to.equals(governance);
        expect(await oldFtsoRegistry.governance()).to.equals(governance);
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
        expect((await newFtso1.getAssetFtsos()).length).to.equals(3);
        expect((await newFtso1.getCurrentPrice())[0].toNumber()).to.equals(1);
        expect((await newFtso2.getCurrentPrice())[0].toNumber()).to.equals(2);

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
