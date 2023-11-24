import { constants, expectEvent, expectRevert, time } from '@openzeppelin/test-helpers';
import { Contracts } from "../../../../deployment/scripts/Contracts";
import {
  CleanupBlockNumberManagerInstance,
  FtsoInstance,
  FtsoManagerInstance,
  FtsoRegistryInstance,
  FtsoRewardManagerInstance, MockContractInstance,
  MockVPTokenContract,
  MockVPTokenInstance,
  MockUpdateValidatorsInstance,
  FtsoRegistryProxyInstance
} from "../../../../typechain-truffle";
import { defaultPriceEpochCyclicBufferSize } from "../../../utils/constants";
import { createMockSupplyContract } from "../../../utils/FTSO-test-utils";
import {
  revealSomePrices,
  setDefaultGovernanceParameters,
  settingWithFourFTSOs,
  settingWithOneFTSO_1,
  settingWithTwoFTSOs,
  submitSomePrices,
  toNumberify
} from "../../../utils/FtsoManager-test-utils";
import { compareArrays, doBNListsMatch, encodeContractNames, lastOf, numberedKeyedObjectToList, toBN } from "../../../utils/test-helpers";


const getTestFile = require('../../../utils/constants').getTestFile;

const FtsoRegistry = artifacts.require("FtsoRegistry");
const FtsoRewardManager = artifacts.require("FtsoRewardManager");
const DataProviderFee = artifacts.require("DataProviderFee" as any);
const FtsoManager = artifacts.require("FtsoManager");
const FtsoManagement = artifacts.require("FtsoManagement");
const CleanupBlockNumberManager = artifacts.require("CleanupBlockNumberManager");
const Ftso = artifacts.require("Ftso");
const MockFtso = artifacts.require("MockContract");
const MockContract = artifacts.require("MockContract");
const PriceSubmitter = artifacts.require("PriceSubmitter");
const MockUpdateValidators = artifacts.require("MockUpdateValidators");
const FtsoRegistryProxy = artifacts.require("FtsoRegistryProxy");

const PRICE_EPOCH_DURATION_S = 120;   // 2 minutes
const REVEAL_EPOCH_DURATION_S = 30;
const REWARD_EPOCH_DURATION_S = 2 * 24 * 60 * 60; // 2 days
const VOTE_POWER_BOUNDARY_FRACTION = 7;

const ERR_GOVERNANCE_ONLY = "only governance"
const ERR_GOV_PARAMS_NOT_INIT_FOR_FTSOS = "Gov. params not initialized"
const ERR_XASSET_FTSO_NOT_MANAGED = "Asset FTSO not managed";
const ERR_NOT_FOUND = "FTSO index not supported";

const DAY = 60 * 60 * 24;

async function increaseTimeTo(current: BN, increase: number) {
  try {
    await time.increaseTo(current.addn(increase));
  } catch (e: any) {
    if (!(e.message.includes('Cannot increase current time') && e.message.includes('to a moment in the past'))) {
      throw e
    }
  }
}

