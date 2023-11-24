import { FlareDaemonInstance, 
  MockContractInstance, 
  PriceSubmitterInstance} from "../../../typechain-truffle";

import {constants, time} from '@openzeppelin/test-helpers';
const getTestFile = require('../../utils/constants').getTestFile;
const GOVERNANCE_GENESIS_ADDRESS = require('../../utils/constants').GOVERNANCE_GENESIS_ADDRESS;
import { advanceBlock, encodeContractNames, waitFinalize, waitFinalize3 } from '../../utils/test-helpers';
import { spewDaemonErrors } from "../../utils/FlareDaemonTestUtils";
import { defaultPriceEpochCyclicBufferSize, FLARE_DAEMON_ADDRESS, PRICE_SUBMITTER_ADDRESS } from "../../utils/constants";
import { Contracts } from "../../../deployment/scripts/Contracts";

const BN = web3.utils.toBN;

const FlareDaemon = artifacts.require("FlareDaemon");
const PriceSubmitter = artifacts.require("PriceSubmitter");
const FtsoManager = artifacts.require("FtsoManager");
const FtsoManagement = artifacts.require("FtsoManagement");
const MockContract = artifacts.require("MockContract");


/**
 * This test assumes a local chain is running with Native allocated in accounts
 * listed in `./hardhat.config.ts`
 * It does not assume that contracts are deployed, other than the FlareDaemon, which should
 * already be loaded in the genesis block.
 */
 contract(`FtsoManager.sol; ${getTestFile(__filename)}; FtsoManager system tests`, async accounts => {
    // Static address of the daemon and price submitter on a local network
    let flareDaemon: FlareDaemonInstance;
    let priceSubmitter: PriceSubmitterInstance;

    const ADDRESS_UPDATER = accounts[16];

    // fresh contracts for each test
    let rewardManagerMock: MockContractInstance;
    let voterWhitelisterMock: MockContractInstance;
    let supplyMock: MockContractInstance;
    let cleanupBlockNumberManagerMock: MockContractInstance;
    let inflationMock: MockContractInstance;
    let ftsoRegistryMock: MockContractInstance;
    let startTs: any;


    before(async() => {
        // Defined in fba-avalanche/avalanchego/genesis/genesis_coston.go
        flareDaemon = await FlareDaemon.at(FLARE_DAEMON_ADDRESS);
        priceSubmitter = await PriceSubmitter.at(PRICE_SUBMITTER_ADDRESS);
        inflationMock = await MockContract.new();
        ftsoRegistryMock = await MockContract.new();
        // Make sure daemon is initialized with a governance address...if may revert if already done.
        try {
            await flareDaemon.initialiseFixedAddress();
            await flareDaemon.setAddressUpdater(ADDRESS_UPDATER, {from: GOVERNANCE_GENESIS_ADDRESS});
            await flareDaemon.updateContractAddresses(
              encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION]),
              [ADDRESS_UPDATER, inflationMock.address], {from: ADDRESS_UPDATER});
        } catch (e) {
            const governanceAddress = await flareDaemon.governance();
            if (GOVERNANCE_GENESIS_ADDRESS != governanceAddress) {
                throw e;
            }
            // keep going
        }
        try {
            await priceSubmitter.initialiseFixedAddress();
            await priceSubmitter.setAddressUpdater(ADDRESS_UPDATER, {from: GOVERNANCE_GENESIS_ADDRESS});
        } catch (e) {
            const governanceAddress = await priceSubmitter.governance();
            if (GOVERNANCE_GENESIS_ADDRESS != governanceAddress) {
                throw e;
            }
            // keep going
        }
        // link contracts
        FtsoManager.link(await FtsoManagement.new() as any);
    });

    beforeEach(async() => {
        rewardManagerMock = await MockContract.new();
        voterWhitelisterMock = await MockContract.new();
        supplyMock = await MockContract.new();
        cleanupBlockNumberManagerMock = await MockContract.new();
        // Force a block in order to get most up to date time
        await time.advanceBlock();
        // Get the timestamp for the just mined block
        startTs = await time.latest();
    });

    describe("daemonize", async() => {
        it("Should be daemonized by daemon", async() => {
            // Assemble
            const ftsoManager = await FtsoManager.new(
              GOVERNANCE_GENESIS_ADDRESS,
              flareDaemon.address,
              ADDRESS_UPDATER,
              constants.ZERO_ADDRESS,
              startTs,
              60,
              5,
              startTs.addn(5),
              600,
              4
            );

            await ftsoManager.updateContractAddresses(
              encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.PRICE_SUBMITTER, Contracts.FTSO_REWARD_MANAGER, Contracts.FTSO_REGISTRY, Contracts.VOTER_WHITELISTER, Contracts.SUPPLY, Contracts.CLEANUP_BLOCK_NUMBER_MANAGER]),
              [ADDRESS_UPDATER, priceSubmitter.address, rewardManagerMock.address, ftsoRegistryMock.address, voterWhitelisterMock.address, supplyMock.address, cleanupBlockNumberManagerMock.address], {from: ADDRESS_UPDATER});
        

            await ftsoManager.setGovernanceParameters(0, 10, 10, 500, 100000, 5000, 300, 0, 50000, [], {from: GOVERNANCE_GENESIS_ADDRESS});

            await priceSubmitter.updateContractAddresses(
              encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_REGISTRY, Contracts.VOTER_WHITELISTER, Contracts.FTSO_MANAGER]),
              [ADDRESS_UPDATER, ftsoRegistryMock.address, voterWhitelisterMock.address, ftsoManager.address], {from: ADDRESS_UPDATER});

            await flareDaemon.registerToDaemonize([{daemonizedContract: ftsoManager.address, gasLimit: 0}], {from: GOVERNANCE_GENESIS_ADDRESS});
            // Act
            await ftsoManager.activate({from: GOVERNANCE_GENESIS_ADDRESS});
            // Wait for some blocks to mine...
            for(let i = 0; i < 5; i++) {
              await new Promise(resolve => {
                setTimeout(resolve, 1000);
              });
              await advanceBlock();  
            }
            // Assert
            // If the daemon is calling daemonize on the RewardManager, then there should be
            // an active reward epoch.
            await spewDaemonErrors(flareDaemon);
            //assert.equal(await spewDaemonErrors(flareDaemon), 0);
            const votepowerBlock = (await ftsoManager.getRewardEpochData(0)).votepowerBlock;
            assert(votepowerBlock.toNumber() != 0);
        });
    });
});