contract(`FtsoManager.sol; ${getTestFile(__filename)}; Ftso manager unit tests`, async accounts => {
  // contains a fresh contract for each test
  let ftsoManager: FtsoManagerInstance;
  let cleanupBlockNumberManager: CleanupBlockNumberManagerInstance;
  let startTs: BN;
  let mockRewardManager: MockContractInstance;
  let ftsoRewardManagerInterface: FtsoRewardManagerInstance;
  let mockFtso: MockContractInstance;
  let ftsoInterface: FtsoInstance;
  let ftsoRegistry: FtsoRegistryInstance;
  let mockPriceSubmitter: MockContractInstance;
  let mockVoterWhitelister: MockContractInstance;
  let mockSupply: MockContractInstance;
  let mockUpdateValidator: MockContractInstance;
  let mockUpdateValidators: MockUpdateValidatorsInstance;
  let registry: FtsoRegistryInstance
  let ftsoRegistryProxy: FtsoRegistryProxyInstance;

  async function mockFtsoSymbol(symbol: string, mockContract: MockContractInstance, dummyInterface: FtsoInstance) {
    const encodedMethod = dummyInterface.contract.methods.symbol().encodeABI();
    const symbolReturn = web3.eth.abi.encodeParameter('string', symbol);
    await mockContract.givenMethodReturn(encodedMethod, symbolReturn);
  }

  const ADDRESS_UPDATER = accounts[16];
  
  before(async() => {
    FtsoManager.link(await FtsoManagement.new() as any);
    FtsoRewardManager.link(await DataProviderFee.new() as any);
  });

  beforeEach(async () => {
    mockFtso = await MockFtso.new();
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

    await mockFtsoSymbol("ATOK", mockFtso, ftsoInterface);

    // Force a block in order to get most up to date time
    await time.advanceBlock();
    // Get the timestamp for the just mined block
    startTs = await time.latest();

    mockRewardManager = await MockContract.new();
    ftsoRewardManagerInterface = await FtsoRewardManager.new(
      accounts[0],
      ADDRESS_UPDATER,
      constants.ZERO_ADDRESS,
      3,
      0
    );

    ftsoRegistry = await FtsoRegistry.new();
    ftsoRegistryProxy = await FtsoRegistryProxy.new(accounts[0], ftsoRegistry.address);
    registry = await FtsoRegistry.at(ftsoRegistryProxy.address);
    await registry.initialiseRegistry(ADDRESS_UPDATER);

    mockPriceSubmitter = await MockContract.new();
    await mockPriceSubmitter.givenMethodReturnUint(
      web3.utils.sha3("addFtso(address)")!.slice(0, 10),
      0
    )
    await mockPriceSubmitter.givenMethodReturnUint(
      web3.utils.sha3("removeFtso(address)")!.slice(0, 10),
      0
    )
    mockVoterWhitelister = await MockContract.new();

    mockSupply = await createMockSupplyContract(accounts[0], 10000);

    mockUpdateValidator = await MockContract.new();
    await mockUpdateValidator.givenMethodReturnUint(
      web3.utils.sha3("updateActiveValidators()")!.slice(0,10),
      0
    );

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

    cleanupBlockNumberManager = await CleanupBlockNumberManager.new(accounts[0], ADDRESS_UPDATER, "FtsoManager");

    await ftsoManager.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.PRICE_SUBMITTER, Contracts.FTSO_REWARD_MANAGER, Contracts.FTSO_REGISTRY, Contracts.VOTER_WHITELISTER, Contracts.SUPPLY, Contracts.CLEANUP_BLOCK_NUMBER_MANAGER]),
      [ADDRESS_UPDATER, mockPriceSubmitter.address, mockRewardManager.address, registry.address, mockVoterWhitelister.address, mockSupply.address, cleanupBlockNumberManager.address], { from: ADDRESS_UPDATER });

    await registry.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_MANAGER]),
      [ADDRESS_UPDATER, ftsoManager.address], {from: ADDRESS_UPDATER});
  });

  describe("basic", async () => {
    it("Should revert at deploy if setting invalid parameters", async () => {
      await expectRevert(FtsoManager.new(
        accounts[0],
        constants.ZERO_ADDRESS,
        ADDRESS_UPDATER,
        constants.ZERO_ADDRESS,
        startTs,
        PRICE_EPOCH_DURATION_S,
        REVEAL_EPOCH_DURATION_S,
        startTs.addn(REVEAL_EPOCH_DURATION_S),
        REWARD_EPOCH_DURATION_S,
        VOTE_POWER_BOUNDARY_FRACTION
      ), "flare daemon zero");

      await expectRevert(FtsoManager.new(
        accounts[0],
        accounts[0],
        ADDRESS_UPDATER,
        constants.ZERO_ADDRESS,
        startTs,
        0,
        REVEAL_EPOCH_DURATION_S,
        startTs.addn(REVEAL_EPOCH_DURATION_S),
        REWARD_EPOCH_DURATION_S,
        VOTE_POWER_BOUNDARY_FRACTION
      ), "Price epoch 0");

      await expectRevert(FtsoManager.new(
        accounts[0],
        accounts[0],
        ADDRESS_UPDATER,
        constants.ZERO_ADDRESS,
        startTs,
        PRICE_EPOCH_DURATION_S,
        0,
        startTs.addn(REVEAL_EPOCH_DURATION_S),
        REWARD_EPOCH_DURATION_S,
        VOTE_POWER_BOUNDARY_FRACTION
      ), "Reveal price epoch 0");

      await expectRevert(FtsoManager.new(
        accounts[0],
        accounts[0],
        ADDRESS_UPDATER,
        constants.ZERO_ADDRESS,
        startTs,
        PRICE_EPOCH_DURATION_S,
        REVEAL_EPOCH_DURATION_S,
        startTs.addn(REVEAL_EPOCH_DURATION_S),
        0,
        VOTE_POWER_BOUNDARY_FRACTION
      ), "Reward epoch 0");

      await expectRevert(FtsoManager.new(
        accounts[0],
        accounts[0],
        ADDRESS_UPDATER,
        constants.ZERO_ADDRESS,
        startTs.addn(500),
        PRICE_EPOCH_DURATION_S,
        REVEAL_EPOCH_DURATION_S,
        startTs.addn(REVEAL_EPOCH_DURATION_S),
        REWARD_EPOCH_DURATION_S,
        VOTE_POWER_BOUNDARY_FRACTION
      ), "First epoch start ts in future");

      await expectRevert(FtsoManager.new(
        accounts[0],
        accounts[0],
        ADDRESS_UPDATER,
        constants.ZERO_ADDRESS,
        startTs,
        PRICE_EPOCH_DURATION_S,
        PRICE_EPOCH_DURATION_S,
        startTs.addn(REVEAL_EPOCH_DURATION_S),
        REWARD_EPOCH_DURATION_S,
        VOTE_POWER_BOUNDARY_FRACTION
      ), "Reveal price epoch too long");

      await expectRevert(FtsoManager.new(
        accounts[0],
        accounts[0],
        ADDRESS_UPDATER,
        constants.ZERO_ADDRESS,
        startTs,
        PRICE_EPOCH_DURATION_S,
        REVEAL_EPOCH_DURATION_S,
        startTs.subn(1),
        REWARD_EPOCH_DURATION_S,
        VOTE_POWER_BOUNDARY_FRACTION
      ), "Reward epoch start too soon");

      await expectRevert(FtsoManager.new(
        accounts[0],
        accounts[0],
        ADDRESS_UPDATER,
        constants.ZERO_ADDRESS,
        startTs,
        PRICE_EPOCH_DURATION_S,
        REVEAL_EPOCH_DURATION_S,
        startTs.addn(REVEAL_EPOCH_DURATION_S + 1),
        REWARD_EPOCH_DURATION_S,
        VOTE_POWER_BOUNDARY_FRACTION
      ), "Reward epoch start condition invalid");

      await expectRevert(FtsoManager.new(
        accounts[0],
        accounts[0],
        ADDRESS_UPDATER,
        constants.ZERO_ADDRESS,
        startTs,
        PRICE_EPOCH_DURATION_S,
        REVEAL_EPOCH_DURATION_S,
        startTs.addn(REVEAL_EPOCH_DURATION_S),
        REWARD_EPOCH_DURATION_S + 1,
        VOTE_POWER_BOUNDARY_FRACTION
      ), "Reward epoch duration condition invalid");

      await expectRevert(FtsoManager.new(
        accounts[0],
        accounts[0],
        ADDRESS_UPDATER,
        constants.ZERO_ADDRESS,
        startTs,
        PRICE_EPOCH_DURATION_S,
        REVEAL_EPOCH_DURATION_S,
        startTs.addn(REVEAL_EPOCH_DURATION_S),
        REWARD_EPOCH_DURATION_S,
        0
      ), "Vote power interval fraction 0");
    });

    it("Should return contract name", async () => {
      expect(await ftsoManager.getContractName()).to.equals(Contracts.FTSO_MANAGER);
    });

    it("Should return current price epoch id", async () => {
      expect((await ftsoManager.getCurrentPriceEpochId()).toNumber()).to.equals(0);

      await increaseTimeTo(startTs, PRICE_EPOCH_DURATION_S);
      expect((await ftsoManager.getCurrentPriceEpochId()).toNumber()).to.equals(1);
    });

    it("Should return price submitter address", async () => {
      expect(await ftsoManager.priceSubmitter()).to.equals(mockPriceSubmitter.address);
      expect(await ftsoManager.getPriceSubmitter()).to.equals(mockPriceSubmitter.address);
    });

    it("Should return vote power interval fraction", async () => {
      expect((await ftsoManager.getVotePowerIntervalFraction()).toNumber()).to.equals(VOTE_POWER_BOUNDARY_FRACTION);
    });

    it("Should return true when calling daemonize and ftso manager is active", async () => {
      await ftsoManager.activate();
      expect(await ftsoManager.daemonize.call()).to.equals(true);
    });

    it("Should return false when calling daemonize and ftso manager not active", async () => {
      expect(await ftsoManager.daemonize.call()).to.equals(false);
    });

    it("Should revert calling daemonize if not from flare daemon", async () => {
      await ftsoManager.activate();
      await expectRevert(ftsoManager.daemonize({ from: accounts[1] }), "only flare daemon");
    });

    it("Should get current price epoch data", async () => {
      let epochId = Math.floor(((await time.latest()).toNumber() - startTs.toNumber()) / PRICE_EPOCH_DURATION_S);
      let data = await ftsoManager.getCurrentPriceEpochData();
      expect(data[0].toNumber()).to.equals(epochId);
      let startTime = startTs.toNumber() + epochId * PRICE_EPOCH_DURATION_S;
      expect(data[1].toNumber()).to.equals(startTime);
      expect(data[2].toNumber()).to.equals(startTime + PRICE_EPOCH_DURATION_S);
      expect(data[3].toNumber()).to.equals(startTime + PRICE_EPOCH_DURATION_S + REVEAL_EPOCH_DURATION_S);

      await increaseTimeTo(startTs, PRICE_EPOCH_DURATION_S);
      epochId++;

      data = await ftsoManager.getCurrentPriceEpochData();
      expect(data[0].toNumber()).to.equals(epochId);
      startTime = startTs.toNumber() + epochId * PRICE_EPOCH_DURATION_S;
      expect(data[1].toNumber()).to.equals(startTime);
      expect(data[2].toNumber()).to.equals(startTime + PRICE_EPOCH_DURATION_S);
      expect(data[3].toNumber()).to.equals(startTime + PRICE_EPOCH_DURATION_S + REVEAL_EPOCH_DURATION_S);
    });

    it("Should get current reward epoch", async () => {
      await expectRevert(ftsoManager.getCurrentRewardEpoch(), "Reward epoch not initialized yet");

      await ftsoManager.activate();
      await increaseTimeTo(startTs, REVEAL_EPOCH_DURATION_S);
      await ftsoManager.daemonize(); // initalize reward epoch
      expect((await ftsoManager.getCurrentRewardEpoch()).toNumber()).to.equals(0);

      await increaseTimeTo(startTs, REVEAL_EPOCH_DURATION_S + REWARD_EPOCH_DURATION_S);
      await ftsoManager.daemonize();

      expect((await ftsoManager.getCurrentRewardEpoch()).toNumber()).to.equals(1);
    });

    it("Should get reward epoch data", async () => {
      await expectRevert(ftsoManager.getRewardEpochData(0), "Reward epoch not initialized yet");
      await expectRevert(ftsoManager.rewardEpochs(0), "Reward epoch not initialized yet");

      await ftsoManager.activate();
      await increaseTimeTo(startTs, REVEAL_EPOCH_DURATION_S);
      await ftsoManager.daemonize(); // initalize reward epoch

      let block = await web3.eth.getBlockNumber();

      const rewardEpochData = await ftsoManager.getRewardEpochData(0);
      expect(rewardEpochData.votepowerBlock.toString()).to.equals((block - 1).toString());
      expect(rewardEpochData.startBlock.toString()).to.equals(block.toString());
      expect(rewardEpochData.startTimestamp.toString()).to.equals((await web3.eth.getBlock(block)).timestamp.toString());

      const rewardEpochs = await ftsoManager.rewardEpochs(0);
      expect(rewardEpochs[0].toString()).to.equals((block - 1).toString());
      expect(rewardEpochs[1].toString()).to.equals(block.toString());
      expect(rewardEpochs[2].toString()).to.equals((await web3.eth.getBlock(block)).timestamp.toString());
    });

    it("Should get reward epoch vote power block", async () => {
      await ftsoManager.activate();
      await increaseTimeTo(startTs, REVEAL_EPOCH_DURATION_S);
      await ftsoManager.daemonize();

      let block = await web3.eth.getBlockNumber();

      expect((await ftsoManager.getRewardEpochVotePowerBlock(0)).toNumber()).to.equals(block - 1);
    });

    it("Should switch use good random flag", async () => {
      // Assemble
      // Act
      await ftsoManager.setUseGoodRandom(true, 1);
      // Assert
      assert.isTrue(await ftsoManager.useGoodRandom());
      assert.equal((await ftsoManager.maxWaitForGoodRandomSeconds()).toNumber(), 1);
    });

    it("Should switch use good random flag 2", async () => {
      // Assemble
      await ftsoManager.setUseGoodRandom(true, 1);
      // Act
      await ftsoManager.setUseGoodRandom(false, 0);
      // Assert
      assert.isFalse(await ftsoManager.useGoodRandom());
      assert.equal((await ftsoManager.maxWaitForGoodRandomSeconds()).toNumber(), 0);
    });

    it("Should revert switch to good random if invalid parameters", async () => {
      // Assemble
      // Act
      // Assert
      await expectRevert(ftsoManager.setUseGoodRandom(true, 0), "invalid parameters");
      await expectRevert(ftsoManager.setUseGoodRandom(true, 3 * 24 * 3600 + 1), "invalid parameters"); // 3 days max
      await expectRevert(ftsoManager.setUseGoodRandom(false, 1), "invalid parameters");
    });

    it("Should not switch to good random if not from governance", async () => {
      // Assemble
      // Act
      const setUseGoodRandomPromise = ftsoManager.setUseGoodRandom(true, 1, {from: accounts[2]});
      // Assert
      await expectRevert(setUseGoodRandomPromise, "only governance");
      assert.isFalse(await ftsoManager.useGoodRandom());
    });

    it("Should not update timestamp to some past ts", async () => {
      await expectRevert(ftsoManager.setGovernanceParameters(1, 5, 5, 50, 500, 500, 5000, 0, 10 * DAY, []), "invalid update ts");
    });

    it("Should set update timestamp", async () => {
      const updateTs = (await time.latest()).toNumber() + 500;
      await ftsoManager.setGovernanceParameters(updateTs, 5, 5, 50, 500, 500, 5000, 0, 10 * DAY, []);
      expect((await ftsoManager.getUpdateGovernanceParametersTs()).toNumber()).to.equals(updateTs);
    });

    it("Should set update timestamp 2", async () => {
      const updateTs = (await time.latest()).toNumber() + 600;
      await ftsoManager.setElasticBandWidthPPMFtsos(updateTs, [], []);
      expect((await ftsoManager.getUpdateGovernanceParametersTs()).toNumber()).to.equals(updateTs);
    });

    it("Should not set governance parameters if not from governance", async () => {
      await expectRevert(ftsoManager.setGovernanceParameters(0, 5, 5, 50, 500, 500, 5000, 0, 10 * DAY, [], { from: accounts[2] }), "only governance");
    });

    it("Should revert setting invalid governance parameters", async () => {
      await expectRevert(ftsoManager.setGovernanceParameters(0, 0, 5, 50, 500, 500, 5000, 0, 10 * DAY, []), "Gov. params invalid");
      await expectRevert(ftsoManager.setGovernanceParameters(0, 5, 0, 50, 500, 500, 5000, 0, 10 * DAY, []), "Gov. params invalid");
      await expectRevert(ftsoManager.setGovernanceParameters(0, 5, 5, 500, 50, 500, 5000, 0, 10 * DAY, []), "Gov. params invalid");
      await expectRevert(ftsoManager.setGovernanceParameters(0, 5, 5, 50, 500, 50000, 5000, 0, 10 * DAY, []), "Gov. params invalid");
      await expectRevert(ftsoManager.setGovernanceParameters(0, 5, 5, 50, 500, 500, 50000, 0, 10 * DAY, []), "Gov. params invalid");
      await expectRevert(ftsoManager.setGovernanceParameters(0, 5, 5, 50, 500, 500, 5000, 0, 0, []), "Gov. params invalid");
      await expectRevert(ftsoManager.setGovernanceParameters(0, 5, 5, 50, 500, 500, 5000, 0, 10 * DAY, [accounts[0], accounts[1], accounts[2], accounts[3], accounts[4], accounts[5]]), "Gov. params invalid");
      await expectRevert(ftsoManager.setGovernanceParameters(0, 5, 5, 50, 500, 500, 5000, 10001, 10 * DAY, []), "Gov. params invalid");
    });

    it("Should set votePowerIntervalFraction", async () => {
      expect((await ftsoManager.getVotePowerIntervalFraction()).toNumber()).to.equals(VOTE_POWER_BOUNDARY_FRACTION);
      await ftsoManager.setVotePowerIntervalFraction(VOTE_POWER_BOUNDARY_FRACTION + 3);
      expect((await ftsoManager.getVotePowerIntervalFraction()).toNumber()).to.equals(VOTE_POWER_BOUNDARY_FRACTION + 3);
    });

    it("Should revert setting votePowerIntervalFraction to 0", async () => {
      await ftsoManager.setVotePowerIntervalFraction(VOTE_POWER_BOUNDARY_FRACTION + 3);
      await expectRevert(ftsoManager.setVotePowerIntervalFraction(0), "Vote power interval fraction 0");
    });

    it("Should not set votePowerIntervalFraction if not from governance", async () => {
      await expectRevert(ftsoManager.setVotePowerIntervalFraction(1, { from: accounts[2] }), "only governance");
    });

    it("Should set rewardEpochDurationSeconds", async () => {
      expect((await ftsoManager.getRewardEpochConfiguration())[1].toNumber()).to.equals(REWARD_EPOCH_DURATION_S);
      await ftsoManager.setRewardEpochDurationSeconds(REWARD_EPOCH_DURATION_S + PRICE_EPOCH_DURATION_S);
      expect((await ftsoManager.getRewardEpochConfiguration())[1].toNumber()).to.equals(REWARD_EPOCH_DURATION_S + PRICE_EPOCH_DURATION_S);
    });

    it("Should revert setting rewardEpochDurationSeconds to 0", async () => {
      await ftsoManager.setRewardEpochDurationSeconds(REWARD_EPOCH_DURATION_S + PRICE_EPOCH_DURATION_S);
      await expectRevert(ftsoManager.setRewardEpochDurationSeconds(0), "Reward epoch 0");
    });

    it("Should revert setting rewardEpochDurationSeconds if not multiple of price epoch duration", async () => {
      await ftsoManager.setRewardEpochDurationSeconds(10 * PRICE_EPOCH_DURATION_S);
      await expectRevert(ftsoManager.setRewardEpochDurationSeconds(10 * PRICE_EPOCH_DURATION_S + 1), "Reward epoch duration condition invalid");
    });

    it("Should not set rewardEpochDurationSeconds if not from governance", async () => {
      await expectRevert(ftsoManager.setRewardEpochDurationSeconds(1, { from: accounts[2] }), "only governance");
    });

    it("Should activate", async () => {
      await ftsoManager.activate();
    });

    it("Should not activate if not from governance", async () => {
      await expectRevert(ftsoManager.activate({ from: accounts[2] }), "only governance");
    });

    it("Should init price epoch start and not finalize anything", async () => {
      // Assemble
      await ftsoManager.activate();
      // Act
      await increaseTimeTo(startTs, REVEAL_EPOCH_DURATION_S);
      let tx = await ftsoManager.daemonize();
      // Assert
      let data = await ftsoManager.getPriceEpochConfiguration() as any;
      assert(startTs.eq(data._firstPriceEpochStartTs));
      expectEvent.notEmitted(tx, "PriceEpochFinalized");
      expectEvent.notEmitted(tx, "RewardEpochFinalized");
    });

    it("Should get governance parameters", async () => {
      let paramList = [1, 1 + 2, 1000, 10001, 50, 1500, 0, 10 * DAY];
      let paramListBN = paramList.map(x => toBN(x));
      let trustedAddresses = [accounts[6], accounts[7]];
      await (ftsoManager.setGovernanceParameters as any)(0, ...paramListBN, trustedAddresses);

      let govPar = await ftsoManager.getGovernanceParameters();
      expect(govPar[0].toNumber()).to.equals(paramListBN[0].toNumber());
      expect(govPar[1].toNumber()).to.equals(paramListBN[1].toNumber());
      expect(govPar[2].toNumber()).to.equals(paramListBN[2].toNumber());
      expect(govPar[3].toNumber()).to.equals(paramListBN[3].toNumber());
      expect(govPar[4].toNumber()).to.equals(paramListBN[4].toNumber());
      expect(govPar[5].toNumber()).to.equals(paramListBN[5].toNumber());
      expect(govPar[6].toNumber()).to.equals(paramListBN[6].toNumber());
      expect(govPar[7].toNumber()).to.equals(paramListBN[7].toNumber());
      expect(govPar[8][0]).to.equals(trustedAddresses[0]);
      expect(govPar[8][1]).to.equals(trustedAddresses[1]);
      assert(govPar[9]);
      assert(govPar[10]);

      expect((await ftsoManager.getRewardExpiryOffsetSeconds()).toNumber()).to.equals(paramListBN[7].toNumber());

      // changed = false; daemonize
      await ftsoManager.activate();
      await increaseTimeTo(startTs, REVEAL_EPOCH_DURATION_S);
      await ftsoManager.daemonize(); // _initializeFirstRewardEpoch
      await ftsoManager.daemonize();
      govPar = await ftsoManager.getGovernanceParameters();
      assert(!govPar[10]);
    });

    it("Should set governance parameters", async() => {
      await ftsoManager.setGovernanceParameters(0, 1, 5, 50, 500, 500, 500, 0, 10 * DAY, [accounts[1], accounts[2]]);
      await ftsoManager.setGovernanceParameters(0, 5, 5, 60, 500, 600, 5000, 10, 11 * DAY, [accounts[1], accounts[2]]);
    });
  });

  describe("FTSO initialization", async () => {
    it("Should successfully add an FTSO", async () => {
      // Assemble
      // Act
      await setDefaultGovernanceParameters(ftsoManager);
      let tx = await ftsoManager.addFtso(mockFtso.address);
      // Assert
      expectEvent(tx, "FtsoAdded", { ftso: mockFtso.address, add: true });
      assert.equal(mockFtso.address, (await ftsoManager.getFtsos())[0]);

      const activate = web3.utils.sha3("activateFtso(uint256,uint256,uint256)")!.slice(0, 10); // first 4 bytes is function selector
      const invocationCount = await mockFtso.invocationCountForMethod.call(activate);
      assert.equal(invocationCount.toNumber(), 1);

      const configureEpochs = web3.utils.sha3("configureEpochs(uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,address[])")!.slice(0, 10); // first 4 bytes is function selector
      const invocationCount2 = await mockFtso.invocationCountForMethod.call(configureEpochs);
      assert.equal(invocationCount2.toNumber(), 1);

      const addFtsoVoterWhitelister = web3.utils.sha3("addFtso(uint256)")!.slice(0, 10); // first 4 bytes is function selector
      const voterWhitelisterInvocationCount = await mockVoterWhitelister.invocationCountForMethod.call(addFtsoVoterWhitelister);
      // should add new ftso to VoterWhitelister
      assert.equal(voterWhitelisterInvocationCount.toNumber(), 1);
    });

    it("Should not add an FTSO twice", async () => {
      // Assemble
      // Act
      await setDefaultGovernanceParameters(ftsoManager);
      let tx = await ftsoManager.addFtso(mockFtso.address);
      // Assert
      expectEvent(tx, "FtsoAdded", { ftso: mockFtso.address, add: true });
      assert.equal(mockFtso.address, (await ftsoManager.getFtsos())[0]);

      await expectRevert(ftsoManager.addFtso(mockFtso.address), "Already added");
    });

    it("Should revert adding an FTSO until governance settings can be updated on ftsos", async () => {
      // Assemble
      const updateTs = (await time.latest()).toNumber() + 500;
      await ftsoManager.setGovernanceParameters(updateTs, 5, 5, 50, 500, 500, 5000, 0, 10 * DAY, []);
      // Act
      // Assert
      await expectRevert(ftsoManager.addFtso(mockFtso.address), "Gov. params updated");
      await time.increase(500);
      let tx = await ftsoManager.addFtso(mockFtso.address);
      expectEvent(tx, "FtsoAdded", { ftso: mockFtso.address, add: true });
      assert.equal(mockFtso.address, (await ftsoManager.getFtsos())[0]);
    });

    it("Should initialize reward epoch only after reward epoch start timestamp", async () => {
      mockPriceSubmitter = await MockContract.new();
      await mockPriceSubmitter.givenMethodReturnUint(
        web3.utils.sha3("addFtso(address)")!.slice(0, 10),
        0
      )

      ftsoManager = await FtsoManager.new(
        accounts[0],
        accounts[0],
        ADDRESS_UPDATER,
        constants.ZERO_ADDRESS,
        startTs,
        PRICE_EPOCH_DURATION_S,
        REVEAL_EPOCH_DURATION_S,
        startTs.addn(PRICE_EPOCH_DURATION_S * 5 + REVEAL_EPOCH_DURATION_S),
        REWARD_EPOCH_DURATION_S,
        VOTE_POWER_BOUNDARY_FRACTION
      );

      await ftsoManager.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.PRICE_SUBMITTER, Contracts.FTSO_REWARD_MANAGER, Contracts.FTSO_REGISTRY, Contracts.VOTER_WHITELISTER, Contracts.SUPPLY, Contracts.CLEANUP_BLOCK_NUMBER_MANAGER]),
        [ADDRESS_UPDATER, mockPriceSubmitter.address, mockRewardManager.address, registry.address, mockVoterWhitelister.address, mockSupply.address, cleanupBlockNumberManager.address], { from: ADDRESS_UPDATER });

        await registry.updateContractAddresses(
          encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_MANAGER]),
          [ADDRESS_UPDATER, ftsoManager.address], {from: ADDRESS_UPDATER});

      // stub finalizer
      const finalizePriceEpoch = ftsoInterface.contract.methods.finalizePriceEpoch(0, true).encodeABI();
      const finalizePriceEpochReturn = web3.eth.abi.encodeParameters(
        ['address[]', 'uint256[]', 'uint256'],
        [[], [], '0']);
      await mockFtso.givenMethodReturn(finalizePriceEpoch, finalizePriceEpochReturn);

      await setDefaultGovernanceParameters(ftsoManager);
      // add fakey ftso
      await ftsoManager.addFtso(mockFtso.address, { from: accounts[0] });
      await ftsoManager.activate();
      await ftsoManager.daemonize();

      // Get the invocation count for setting new vote power block on mocked FTSO
      const setVotePowerBlock = web3.utils.sha3("setVotePowerBlock(uint256)")!.slice(0, 10); // first 4 bytes is function selector
      // Act
      for (let i = 1; i < 10; i++) {
        // Time travel to trigger a first initialize reward epoch
        // Cheat and do every 50 seconds to reduce test time
        await increaseTimeTo(startTs, 60 * i);
        // Mine at least a block
        await time.advanceBlock();
        await ftsoManager.daemonize();
        const invocationCount = await mockFtso.invocationCountForMethod.call(setVotePowerBlock);
        assert.equal(invocationCount.toNumber(), 0);
      }

      // Assert
      await increaseTimeTo(startTs, PRICE_EPOCH_DURATION_S * 5 + REVEAL_EPOCH_DURATION_S);
      await time.advanceBlock();
      await ftsoManager.daemonize();
      const invocationCount = await mockFtso.invocationCountForMethod.call(setVotePowerBlock);
      // Should be 1 invocation during initializing first reward epoch - for 1 FTSO
      assert.equal(invocationCount.toNumber(), 1);
    });

    it("Should successfully add an FTSO even if ftso manager is active", async () => {
      // Assemble
      await ftsoManager.activate();
      await increaseTimeTo(startTs, REVEAL_EPOCH_DURATION_S);
      await ftsoManager.daemonize();
      await setDefaultGovernanceParameters(ftsoManager);

      // Act
      let tx = await ftsoManager.addFtso(mockFtso.address);

      // Assert
      expectEvent(tx, "FtsoAdded", { ftso: mockFtso.address, add: true });
      assert.equal(mockFtso.address, (await ftsoManager.getFtsos())[0]);

      const activate = web3.utils.sha3("activateFtso(uint256,uint256,uint256)")!.slice(0, 10); // first 4 bytes is function selector
      const invocationCount = await mockFtso.invocationCountForMethod.call(activate);
      assert.equal(invocationCount.toNumber(), 1);

      const configureEpochs = web3.utils.sha3("configureEpochs(uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,address[])")!.slice(0, 10); // first 4 bytes is function selector
      const invocationCount2 = await mockFtso.invocationCountForMethod.call(configureEpochs);
      assert.equal(invocationCount2.toNumber(), 1);

      const setVotePowerBlock = web3.utils.sha3("setVotePowerBlock(uint256)")!.slice(0, 10); // first 4 bytes is function selector
      const invocationCount3 = await mockFtso.invocationCountForMethod.call(setVotePowerBlock);
      assert.equal(invocationCount3.toNumber(), 1);
    });

    it("Should not add an FTSO if not from governance", async () => {
      // Assemble
      await setDefaultGovernanceParameters(ftsoManager);
      // Act
      let addPromise = ftsoManager.addFtso(mockFtso.address, { from: accounts[1] });
      // Assert
      await expectRevert(addPromise, ERR_GOVERNANCE_ONLY);
    });

    it("Should successfully remove an FTSO", async () => {
      // Assemble
      await setDefaultGovernanceParameters(ftsoManager);
      let tx = await ftsoManager.addFtso(mockFtso.address);
      expectEvent(tx, "FtsoAdded", { ftso: mockFtso.address, add: true });
      assert.equal(mockFtso.address, (await ftsoManager.getFtsos())[0]);
      const ftsoManagerFunction = web3.utils.sha3("ftsoManager()")!.slice(0, 10); // first 4 bytes is function selector
      await mockFtso.givenMethodReturnAddress(ftsoManagerFunction, ftsoManager.address);

      // Act
      let tx2 = await ftsoManager.removeFtso(mockFtso.address);

      // Assert
      expectEvent(tx2, "FtsoAdded", { ftso: mockFtso.address, add: false });
      assert.equal((await ftsoManager.getFtsos()).length, 0);
      const deactivate = web3.utils.sha3("deactivateFtso()")!.slice(0, 10); // first 4 bytes is function selector
      const invocationCount = await mockFtso.invocationCountForMethod.call(deactivate);
      assert.equal(invocationCount.toNumber(), 1);
    });

    it("Should revert at removing an FTSO if not managed", async () => {
      // Assemble
      await setDefaultGovernanceParameters(ftsoManager);

      // Act
      let removePromise = ftsoManager.removeFtso(mockFtso.address);

      // Assert
      await expectRevert(removePromise, ERR_NOT_FOUND);
    });

    it("Should not remove an FTSO if not from governance", async () => {
      // Assemble
      await setDefaultGovernanceParameters(ftsoManager);
      let tx = await ftsoManager.addFtso(mockFtso.address);
      expectEvent(tx, "FtsoAdded", { ftso: mockFtso.address, add: true });
      assert.equal(mockFtso.address, (await ftsoManager.getFtsos())[0]);

      // Act
      let removePromise = ftsoManager.removeFtso(mockFtso.address, { from: accounts[1] });

      // Assert
      await expectRevert(removePromise, ERR_GOVERNANCE_ONLY);
    });

    it("Should successfully replace an FTSO and not update initial price", async () => {
      // Assemble
      await setDefaultGovernanceParameters(ftsoManager);
      await ftsoManager.addFtso(mockFtso.address);
      let mockFtso2 = await MockFtso.new();

      const symbol = ftsoInterface.contract.methods.symbol().encodeABI();
      const symbolReturn = web3.eth.abi.encodeParameter('string', 'ATOK');
      await mockFtso.givenMethodReturn(symbol, symbolReturn);
      await mockFtso2.givenMethodReturn(symbol, symbolReturn);

      const currentPrice = ftsoInterface.contract.methods.getCurrentPrice().encodeABI();
      const currentPriceReturn = web3.eth.abi.encodeParameters(['uint256', 'uint256'], [500, 1]);
      await mockFtso.givenMethodReturn(currentPrice, currentPriceReturn);

      let addFtsoVoterWhitelister = web3.utils.sha3("addFtso(uint256)")!.slice(0, 10); // first 4 bytes is function selector
      let voterWhitelisterInvocationCount = await mockVoterWhitelister.invocationCountForMethod.call(addFtsoVoterWhitelister);
      // should add new ftso to VoterWhitelister
      assert.equal(voterWhitelisterInvocationCount.toNumber(), 1);

      let maxVotersForFtsoVoterWhitelister = web3.utils.sha3("maxVotersForFtso(uint256)")!.slice(0, 10); // first 4 bytes is function selector
      await mockVoterWhitelister.givenMethodReturnUint(maxVotersForFtsoVoterWhitelister, 100);
      
      // Act
      let tx = await ftsoManager.replaceFtso(mockFtso2.address, false, false);

      // Assert
      expectEvent(tx, "FtsoAdded", { ftso: mockFtso.address, add: false });
      expectEvent(tx, "FtsoAdded", { ftso: mockFtso2.address, add: true });
      assert.equal((await ftsoManager.getFtsos()).length, 1);

      const updateInitialPrice = web3.utils.sha3("updateInitialPrice(uint256,uint256)")!.slice(0, 10); // first 4 bytes is function selector
      const invocationCount = await mockFtso.invocationCountForMethod.call(updateInitialPrice);
      assert.equal(invocationCount.toNumber(), 0);

      addFtsoVoterWhitelister = web3.utils.sha3("addFtso(uint256)")!.slice(0, 10); // first 4 bytes is function selector
      voterWhitelisterInvocationCount = await mockVoterWhitelister.invocationCountForMethod.call(addFtsoVoterWhitelister);
      // should not add new ftso to VoterWhitelister
      assert.equal(voterWhitelisterInvocationCount.toNumber(), 1);
    });

    it("Should successfully replace an FTSO and update initial price", async () => {
      // Assemble
      await setDefaultGovernanceParameters(ftsoManager);
      await ftsoManager.addFtso(mockFtso.address);
      let mockFtso2 = await MockFtso.new();

      await mockFtsoSymbol("ATOK", mockFtso, ftsoInterface);
      await mockFtsoSymbol("ATOK", mockFtso2, ftsoInterface);

      const currentPrice = ftsoInterface.contract.methods.getCurrentPrice().encodeABI();
      const currentPriceReturn = web3.eth.abi.encodeParameters(['uint256', 'uint256'], [500, 1]);
      await mockFtso.givenMethodReturn(currentPrice, currentPriceReturn);

      // Act
      let tx = await ftsoManager.replaceFtso(mockFtso2.address, true, false);

      // Assert
      expectEvent(tx, "FtsoAdded", { ftso: mockFtso.address, add: false });
      expectEvent(tx, "FtsoAdded", { ftso: mockFtso2.address, add: true });
      assert.equal((await ftsoManager.getFtsos()).length, 1);

      const updateInitialPrice = ftsoInterface.contract.methods.updateInitialPrice(500, 1).encodeABI();
      const invocationCount = await mockFtso2.invocationCountForCalldata.call(updateInitialPrice);
      assert.equal(invocationCount.toNumber(), 1);
    });

    it("Should successfully replace an FTSO", async () => {
      // Assemble
      await setDefaultGovernanceParameters(ftsoManager);
      await ftsoManager.addFtso(mockFtso.address);
      let mockFtso2 = await MockFtso.new();

      const symbol = ftsoInterface.contract.methods.symbol().encodeABI();
      const symbolReturn = web3.eth.abi.encodeParameter('string', 'ATOK');
      await mockFtso.givenMethodReturn(symbol, symbolReturn);
      await mockFtso2.givenMethodReturn(symbol, symbolReturn);

      // Act
      let tx = await ftsoManager.replaceFtso(mockFtso2.address, false, true);

      // Assert
      expectEvent(tx, "FtsoAdded", { ftso: mockFtso.address, add: false });
      expectEvent(tx, "FtsoAdded", { ftso: mockFtso2.address, add: true });
      assert.equal((await ftsoManager.getFtsos()).length, 1);

      const setAsset = ftsoInterface.contract.methods.setAsset(accounts[5]).encodeABI();
      const invocationCount = await mockFtso2.invocationCountForMethod.call(setAsset);
      assert.equal(invocationCount.toNumber(), 0);

      const setAssetFtsos = ftsoInterface.contract.methods.setAssetFtsos([accounts[5], accounts[6]]).encodeABI();
      const invocationCount2 = await mockFtso2.invocationCountForMethod.call(setAssetFtsos);
      assert.equal(invocationCount2.toNumber(), 0);
    });

    it("Should successfully replace an FTSO and update asset", async () => {
      // Assemble
      await setDefaultGovernanceParameters(ftsoManager);
      await ftsoManager.addFtso(mockFtso.address);
      let mockFtso2 = await MockFtso.new();

      const symbol = ftsoInterface.contract.methods.symbol().encodeABI();
      const symbolReturn = web3.eth.abi.encodeParameter('string', 'ATOK');
      await mockFtso.givenMethodReturn(symbol, symbolReturn);
      await mockFtso2.givenMethodReturn(symbol, symbolReturn);

      const asset = ftsoInterface.contract.methods.getAsset().encodeABI();
      const assetReturn = web3.eth.abi.encodeParameter('address', accounts[5]);
      await mockFtso.givenMethodReturn(asset, assetReturn);

      // Act
      let tx = await ftsoManager.replaceFtso(mockFtso2.address, false, true);

      // Assert
      expectEvent(tx, "FtsoAdded", { ftso: mockFtso.address, add: false });
      expectEvent(tx, "FtsoAdded", { ftso: mockFtso2.address, add: true });
      assert.equal((await ftsoManager.getFtsos()).length, 1);

      const setAsset = ftsoInterface.contract.methods.setAsset(accounts[5]).encodeABI();
      const invocationCount = await mockFtso2.invocationCountForCalldata.call(setAsset);
      assert.equal(invocationCount.toNumber(), 1);
    });

    it("Should successfully replace an FTSO and update asset ftsos", async () => {
      // Assemble
      await setDefaultGovernanceParameters(ftsoManager);
      let mockAssetFtso1 = await MockFtso.new();
      let mockAssetFtso2 = await MockFtso.new();
      await mockFtsoSymbol("ATOK1", mockAssetFtso1, ftsoInterface);
      await mockFtsoSymbol("ATOK2", mockAssetFtso2, ftsoInterface);
      await ftsoManager.addFtso(mockFtso.address);
      await ftsoManager.addFtso(mockAssetFtso1.address);
      await ftsoManager.addFtso(mockAssetFtso2.address);
      let mockFtso2 = await MockFtso.new();

      const symbol = ftsoInterface.contract.methods.symbol().encodeABI();
      const symbolReturn = web3.eth.abi.encodeParameter('string', 'ATOK');
      await mockFtso.givenMethodReturn(symbol, symbolReturn);
      await mockFtso2.givenMethodReturn(symbol, symbolReturn);

      const assetFtsos = ftsoInterface.contract.methods.getAssetFtsos().encodeABI();
      const assetFtsosReturn = web3.eth.abi.encodeParameter('address[]', [mockAssetFtso1.address, mockAssetFtso2.address]);
      await mockFtso.givenMethodReturn(assetFtsos, assetFtsosReturn);
      await mockFtso2.givenMethodReturn(assetFtsos, assetFtsosReturn);

      // Act
      let tx = await ftsoManager.replaceFtso(mockFtso2.address, false, true);

      // Assert
      expectEvent(tx, "FtsoAdded", { ftso: mockFtso.address, add: false });
      expectEvent(tx, "FtsoAdded", { ftso: mockFtso2.address, add: true });
      assert.equal((await ftsoManager.getFtsos()).length, 3);

      const setAssetFtsos = ftsoInterface.contract.methods.setAssetFtsos([mockAssetFtso1.address, mockAssetFtso2.address]).encodeABI();
      const invocationCount = await mockFtso2.invocationCountForCalldata.call(setAssetFtsos);
      assert.equal(invocationCount.toNumber(), 1);
    });

    it("Should successfully replace an FTSO and change asset ftso", async () => {
      // Assemble
      await setDefaultGovernanceParameters(ftsoManager);
      let multiFtso = await Ftso.new('NAT', 5, mockPriceSubmitter.address, constants.ZERO_ADDRESS, ftsoManager.address,
        startTs, PRICE_EPOCH_DURATION_S, REVEAL_EPOCH_DURATION_S, 0, 1e10, defaultPriceEpochCyclicBufferSize);
      await ftsoManager.addFtso(multiFtso.address);
      await ftsoManager.addFtso(mockFtso.address);
      await ftsoManager.setFtsoAssetFtsos(multiFtso.address, [mockFtso.address]);
      let mockFtso2 = await MockFtso.new();

      await mockFtsoSymbol("ATOK", mockFtso, ftsoInterface);
      await mockFtsoSymbol("ATOK", mockFtso2, ftsoInterface);

      // Act
      let tx = await ftsoManager.replaceFtso(mockFtso2.address, false, false);

      // // Assert
      expectEvent(tx, "FtsoAdded", { ftso: mockFtso.address, add: false });
      expectEvent(tx, "FtsoAdded", { ftso: mockFtso2.address, add: true });
      assert.equal((await ftsoManager.getFtsos()).length, 2);

      assert.equal((await multiFtso.getAssetFtsos())[0], mockFtso2.address);
    });

    it("Should revert at replacing an FTSO if symbol does not exist", async () => {
      // Assemble
      await setDefaultGovernanceParameters(ftsoManager);
      await ftsoManager.addFtso(mockFtso.address);
      let mockFtso2 = await MockFtso.new();

      const symbol = ftsoInterface.contract.methods.symbol().encodeABI();
      const symbolReturn = web3.eth.abi.encodeParameter('string', 'ATOK');
      const symbolReturn2 = web3.eth.abi.encodeParameter('string', 'ATOK2');
      await mockFtso.givenMethodReturn(symbol, symbolReturn);
      await mockFtso2.givenMethodReturn(symbol, symbolReturn2);

      // Act
      let replacePromise = ftsoManager.replaceFtso(mockFtso2.address, false, false);

      // Assert
      await expectRevert(replacePromise, ERR_NOT_FOUND);
    });

    it("Should revert at replacing an FTSO if not managed", async () => {
      // Assemble
      await setDefaultGovernanceParameters(ftsoManager);
      let mockFtso2 = await MockFtso.new();

      await mockFtsoSymbol("ATOK", mockFtso, ftsoInterface);
      await mockFtsoSymbol("ATOK", mockFtso2, ftsoInterface);

      // Act
      let replacePromise = ftsoManager.replaceFtso(mockFtso2.address, false, false);

      // Assert
      await expectRevert(replacePromise, ERR_NOT_FOUND);
    });

    it("Should not remove an FTSO if not from governance", async () => {
      // Assemble
      await setDefaultGovernanceParameters(ftsoManager);
      await ftsoManager.addFtso(mockFtso.address);
      let mockFtso2 = await MockFtso.new();

      const symbol = ftsoInterface.contract.methods.symbol().encodeABI();
      const symbolReturn = web3.eth.abi.encodeParameter('string', 'ATOK');
      await mockFtso.givenMethodReturn(symbol, symbolReturn);
      await mockFtso2.givenMethodReturn(symbol, symbolReturn);

      // Act
      let removePromise = ftsoManager.removeFtso(mockFtso.address, { from: accounts[1] });

      // Assert
      await expectRevert(removePromise, ERR_GOVERNANCE_ONLY);
    });

    it("Should not add FTSO if initial governance parameters not set", async () => {
      let [ftso1, _] = await settingWithTwoFTSOs(accounts, ftsoManager);
      // init reward epoch

      let addPromise = ftsoManager.addFtso(ftso1.address, { from: accounts[0] });
      await expectRevert(addPromise, ERR_GOV_PARAMS_NOT_INIT_FOR_FTSOS);
    });

    it("Should set Asset to FTSO", async () => {
      let [ftso1, ftso2] = await settingWithTwoFTSOs(accounts, ftsoManager);

      const MockVPToken = artifacts.require("MockVPToken") as MockVPTokenContract;
      let asset1Token = await MockVPToken.new(accounts.slice(0, 10), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) as MockVPTokenInstance;
      let asset2Token = await MockVPToken.new(accounts.slice(0, 10), [0, 1, 2, 0, 1, 2, 0, 1, 2, 0]) as MockVPTokenInstance;

      // set asset to ftso
      await ftsoManager.setFtsoAsset(ftso1.address, asset1Token.address);
      await ftsoManager.setFtsoAsset(ftso2.address, asset2Token.address);

      // ftso and asset for ftso should match
      assert.equal(await ftso1.assetFtsos(0), ftso1.address);
      assert.equal(await ftso2.assetFtsos(0), ftso2.address);
      assert.equal(await ftso1.assets(0), asset1Token.address);
      assert.equal(await ftso2.assets(0), asset2Token.address);

      // length of assetFtsos lists should match
      await expectRevert.unspecified(ftso1.assetFtsos(1));
      await expectRevert.unspecified(ftso2.assetFtsos(1));
      await expectRevert.unspecified(ftso1.assets(1));
      await expectRevert.unspecified(ftso2.assets(1));
    });

    it("Should not set Asset to FTSO if not from governance", async () => {
      let [ftso1,] = await settingWithTwoFTSOs(accounts, ftsoManager);

      const MockVPToken = artifacts.require("MockVPToken") as MockVPTokenContract;
      let asset1Token = await MockVPToken.new(accounts.slice(0, 10), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) as MockVPTokenInstance;

      // set asset to ftso
      let setPromise = ftsoManager.setFtsoAsset(ftso1.address, asset1Token.address, { from: accounts[1] });

      await expectRevert(setPromise, ERR_GOVERNANCE_ONLY);
    });

    it("Should set Asset FTSOs to FTSO", async () => {
      // Setup 4 ftsos, ftso1 is multi asset, with reference to next 3 ftsos
      let [ftso1, ftso2, ftso3, ftso4] = await settingWithFourFTSOs(accounts, ftsoManager, true);
      await setDefaultGovernanceParameters(ftsoManager);

      await ftsoManager.addFtso(ftso2.address);
      await ftsoManager.addFtso(ftso3.address);
      await ftsoManager.addFtso(ftso4.address);

      // set asset ftsos to ftso
      await ftsoManager.setFtsoAssetFtsos(ftso1.address, [ftso2, ftso3, ftso4].map(ftso => ftso.address));

      // multiasset ftsos for ftso 1 should match
      assert.equal(await ftso1.assetFtsos(0), ftso2.address);
      assert.equal(await ftso1.assetFtsos(1), ftso3.address);
      assert.equal(await ftso1.assetFtsos(2), ftso4.address);

      // length of assetFtsos lists should match
      await expectRevert.unspecified(ftso1.assetFtsos(3))
      await expectRevert.unspecified(ftso2.assetFtsos(1))
      await expectRevert.unspecified(ftso3.assetFtsos(1))
      await expectRevert.unspecified(ftso4.assetFtsos(1))
    });

    it("Should update Asset FTSOs on FTSO", async () => {
      // Setup 4 ftsos, ftso1 is multi asset, with reference to next 3 ftsos
      let [ftso1, ftso2, ftso3, ftso4] = await settingWithFourFTSOs(accounts, ftsoManager, true);
      await setDefaultGovernanceParameters(ftsoManager);

      await ftsoManager.addFtso(ftso1.address);
      await ftsoManager.addFtso(ftso2.address);
      await ftsoManager.addFtso(ftso3.address);
      await ftsoManager.addFtso(ftso4.address);

      // set asset ftsos to ftso
      await ftsoManager.setFtsoAssetFtsos(ftso1.address, [ftso2, ftso3, ftso4].map(ftso => ftso.address));

      // multiasset ftsos for ftso 1 should match
      assert.equal(await ftso1.assetFtsos(0), ftso2.address);
      assert.equal(await ftso1.assetFtsos(1), ftso3.address);
      assert.equal(await ftso1.assetFtsos(2), ftso4.address);

      // length of assetFtsos lists should match
      await expectRevert.unspecified(ftso1.assetFtsos(3))
      await expectRevert.unspecified(ftso2.assetFtsos(1))
      await expectRevert.unspecified(ftso3.assetFtsos(1))
      await expectRevert.unspecified(ftso4.assetFtsos(1))
    });

    it("Should not set Asset FTSOs to FTSO if not from governance", async () => {
      // Setup 4 ftsos, ftso1 is multi asset, with reference to next 3 ftsos
      let [ftso1, ftso2, ftso3, ftso4] = await settingWithFourFTSOs(accounts, ftsoManager, true);
      await setDefaultGovernanceParameters(ftsoManager);

      await ftsoManager.addFtso(ftso2.address);
      await ftsoManager.addFtso(ftso3.address);
      await ftsoManager.addFtso(ftso4.address);

      // set asset ftsos to ftso
      let setPromise = ftsoManager.setFtsoAssetFtsos(ftso1.address, [ftso2, ftso3, ftso4].map(ftso => ftso.address), { from: accounts[1] });

      await expectRevert(setPromise, ERR_GOVERNANCE_ONLY);
    });

    it("Should not set empty list of Asset FTSOs to FTSO", async () => {
      // Setup 4 ftsos, ftso1 is multi asset, with reference to next 3 ftsos
      let [ftso1, ftso2, ftso3, ftso4] = await settingWithFourFTSOs(accounts, ftsoManager, true);
      await setDefaultGovernanceParameters(ftsoManager);

      await ftsoManager.addFtso(ftso2.address);
      await ftsoManager.addFtso(ftso3.address);
      await ftsoManager.addFtso(ftso4.address);

      // set asset ftsos to ftso
      let setPromise = ftsoManager.setFtsoAssetFtsos(ftso1.address, []);

      await expectRevert(setPromise, "Asset ftsos list empty");
    });

    it("Should not set FTSO (itself) in Asset FTSOs to FTSO", async () => {
      // Setup 4 ftsos, ftso1 is multi asset, with reference to next 3 ftsos
      let [ftso1, ftso2, ftso3, ftso4] = await settingWithFourFTSOs(accounts, ftsoManager, true);
      await setDefaultGovernanceParameters(ftsoManager);

      await ftsoManager.addFtso(ftso2.address);
      await ftsoManager.addFtso(ftso3.address);
      await ftsoManager.addFtso(ftso4.address);

      // set asset ftsos to ftso
      let setPromise = ftsoManager.setFtsoAssetFtsos(ftso1.address, [ftso2, ftso3, ftso1, ftso4].map(ftso => ftso.address));

      await expectRevert(setPromise, "ftso equals asset ftso");
    });

    it("Should add multi Asset FTSO if all ftsos are added", async () => {
      // Setup 4 ftsos, ftso1 is multi asset, with reference to next 3 ftsos
      let [ftso1, ftso2, ftso3, ftso4] = await settingWithFourFTSOs(accounts, ftsoManager, true);
      await setDefaultGovernanceParameters(ftsoManager);

      await ftsoManager.addFtso(ftso2.address);
      await ftsoManager.addFtso(ftso3.address);
      await ftsoManager.addFtso(ftso4.address);

      // set asset ftsos to ftso
      await ftsoManager.setFtsoAssetFtsos(ftso1.address, [ftso2, ftso3, ftso4].map(ftso => ftso.address));
      await ftsoManager.addFtso(ftso1.address);

      // multiasset ftsos for ftso 1 should match
      assert.equal(await ftso1.assetFtsos(0), ftso2.address);
      assert.equal(await ftso1.assetFtsos(1), ftso3.address);
      assert.equal(await ftso1.assetFtsos(2), ftso4.address);

      // length of assetFtsos lists should match
      await expectRevert.unspecified(ftso1.assetFtsos(3))
      await expectRevert.unspecified(ftso2.assetFtsos(1))
      await expectRevert.unspecified(ftso3.assetFtsos(1))
      await expectRevert.unspecified(ftso4.assetFtsos(1))
    });

    it("Should set ftsos on multi Asset FTSO even if ftsos are not added, but then it should revert at adding multi Asset FTSO", async () => {
      // Setup 4 ftsos, ftso1 is multi asset, with reference to next 3 ftsos
      let [ftso1, ftso2, ftso3, ftso4] = await settingWithFourFTSOs(accounts, ftsoManager, true);
      await setDefaultGovernanceParameters(ftsoManager);

      // set asset ftsos to ftso
      await ftsoManager.setFtsoAssetFtsos(ftso1.address, [ftso2, ftso3, ftso4].map(ftso => ftso.address));
      await expectRevert(ftsoManager.addFtso(ftso1.address), ERR_XASSET_FTSO_NOT_MANAGED);
    });

    it("Should not add multi Asset FTSO if not all ftsos are added", async () => {
      // Setup 4 ftsos, ftso1 is multi asset, with reference to next 3 ftsos
      let [ftso1, ftso2, ftso3, ftso4] = await settingWithFourFTSOs(accounts, ftsoManager, true);
      await setDefaultGovernanceParameters(ftsoManager);

      await ftsoManager.addFtso(ftso2.address);
      await ftsoManager.addFtso(ftso3.address);
      await ftsoManager.addFtso(ftso4.address);

      // set asset ftsos to ftso
      await ftsoManager.setFtsoAssetFtsos(ftso1.address, [ftso2, ftso3, ftso4].map(ftso => ftso.address));
      await ftsoManager.removeFtso(ftso4.address);
      await expectRevert(ftsoManager.addFtso(ftso1.address), ERR_XASSET_FTSO_NOT_MANAGED);
    });

    it("Should not remove FTSO if used in multi Asset ftso", async () => {
      // Setup 4 ftsos, ftso1 is multi asset, with reference to next 3 ftsos
      let [ftso1, ftso2, ftso3, ftso4] = await settingWithFourFTSOs(accounts, ftsoManager, true);
      await setDefaultGovernanceParameters(ftsoManager);

      await ftsoManager.addFtso(ftso2.address);
      await ftsoManager.addFtso(ftso3.address);
      await ftsoManager.addFtso(ftso4.address);

      // set asset ftsos to ftso
      await ftsoManager.setFtsoAssetFtsos(ftso1.address, [ftso2, ftso3, ftso4].map(ftso => ftso.address));
      await ftsoManager.addFtso(ftso1.address);
      await expectRevert(ftsoManager.removeFtso(ftso2.address), ERR_XASSET_FTSO_NOT_MANAGED);
    });

    it("Should governance set FTSO parameters to FTSO manager and then the FTSO manager set the FTSOs on init", async () => {
      // Setup 4 ftsos, ftso1 is multi asset, with reference to next 3 ftsos
      let [ftso1, ftso2, ftso3, ftso4] = await settingWithFourFTSOs(accounts, ftsoManager, true);
      // init reward epoch
      let paramList = [1, 1 + 2, 1000, 10001, 50, 1500, 0, 10 * DAY];
      let paramListBN = paramList.map(x => toBN(x));
      let paramListBNWithoutRewardExpiry = paramListBN.slice(0, -1)

      let trustedAddresses = [accounts[8], accounts[9]]

      // setup governance parameters
      await (ftsoManager.setGovernanceParameters as any)(0, ...paramListBN, trustedAddresses);

      // add ftsos, parameters should be set by FTSOManager
      await ftsoManager.addFtso(ftso1.address, { from: accounts[0] });
      await ftsoManager.addFtso(ftso2.address, { from: accounts[0] });
      await ftsoManager.addFtso(ftso3.address, { from: accounts[0] });
      await ftsoManager.addFtso(ftso4.address, { from: accounts[0] });
      await ftsoManager.setFtsoAssetFtsos(ftso1.address, [ftso2, ftso3, ftso4].map(ftso => ftso.address));

      await ftsoManager.activate();
      // await ftsoManager.daemonize();

      let ftso1Params = numberedKeyedObjectToList(await ftso1.epochsConfiguration());
      let ftso2Params = numberedKeyedObjectToList(await ftso2.epochsConfiguration());
      let ftso3Params = numberedKeyedObjectToList(await ftso2.epochsConfiguration());
      let ftso4Params = numberedKeyedObjectToList(await ftso2.epochsConfiguration());

      let trustedAddresses1 = ftso1Params.pop();
      let trustedAddresses2 = ftso2Params.pop();
      let trustedAddresses3 = ftso3Params.pop();
      let trustedAddresses4 = ftso4Params.pop();

      // elastic band width BIPS
      assert.equal(ftso1Params.pop(), 0);
      assert.equal(ftso2Params.pop(), 0);
      assert.equal(ftso3Params.pop(), 0);
      assert.equal(ftso4Params.pop(), 0);

      // numeric epoch configuration should match the set one
      assert(doBNListsMatch(paramListBNWithoutRewardExpiry, ftso1Params as BN[]), "Wrong FTSO 1 governance parameters");
      assert(doBNListsMatch(paramListBNWithoutRewardExpiry, ftso2Params as BN[]), "Wrong FTSO 2 governance parameters");
      assert(doBNListsMatch(paramListBNWithoutRewardExpiry, ftso3Params as BN[]), "Wrong FTSO 3 governance parameters");
      assert(doBNListsMatch(paramListBNWithoutRewardExpiry, ftso4Params as BN[]), "Wrong FTSO 4 governance parameters");

      compareArrays(trustedAddresses, trustedAddresses1 as string[]);
      compareArrays(trustedAddresses, trustedAddresses2 as string[]);
      compareArrays(trustedAddresses, trustedAddresses3 as string[]);
      compareArrays(trustedAddresses, trustedAddresses4 as string[]);

    });

    it("Should governance set FTSO parameters after two price finalizations", async () => {
      let [ftso1, ftso2] = await settingWithFourFTSOs(accounts, ftsoManager, true);

      let priceSubmitterInterface = await PriceSubmitter.new();
      // init reward epoch
      let defaultParamList = [1, 1, 1000, 10000, 50, 1500, 0, 10 * DAY];
      let defaultParamListBN = defaultParamList.map(x => toBN(x));
      let trustedAddresses = [accounts[6], accounts[7]];
      await (ftsoManager.setGovernanceParameters as any)(0, ...defaultParamListBN, trustedAddresses);

      await ftsoManager.addFtso(ftso1.address, { from: accounts[0] });
      await ftsoManager.addFtso(ftso2.address, { from: accounts[0] });

      await ftsoManager.activate();
      await ftsoManager.daemonize(); // initialize reward epoch
      await ftsoManager.daemonize(); // initialize price epoch

      // check price submitter trusted addresses
      const setTrustedAddresses1 = priceSubmitterInterface.contract.methods.setTrustedAddresses(trustedAddresses).encodeABI();
      const invocationCount1 = await mockPriceSubmitter.invocationCountForCalldata.call(setTrustedAddresses1);
      assert.equal(invocationCount1.toNumber(), 1);

      await increaseTimeTo(startTs, 120 + 30);
      await ftsoManager.daemonize(); // finalize price epoch
      await ftsoManager.daemonize(); // initialize price epoch

      let epoch = 1;

      await submitSomePrices(epoch, ftso1, 10, accounts);
      await submitSomePrices(epoch, ftso2, 10, accounts);

      await increaseTimeTo(startTs, 120 * 2);
      await ftsoManager.daemonize();

      await revealSomePrices(ftso1, 10, epoch, accounts);
      await revealSomePrices(ftso2, 10, epoch, accounts);

      await increaseTimeTo(startTs, 120 * 2 + 30);
      let tx = await ftsoManager.daemonize(); // finalize price epoch
      await ftsoManager.daemonize(); // initialize price epoch

      // Assert
      expectEvent(tx, "PriceEpochFinalized");
      epoch = 2;
      await submitSomePrices(epoch, ftso1, 10, accounts);
      await submitSomePrices(epoch, ftso2, 10, accounts);

      await increaseTimeTo(startTs, 120 * 3);
      tx = await ftsoManager.daemonize();

      await revealSomePrices(ftso1, 10, epoch, accounts);
      await revealSomePrices(ftso2, 10, epoch, accounts);

      await increaseTimeTo(startTs, 120 * 3 + 30);
      tx = await ftsoManager.daemonize(); // finalize price epoch
      await ftsoManager.daemonize(); // initialize price epoch

      expectEvent(tx, "PriceEpochFinalized");

      epoch = 3
      await submitSomePrices(epoch, ftso1, 10, accounts);
      await submitSomePrices(epoch, ftso2, 10, accounts);

      let paramList = [1, 1 + 2, 1000, 10001, 50, 1500, 0, 10 * DAY];
      let paramListBN = paramList.map(x => toBN(x));
      let paramListBNWithoutRewardExpiry = paramListBN.slice(0, -1)

      trustedAddresses = [accounts[8], accounts[9]];
      await (ftsoManager.setGovernanceParameters as any)(0, ...paramListBN, trustedAddresses);

      await increaseTimeTo(startTs, 120 * 4);
      tx = await ftsoManager.daemonize();

      await revealSomePrices(ftso1, 10, epoch, accounts);
      await revealSomePrices(ftso2, 10, epoch, accounts);

      await increaseTimeTo(startTs, 120 * 4 + 30);
      tx = await ftsoManager.daemonize(); // finalize price epoch
      expectEvent(tx, "PriceEpochFinalized");

      await ftsoManager.daemonize(); // initialize price epoch

      // check price submitter trusted addresses
      const setTrustedAddresses2 = priceSubmitterInterface.contract.methods.setTrustedAddresses(trustedAddresses).encodeABI();
      const invocationCount2 = await mockPriceSubmitter.invocationCountForCalldata.call(setTrustedAddresses2);
      assert.equal(invocationCount2.toNumber(), 1);

      let ftso1Params = numberedKeyedObjectToList(await ftso1.epochsConfiguration());
      let ftso2Params = numberedKeyedObjectToList(await ftso2.epochsConfiguration());

      let trustedAddresses1 = ftso1Params.pop();
      let trustedAddresses2 = ftso2Params.pop();

      // elastic band width BIPS
      assert.equal(ftso1Params.pop(), 0);
      assert.equal(ftso2Params.pop(), 0);

      assert(doBNListsMatch(paramListBNWithoutRewardExpiry, ftso1Params as BN[]), "Wrong FTSO 1 governance parameters");
      assert(doBNListsMatch(paramListBNWithoutRewardExpiry, ftso2Params as BN[]), "Wrong FTSO 2 governance parameters");
      assert(!doBNListsMatch(paramListBN, defaultParamListBN), "Changed parameters should not match the default ones.");
      compareArrays(trustedAddresses, trustedAddresses1 as string[]);
      compareArrays(trustedAddresses, trustedAddresses2 as string[]);
    });

    it("Should update governance parameters only after two price finalizations", async () => {
      let [ftso1, ftso2] = await settingWithFourFTSOs(accounts, ftsoManager, true);

      let priceSubmitterInterface = await PriceSubmitter.new();
      // init reward epoch
      let defaultParamList = [1, 1, 1000, 10000, 50, 1500, 0, 10 * DAY];
      let defaultParamListBN = defaultParamList.map(x => toBN(x));
      let trustedAddresses = [accounts[6], accounts[7]];
      await (ftsoManager.setGovernanceParameters as any)(0, ...defaultParamListBN, trustedAddresses);

      await ftsoManager.addFtso(ftso1.address, { from: accounts[0] });
      await ftsoManager.addFtso(ftso2.address, { from: accounts[0] });
      
      await ftsoManager.activate();
      await ftsoManager.daemonize(); // initialize reward epoch
      await ftsoManager.daemonize(); // initialize price epoch

      let paramList = [1, 1 + 2, 1000, 10001, 50, 1500, 0, 10 * DAY];
      let paramListBN = paramList.map(x => toBN(x));
      let paramListBNWithoutRewardExpiry = paramListBN.slice(0, -1)
      let trustedAddressesNew = [accounts[8], accounts[9]];
      let updateTs = startTs.addn(120 * 4 + 30);
      await (ftsoManager.setGovernanceParameters as any)(updateTs, ...paramListBN, trustedAddressesNew);
      assert.equal((await ftsoManager.getUpdateGovernanceParametersTs()).toNumber(), updateTs.toNumber());

      // check price submitter trusted addresses
      const setTrustedAddresses1 = priceSubmitterInterface.contract.methods.setTrustedAddresses(trustedAddresses).encodeABI();
      const invocationCount1 = await mockPriceSubmitter.invocationCountForCalldata.call(setTrustedAddresses1);
      assert.equal(invocationCount1.toNumber(), 1);

      await increaseTimeTo(startTs, 120 + 30);
      await ftsoManager.daemonize(); // finalize price epoch
      await ftsoManager.daemonize(); // initialize price epoch

      // check price submitter trusted addresses
      const setTrustedAddressesNew = priceSubmitterInterface.contract.methods.setTrustedAddresses(trustedAddressesNew).encodeABI();
      const invocationCount2 = await mockPriceSubmitter.invocationCountForCalldata.call(setTrustedAddressesNew);
      assert.equal(invocationCount2.toNumber(), 0);

      let epoch = 1;

      await submitSomePrices(epoch, ftso1, 10, accounts);
      await submitSomePrices(epoch, ftso2, 10, accounts);

      await increaseTimeTo(startTs, 120 * 2);
      await ftsoManager.daemonize();

      await revealSomePrices(ftso1, 10, epoch, accounts);
      await revealSomePrices(ftso2, 10, epoch, accounts);

      await increaseTimeTo(startTs, 120 * 2 + 30);
      let tx = await ftsoManager.daemonize(); // finalize price epoch
      await ftsoManager.daemonize(); // initialize price epoch

      const invocationCount3 = await mockPriceSubmitter.invocationCountForCalldata.call(setTrustedAddressesNew);
      assert.equal(invocationCount3.toNumber(), 0);

      // Assert
      expectEvent(tx, "PriceEpochFinalized");
      epoch = 2;
      await submitSomePrices(epoch, ftso1, 10, accounts);
      await submitSomePrices(epoch, ftso2, 10, accounts);

      await increaseTimeTo(startTs, 120 * 3);
      tx = await ftsoManager.daemonize();

      await revealSomePrices(ftso1, 10, epoch, accounts);
      await revealSomePrices(ftso2, 10, epoch, accounts);

      await increaseTimeTo(startTs, 120 * 3 + 30);
      tx = await ftsoManager.daemonize(); // finalize price epoch
      await ftsoManager.daemonize(); // initialize price epoch

      expectEvent(tx, "PriceEpochFinalized");

      const invocationCount4 = await mockPriceSubmitter.invocationCountForCalldata.call(setTrustedAddressesNew);
      assert.equal(invocationCount4.toNumber(), 0);

      epoch = 3
      await submitSomePrices(epoch, ftso1, 10, accounts);
      await submitSomePrices(epoch, ftso2, 10, accounts);

      await increaseTimeTo(startTs, 120 * 4);
      tx = await ftsoManager.daemonize();

      await revealSomePrices(ftso1, 10, epoch, accounts);
      await revealSomePrices(ftso2, 10, epoch, accounts);

      await increaseTimeTo(startTs, 120 * 4 + 30);
      tx = await ftsoManager.daemonize(); // finalize price epoch
      expectEvent(tx, "PriceEpochFinalized");

      await ftsoManager.daemonize(); // initialize price epoch

      // check price submitter trusted addresses
      const invocationCount5 = await mockPriceSubmitter.invocationCountForCalldata.call(setTrustedAddressesNew);
      assert.equal(invocationCount5.toNumber(), 1);

      let ftso1Params = numberedKeyedObjectToList(await ftso1.epochsConfiguration());
      let ftso2Params = numberedKeyedObjectToList(await ftso2.epochsConfiguration());

      let trustedAddresses1 = ftso1Params.pop();
      let trustedAddresses2 = ftso2Params.pop();

      // elastic band width BIPS
      assert.equal(ftso1Params.pop(), 0);
      assert.equal(ftso2Params.pop(), 0);

      assert(doBNListsMatch(paramListBNWithoutRewardExpiry, ftso1Params as BN[]), "Wrong FTSO 1 governance parameters");
      assert(doBNListsMatch(paramListBNWithoutRewardExpiry, ftso2Params as BN[]), "Wrong FTSO 2 governance parameters");
      assert(!doBNListsMatch(paramListBN, defaultParamListBN), "Changed parameters should not match the default ones.");
      compareArrays(trustedAddressesNew, trustedAddresses1 as string[]);
      compareArrays(trustedAddressesNew, trustedAddresses2 as string[]);
    });

    it("Should emit event if initialize price epoch fails and catches reverted errors", async () => {
      // Assemble
      // stub ftso initialize
      const initializePriceEpoch = ftsoInterface.contract.methods.initializeCurrentEpochStateForReveal(10000, false).encodeABI();
      await mockFtso.givenCalldataRevertWithMessage(initializePriceEpoch, "I am broken");
      const initializePriceEpochFallback = ftsoInterface.contract.methods.initializeCurrentEpochStateForReveal(0, true).encodeABI();
      await mockFtso.givenCalldataRunOutOfGas(initializePriceEpochFallback);

      await setDefaultGovernanceParameters(ftsoManager);
      // add fakey ftso
      await ftsoManager.addFtso(mockFtso.address, { from: accounts[0] });
      // activate ftso manager
      await ftsoManager.activate();
      await increaseTimeTo(startTs, REVEAL_EPOCH_DURATION_S);
      await ftsoManager.daemonize();

      await increaseTimeTo(startTs, 120);

      // Act
      // Simulate the daemon tickling reward manager
      let tx = await ftsoManager.daemonize();
      // Assert
      expectEvent(tx, "InitializingCurrentEpochStateForRevealFailed", { ftso: mockFtso.address, epochId: toBN(1) });

      const {
        0: lastErrorBlockArr,
        1: numErrorsArr,
        2: errorStringArr,
        3: errorContractArr,
        4: totalDaemonizedErrors
      } = await ftsoManager.showRevertedErrors(0, 2);

      assert.equal(lastErrorBlockArr[0].toNumber(), tx.logs[0].blockNumber);
      assert.equal(numErrorsArr[0].toNumber(), 1);
      assert.equal(errorStringArr[0], "I am broken");
      assert.equal(errorContractArr[0], mockFtso.address);
      assert.equal(totalDaemonizedErrors.toNumber(), 2);

      assert.equal(lastErrorBlockArr[1].toNumber(), tx.logs[0].blockNumber);
      assert.equal(numErrorsArr[1].toNumber(), 1);
      assert.equal(errorStringArr[1], "err fallback init epoch for reveal");
      assert.equal(errorContractArr[1], mockFtso.address);
      assert.equal(totalDaemonizedErrors.toNumber(), 2);
    });

    it("Should get correct reward manager", async () => {
      let contract = await ftsoManager.rewardManager();
      expect(contract).to.equals(mockRewardManager.address);
    });

    it("Should get correct registry", async () => {
      let contract = await ftsoManager.ftsoRegistry();
      expect(contract).to.equals(registry.address);
      assert.equal(contract, registry.address)
    });

    it("Should get correct voter whitelister", async () => {
      let contract = await ftsoManager.voterWhitelister();
      expect(contract).to.equals(mockVoterWhitelister.address);
    });

    it("Should get correct supply", async () => {
      let contract = await ftsoManager.supply();
      expect(contract).to.equals(mockSupply.address);
    });

    it("Should get correct cleanup block number manager", async () => {
      let contract = await ftsoManager.cleanupBlockNumberManager();
      expect(contract).to.equals(cleanupBlockNumberManager.address);
    });

    it("Should revert deactivating ftso if not from governance", async () => {
      let [ftso1, ftso2] = await settingWithTwoFTSOs(accounts, ftsoManager);
      // init reward epoch
      await setDefaultGovernanceParameters(ftsoManager);

      await ftsoManager.addFtso(ftso1.address, { from: accounts[0] });
      await ftsoManager.addFtso(ftso2.address, { from: accounts[0] });

      await expectRevert(ftsoManager.deactivateFtsos([ftso1.address], { from: accounts[1] }), "only governance");
      assert(await ftso1.active());
    });

    it("Should not deactivate ftso if still used on ftso registry", async () => {
      let [ftso1, ftso2] = await settingWithTwoFTSOs(accounts, ftsoManager);
      // init reward epoch
      await setDefaultGovernanceParameters(ftsoManager);

      await ftsoManager.addFtso(ftso1.address, { from: accounts[0] });
      await ftsoManager.addFtso(ftso2.address, { from: accounts[0] });

      expectEvent(await ftsoManager.deactivateFtsos([ftso1.address]), "FtsoDeactivationFailed", { ftso: ftso1.address });
      assert(await ftso1.active());
    });

    it("Should deactivate ftso if removed from ftso registry", async () => {
      let [ftso1, ftso2] = await settingWithTwoFTSOs(accounts, ftsoManager);
      await setDefaultGovernanceParameters(ftsoManager);

      await ftsoManager.addFtsosBulk([ftso1.address, ftso2.address]);

      let ftsoManager2 = await FtsoManager.new(
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

      await ftsoManager2.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.PRICE_SUBMITTER, Contracts.FTSO_REWARD_MANAGER, Contracts.FTSO_REGISTRY, Contracts.VOTER_WHITELISTER, Contracts.SUPPLY, Contracts.CLEANUP_BLOCK_NUMBER_MANAGER]),
        [ADDRESS_UPDATER, mockPriceSubmitter.address, mockRewardManager.address, registry.address, mockVoterWhitelister.address, mockSupply.address, cleanupBlockNumberManager.address], { from: ADDRESS_UPDATER });

      // set new ftso manager
      await registry.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_MANAGER]),
        [ADDRESS_UPDATER, ftsoManager2.address], {from: ADDRESS_UPDATER});

      let [ftso3, ftso4] = await settingWithTwoFTSOs(accounts, ftsoManager2);
      await setDefaultGovernanceParameters(ftsoManager2);

      // replaces both ftsos
      await ftsoManager2.replaceFtsosBulk([ftso3.address, ftso4.address], true, false);
      await ftsoManager2.removeFtso(ftso3.address);

      await ftsoManager.deactivateFtsos([ftso1.address, ftso2.address]);

      assert(!await ftso1.active());
      assert(!await ftso2.active());
      assert(!await ftso3.active());
      assert(await ftso4.active());
    });

    it("Should deactivate ftso if replaced on ftso registry", async () => {
      let [ftso1, ftso2] = await settingWithTwoFTSOs(accounts, ftsoManager);
      await setDefaultGovernanceParameters(ftsoManager);

      await ftsoManager.addFtsosBulk([ftso1.address, ftso2.address]);

      let ftsoManager2 = await FtsoManager.new(
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

      await ftsoManager2.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.PRICE_SUBMITTER, Contracts.FTSO_REWARD_MANAGER, Contracts.FTSO_REGISTRY, Contracts.VOTER_WHITELISTER, Contracts.SUPPLY, Contracts.CLEANUP_BLOCK_NUMBER_MANAGER]),
        [ADDRESS_UPDATER, mockPriceSubmitter.address, mockRewardManager.address, registry.address, mockVoterWhitelister.address, mockSupply.address, cleanupBlockNumberManager.address], { from: ADDRESS_UPDATER });

      // set new ftso manager
      await registry.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_MANAGER]),
        [ADDRESS_UPDATER, ftsoManager2.address], {from: ADDRESS_UPDATER});

      let [ftso3, ftso4] = await settingWithTwoFTSOs(accounts, ftsoManager2);
      await setDefaultGovernanceParameters(ftsoManager2);

      // replaces both ftsos
      await ftsoManager2.replaceFtsosBulk([ftso3.address, ftso4.address], true, false);

      await ftsoManager.deactivateFtsos([ftso1.address, ftso2.address]);

      assert(!await ftso1.active());
      assert(!await ftso2.active());
      assert(await ftso3.active());
      assert(await ftso4.active());
    });

    it("Should not set an array of FTSOs for FTSO", async () => {
      await setDefaultGovernanceParameters(ftsoManager);
      let multiFtso = await Ftso.new('NAT', 5, mockPriceSubmitter.address, constants.ZERO_ADDRESS, ftsoManager.address,
        startTs, PRICE_EPOCH_DURATION_S, REVEAL_EPOCH_DURATION_S, 0, 1e10, defaultPriceEpochCyclicBufferSize);
      
      await ftsoManager.addFtso(multiFtso.address);
      await ftsoManager.addFtso(mockFtso.address);
      let mockFtso3 = await MockFtso.new();
      await ftsoManager.addFtso(mockFtso3.address);
      await ftsoManager.setFtsoAssetFtsos(multiFtso.address, [mockFtso3.address]);
      let mockFtso2 = await MockFtso.new();

      await mockFtsoSymbol("ATOK", mockFtso, ftsoInterface);
      await mockFtsoSymbol("ATOK", mockFtso2, ftsoInterface);

      await ftsoManager.replaceFtso(mockFtso2.address, false, false);
    });

    it("Should set width of ftsos' elastic bands", async () => {
      await setDefaultGovernanceParameters(ftsoManager);
      let mockFtso1 = await MockFtso.new();
      let mockFtso2 = await MockFtso.new();
      await mockFtsoSymbol("ATOK1", mockFtso1, ftsoInterface);
      await mockFtsoSymbol("ATOK2", mockFtso2, ftsoInterface);
      await ftsoManager.addFtso(mockFtso1.address);
      await ftsoManager.addFtso(mockFtso2.address);
      expect((await ftsoManager.getElasticBandWidthPPMFtso(mockFtso1.address)).toNumber()).to.equals(0);
      expect((await ftsoManager.getElasticBandWidthPPMFtso(mockFtso2.address)).toNumber()).to.equals(0);

      await ftsoManager.setElasticBandWidthPPMFtsos(0, [mockFtso1.address, mockFtso2.address], [100, 200]);
      expect((await ftsoManager.getElasticBandWidthPPMFtso(mockFtso1.address)).toNumber()).to.equals(100);
      expect((await ftsoManager.getElasticBandWidthPPMFtso(mockFtso2.address)).toNumber()).to.equals(200);

      let mockFtso3 = await MockFtso.new();
      await mockFtsoSymbol("ATOK1", mockFtso3, ftsoInterface);
      await ftsoManager.replaceFtso(mockFtso3.address, false, false);
      expect((await ftsoManager.getElasticBandWidthPPMFtso(mockFtso1.address)).toNumber()).to.equals(0);
      expect((await ftsoManager.getElasticBandWidthPPMFtso(mockFtso3.address)).toNumber()).to.equals(100);

      await ftsoManager.removeFtso(mockFtso2.address);
      expect((await ftsoManager.getElasticBandWidthPPMFtso(mockFtso2.address)).toNumber()).to.equals(0);
    });

    it("Should revert setting width of elastic bands if array lengts do not match", async () => {
      await setDefaultGovernanceParameters(ftsoManager);
      let mockFtso1 = await MockFtso.new();
      let mockFtso2 = await MockFtso.new();
      await mockFtsoSymbol("ATOK1", mockFtso1, ftsoInterface);
      await mockFtsoSymbol("ATOK2", mockFtso2, ftsoInterface);
      await ftsoManager.addFtso(mockFtso1.address);
      await ftsoManager.addFtso(mockFtso2.address);

      let set = ftsoManager.setElasticBandWidthPPMFtsos(0, [mockFtso1.address, mockFtso2.address], [100]);
      await expectRevert(set, "array lengths do not match");
    });

    it("Should revert setting width of elastic bands if width exceeds 1000000 ppm", async () => {
      await setDefaultGovernanceParameters(ftsoManager);
      let mockFtso1 = await MockFtso.new();
      let mockFtso2 = await MockFtso.new();
      await mockFtsoSymbol("ATOK1", mockFtso1, ftsoInterface);
      await mockFtsoSymbol("ATOK2", mockFtso2, ftsoInterface);
      await ftsoManager.addFtso(mockFtso1.address);
      await ftsoManager.addFtso(mockFtso2.address);

      let set = ftsoManager.setElasticBandWidthPPMFtsos(0, [mockFtso1.address, mockFtso2.address], [1e7, 100]);
      await expectRevert(set, "elastic band width invalid");
    });

  });

  describe("Price epochs, finalization", async () => {
    it("Should finalize a price epoch only", async () => {
      // Assemble
      await ftsoManager.activate();
      await increaseTimeTo(startTs, REVEAL_EPOCH_DURATION_S);
      await ftsoManager.daemonize(); // initialize reward epoch
      await ftsoManager.daemonize(); // initialize price epoch

      // Time travel 120 seconds
      await increaseTimeTo(startTs, 120 + REVEAL_EPOCH_DURATION_S);
      // Act
      let tx = await ftsoManager.daemonize();
      // Assert
      expectEvent(tx, "PriceEpochFinalized");
      expectEvent.notEmitted(tx, "RewardEpochFinalized");
    });

    it("Should finalize a price epoch at the configured interval", async () => {
      // Assemble
      await ftsoManager.activate();
      await increaseTimeTo(startTs, REVEAL_EPOCH_DURATION_S);
      await ftsoManager.daemonize(); // initialize reward epoch
      await ftsoManager.daemonize(); // initialize price epoch

      // Time travel 120 seconds
      await increaseTimeTo(startTs, 120 + REVEAL_EPOCH_DURATION_S);
      await ftsoManager.daemonize(); // finalize price epoch
      await ftsoManager.daemonize(); // initialize price epoch

      // Time travel another 120 seconds
      await increaseTimeTo(startTs, 120 * 2 + REVEAL_EPOCH_DURATION_S);
      // Act
      let tx = await ftsoManager.daemonize();
      // Assert
      expectEvent(tx, "PriceEpochFinalized");
      expectEvent.notEmitted(tx, "RewardEpochFinalized");
    });

    it("Should finalize price epoch for winning ftso with no reward recipients", async () => {
      // Assemble
      // stub finalizer
      const finalizePriceEpoch = ftsoInterface.contract.methods.finalizePriceEpoch(0, true).encodeABI();
      const finalizePriceEpochReturn = web3.eth.abi.encodeParameters(
        ['address[]', 'uint256[]', 'uint256'],
        [[], [], '0']);
      await mockFtso.givenMethodReturn(finalizePriceEpoch, finalizePriceEpochReturn);

      await setDefaultGovernanceParameters(ftsoManager);
      // add fakey ftso
      await ftsoManager.addFtso(mockFtso.address, { from: accounts[0] });
      // activate ftso manager
      await ftsoManager.activate();
      await increaseTimeTo(startTs, REVEAL_EPOCH_DURATION_S);
      await ftsoManager.daemonize(); // initialize reward epoch
      await ftsoManager.daemonize(); // initialize price epoch

      // Time travel 120 seconds
      await increaseTimeTo(startTs, 120 + REVEAL_EPOCH_DURATION_S);

      // Act
      let tx = await ftsoManager.daemonize();

      // Assert
      expectEvent(tx, "PriceEpochFinalized");
    });

    it("Should finalize price epoch and distribute unclaimed rewards", async () => {
      // Assemble
      // stub ftso finalizer
      const finalizePriceEpoch = ftsoInterface.contract.methods.finalizePriceEpoch(0, true).encodeABI();
      const finalizePriceEpochReturn = web3.eth.abi.encodeParameters(
        ['address[]', 'uint256[]', 'uint256'],
        [[accounts[1], accounts[2]], [25, 75], 100]);
      await mockFtso.givenMethodReturn(finalizePriceEpoch, finalizePriceEpochReturn);

      await setDefaultGovernanceParameters(ftsoManager);
      // add fakey ftso
      await ftsoManager.addFtso(mockFtso.address, { from: accounts[0] });
      // activate ftso manager
      await ftsoManager.activate();
      await increaseTimeTo(startTs, REVEAL_EPOCH_DURATION_S);
      await ftsoManager.daemonize(); // intialize reward epoch
      await ftsoManager.daemonize(); // initialize price epoch

      // Time travel 120 seconds
      await increaseTimeTo(startTs, 120 + REVEAL_EPOCH_DURATION_S);

      // Act
      // Simulate the daemon tickling reward manager
      await ftsoManager.daemonize();

      // address[] memory addresses,
      // uint256[] memory weights,
      // uint256 totalWeight,
      // uint256 epochId,
      // address ftso,
      // uint256 priceEpochDurationSeconds,
      // uint256 currentRewardEpoch
      const distributeRewards = ftsoRewardManagerInterface.contract.methods.distributeRewards(
        [accounts[1], accounts[2]],
        [25, 75],
        100,
        0,
        mockFtso.address,
        120,
        0,
        startTs.addn(PRICE_EPOCH_DURATION_S - 1),
        await ftsoManager.getRewardEpochVotePowerBlock(0)
      ).encodeABI();

      // Assert
      const invocationCountWithData = await mockRewardManager.invocationCountForCalldata.call(distributeRewards);
      assert.equal(invocationCountWithData.toNumber(), 1);
    });

    it("Should finalize price epoch and emit event if distribute rewards fails", async () => {
      // Assemble
      // stub ftso finalizer
      const finalizePriceEpoch = ftsoInterface.contract.methods.finalizePriceEpoch(0, true).encodeABI();
      const finalizePriceEpochReturn = web3.eth.abi.encodeParameters(
        ['address[]', 'uint256[]', 'uint256'],
        [[accounts[1], accounts[2]], [25, 75], 100]);
      await mockFtso.givenMethodReturn(finalizePriceEpoch, finalizePriceEpochReturn);

      await setDefaultGovernanceParameters(ftsoManager);
      // add fakey ftso
      await ftsoManager.addFtso(mockFtso.address, { from: accounts[0] });
      // activate ftso manager
      await ftsoManager.activate();
      await increaseTimeTo(startTs, REVEAL_EPOCH_DURATION_S);
      await ftsoManager.daemonize(); // initialize reward epoch
      await ftsoManager.daemonize(); // initialize price epoch

      // Time travel 120 seconds
      await increaseTimeTo(startTs, 120 + REVEAL_EPOCH_DURATION_S);

      // address[] memory addresses,
      // uint256[] memory weights,
      // uint256 totalWeight,
      // uint256 epochId,
      // address ftso,
      // uint256 priceEpochDurationSeconds,
      // uint256 currentRewardEpoch
      const distributeRewards = ftsoRewardManagerInterface.contract.methods.distributeRewards(
        [accounts[1], accounts[2]],
        [25, 75],
        100,
        0,
        mockFtso.address,
        120,
        0,
        startTs.addn(PRICE_EPOCH_DURATION_S - 1),
        await ftsoManager.getRewardEpochVotePowerBlock(0)
      ).encodeABI();

      await mockRewardManager.givenMethodRevertWithMessage(distributeRewards, "I am broken");
      // Act
      // Simulate the daemon tickling reward manager
      let tx = await ftsoManager.daemonize();

      // Assert
      expectEvent(tx, "DistributingRewardsFailed", { ftso: mockFtso.address, epochId: toBN(0) })
    });

    it("Should emit event for a accrue unearned rewards catch statement with a message if ftso manager in fallback mode ", async () => {
      const finalizePriceEpoch = ftsoInterface.contract.methods.finalizePriceEpoch(0, true).encodeABI();
      const finalizePriceEpochReturn = web3.eth.abi.encodeParameters(
        ['address[]', 'uint256[]', 'uint256'],
        [[accounts[1], accounts[2]], [25, 75], 100]);
      await mockFtso.givenMethodReturn(finalizePriceEpoch, finalizePriceEpochReturn);

      await setDefaultGovernanceParameters(ftsoManager);
      await ftsoManager.addFtso(mockFtso.address);

      await ftsoManager.activate();
      await ftsoManager.setFallbackMode(true);
      await increaseTimeTo(startTs, REVEAL_EPOCH_DURATION_S);
      await ftsoManager.daemonize(); // initialize reward epoch
      await ftsoManager.daemonize(); // initialize price epoch
      await increaseTimeTo(startTs, REVEAL_EPOCH_DURATION_S + PRICE_EPOCH_DURATION_S);

      const accrueUnearnedRewards = ftsoRewardManagerInterface.contract.methods.accrueUnearnedRewards(
        0,
        120,
        startTs.addn(PRICE_EPOCH_DURATION_S - 1)
      ).encodeABI();
      await mockRewardManager.givenMethodRevertWithMessage(accrueUnearnedRewards, "I am broken");

      let tx = await ftsoManager.daemonize();
      expectEvent(tx, "AccruingUnearnedRewardsFailed", { epochId: toBN(0) });
    });

    it("Should emit event for a accrue unearned rewards catch statement with a message if no ftso could get rewards", async () => {
      const finalizePriceEpoch = ftsoInterface.contract.methods.finalizePriceEpoch(0, true).encodeABI();
      const finalizePriceEpochReturn = web3.eth.abi.encodeParameters(
        ['address[]', 'uint256[]', 'uint256'],
        [[], [], '0']);
      await mockFtso.givenMethodReturn(finalizePriceEpoch, finalizePriceEpochReturn);

      await setDefaultGovernanceParameters(ftsoManager);
      await ftsoManager.addFtso(mockFtso.address);

      await ftsoManager.activate();
      await increaseTimeTo(startTs, REVEAL_EPOCH_DURATION_S);
      await ftsoManager.daemonize(); // initialize reward epoch
      await ftsoManager.daemonize(); // initialize price epoch
      await increaseTimeTo(startTs, REVEAL_EPOCH_DURATION_S + PRICE_EPOCH_DURATION_S);

      const accrueUnearnedRewards = ftsoRewardManagerInterface.contract.methods.accrueUnearnedRewards(
        0,
        120,
        startTs.addn(PRICE_EPOCH_DURATION_S - 1)
      ).encodeABI();
      await mockRewardManager.givenMethodRevertWithMessage(accrueUnearnedRewards, "I am broken");

      let tx = await ftsoManager.daemonize();
      expectEvent(tx, "AccruingUnearnedRewardsFailed", { epochId: toBN(0) });
    });

    it("Should finalize price epoch and declare non-winning but next eligible ftso the winner", async () => {
      // Assemble
      // Force the first FTSO random number generator to yield FTSO 0 as reward FTSO
      const mockFtsoNoAccounts = await MockFtso.new();
      // Rig FTSO0 to yield no accounts
      const finalizePriceEpochFtso0 = ftsoInterface.contract.methods.finalizePriceEpoch(0, true).encodeABI();
      const finalizePriceEpochReturnFtso0 = web3.eth.abi.encodeParameters(
        ['address[]', 'uint256[]', 'uint256'],
        [[], [], 100]);
      await mockFtsoNoAccounts.givenMethodReturn(finalizePriceEpochFtso0, finalizePriceEpochReturnFtso0);
      // stub FTSO1 to actually contain rewardable accounts
      const finalizePriceEpoch = ftsoInterface.contract.methods.finalizePriceEpoch(0, true).encodeABI();
      const finalizePriceEpochReturn = web3.eth.abi.encodeParameters(
        ['address[]', 'uint256[]', 'uint256'],
        [[accounts[1], accounts[2]], [25, 75], 100]);
      await mockFtso.givenMethodReturn(finalizePriceEpoch, finalizePriceEpochReturn);
      // give reward manager some nats to distribute
      // await web3.eth.sendTransaction({ from: accounts[0], to: mockRewardManager.address, value: 1000000 });

      await setDefaultGovernanceParameters(ftsoManager);
      // add fakey unrewardable ftso 0
      await ftsoManager.addFtso(mockFtsoNoAccounts.address, { from: accounts[0] });
      // add fakey rewardable ftso 1
      await ftsoManager.addFtso(mockFtso.address, { from: accounts[0] });
      // activate ftso manager
      await ftsoManager.activate();
      await increaseTimeTo(startTs, REVEAL_EPOCH_DURATION_S);
      await ftsoManager.daemonize(); // initialize reward epoch
      await ftsoManager.daemonize(); // initialize price epoch

      // Time travel 120 seconds
      await increaseTimeTo(startTs, 120 + REVEAL_EPOCH_DURATION_S);

      // Act
      // Simulate the daemon tickling reward manager
      let tx = await ftsoManager.daemonize();

      // Assert
      // Should equal FTSO 1, the next eligible ftso in the list
      assert.equal(await ftsoManager.lastRewardedFtsoAddress(), mockFtso.address);
      expectEvent.notEmitted(tx, "DistributingRewardsFailed");
      expectEvent(tx, "PriceEpochFinalized", { chosenFtso: mockFtso.address, rewardEpochId: toBN(0) });
    });

    it("Should force finalize the price after one finalization", async () => {
      let [ftso1, ftso2] = await settingWithTwoFTSOs(accounts, ftsoManager);
      // init reward epoch
      await setDefaultGovernanceParameters(ftsoManager);

      await ftsoManager.addFtso(ftso1.address, { from: accounts[0] });
      await ftsoManager.addFtso(ftso2.address, { from: accounts[0] });

      await ftsoManager.activate();
      await increaseTimeTo(startTs, REVEAL_EPOCH_DURATION_S);
      await ftsoManager.daemonize(); // initialize reward epoch

      await increaseTimeTo(startTs, 120 + REVEAL_EPOCH_DURATION_S);
      await ftsoManager.daemonize(); // initialize price epoch


      let epoch = 1;
      await submitSomePrices(epoch, ftso1, 10, accounts);
      await submitSomePrices(epoch, ftso2, 10, accounts);

      await increaseTimeTo(startTs, 2 * 120);
      await ftsoManager.daemonize();

      await revealSomePrices(ftso1, 10, epoch, accounts);
      await revealSomePrices(ftso2, 10, epoch, accounts);

      await increaseTimeTo(startTs, 2 * 120 + REVEAL_EPOCH_DURATION_S);
      await ftsoManager.daemonize(); // finalize price epoch

      let ftso1Events = await ftso1.getPastEvents("PriceFinalized")
      let ftso2Events = await ftso2.getPastEvents("PriceFinalized")
      assert.equal(lastOf(ftso1Events).args.finalizationType.toNumber(), 1);
      assert.equal(lastOf(ftso2Events).args.finalizationType.toNumber(), 1);

      // initialize price epoch is called in a separate block as finalize price epoch
      await ftsoManager.daemonize();

      // reveal only for ftso2, not ftso1
      epoch = 2;
      await submitSomePrices(epoch, ftso2, 10, accounts);

      await increaseTimeTo(startTs, 3 * 120);
      await ftsoManager.daemonize();

      await revealSomePrices(ftso2, 10, epoch, accounts);

      await increaseTimeTo(startTs, 3 * 120 + REVEAL_EPOCH_DURATION_S);

      // finalize, ftso1 will force finalize
      await ftsoManager.daemonize();

      ftso1Events = await ftso1.getPastEvents("PriceFinalized");
      ftso2Events = await ftso2.getPastEvents("PriceFinalized");
      assert.equal(lastOf(ftso1Events).args.finalizationType.toNumber(), 3);
      assert.equal(lastOf(ftso2Events).args.finalizationType.toNumber(), 1);
    });

    it("Should emit event if finalize price epoch fails due to WEIGHTED_MEDIAN", async () => {
      // Assemble
      // stub ftso finalizer
      const finalizePriceEpoch = ftsoInterface.contract.methods.finalizePriceEpoch(0, true).encodeABI();
      const fallbackFinalizePriceEpoch = ftsoInterface.contract.methods.fallbackFinalizePriceEpoch(0).encodeABI();
      const forceFinalizePriceEpoch = ftsoInterface.contract.methods.forceFinalizePriceEpoch(0).encodeABI();
      await mockFtso.givenMethodRevertWithMessage(finalizePriceEpoch, "I am broken");
      await mockFtso.givenMethodReturnUint(fallbackFinalizePriceEpoch, 0);
      await mockFtso.givenMethodReturnUint(forceFinalizePriceEpoch, 0);

      await setDefaultGovernanceParameters(ftsoManager);
      // add fakey ftso
      await ftsoManager.addFtso(mockFtso.address, { from: accounts[0] });
      // activate ftso manager
      await ftsoManager.activate();
      await increaseTimeTo(startTs, REVEAL_EPOCH_DURATION_S);
      await ftsoManager.daemonize(); // initialize reward epoch
      await ftsoManager.daemonize(); // initialize price epoch

      // Time travel to reveal end
      await increaseTimeTo(startTs, 120 + REVEAL_EPOCH_DURATION_S);

      // Act
      // Simulate the daemon tickling reward manager
      let tx = await ftsoManager.daemonize();

      // Assert
      // FinalizingPriceEpochFailed due to WEIGHTED_MEDIAN
      expectEvent(tx, "FinalizingPriceEpochFailed", { ftso: mockFtso.address, epochId: toBN(0), failingType: toBN(1) })

      let finalizingPriceEpochFailedEvents = await ftsoManager.getPastEvents("FinalizingPriceEpochFailed")

      const {
        0: lastErrorBlockArr,
        1: numErrorsArr,
        2: errorStringArr,
        3: errorContractArr,
        4: totalDaemonizedErrors
      } = await ftsoManager.showRevertedErrors(0, 3);

      assert.equal(lastErrorBlockArr[0].toNumber(), finalizingPriceEpochFailedEvents[0].blockNumber);
      assert.equal(numErrorsArr[0].toNumber(), 1);
      assert.equal(errorStringArr[0], "I am broken");
      assert.equal(errorContractArr[0], mockFtso.address);
    });

    it("Should emit event if finalize price epoch fails due to TRUSTED_ADDRESSES", async () => {
      // Assemble
      // stub ftso finalizer
      const finalizePriceEpoch = ftsoInterface.contract.methods.finalizePriceEpoch(0, true).encodeABI();
      const fallbackFinalizePriceEpoch = ftsoInterface.contract.methods.fallbackFinalizePriceEpoch(0).encodeABI();
      const forceFinalizePriceEpoch = ftsoInterface.contract.methods.forceFinalizePriceEpoch(0).encodeABI();
      await mockFtso.givenMethodRevertWithMessage(finalizePriceEpoch, "I am broken");
      await mockFtso.givenMethodRevertWithMessage(fallbackFinalizePriceEpoch, "fallbackFinalizePriceEpoch broken too");
      await mockFtso.givenMethodReturnUint(forceFinalizePriceEpoch, 0);

      await setDefaultGovernanceParameters(ftsoManager);
      // add fakey ftso
      await ftsoManager.addFtso(mockFtso.address, { from: accounts[0] });
      // activte ftso manager
      await ftsoManager.activate();
      await increaseTimeTo(startTs, REVEAL_EPOCH_DURATION_S);
      await ftsoManager.daemonize(); // initialize reward epoch
      await ftsoManager.daemonize(); // initialize price epoch

      // Time travel 120 seconds
      await increaseTimeTo(startTs, 120 + REVEAL_EPOCH_DURATION_S);

      // Act
      // Simulate the flare daemon tickling reward manager
      let tx = await ftsoManager.daemonize();

      // Assert
      // FinalizingPriceEpochFailed due to TRUSTED_ADDRESSES
      expectEvent(tx, "FinalizingPriceEpochFailed", { ftso: mockFtso.address, epochId: toBN(0), failingType: toBN(2) })

      let finalizingPriceEpochFailedEvents = await ftsoManager.getPastEvents("FinalizingPriceEpochFailed")

      const {
        0: lastErrorBlockArr1,
        1: numErrorsArr1,
        2: errorStringArr1,
        3: errorContractArr1,
        4: totalDaemonizedErrors1
      } = await ftsoManager.showRevertedErrors(0, 3);

      assert.equal(lastErrorBlockArr1[1].toNumber(), finalizingPriceEpochFailedEvents[1].blockNumber);
      assert.equal(numErrorsArr1[1].toNumber(), 1);
      assert.equal(errorStringArr1[1], "fallbackFinalizePriceEpoch broken too");
      assert.equal(errorContractArr1[1], mockFtso.address);
    });

    it("Should revert if finalize price epoch fails due to PREVIOUS_PRICE_COPIED", async () => {
      // Assemble
      // stub ftso finalizer
      const finalizePriceEpoch = ftsoInterface.contract.methods.finalizePriceEpoch(0, true).encodeABI();
      const fallbackFinalizePriceEpoch = ftsoInterface.contract.methods.fallbackFinalizePriceEpoch(0).encodeABI();
      const forceFinalizePriceEpoch = ftsoInterface.contract.methods.forceFinalizePriceEpoch(0).encodeABI();
      await mockFtso.givenMethodRevertWithMessage(finalizePriceEpoch, "I am broken");
      await mockFtso.givenMethodRevertWithMessage(fallbackFinalizePriceEpoch, "fallbackFinalizePriceEpoch broken too");
      await mockFtso.givenMethodRevertWithMessage(forceFinalizePriceEpoch, "forceFinalizePriceEpoch broken too");

      await setDefaultGovernanceParameters(ftsoManager);
      // add fakey ftso
      await ftsoManager.addFtso(mockFtso.address, { from: accounts[0] });
      // activte ftso manager
      await ftsoManager.activate();
      await increaseTimeTo(startTs, REVEAL_EPOCH_DURATION_S);
      await ftsoManager.daemonize(); // initialize reward epoch
      await ftsoManager.daemonize(); // initialize price epoch

      // Time travel 120 seconds
      await increaseTimeTo(startTs, 120 + REVEAL_EPOCH_DURATION_S);

      // Act
      // Simulate the flare daemon tickling reward manager
      await expectRevert(ftsoManager.daemonize(), "forceFinalizePriceEpoch broken too");
    });

    it("Should return correct price epochs", async () => {
      let lastUnprocessed = await ftsoManager.getLastUnprocessedPriceEpochData();
      assert(lastUnprocessed[0].eq(
        startTs.addn(REVEAL_EPOCH_DURATION_S)
          .sub(startTs)
          .div(toBN(PRICE_EPOCH_DURATION_S))
      ), "Wrong price epoch");
      assert(lastUnprocessed[1].eq(startTs.addn(REVEAL_EPOCH_DURATION_S)), "Wrong epoch")

      await ftsoManager.activate();
      await increaseTimeTo(startTs, REVEAL_EPOCH_DURATION_S);
      await ftsoManager.daemonize(); // _initializeFirstRewardEpoch
      await ftsoManager.daemonize();
      lastUnprocessed = await ftsoManager.getLastUnprocessedPriceEpochData();
      assert(lastUnprocessed[2]);

      await increaseTimeTo(startTs, PRICE_EPOCH_DURATION_S + REVEAL_EPOCH_DURATION_S);
      await ftsoManager.daemonize();
      lastUnprocessed = await ftsoManager.getLastUnprocessedPriceEpochData();
      assert(!lastUnprocessed[2]);
    });

    it("Should set notInitializedFtsos[ftso]=true if not in fallback mode and then delete it", async () => {
      const initializeCurrentEpochStateForReveal = ftsoInterface.contract.methods.initializeCurrentEpochStateForReveal(10000, false).encodeABI();
      await mockFtso.givenCalldataRunOutOfGas(initializeCurrentEpochStateForReveal);
      const initializeCurrentEpochStateForRevealFallback = ftsoInterface.contract.methods.initializeCurrentEpochStateForReveal(0, true).encodeABI();
      await mockFtso.givenCalldataRevertWithMessage(initializeCurrentEpochStateForRevealFallback, "Err");

      await setDefaultGovernanceParameters(ftsoManager);
      await ftsoManager.addFtso(mockFtso.address);

      await ftsoManager.activate();
      await increaseTimeTo(startTs, REVEAL_EPOCH_DURATION_S);
      await ftsoManager.daemonize(); // initialize reward epoch
      assert(!(await ftsoManager.notInitializedFtsos(mockFtso.address)));

      await ftsoManager.daemonize();
      assert(await ftsoManager.notInitializedFtsos(mockFtso.address));

      await increaseTimeTo(startTs, REVEAL_EPOCH_DURATION_S + PRICE_EPOCH_DURATION_S);
      await ftsoManager.daemonize(); // initialize lastUnprocessedPriceEpoc
      assert(!(await ftsoManager.notInitializedFtsos(mockFtso.address)));
    });
  });

  describe("Reward epochs, finalization", async () => {
    it("Should finalize a reward epoch", async () => {
      // Assemble
      await ftsoManager.activate();
      await increaseTimeTo(startTs, REVEAL_EPOCH_DURATION_S);
      await ftsoManager.daemonize();
      // Time travel 2 days
      await increaseTimeTo(startTs, REVEAL_EPOCH_DURATION_S + 172800);
      // Act
      let tx = await ftsoManager.daemonize();
      // // Assert
      expectEvent(tx, "RewardEpochFinalized");
    });

    it("Should finalize a reward epoch at the configured interval", async () => {
      // Assemble
      await ftsoManager.activate();
      // Time travel 2 days
      await increaseTimeTo(startTs, 172800);
      await ftsoManager.daemonize();
      // Time travel another 2 days
      await increaseTimeTo(startTs, 2 * 172800);
      // Act
      let tx = await ftsoManager.daemonize();
      // Assert
      expectEvent(tx, "RewardEpochFinalized");
    });

    it("Should finalize current reward epoch at the configured interval and the next one according to changed reward epoch duration", async () => {
      // Assemble
      await ftsoManager.activate();
      await increaseTimeTo(startTs, REVEAL_EPOCH_DURATION_S);
      await ftsoManager.daemonize(); // start first reward epoch
      await ftsoManager.setRewardEpochDurationSeconds(REWARD_EPOCH_DURATION_S + PRICE_EPOCH_DURATION_S * 10);
      // Time travel 2 days
      await increaseTimeTo(startTs, REWARD_EPOCH_DURATION_S + REVEAL_EPOCH_DURATION_S);
      // Act
      let tx = await ftsoManager.daemonize();
      // Assert
      expectEvent(tx, "RewardEpochFinalized");
      // Time travel another 2 days

      await increaseTimeTo(startTs, REWARD_EPOCH_DURATION_S * 2 + REVEAL_EPOCH_DURATION_S);
      tx = await ftsoManager.daemonize(); // initialize ftsos for reveal
      expectEvent.notEmitted(tx, "RewardEpochFinalized");

      // Time travel to reward epoch end
      await increaseTimeTo(startTs, REWARD_EPOCH_DURATION_S * 2 + REVEAL_EPOCH_DURATION_S + PRICE_EPOCH_DURATION_S * 10);
      tx = await ftsoManager.daemonize(); // finalize ftsos
      expectEvent.notEmitted(tx, "RewardEpochFinalized");
      tx = await ftsoManager.daemonize(); // finalize reward epoch
      expectEvent(tx, "RewardEpochFinalized");
    });

    it("Should set cleanup block after finalization", async () => {
      // Assemble
      await cleanupBlockNumberManager.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_MANAGER]),
        [ADDRESS_UPDATER, ftsoManager.address], {from: ADDRESS_UPDATER});
      const mockVpToken = await MockContract.new();
      await cleanupBlockNumberManager.registerToken(mockVpToken.address);
      await ftsoManager.activate();
      // Time travel 2 days
      await increaseTimeTo(startTs, 172800);
      await ftsoManager.daemonize();
      // Time travel another 2 days
      await increaseTimeTo(startTs, 172800 * 2);
      // Act
      let receipt = await ftsoManager.daemonize();
      // Assert
      await expectEvent.inTransaction(receipt.tx, cleanupBlockNumberManager,
        "CleanupBlockNumberSet", { theContract: mockVpToken.address, success: true });
    });

    it("Must be set as trigger to allow setting cleanup block", async () => {
      // Assemble
      const mockVpToken = await MockContract.new();
      await cleanupBlockNumberManager.registerToken(mockVpToken.address);
      await ftsoManager.activate();
      // Time travel 2 days
      await increaseTimeTo(startTs, 172800);
      await ftsoManager.daemonize();
      // Time travel another 2 days
      await increaseTimeTo(startTs, 172800 * 2);
      // Act
      let receipt = await ftsoManager.daemonize();
      // Assert
      expectEvent(receipt, "CleanupBlockNumberManagerFailedForBlock", {});
      await expectEvent.notEmitted.inTransaction(receipt.tx, cleanupBlockNumberManager, "CleanupBlockNumberSet")
    });

    it("Should setup a reward epoch when initial startup time passes", async () => {
      // Assemble
      // Store block numbers
      const b = [];
      await ftsoManager.activate();
      // Time travel 2 days
      await increaseTimeTo(startTs, 172800);
      await time.advanceBlock();
      b[0] = await web3.eth.getBlockNumber();
      // Act
      // Force another block
      await ftsoManager.daemonize();
      // Assert
      const { votepowerBlock, startBlock } = await ftsoManager.getRewardEpochData(0);
      assert.equal(Number(votepowerBlock), b[0]);
      assert.equal(Number(startBlock), b[0] + 1);
    });

    it("Should select vote power block in the correct interval and be random", async () => {
      await settingWithOneFTSO_1(accounts, ftsoInterface, mockFtso, ftsoManager);
      await ftsoManager.daemonize();
      let b: number[] = [];
      let rewardEpochDataList: any[] = [];
      let currentSnapshotTime = startTs.addn(REWARD_EPOCH_DURATION_S)
      await increaseTimeTo(startTs, REWARD_EPOCH_DURATION_S);
      await time.advanceBlock();

      b[0] = await web3.eth.getBlockNumber();
      // Act
      await ftsoManager.daemonize();
      let secondsPerBlock = 60 * 60 * 6;
      let noRuns = 5;
      for (let i = 0; i < noRuns; i++) {
        let res = toNumberify(await ftsoManager.getRewardEpochData(i));
        rewardEpochDataList.push(res);
        for (let j = 0; j < REWARD_EPOCH_DURATION_S; j += secondsPerBlock) {
          currentSnapshotTime = currentSnapshotTime.addn(secondsPerBlock);
          await increaseTimeTo(currentSnapshotTime, secondsPerBlock);
          // time.increaseTo doesn't increase block number enough, so there is almost no space for random votePowerBlock (after we divide by 7)
          for (let k = 0; k < 10; k++) {
            await time.advanceBlock();
          }
          await ftsoManager.daemonize();
        }
      }
      let offsets = new Set<number>();
      for (let i = 1; i < rewardEpochDataList.length; i++) {
        rewardEpochDataList[i].diff = rewardEpochDataList[i].startBlock - rewardEpochDataList[i - 1].startBlock;
        rewardEpochDataList[i].offset = rewardEpochDataList[i].startBlock - rewardEpochDataList[i].votepowerBlock;
        rewardEpochDataList[i].min = rewardEpochDataList[i].startBlock - Math.ceil(rewardEpochDataList[i].diff / VOTE_POWER_BOUNDARY_FRACTION);
        offsets.add(rewardEpochDataList[i].offset);
        assert(rewardEpochDataList[i].votepowerBlock >= rewardEpochDataList[i].min, "Vote power block in wrong range.");
      }
      assert(offsets.size > 1, "Offsets not random (ok to fail with small probability)");
    });

    it("Should finalize a reward epoch and designate a new vote power block, setting FTSOs to new block", async () => {
      // Assemble
      // stub finalizer
      const finalizePriceEpoch = ftsoInterface.contract.methods.finalizePriceEpoch(0, true).encodeABI();
      const finalizePriceEpochReturn = web3.eth.abi.encodeParameters(
        ['address[]', 'uint256[]', 'uint256'],
        [[], [], '0']);
      await mockFtso.givenMethodReturn(finalizePriceEpoch, finalizePriceEpochReturn);

      await setDefaultGovernanceParameters(ftsoManager);
      // add fakey ftso
      await ftsoManager.addFtso(mockFtso.address, { from: accounts[0] });
      await ftsoManager.activate();
      await increaseTimeTo(startTs, REVEAL_EPOCH_DURATION_S);
      await ftsoManager.daemonize();

      // Act
      for (let i = 1; i <= (172800 / 1200); i++) {
        // Time travel to trigger a price epoch change
        // Cheat and do every 20 mins to reduce test time
        await increaseTimeTo(startTs, 1200 * i + REVEAL_EPOCH_DURATION_S);
        // Mine at least a block
        await time.advanceBlock();
        await ftsoManager.daemonize();
      }

      // finalize reward epoch is called in a separate block as finalize price epoch
      await ftsoManager.daemonize();

      // Assert
      const chillNonrevealingDataProviders = web3.utils.sha3("chillNonrevealingDataProviders(uint256,uint256)")!.slice(0, 10); // first 4 bytes is function selector
      let invocationCount = await mockPriceSubmitter.invocationCountForMethod.call(chillNonrevealingDataProviders);
      assert.equal(invocationCount.toNumber(), 0);
      // Get the invocation count for setting new vote power block on mocked FTSO
      const setVotePowerBlock = web3.utils.sha3("setVotePowerBlock(uint256)")!.slice(0, 10); // first 4 bytes is function selector
      invocationCount = await mockFtso.invocationCountForMethod.call(setVotePowerBlock);
      // Should be 2 invocations; 1 during initializing first reward epoch, 1 during reward epoch finalization - for 1 FTSO
      assert.equal(invocationCount.toNumber(), 2);
    });

    it("Should postopone finalizing a reward epoch until getting a good random", async () => {
      // Assemble
      // stub finalizer
      const finalizePriceEpoch = ftsoInterface.contract.methods.finalizePriceEpoch(0, true).encodeABI();
      const finalizePriceEpochReturn = web3.eth.abi.encodeParameters(
        ['address[]', 'uint256[]', 'uint256'],
        [[], [], '0']);
      await mockFtso.givenMethodReturn(finalizePriceEpoch, finalizePriceEpochReturn);

      await setDefaultGovernanceParameters(ftsoManager);

      const chillNonrevealingDataProviders = web3.utils.sha3("chillNonrevealingDataProviders(uint256,uint256)")!.slice(0, 10); // first 4 bytes is function selector
      const getCurrentRandomWithQuality = web3.utils.sha3("getCurrentRandomWithQuality()")!.slice(0, 10); // first 4 bytes is function selector
      let getCurrentRandomWithQualityReturn = web3.eth.abi.encodeParameters(
        ['uint256', 'bool'],
        [100, false]);
      await mockPriceSubmitter.givenMethodReturn(getCurrentRandomWithQuality, getCurrentRandomWithQualityReturn);
      await ftsoManager.setUseGoodRandom(true, 86400);

      // add fakey ftso
      await ftsoManager.addFtso(mockFtso.address, { from: accounts[0] });
      await ftsoManager.activate();
      await increaseTimeTo(startTs, REVEAL_EPOCH_DURATION_S);
      await ftsoManager.daemonize();

      const currentRewardEpoch = (await ftsoManager.getCurrentRewardEpoch()).toNumber();

      // Act
      for (let i = 1; i <= (172800 / 1200); i++) {
        // Time travel to trigger a price epoch change
        // Cheat and do every 20 mins to reduce test time
        await increaseTimeTo(startTs, 1200 * i + REVEAL_EPOCH_DURATION_S);
        // Mine at least a block
        await time.advanceBlock();
        const tx = await ftsoManager.daemonize();
        const invocationCount = await mockPriceSubmitter.invocationCountForMethod.call(chillNonrevealingDataProviders);
        assert.equal(invocationCount.toNumber(), Math.floor(i / 2));
        expectEvent.notEmitted(tx, "ChillingNonrevealingDataProvidersFailed");
      }

      expect(currentRewardEpoch).to.equals((await ftsoManager.getCurrentRewardEpoch()).toNumber());

      // should not finalize reward epoch yet
      let tx = await ftsoManager.daemonize();
      expectEvent.notEmitted(tx, "RewardEpochFinalized");
      expectEvent.notEmitted(tx, "ChillingNonrevealingDataProvidersFailed");
      const waitingSinceTs = (await time.latest()).toNumber();
      assert.equal((await ftsoManager.waitingForGoodRandomSinceTs()).toNumber(), waitingSinceTs);

      for (let i = 1; i < 10; i++) {
        // Time travel to trigger a price epoch change
        // Cheat and do every 20 mins to reduce test time
        await increaseTimeTo(startTs, 1200 * (i + (172800 / 1200)) + REVEAL_EPOCH_DURATION_S);
        // Mine at least a block
        await time.advanceBlock();
        tx = await ftsoManager.daemonize();
        expectEvent.notEmitted(tx, "RewardEpochFinalized");
        expectEvent.notEmitted(tx, "ChillingNonrevealingDataProvidersFailed");

        expect(currentRewardEpoch).to.equals((await ftsoManager.getCurrentRewardEpoch()).toNumber());
        const invocationCount = await mockPriceSubmitter.invocationCountForMethod.call(chillNonrevealingDataProviders);
        assert.equal(invocationCount.toNumber(), 72 + Math.ceil(i / 2));
        assert.equal((await ftsoManager.waitingForGoodRandomSinceTs()).toNumber(), waitingSinceTs);
      }

      getCurrentRandomWithQualityReturn = web3.eth.abi.encodeParameters(
        ['uint256', 'bool'],
        [100, true]);
      await mockPriceSubmitter.givenMethodReturn(getCurrentRandomWithQuality, getCurrentRandomWithQualityReturn);
      let invocationCount = await mockPriceSubmitter.invocationCountForMethod.call(chillNonrevealingDataProviders);
      assert.equal(invocationCount.toNumber(), 77);

      // should finalize reward epoch
      tx = await ftsoManager.daemonize();
      expectEvent(tx, "RewardEpochFinalized");
      expectEvent.notEmitted(tx, "ChillingNonrevealingDataProvidersFailed");
      assert.equal((await ftsoManager.waitingForGoodRandomSinceTs()).toNumber(), 0);

      // Assert
      invocationCount = await mockPriceSubmitter.invocationCountForMethod.call(chillNonrevealingDataProviders);
      assert.equal(invocationCount.toNumber(), 77);
      // Get the invocation count for setting new vote power block on mocked FTSO
      const setVotePowerBlock = web3.utils.sha3("setVotePowerBlock(uint256)")!.slice(0, 10); // first 4 bytes is function selector
      invocationCount = await mockFtso.invocationCountForMethod.call(setVotePowerBlock);
      // Should be 2 invocations; 1 during initializing first reward epoch, 1 during reward epoch finalization - for 1 FTSO
      assert.equal(invocationCount.toNumber(), 2);
    });

    it("Should finalize a reward epoch after wait time even if no good random", async () => {
      // Assemble
      // stub finalizer
      const finalizePriceEpoch = ftsoInterface.contract.methods.finalizePriceEpoch(0, true).encodeABI();
      const finalizePriceEpochReturn = web3.eth.abi.encodeParameters(
        ['address[]', 'uint256[]', 'uint256'],
        [[], [], '0']);
      await mockFtso.givenMethodReturn(finalizePriceEpoch, finalizePriceEpochReturn);

      await setDefaultGovernanceParameters(ftsoManager);

      const chillNonrevealingDataProviders = web3.utils.sha3("chillNonrevealingDataProviders(uint256,uint256)")!.slice(0, 10); // first 4 bytes is function selector
      const getCurrentRandomWithQuality = web3.utils.sha3("getCurrentRandomWithQuality()")!.slice(0, 10); // first 4 bytes is function selector
      let getCurrentRandomWithQualityReturn = web3.eth.abi.encodeParameters(
        ['uint256', 'bool'],
        [100, false]);
      await mockPriceSubmitter.givenMethodReturn(getCurrentRandomWithQuality, getCurrentRandomWithQualityReturn);
      await ftsoManager.setUseGoodRandom(true, 10000);

      // add fakey ftso
      await ftsoManager.addFtso(mockFtso.address, { from: accounts[0] });
      await ftsoManager.activate();
      await increaseTimeTo(startTs, REVEAL_EPOCH_DURATION_S);
      await ftsoManager.daemonize();

      const currentRewardEpoch = (await ftsoManager.getCurrentRewardEpoch()).toNumber();

      // Act
      for (let i = 1; i <= (172800 / 1200); i++) {
        // Time travel to trigger a price epoch change
        // Cheat and do every 20 mins to reduce test time
        await increaseTimeTo(startTs, 1200 * i + REVEAL_EPOCH_DURATION_S);
        // Mine at least a block
        await time.advanceBlock();
        const tx = await ftsoManager.daemonize();
        const invocationCount = await mockPriceSubmitter.invocationCountForMethod.call(chillNonrevealingDataProviders);
        assert.equal(invocationCount.toNumber(), Math.floor(i / 2));
        expectEvent.notEmitted(tx, "ChillingNonrevealingDataProvidersFailed");
      }

      expect(currentRewardEpoch).to.equals((await ftsoManager.getCurrentRewardEpoch()).toNumber());

      // should not finalize reward epoch yet
      let tx = await ftsoManager.daemonize();
      expectEvent.notEmitted(tx, "RewardEpochFinalized");
      expectEvent.notEmitted(tx, "ChillingNonrevealingDataProvidersFailed");
      const waitingSinceTs = (await time.latest()).toNumber();
      assert.equal((await ftsoManager.waitingForGoodRandomSinceTs()).toNumber(), waitingSinceTs);

      for (let i = 1; i < 10; i++) {
        // Time travel to trigger a price epoch change
        // Cheat and do every 20 mins to reduce test time
        await increaseTimeTo(startTs, 1200 * (i + (172800 / 1200)) + REVEAL_EPOCH_DURATION_S);
        // Mine at least a block
        await time.advanceBlock();
        tx = await ftsoManager.daemonize();
        expectEvent.notEmitted(tx, "RewardEpochFinalized");
        expectEvent.notEmitted(tx, "ChillingNonrevealingDataProvidersFailed");

        expect(currentRewardEpoch).to.equals((await ftsoManager.getCurrentRewardEpoch()).toNumber());
        const invocationCount = await mockPriceSubmitter.invocationCountForMethod.call(chillNonrevealingDataProviders);
        assert.equal(invocationCount.toNumber(), 72 + Math.ceil(i / 2));
        assert.equal((await ftsoManager.waitingForGoodRandomSinceTs()).toNumber(), waitingSinceTs);
      }

      let invocationCount = await mockPriceSubmitter.invocationCountForMethod.call(chillNonrevealingDataProviders);
      assert.equal(invocationCount.toNumber(), 77);

      // should finalize reward epoch after max wait time even if no good random
      tx = await ftsoManager.daemonize();
      expectEvent(tx, "RewardEpochFinalized");
      expectEvent.notEmitted(tx, "ChillingNonrevealingDataProvidersFailed");
      assert.equal((await ftsoManager.waitingForGoodRandomSinceTs()).toNumber(), 0);

      // should initialize new price epoch
      tx = await ftsoManager.daemonize();
      expectEvent.notEmitted(tx, "RewardEpochFinalized");
      expectEvent.notEmitted(tx, "ChillingNonrevealingDataProvidersFailed");
      assert.equal((await ftsoManager.waitingForGoodRandomSinceTs()).toNumber(), 0);

      // should finalize price epoch
      await time.increase(1200);
      tx = await ftsoManager.daemonize();
      expectEvent.notEmitted(tx, "RewardEpochFinalized");
      expectEvent.notEmitted(tx, "ChillingNonrevealingDataProvidersFailed");
      assert.equal((await ftsoManager.waitingForGoodRandomSinceTs()).toNumber(), 0);
      // Assert
      invocationCount = await mockPriceSubmitter.invocationCountForMethod.call(chillNonrevealingDataProviders);
      assert.equal(invocationCount.toNumber(), 78);
      // Get the invocation count for setting new vote power block on mocked FTSO
      const setVotePowerBlock = web3.utils.sha3("setVotePowerBlock(uint256)")!.slice(0, 10); // first 4 bytes is function selector
      invocationCount = await mockFtso.invocationCountForMethod.call(setVotePowerBlock);
      // Should be 2 invocations; 1 during initializing first reward epoch, 1 during reward epoch finalization - for 1 FTSO
      assert.equal(invocationCount.toNumber(), 2);
    });

    it("Should emit event if chilling nonrevealing data providers fails", async () => {
      // Assemble
      // stub finalizer
      const finalizePriceEpoch = ftsoInterface.contract.methods.finalizePriceEpoch(0, true).encodeABI();
      const finalizePriceEpochReturn = web3.eth.abi.encodeParameters(
        ['address[]', 'uint256[]', 'uint256'],
        [[], [], '0']);
      await mockFtso.givenMethodReturn(finalizePriceEpoch, finalizePriceEpochReturn);

      await setDefaultGovernanceParameters(ftsoManager);

      const chillNonrevealingDataProviders = web3.utils.sha3("chillNonrevealingDataProviders(uint256,uint256)")!.slice(0, 10); // first 4 bytes is function selector
      const getCurrentRandomWithQuality = web3.utils.sha3("getCurrentRandomWithQuality()")!.slice(0, 10); // first 4 bytes is function selector
      let getCurrentRandomWithQualityReturn = web3.eth.abi.encodeParameters(
        ['uint256', 'bool'],
        [100, false]);
      await mockPriceSubmitter.givenMethodReturn(getCurrentRandomWithQuality, getCurrentRandomWithQualityReturn);
      await mockPriceSubmitter.givenMethodRevertWithMessage(chillNonrevealingDataProviders, "chilling error");
      await ftsoManager.setUseGoodRandom(true, 86400);

      // add fakey ftso
      await ftsoManager.addFtso(mockFtso.address, { from: accounts[0] });
      await ftsoManager.activate();
      await increaseTimeTo(startTs, REVEAL_EPOCH_DURATION_S);
      await ftsoManager.daemonize();

      const currentRewardEpoch = (await ftsoManager.getCurrentRewardEpoch()).toNumber();

      // Act
      for (let i = 1; i <= (172800 / 1200); i++) {
        // Time travel to trigger a price epoch change
        // Cheat and do every 20 mins to reduce test time
        await increaseTimeTo(startTs, 1200 * i + REVEAL_EPOCH_DURATION_S);
        // Mine at least a block
        await time.advanceBlock();
        const tx = await ftsoManager.daemonize();
        if (i % 2 == 0) {
          expectEvent(tx, "ChillingNonrevealingDataProvidersFailed");
          const {
            0: lastErrorBlock,
            1: numErrors,
            2: errorString,
            3: errorContract,
          } = await ftsoManager.showLastRevertedError();

          assert.equal(lastErrorBlock[0].toNumber(), tx.logs[0].blockNumber);
          assert.equal(numErrors[0].toNumber(), i / 2);
          assert.equal(errorString[0], "chilling error");
          assert.equal(errorContract[0], mockPriceSubmitter.address);
        } else {
          expectEvent.notEmitted(tx, "ChillingNonrevealingDataProvidersFailed");
        }
      }

      expect(currentRewardEpoch).to.equals((await ftsoManager.getCurrentRewardEpoch()).toNumber());

      await mockPriceSubmitter.givenMethodRunOutOfGas(chillNonrevealingDataProviders);

      // should not finalize reward epoch yet
      let tx = await ftsoManager.daemonize();
      expectEvent.notEmitted(tx, "RewardEpochFinalized");
      expectEvent.notEmitted(tx, "ChillingNonrevealingDataProvidersFailed");
      const waitingSinceTs = (await time.latest()).toNumber();
      assert.equal((await ftsoManager.waitingForGoodRandomSinceTs()).toNumber(), waitingSinceTs);

      for (let i = 1; i < 10; i++) {
        // Time travel to trigger a price epoch change
        // Cheat and do every 20 mins to reduce test time
        await increaseTimeTo(startTs, 1200 * (i + (172800 / 1200)) + REVEAL_EPOCH_DURATION_S);
        // Mine at least a block
        await time.advanceBlock();
        tx = await ftsoManager.daemonize();
        expectEvent.notEmitted(tx, "RewardEpochFinalized");
        if (i % 2 == 1) {
          expectEvent(tx, "ChillingNonrevealingDataProvidersFailed");
          const {
            0: lastErrorBlock,
            1: numErrors,
            2: errorString,
            3: errorContract,
          } = await ftsoManager.showLastRevertedError();

          assert.equal(lastErrorBlock[0].toNumber(), tx.logs[0].blockNumber);
          assert.equal(numErrors[0].toNumber(), Math.ceil(i / 2));
          assert.equal(errorString[0], "err calling chillNonrevealingDataProviders");
          assert.equal(errorContract[0], mockPriceSubmitter.address);
        } else {
          expectEvent.notEmitted(tx, "ChillingNonrevealingDataProvidersFailed");
        }

        expect(currentRewardEpoch).to.equals((await ftsoManager.getCurrentRewardEpoch()).toNumber());
        assert.equal((await ftsoManager.waitingForGoodRandomSinceTs()).toNumber(), waitingSinceTs);
      }

      getCurrentRandomWithQualityReturn = web3.eth.abi.encodeParameters(
        ['uint256', 'bool'],
        [100, true]);
      await mockPriceSubmitter.givenMethodReturn(getCurrentRandomWithQuality, getCurrentRandomWithQualityReturn);

      // should finalize reward epoch
      tx = await ftsoManager.daemonize();
      expectEvent(tx, "RewardEpochFinalized");
      expectEvent.notEmitted(tx, "ChillingNonrevealingDataProvidersFailed");
      assert.equal((await ftsoManager.waitingForGoodRandomSinceTs()).toNumber(), 0);

      // Assert
      let invocationCount = await mockPriceSubmitter.invocationCountForMethod.call(chillNonrevealingDataProviders);
      assert.equal(invocationCount.toNumber(), 0);
      // Get the invocation count for setting new vote power block on mocked FTSO
      const setVotePowerBlock = web3.utils.sha3("setVotePowerBlock(uint256)")!.slice(0, 10); // first 4 bytes is function selector
      invocationCount = await mockFtso.invocationCountForMethod.call(setVotePowerBlock);
      // Should be 2 invocations; 1 during initializing first reward epoch, 1 during reward epoch finalization - for 1 FTSO
      assert.equal(invocationCount.toNumber(), 2);
    });

    it("Should emit event if close expired reward epochs fails", async () => {
      // Assemble
      // stub ftso initialize
      const closeExpiredRewardEpoch = ftsoRewardManagerInterface.contract.methods.closeExpiredRewardEpoch(0).encodeABI();
      await mockRewardManager.givenMethodRevertWithMessage(closeExpiredRewardEpoch, "I am broken");

      await setDefaultGovernanceParameters(ftsoManager);
      // activate ftso manager
      await ftsoManager.activate();
      await increaseTimeTo(startTs, REVEAL_EPOCH_DURATION_S);
      await ftsoManager.daemonize();

      // act - go through 6 2-day rewardEpochs, so the first can be expired
      let tx = null;
      for (let i = 1; i <= 6; i++) {
        await increaseTimeTo(startTs, i * 2 * DAY + REVEAL_EPOCH_DURATION_S); // i*two days
        tx = await ftsoManager.daemonize();
      }
      // Assert
      expectEvent(tx!, "ClosingExpiredRewardEpochFailed");
    });

    it("Should call distribute rewards correctly at the transition to the next reward epoch", async () => {
      let yearSeconds = 60 * 60 * 24 * 365; // 2021

      // longer reward and price epochs - time travel and calling daemonize()
      ftsoManager = await FtsoManager.new(
        accounts[0],
        accounts[0],
        ADDRESS_UPDATER,
        constants.ZERO_ADDRESS,
        startTs,
        yearSeconds / 10,
        REVEAL_EPOCH_DURATION_S,
        startTs.addn(REVEAL_EPOCH_DURATION_S),
        yearSeconds,
        VOTE_POWER_BOUNDARY_FRACTION,
      );

      await ftsoManager.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.PRICE_SUBMITTER, Contracts.FTSO_REWARD_MANAGER, Contracts.FTSO_REGISTRY, Contracts.VOTER_WHITELISTER, Contracts.SUPPLY, Contracts.CLEANUP_BLOCK_NUMBER_MANAGER]),
        [ADDRESS_UPDATER, mockPriceSubmitter.address, mockRewardManager.address, registry.address, mockVoterWhitelister.address, mockSupply.address, cleanupBlockNumberManager.address], { from: ADDRESS_UPDATER });

        await registry.updateContractAddresses(
          encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_MANAGER]),
          [ADDRESS_UPDATER, ftsoManager.address], {from: ADDRESS_UPDATER});

      // stub ftso finalizer
      const finalizePriceEpoch = ftsoInterface.contract.methods.finalizePriceEpoch(0, true).encodeABI();
      const finalizePriceEpochReturn = web3.eth.abi.encodeParameters(
        ['address[]', 'uint256[]', 'uint256'],
        [[accounts[1], accounts[2]], [25, 75], 100]);
      await mockFtso.givenMethodReturn(finalizePriceEpoch, finalizePriceEpochReturn);

      await setDefaultGovernanceParameters(ftsoManager);
      // add fakey ftso
      await ftsoManager.addFtso(mockFtso.address, { from: accounts[0] });
      // activate ftso manager
      await ftsoManager.activate();
      await increaseTimeTo(startTs, REVEAL_EPOCH_DURATION_S);
      await ftsoManager.daemonize(); // initialize reward epoch
      await ftsoManager.daemonize(); // initialize price epoch

      // Time travel
      for (let i = 1; i < 10; i++) { // one year
        await increaseTimeTo(startTs, i * yearSeconds / 10 + 30);
        await ftsoManager.daemonize(); // finalize price epoch
        await ftsoManager.daemonize(); // initialize price epoch
      }

      await increaseTimeTo(startTs, 10 * yearSeconds / 10 + 30);
      await ftsoManager.daemonize(); // finalize price epoch
      await ftsoManager.daemonize(); // finalize reward epoch
      await ftsoManager.daemonize(); // initialize price epoch

      // Act
      // Simulate the daemon tickling reward manager
      await increaseTimeTo(startTs, 11 * yearSeconds / 10 + 30);
      await ftsoManager.daemonize(); // finalize price epoch

      // address[] memory addresses,
      // uint256[] memory weights,
      // uint256 totalWeight,
      // uint256 epochId,
      // address ftso,
      // uint256 priceEpochDurationSeconds,
      // uint256 currentRewardEpoch
      // uint256 _priceEpochEndTime, // end time included in epoch
      // uint256 _votePowerBlock
      const distributeRewards = ftsoRewardManagerInterface.contract.methods.distributeRewards(
        [accounts[1], accounts[2]],
        [25, 75],
        100,
        9,
        mockFtso.address,
        yearSeconds / 10,
        0,
        startTs.addn((yearSeconds / 10 * 10) - 1),
        await ftsoManager.getRewardEpochVotePowerBlock(0)
      ).encodeABI();

      const distributeRewards2 = ftsoRewardManagerInterface.contract.methods.distributeRewards(
        [accounts[1], accounts[2]],
        [25, 75],
        100,
        10,
        mockFtso.address,
        yearSeconds / 10,
        1,
        startTs.addn((yearSeconds / 10 * 11) - 1),
        await ftsoManager.getRewardEpochVotePowerBlock(1)
      ).encodeABI();

      // Assert
      const invocationCountWithData = await mockRewardManager.invocationCountForCalldata.call(distributeRewards);
      assert.equal(invocationCountWithData.toNumber(), 1);
      const invocationCountWithData2 = await mockRewardManager.invocationCountForCalldata.call(distributeRewards2);
      assert.equal(invocationCountWithData2.toNumber(), 1);
    });

    it("Should get reward epoch configuration", async () => {
      let rewardEpochConfig = await ftsoManager.getRewardEpochConfiguration();
      assert(rewardEpochConfig[0].eq(startTs.addn(REVEAL_EPOCH_DURATION_S)));
      expect(rewardEpochConfig[1].toNumber()).to.equals(REWARD_EPOCH_DURATION_S);
      assert((await ftsoManager.rewardEpochsStartTs()).eq(startTs.addn(REVEAL_EPOCH_DURATION_S)));
      expect((await ftsoManager.rewardEpochDurationSeconds()).toNumber()).to.equals(REWARD_EPOCH_DURATION_S);
    });

    it("Should get reward epoch that expires next", async () => {
      let rewardEpochExpire = await ftsoManager.getRewardEpochToExpireNext();
      expect(rewardEpochExpire.toNumber()).to.equals(0);
    });

    it("Should emit event for a close expired reward epochs catch statement without a message", async () => {
      const closeExpiredRewardEpoch = ftsoRewardManagerInterface.contract.methods.closeExpiredRewardEpoch(0).encodeABI();
      // await mockRewardManager.givenAnyRunOutOfGas();
      await mockRewardManager.givenMethodRunOutOfGas(closeExpiredRewardEpoch);

      await ftsoManager.activate();
      await ftsoManager.daemonize();
      await increaseTimeTo(startTs, REVEAL_EPOCH_DURATION_S);
      await ftsoManager.daemonize(); // _initializeFirstRewardEpoch
      await increaseTimeTo(startTs, 172800 + REVEAL_EPOCH_DURATION_S);
      let tx = await ftsoManager.daemonize();

      expectEvent(tx, "ClosingExpiredRewardEpochFailed");
    });

    it("Should emit event for a block cleanup catch statement without a message", async () => {
      let cleanUp = await MockContract.new();

      await ftsoManager.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.PRICE_SUBMITTER, Contracts.FTSO_REWARD_MANAGER, Contracts.FTSO_REGISTRY, Contracts.VOTER_WHITELISTER, Contracts.SUPPLY, Contracts.CLEANUP_BLOCK_NUMBER_MANAGER]),
        [ADDRESS_UPDATER, mockPriceSubmitter.address, mockRewardManager.address, registry.address, mockVoterWhitelister.address, mockSupply.address, cleanUp.address], { from: ADDRESS_UPDATER });

      const setCleanUpBlockNumber = cleanupBlockNumberManager.contract.methods.setCleanUpBlockNumber(0).encodeABI();
      await cleanUp.givenMethodRunOutOfGas(setCleanUpBlockNumber);

      await ftsoManager.activate();
      await ftsoManager.daemonize();
      await increaseTimeTo(startTs, REVEAL_EPOCH_DURATION_S);
      await ftsoManager.daemonize(); // _initializeFirstRewardEpoch
      await increaseTimeTo(startTs, 172800 + REVEAL_EPOCH_DURATION_S);
      let tx = await ftsoManager.daemonize();
      expectEvent(tx, "CleanupBlockNumberManagerFailedForBlock", {});
      await expectEvent.notEmitted.inTransaction(tx.tx, cleanupBlockNumberManager, "CleanupBlockNumberSet")
    });

    it("Should emit event for a finalize price epoch catch statement without a message", async () => {
      let finalizePriceEpoch = ftsoInterface.contract.methods.finalizePriceEpoch(0, true).encodeABI();
      await mockFtso.givenMethodRunOutOfGas(finalizePriceEpoch);

      await setDefaultGovernanceParameters(ftsoManager);
      await ftsoManager.addFtso(mockFtso.address);

      await ftsoManager.activate();
      await increaseTimeTo(startTs, REVEAL_EPOCH_DURATION_S);
      await ftsoManager.daemonize(); // initialize reward epoch
      await ftsoManager.daemonize(); // initialize price epoch
      await increaseTimeTo(startTs, REVEAL_EPOCH_DURATION_S + PRICE_EPOCH_DURATION_S);
      let tx = await ftsoManager.daemonize();
      expectEvent(tx, "FinalizingPriceEpochFailed");
    });

    it("Should emit event for a distributing rewards catch statement without a message", async () => {
      const finalizePriceEpoch = ftsoInterface.contract.methods.finalizePriceEpoch(0, true).encodeABI();
      const finalizePriceEpochReturn = web3.eth.abi.encodeParameters(
        ['address[]', 'uint256[]', 'uint256'],
        [[accounts[1], accounts[2]], [25, 75], 100]);
      await mockFtso.givenMethodReturn(finalizePriceEpoch, finalizePriceEpochReturn);

      await setDefaultGovernanceParameters(ftsoManager);
      await ftsoManager.addFtso(mockFtso.address);

      await ftsoManager.activate();
      await increaseTimeTo(startTs, REVEAL_EPOCH_DURATION_S);
      await ftsoManager.daemonize(); // initialize reward epoch
      await ftsoManager.daemonize(); // initialize price epoch
      await increaseTimeTo(startTs, REVEAL_EPOCH_DURATION_S + PRICE_EPOCH_DURATION_S);

      const distributeRewards = ftsoRewardManagerInterface.contract.methods.distributeRewards(
        [accounts[1], accounts[2]],
        [25, 75],
        100,
        0,
        mockFtso.address,
        120,
        0,
        startTs.addn(PRICE_EPOCH_DURATION_S - 1),
        await ftsoManager.getRewardEpochVotePowerBlock(0)
      ).encodeABI();
      await mockRewardManager.givenMethodRunOutOfGas(distributeRewards);

      let tx = await ftsoManager.daemonize();
      expectEvent(tx, "DistributingRewardsFailed", { ftso: mockFtso.address, epochId: toBN(0) });
    });

    it("Should emit event for a accrue unearned rewards catch statement without a message if ftso manager in fallback mode ", async () => {
      const finalizePriceEpoch = ftsoInterface.contract.methods.finalizePriceEpoch(0, true).encodeABI();
      const finalizePriceEpochReturn = web3.eth.abi.encodeParameters(
        ['address[]', 'uint256[]', 'uint256'],
        [[accounts[1], accounts[2]], [25, 75], 100]);
      await mockFtso.givenMethodReturn(finalizePriceEpoch, finalizePriceEpochReturn);

      await setDefaultGovernanceParameters(ftsoManager);
      await ftsoManager.addFtso(mockFtso.address);

      await ftsoManager.activate();
      await ftsoManager.setFallbackMode(true);
      await increaseTimeTo(startTs, REVEAL_EPOCH_DURATION_S);
      await ftsoManager.daemonize(); // initialize reward epoch
      await ftsoManager.daemonize(); // initialize price epoch
      await increaseTimeTo(startTs, REVEAL_EPOCH_DURATION_S + PRICE_EPOCH_DURATION_S);

      const accrueUnearnedRewards = ftsoRewardManagerInterface.contract.methods.accrueUnearnedRewards(
        0,
        120,
        startTs.addn(PRICE_EPOCH_DURATION_S - 1)
      ).encodeABI();
      await mockRewardManager.givenMethodRunOutOfGas(accrueUnearnedRewards);

      let tx = await ftsoManager.daemonize();
      expectEvent(tx, "AccruingUnearnedRewardsFailed", { epochId: toBN(0) });
    });

    it("Should emit event for a accrue unearned rewards catch statement without a message if no ftso could get rewards", async () => {
      const finalizePriceEpoch = ftsoInterface.contract.methods.finalizePriceEpoch(0, true).encodeABI();
      const finalizePriceEpochReturn = web3.eth.abi.encodeParameters(
        ['address[]', 'uint256[]', 'uint256'],
        [[], [], '0']);
      await mockFtso.givenMethodReturn(finalizePriceEpoch, finalizePriceEpochReturn);

      await setDefaultGovernanceParameters(ftsoManager);
      await ftsoManager.addFtso(mockFtso.address);

      await ftsoManager.activate();
      await increaseTimeTo(startTs, REVEAL_EPOCH_DURATION_S);
      await ftsoManager.daemonize(); // initialize reward epoch
      await ftsoManager.daemonize(); // initialize price epoch
      await increaseTimeTo(startTs, REVEAL_EPOCH_DURATION_S + PRICE_EPOCH_DURATION_S);

      const accrueUnearnedRewards = ftsoRewardManagerInterface.contract.methods.accrueUnearnedRewards(
        0,
        120,
        startTs.addn(PRICE_EPOCH_DURATION_S - 1)
      ).encodeABI();
      await mockRewardManager.givenMethodRunOutOfGas(accrueUnearnedRewards);

      let tx = await ftsoManager.daemonize();
      expectEvent(tx, "AccruingUnearnedRewardsFailed", { epochId: toBN(0) });
    });

    it("Should emit event for a initialize current epoch for reveal catch statement without a message", async () => {
      const initializeCurrentEpochStateForReveal = ftsoInterface.contract.methods.initializeCurrentEpochStateForReveal(10000, false).encodeABI();
      await mockFtso.givenCalldataRunOutOfGas(initializeCurrentEpochStateForReveal);
      const initializeCurrentEpochStateForRevealFallback = ftsoInterface.contract.methods.initializeCurrentEpochStateForReveal(0, true).encodeABI();
      await mockFtso.givenCalldataRevertWithMessage(initializeCurrentEpochStateForRevealFallback, "Err");
      await setDefaultGovernanceParameters(ftsoManager);
      await ftsoManager.addFtso(mockFtso.address);

      await ftsoManager.activate();
      await increaseTimeTo(startTs, REVEAL_EPOCH_DURATION_S);
      await ftsoManager.daemonize(); // initialize reward epoch
      let tx = await ftsoManager.daemonize();
      expectEvent(tx, "InitializingCurrentEpochStateForRevealFailed");
    });

    it("Should set reward data if not activated and revert if activated", async () => {
      await ftsoManager.setInitialRewardData(0, 4, 5);
      let nextRewardEpochToExpire = await ftsoManager.getRewardEpochToExpireNext();
      let currentRewardEpochId = await ftsoManager.getCurrentRewardEpoch();
      let rewardEpochsLength = currentRewardEpochId.toNumber() + 1;
      expect(nextRewardEpochToExpire.toNumber()).to.equals(0);
      expect(rewardEpochsLength).to.equals(4);
      expect((await ftsoManager.currentRewardEpochEnds()).toNumber()).to.equals(5);

      await ftsoManager.activate();
      await expectRevert(ftsoManager.setInitialRewardData(0, 1, 3), "Already activated");
    });

    it("Should emit event if added FTSO list to the list of rewarded FTSOs", async () => {
      await ftsoManager.setGovernanceParameters(0, 5, 5, 50, 500, 500, 5000, 0, 10 * DAY, [], { from: accounts[0] });
      let mockFtso2 = await MockFtso.new();
      let ftsos = [mockFtso.address, mockFtso2.address];
      let tx = await ftsoManager.addFtsosBulk(ftsos);
      expectEvent(tx, "FtsoAdded", { ftso: mockFtso.address, add: true });
      expectEvent(tx, "FtsoAdded", { ftso: mockFtso2.address, add: true });

    });

    it("Should revert if added gov. params. are not initialized when adding FTSO list", async () => {
      let mockFtso2 = await MockFtso.new();
      let ftsos = [mockFtso.address, mockFtso2.address];
      await expectRevert(ftsoManager.addFtsosBulk(ftsos), ERR_GOV_PARAMS_NOT_INIT_FOR_FTSOS);
    });

    it("Should emit event if bulk replace of ftsos and if deactivation fails", async () => {
      await setDefaultGovernanceParameters(ftsoManager);
      await ftsoManager.addFtso(mockFtso.address);
      let mockFtso2 = await MockFtso.new();
      let mockFtso3 = await MockFtso.new();
      let mockFtso4 = await MockFtso.new();

      const symbol1 = ftsoInterface.contract.methods.symbol().encodeABI();
      const symbolReturn1 = web3.eth.abi.encodeParameter('string', 'ATOK1');
      await mockFtso3.givenMethodReturn(symbol1, symbolReturn1);
      await mockFtso4.givenMethodReturn(symbol1, symbolReturn1);

      await ftsoManager.addFtso(mockFtso3.address);
      const symbol = ftsoInterface.contract.methods.symbol().encodeABI();
      const symbolReturn = web3.eth.abi.encodeParameter('string', 'ATOK');
      await mockFtso.givenMethodReturn(symbol, symbolReturn);
      await mockFtso2.givenMethodReturn(symbol, symbolReturn);

      const deactivateFtso = ftsoInterface.contract.methods.deactivateFtso().encodeABI();
      await mockFtso.givenMethodRevertWithMessage(deactivateFtso, "err");

      const deactivateFtso3 = ftsoInterface.contract.methods.deactivateFtso().encodeABI();
      await mockFtso3.givenMethodRevertWithMessage(deactivateFtso3, "err");

      let tx = await ftsoManager.replaceFtsosBulk([mockFtso2.address, mockFtso4.address], false, false);

      expectEvent(tx, "FtsoAdded", { ftso: mockFtso.address, add: false });
      expectEvent(tx, "FtsoAdded", { ftso: mockFtso2.address, add: true });
      expectEvent(tx, "FtsoAdded", { ftso: mockFtso3.address, add: false });
      expectEvent(tx, "FtsoAdded", { ftso: mockFtso4.address, add: true });
      expectEvent(tx, "FtsoDeactivationFailed", { ftso: mockFtso3.address });
      expectEvent(tx, "FtsoDeactivationFailed", { ftso: mockFtso.address });
    });

    it("Should emit events if (bulk) replacing ftso with the same ftso", async () => {
      const symbol = ftsoInterface.contract.methods.symbol().encodeABI();
      const symbolReturn = web3.eth.abi.encodeParameter('string', 'ATOK');
      await mockFtso.givenMethodReturn(symbol, symbolReturn);

      let mockFtso3 = await MockFtso.new();
      const symbol1 = ftsoInterface.contract.methods.symbol().encodeABI();
      const symbolReturn1 = web3.eth.abi.encodeParameter('string', 'ATOK1');
      await mockFtso3.givenMethodReturn(symbol1, symbolReturn1);

      await setDefaultGovernanceParameters(ftsoManager);
      await ftsoManager.addFtso(mockFtso.address);
      await ftsoManager.addFtso(mockFtso3.address);

      let tx = await ftsoManager.replaceFtsosBulk([mockFtso.address, mockFtso3.address], false, false);

      expectEvent(tx, "FtsoAdded", { ftso: mockFtso.address, add: false });
      expectEvent(tx, "FtsoAdded", { ftso: mockFtso.address, add: true });
      expectEvent(tx, "FtsoAdded", { ftso: mockFtso3.address, add: false });
      expectEvent(tx, "FtsoAdded", { ftso: mockFtso3.address, add: true });
    });

    it("Should get reward epoch from old ftso manager", async () => {
      let oldFtsoManager = await MockContract.new();
      ftsoManager = await FtsoManager.new(
        accounts[0],
        accounts[0],
        ADDRESS_UPDATER,
        oldFtsoManager.address,
        startTs,
        PRICE_EPOCH_DURATION_S,
        REVEAL_EPOCH_DURATION_S,
        startTs.addn(REVEAL_EPOCH_DURATION_S),
        REWARD_EPOCH_DURATION_S,
        VOTE_POWER_BOUNDARY_FRACTION
      );

      const rewardEpochs = web3.utils.sha3("rewardEpochs(uint256)")!.slice(0, 10); // first 4 bytes is function selector
      const rewardEpochsReturn = web3.eth.abi.encodeParameters(
        ['uint256', 'uint256', 'uint256'],
        [100, 110, 1634819978]);

      await oldFtsoManager.givenMethodReturn(rewardEpochs, rewardEpochsReturn);

      await ftsoManager.setInitialRewardData(0, 1, startTs.addn(172800));
      let tx = await ftsoManager.getRewardEpochData(0);
      console.log(tx.votepowerBlock)
      // expect(tx.votepowerBlock.toNumber()).to.equals(BN(100);
      assert.equal(tx.votepowerBlock, toBN(100));
      assert.equal(tx.startBlock, toBN(110));
      assert.equal(tx.startTimestamp, toBN(1634819978));
    });

    it("Should set the updateOnRewardEpochSwitchover iff it is set through governance", async() => {
      await ftsoManager.setUpdateOnRewardEpochSwitchover(accounts[10], { from: accounts[0] });
      let value = await ftsoManager.updateOnRewardEpochSwitchover();
      expect(value).to.equal(accounts[10]);
      let set = ftsoManager.setUpdateOnRewardEpochSwitchover(accounts[10], { from: accounts[1] });
      await expectRevert(set, ERR_GOVERNANCE_ONLY);
    }); 

    it("Should trigger update active validators", async () => {
      await cleanupBlockNumberManager.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_MANAGER]),
        [ADDRESS_UPDATER, ftsoManager.address], {from: ADDRESS_UPDATER});

      await ftsoManager.activate();
      await increaseTimeTo(startTs, REVEAL_EPOCH_DURATION_S);
      await ftsoManager.daemonize();
      // Time travel 2 days
      await increaseTimeTo(startTs, REVEAL_EPOCH_DURATION_S + 172800);
      // Act

      // call updateActiveValidators on a contract without the method
      await ftsoManager.setUpdateOnRewardEpochSwitchover(ftsoManager.address);
      let tx1 = await ftsoManager.daemonize();
      expectEvent(tx1, "UpdatingActiveValidatorsTriggerFailed");

      const {
        0: lastErrorBlock,
        1: numErrors,
        2: errorString,
        3: errorContract,
        4: totalDaemonizedErrors
      } = await ftsoManager.showLastRevertedError();

      assert.equal(lastErrorBlock[0].toNumber(), tx1.logs[0].blockNumber);
      assert.equal(numErrors[0].toNumber(), 1);
      assert.equal(errorString[0], "err calling updateActiveValidators");
      assert.equal(errorContract[0], ftsoManager.address);
      assert.equal(totalDaemonizedErrors.toNumber(), 1);

      await ftsoManager.setUpdateOnRewardEpochSwitchover(mockUpdateValidator.address);
      let tx2 = await ftsoManager.daemonize();
      expectEvent.notEmitted(tx2, "UpdatingActiveValidatorsTriggerFailed");
    });


    it("Should revert with message while trying to update active validators", async () => {
      await cleanupBlockNumberManager.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_MANAGER]),
        [ADDRESS_UPDATER, ftsoManager.address], {from: ADDRESS_UPDATER});

      await ftsoManager.activate();
      await increaseTimeTo(startTs, REVEAL_EPOCH_DURATION_S);
      await ftsoManager.daemonize();
      // Time travel 2 days
      await increaseTimeTo(startTs, REVEAL_EPOCH_DURATION_S + 172800);

      const mock = await MockContract.new();
      await ftsoManager.setUpdateOnRewardEpochSwitchover(mock.address);

      mockUpdateValidators = await MockUpdateValidators.new();

      const updateActive = mockUpdateValidators.contract.methods.updateActiveValidators().encodeABI();
      await mock.givenMethodRevertWithMessage(updateActive, "unable to update active validators");

      let tx1 = await ftsoManager.daemonize();
      expectEvent(tx1, "UpdatingActiveValidatorsTriggerFailed");
    });


  });

  describe("fallback mode", async () => {
    it("Should set fallback mode", async () => {
      await settingWithOneFTSO_1(accounts, ftsoInterface, mockFtso, ftsoManager);
      await ftsoManager.setFallbackMode(true, { from: accounts[0] });
      assert((await ftsoManager.getFallbackMode())[0]);

      await ftsoManager.setFallbackMode(false, { from: accounts[0] });
      assert(!(await ftsoManager.getFallbackMode())[0]);
    });

    it("Should not set fallback mode if not from governance", async () => {
      await settingWithOneFTSO_1(accounts, ftsoInterface, mockFtso, ftsoManager);
      await expectRevert(ftsoManager.setFallbackMode(true, { from: accounts[1] }), ERR_GOVERNANCE_ONLY);
    });

    it("Should set fallback mode for ftso", async () => {
      let [ftso1,] = await settingWithTwoFTSOs(accounts, ftsoManager);
      await setDefaultGovernanceParameters(ftsoManager);
      await ftsoManager.addFtso(ftso1.address, { from: accounts[0] });
      await ftsoManager.setFtsoFallbackMode(ftso1.address, true, { from: accounts[0] });
      assert.equal(ftso1.address, (await ftsoManager.getFallbackMode())[1][0]);
      assert((await ftsoManager.getFallbackMode())[2][0]);

      await ftsoManager.setFtsoFallbackMode(ftso1.address, false, { from: accounts[0] });
      assert.equal(ftso1.address, (await ftsoManager.getFallbackMode())[1][0]);
      assert(!(await ftsoManager.getFallbackMode())[2][0]);
    });

    
    it("Should accrue unearned rewards when in fallback mode", async () => {
      // Assemble
      await settingWithOneFTSO_1(accounts, ftsoInterface, mockFtso, ftsoManager);
      await ftsoManager.setFallbackMode(true, { from: accounts[0] });
      // Initialize
      await time.increaseTo(startTs.addn(REVEAL_EPOCH_DURATION_S));
      await ftsoManager.daemonize(); // intialize reward epoch
      await ftsoManager.daemonize(); // initialize price epoch
      // Act
      // Time travel 120 seconds
      await time.increaseTo(startTs.addn(120 + 30));
      // Simulate the daemon tickling reward manager
      await ftsoManager.daemonize();

      // Assert
      // uint256 epochId,
      // uint256 priceEpochDurationSeconds,
      // uint256 priceEpochEndTime, // end time included in epoch
      const accrueUnearnedRewards = ftsoRewardManagerInterface.contract.methods.accrueUnearnedRewards(
        0,
        120,
        startTs.addn(120 - 1)
      ).encodeABI();
      const invocationCountWithData = await mockRewardManager.invocationCountForCalldata.call(accrueUnearnedRewards);
      assert.equal(invocationCountWithData.toNumber(), 1);
    });

    it("Should accrue unearned rewards if no FTSOs have a declared winner", async () => {
      // Assemble
      let [ftso1, ftso2] = await settingWithTwoFTSOs(accounts, ftsoManager);
      await setDefaultGovernanceParameters(ftsoManager);
      await ftsoManager.addFtso(ftso1.address, { from: accounts[0] });
      await ftsoManager.setFtsoFallbackMode(ftso1.address, true, { from: accounts[0] });
      await ftsoManager.addFtso(ftso2.address, { from: accounts[0] });
      await ftsoManager.setFtsoFallbackMode(ftso2.address, true, { from: accounts[0] });
      await ftsoManager.activate();

      // Initialize
      await time.increaseTo(startTs.addn(2 * REVEAL_EPOCH_DURATION_S));
      await ftsoManager.daemonize(); // intialize reward epoch
      await ftsoManager.daemonize(); // initialize price epoch
      // Act
      // Time travel 120 seconds
      await time.increaseTo(startTs.addn(120 + 30));
      // Simulate the daemon tickling reward manager
      await ftsoManager.daemonize();

      // Assert
      // uint256 epochId,
      // uint256 priceEpochDurationSeconds,
      // uint256 priceEpochEndTime, // end time included in epoch
      const accrueUnearnedRewards = ftsoRewardManagerInterface.contract.methods.accrueUnearnedRewards(
        0,
        120,
        startTs.addn(120 - 1)
      ).encodeABI();
      const invocationCountWithData = await mockRewardManager.invocationCountForCalldata.call(accrueUnearnedRewards);
      assert.equal(invocationCountWithData.toNumber(), 1);
    });

    it("Should not set fallback mode for ftso if not managed", async () => {
      let [ftso1,] = await settingWithTwoFTSOs(accounts, ftsoManager);
      await expectRevert(ftsoManager.setFtsoFallbackMode(ftso1.address, true, { from: accounts[0] }), "Not found");
    });

    it("Should not set fallback mode for ftso if not from governance", async () => {
      let [ftso1,] = await settingWithTwoFTSOs(accounts, ftsoManager);
      await setDefaultGovernanceParameters(ftsoManager);
      await ftsoManager.addFtso(ftso1.address, { from: accounts[0] });
      await expectRevert(ftsoManager.setFtsoFallbackMode(ftso1.address, true, { from: accounts[1] }), ERR_GOVERNANCE_ONLY);
    });

    it("Should initialize epochs in fallback mode for all ftsos", async () => {
      let [ftso1, ftso2] = await settingWithTwoFTSOs(accounts, ftsoManager);
      await setDefaultGovernanceParameters(ftsoManager);
      await ftsoManager.addFtso(ftso1.address, { from: accounts[0] });
      await ftsoManager.setFtsoFallbackMode(ftso1.address, true, { from: accounts[0] });
      await ftsoManager.addFtso(ftso2.address, { from: accounts[0] });

      await ftsoManager.setFallbackMode(true, { from: accounts[0] });

      await ftsoManager.activate();
      await increaseTimeTo(startTs, REVEAL_EPOCH_DURATION_S);
      await ftsoManager.daemonize();

      let epoch = 0;
      await submitSomePrices(epoch, ftso1, 10, accounts);
      await submitSomePrices(epoch, ftso2, 10, accounts);

      await increaseTimeTo(startTs, 120);
      await ftsoManager.daemonize();

      let report1 = await ftso1.getFullEpochReport(epoch + 1);
      expect(report1[9]).to.equals(true);

      let report2 = await ftso2.getFullEpochReport(epoch + 1);
      expect(report2[9]).to.equals(true);
    });

    it("Should initialize epoch in fallback mode for first ftso", async () => {
      let [ftso1, ftso2] = await settingWithTwoFTSOs(accounts, ftsoManager);
      await setDefaultGovernanceParameters(ftsoManager);
      await ftsoManager.addFtso(ftso1.address, { from: accounts[0] });
      await ftsoManager.setFtsoFallbackMode(ftso1.address, true, { from: accounts[0] });
      await ftsoManager.addFtso(ftso2.address, { from: accounts[0] });

      await ftsoManager.setFtsoFallbackMode(ftso1.address, true, { from: accounts[0] });

      await ftsoManager.activate();
      await increaseTimeTo(startTs, REVEAL_EPOCH_DURATION_S);
      await ftsoManager.daemonize();

      let epoch = 0;
      await submitSomePrices(epoch, ftso1, 10, accounts);
      await submitSomePrices(epoch, ftso2, 10, accounts);

      await increaseTimeTo(startTs, 120);
      await ftsoManager.daemonize();

      let report1 = await ftso1.getFullEpochReport(epoch + 1);
      expect(report1[9]).to.equals(true);

      let report2 = await ftso2.getFullEpochReport(epoch + 1);
      expect(report2[9]).to.equals(false);
    });

    it("Should switch to fallback mode", async () => {
      let fallback = (await ftsoManager.getFallbackMode())[0];
      assert(!fallback);

      let switchTo = await ftsoManager.contract.methods.switchToFallbackMode().call({ from: accounts[0] });
      let tx = await ftsoManager.switchToFallbackMode();
      fallback = (await ftsoManager.getFallbackMode())[0];
      assert(switchTo);
      assert(fallback);
      expectEvent(tx, "FallbackMode", { fallbackMode: true });

      switchTo = await ftsoManager.contract.methods.switchToFallbackMode().call({ from: accounts[0] });
      tx = await ftsoManager.switchToFallbackMode();
      fallback = (await ftsoManager.getFallbackMode())[0];
      assert(!switchTo);
      assert(fallback);
      expectEvent.notEmitted(tx, "FallbackMode");
    });

    it("Should emit event for a finalize price epoch in fallback mode catch statement without a message", async () => {
      await setDefaultGovernanceParameters(ftsoManager);
      await ftsoManager.addFtso(mockFtso.address);
      await ftsoManager.switchToFallbackMode();

      await ftsoManager.activate();
      await increaseTimeTo(startTs, REVEAL_EPOCH_DURATION_S);
      await ftsoManager.daemonize(); // initialize reward epoch
      await ftsoManager.daemonize(); // initialize price epoch
      await increaseTimeTo(startTs, REVEAL_EPOCH_DURATION_S + PRICE_EPOCH_DURATION_S);

      let fallbackFinalizePriceEpoch = ftsoInterface.contract.methods.fallbackFinalizePriceEpoch(0).encodeABI();
      await mockFtso.givenMethodRunOutOfGas(fallbackFinalizePriceEpoch);
      let tx = await ftsoManager.daemonize();
      expectEvent(tx, "FinalizingPriceEpochFailed")
    });

    it("Should set notInitializedFtsos[ftso]=true if in fallback mode and then delete it", async () => {
      const initializeCurrentEpochStateForReveal = ftsoInterface.contract.methods.initializeCurrentEpochStateForReveal(10000, true).encodeABI();
      await mockFtso.givenMethodRunOutOfGas(initializeCurrentEpochStateForReveal);

      await setDefaultGovernanceParameters(ftsoManager);
      await ftsoManager.addFtso(mockFtso.address);
      await ftsoManager.switchToFallbackMode();

      await ftsoManager.activate();
      await increaseTimeTo(startTs, REVEAL_EPOCH_DURATION_S);
      await ftsoManager.daemonize(); // initialize reward epoch
      assert(!(await ftsoManager.notInitializedFtsos(mockFtso.address)));

      await ftsoManager.daemonize();
      assert(await ftsoManager.notInitializedFtsos(mockFtso.address));

      await increaseTimeTo(startTs, REVEAL_EPOCH_DURATION_S + PRICE_EPOCH_DURATION_S);
      await ftsoManager.daemonize(); // initialize lastUnprocessedPriceEpoc
      assert(!(await ftsoManager.notInitializedFtsos(mockFtso.address)));
    });
  });
});
