import { constants, expectEvent, expectRevert, time } from '@openzeppelin/test-helpers';
import { expect } from "hardhat";
import { Contracts } from '../../../../deployment/scripts/Contracts';
import {
  CleanupBlockNumberManagerInstance, ExecuteMockInstance, FtsoInstance, FtsoManagerInstance, GovernanceVotePowerInstance, MockContractContract, MockContractInstance, PollingFoundationInstance, PriceSubmitterInstance, VoterWhitelisterContract, VoterWhitelisterInstance, WNatInstance
} from "../../../../typechain-truffle";
import { defaultPriceEpochCyclicBufferSize } from "../../../utils/constants";
import { createMockSupplyContract } from "../../../utils/FTSO-test-utils";
import {
  setDefaultGovernanceParameters
} from "../../../utils/FtsoManager-test-utils";
import { encodeContractNames, toBN } from "../../../utils/test-helpers";

const getTestFile = require('../../../utils/constants').getTestFile;
const GOVERNANCE_GENESIS_ADDRESS = require('../../../utils/constants').GOVERNANCE_GENESIS_ADDRESS;
const DAY = 60 * 60 * 24;

const WNat = artifacts.require("WNat");
const GovernanceVotePower = artifacts.require("GovernanceVotePower");
const MockFtso = artifacts.require("MockContract");
const ExecuteMock = artifacts.require("ExecuteMock");
const FtsoManager = artifacts.require("FtsoManager");
const FtsoManagement = artifacts.require("FtsoManagement");
const MockContract = artifacts.require("MockContract");
const CleanupBlockNumberManager = artifacts.require("CleanupBlockNumberManager");
const Ftso = artifacts.require("Ftso");
const PriceSubmitter = artifacts.require("PriceSubmitter");
const MockRegistry = artifacts.require("MockContract") as MockContractContract;
const VoterWhitelister = artifacts.require("VoterWhitelister") as VoterWhitelisterContract;
const PollingFoundation = artifacts.require("PollingFoundation");

const ONLY_GOVERNANCE_MSG = "only governance";
const PROPOSERSCHANGED_EVENT = 'ProposersChanged'

const PRICE_EPOCH_DURATION_S = 120; // 2 minutes
const REVEAL_EPOCH_DURATION_S = 30;
const REWARD_EPOCH_DURATION_S = 2 * 24 * 60 * 60; // 2 days
const VOTE_POWER_BOUNDARY_FRACTION = 7;

async function increaseTimeTo(current: BN, increase: number) {
  try {
    await time.increaseTo(current.addn(increase));
  } catch (e: any) {
    if (!(e.message.includes('Cannot increase current time') && e.message.includes('to a moment in the past'))) {
      throw e
    }
  }
}

async function mockFtsoSymbol(symbol: string, mockContract: MockContractInstance, dummyInterface: FtsoInstance) {
  const encodedMethod = dummyInterface.contract.methods.symbol().encodeABI();
  const symbolReturn = web3.eth.abi.encodeParameter('string', symbol);
  await mockContract.givenMethodReturn(encodedMethod, symbolReturn);
}

contract(`PollingFoundation.sol; ${getTestFile(__filename)}; PollingFoundation unit tests`, async accounts => {
  let wNat: WNatInstance;
  let governanceVotePower: GovernanceVotePowerInstance;
  let executeMock: ExecuteMockInstance;
  let ftsoManager: FtsoManagerInstance;
  let mockPriceSubmitter: MockContractInstance;
  let startTs: BN;
  let mockRewardManager: MockContractInstance;
  let mockVoterWhitelister: MockContractInstance;
  let cleanupBlockNumberManager: CleanupBlockNumberManagerInstance;
  let mockSupply: MockContractInstance;
  let mockFtso: MockContractInstance;
  let ftsoInterface: FtsoInstance;
  let priceSubmitter: PriceSubmitterInstance;
  let mockFtsoRegistry: MockContractInstance;
  let voterWhitelister: VoterWhitelisterInstance;
  let pollingFoundation: PollingFoundationInstance;

  const ADDRESS_UPDATER = accounts[16];

  before(async () => {
    FtsoManager.link(await FtsoManagement.new() as any);
  });

  beforeEach(async () => {
    wNat = await WNat.new(accounts[0], "Wrapped NAT", "WNAT");
    const pChainStakeMirror = await MockContract.new();
    governanceVotePower = await GovernanceVotePower.new(wNat.address, pChainStakeMirror.address);
    await wNat.setGovernanceVotePower(governanceVotePower.address);

    mockPriceSubmitter = await MockContract.new();
    mockRewardManager = await MockContract.new();
    mockVoterWhitelister = await MockContract.new();
    cleanupBlockNumberManager = await CleanupBlockNumberManager.new(accounts[0], ADDRESS_UPDATER, "FtsoManager");
    mockSupply = await createMockSupplyContract(accounts[0], 10000);

    priceSubmitter = await PriceSubmitter.new();
    await priceSubmitter.initialiseFixedAddress();
    await priceSubmitter.setAddressUpdater(ADDRESS_UPDATER, { from: GOVERNANCE_GENESIS_ADDRESS});

    voterWhitelister = await VoterWhitelister.new(GOVERNANCE_GENESIS_ADDRESS, ADDRESS_UPDATER, priceSubmitter.address, 10, constants.ZERO_ADDRESS);

    mockFtsoRegistry = await MockRegistry.new();

    // Force a block in order to get most up to date time
    await time.advanceBlock();

    // Get the timestamp for the just mined block
    startTs = await time.latest();

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

    // only second to last parameter is important for governor tests
    await ftsoManager.setGovernanceParameters(0, 5, 5, 50, 500, 500, 5000, 0, 30 * DAY, []);

    await ftsoManager.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.PRICE_SUBMITTER, Contracts.FTSO_REWARD_MANAGER, Contracts.FTSO_REGISTRY, Contracts.VOTER_WHITELISTER, Contracts.SUPPLY, Contracts.CLEANUP_BLOCK_NUMBER_MANAGER]),
      [ADDRESS_UPDATER, priceSubmitter.address, mockRewardManager.address, mockFtsoRegistry.address, mockVoterWhitelister.address, mockSupply.address, cleanupBlockNumberManager.address], { from: ADDRESS_UPDATER });

    await priceSubmitter.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_REGISTRY, Contracts.VOTER_WHITELISTER, Contracts.FTSO_MANAGER]),
      [ADDRESS_UPDATER, mockFtsoRegistry.address, voterWhitelister.address, ftsoManager.address], {from: ADDRESS_UPDATER});

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

    const finalizePriceEpoch = ftsoInterface.contract.methods.finalizePriceEpoch(0, true).encodeABI();
    const finalizePriceEpochReturn = web3.eth.abi.encodeParameters(
      ['address[]', 'uint256[]', 'uint256'],
      [[], [], '0']);
    await mockFtso.givenMethodReturn(finalizePriceEpoch, finalizePriceEpochReturn);

    await setDefaultGovernanceParameters(ftsoManager);

    await ftsoManager.addFtso(mockFtso.address);

    // deposit
    await wNat.deposit({ from: accounts[2], value: toBN(1000) });
    await wNat.deposit({ from: accounts[3], value: toBN(1000) });
    await wNat.deposit({ from: accounts[4], value: toBN(2000) });
    await wNat.deposit({ from: accounts[5], value: toBN(3000) });
    await wNat.deposit({ from: accounts[6], value: toBN(100) });

    // mock contract for proposals executable on chain 
    executeMock = await ExecuteMock.new();

    // activate ftso manager
    await ftsoManager.activate();

    // initalize first reward epoch
    await increaseTimeTo(startTs, REVEAL_EPOCH_DURATION_S);
    await ftsoManager.daemonize();

    pollingFoundation = await PollingFoundation.new(
      accounts[0],
      priceSubmitter.address,
      ADDRESS_UPDATER,
      [
        accounts[2],
        accounts[3],
        accounts[6]
      ]
    );

    await pollingFoundation.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_MANAGER, Contracts.GOVERNANCE_VOTE_POWER, Contracts.SUPPLY]),
        [ADDRESS_UPDATER, ftsoManager.address, governanceVotePower.address, mockSupply.address], { from: ADDRESS_UPDATER });

    // initialize three reward epochs
    for (let i = 1; i <= 3 * (172800 / 1200); i++) {
      // Time travel to trigger a price epoch change
      await time.increase(1200);

      // Mine at least a block
      await time.advanceBlock();
      await ftsoManager.daemonize();
    }

    for (let i = 0; i <= 4; i++) {
      await time.advanceBlock();
      await ftsoManager.daemonize();
    }
  });

  it("Should check deployment parameters", async () => {
    expect(await pollingFoundation.isProposer(accounts[3])).to.equals(true);
    expect(await pollingFoundation.isProposer(accounts[4])).to.equals(false);
  });

  it("Should have chainId set", async () => {
    let chainId = await web3.eth.getChainId();
    expect((await pollingFoundation.chainId()).toNumber()).to.equals(chainId);
  });

  it("Should choose voter power block even though vp block period is not long enough", async () => {
    for (let i = 1; i <= 172800 / 1200; i++) {
      // Time travel to trigger a price epoch change
      await time.increase(1200);

      // Mine at least a block
      await time.advanceBlock();
      await ftsoManager.daemonize();
    }

    await ftsoManager.daemonize();

    await pollingFoundation.methods["propose(string,(bool,uint256,uint256,uint256,uint256,uint256))"].sendTransaction("Proposal", 
      {
        accept: false,
        votingDelaySeconds: 3600,
        votingPeriodSeconds: 7200,
        vpBlockPeriodSeconds: 259200,
        thresholdConditionBIPS: 7500,
        majorityConditionBIPS: 5000
      }, { from: accounts[2] });
  })

  it("Should propose and execute a proposal of type reject", async () => {
    let tx = await pollingFoundation.methods["propose(string,(bool,uint256,uint256,uint256,uint256,uint256))"].sendTransaction("First proposal", 
    {
      accept: false,
      votingDelaySeconds: 3600,
      votingPeriodSeconds: 7200,
      vpBlockPeriodSeconds: 259200,
      thresholdConditionBIPS: 7500,
      majorityConditionBIPS: 5000
    }, { from: accounts[2] }) as any;
    // console.log(proposal1Id.proposa);
    let proposal1Id = tx.logs[0].args.proposalId.toString();
    // console.log("pr. ID", proposal1Id);

    // advance one hour to the voting period
    await time.increase(3600);

    // voting
    await pollingFoundation.castVote(proposal1Id, 1, { from: accounts[2] });
    await pollingFoundation.castVote(proposal1Id, 1, { from: accounts[3] });
    await pollingFoundation.castVote(proposal1Id, 1, { from: accounts[4] });
    await pollingFoundation.castVote(proposal1Id, 1, { from: accounts[5] });

    // advance to end of the voting period
    await time.increase(7200);

    let state = await pollingFoundation.state(proposal1Id);
    expect(state.toNumber()).to.equal(4);

    let execute = await pollingFoundation.methods["execute(string)"].sendTransaction("First proposal", { from: accounts[2] }) as any;
    expectEvent(execute, "ProposalExecuted", { proposalId: proposal1Id });
    let state1 = await pollingFoundation.state(proposal1Id);
    expect(state1.toNumber()).to.equal(6);
  });

  it("Should revert because address is not allowed to submit a proposal", async () => {
    let tx = pollingFoundation.methods["propose(string,(bool,uint256,uint256,uint256,uint256,uint256))"].sendTransaction("Proposal", 
    {
      accept: false,
      votingDelaySeconds: 3600,
      votingPeriodSeconds: 7200,
      vpBlockPeriodSeconds: 259200,
      thresholdConditionBIPS: 7500,
      majorityConditionBIPS: 5000
    }, { from: accounts[5] }) as any;
    await expectRevert(tx, "submitter is not eligible to submit a proposal");
  });

  it("Should not be rejected if turnout is too low", async () => {
    let tx = await pollingFoundation.methods["propose(string,(bool,uint256,uint256,uint256,uint256,uint256))"].sendTransaction("Proposal", 
    {
      accept: false,
      votingDelaySeconds: 3600,
      votingPeriodSeconds: 7200,
      vpBlockPeriodSeconds: 259200,
      thresholdConditionBIPS: 7500,
      majorityConditionBIPS: 5000
    }, { from: accounts[2] }) as any;
    let proposal1Id = tx.logs[0].args.proposalId.toString();

    // advance one hour to the voting period
    await time.increase(3600);

    // voting
    await pollingFoundation.castVote(proposal1Id, 1, { from: accounts[2] });

    // advance to the end of the voting period
    await time.increase(7200);

    let state1 = await pollingFoundation.state(proposal1Id);
    expect(state1.toString()).to.equals("4");
  });

  it("Should be rejected because enough vote power was against", async () => {
    let tx = await pollingFoundation.methods["propose(string,(bool,uint256,uint256,uint256,uint256,uint256))"].sendTransaction("Proposal", 
    {
      accept: false,
      votingDelaySeconds: 3600,
      votingPeriodSeconds: 7200,
      vpBlockPeriodSeconds: 259200,
      thresholdConditionBIPS: 7500,
      majorityConditionBIPS: 5000
    }, { from: accounts[2] }) as any;
    let proposal1Id = tx.logs[0].args.proposalId.toString();

    // advance one hour to the voting period
    await time.increase(3600);

    // voting
    await pollingFoundation.castVote(proposal1Id, 0, { from: accounts[3] });
    await pollingFoundation.castVote(proposal1Id, 0, { from: accounts[4] });
    await pollingFoundation.castVote(proposal1Id, 0, { from: accounts[5] });

    // advance to the end of the voting period
    await time.increase(7200);

    let state1 = await pollingFoundation.state(proposal1Id);
    expect(state1.toString()).to.equals("2");
  });

  it("Should not be rejected if enough vote power voted for", async () => {
    let tx = await pollingFoundation.methods["propose(string,(bool,uint256,uint256,uint256,uint256,uint256))"].sendTransaction("Proposal", 
    {
      accept: false,
      votingDelaySeconds: 3600,
      votingPeriodSeconds: 7200,
      vpBlockPeriodSeconds: 259200,
      thresholdConditionBIPS: 3000,
      majorityConditionBIPS: 5000
    }, { from: accounts[2] }) as any;
    let proposal1Id = tx.logs[0].args.proposalId.toString();

    // advance one hour to the voting period
    await time.increase(3600);

    // voting
    await pollingFoundation.castVote(proposal1Id, 0, { from: accounts[3] });
    await pollingFoundation.castVote(proposal1Id, 0, { from: accounts[4] });
    await pollingFoundation.castVote(proposal1Id, 1, { from: accounts[5] });

    // advance to the end of the voting period
    await time.increase(7200);

    let state1 = await pollingFoundation.state(proposal1Id);
    expect(state1.toString()).to.equals("4");
  });

  it("Should be rejected because enough vote power voted against", async () => {
    let lastBlock = await time.latestBlock();
    await time.advanceBlockTo((lastBlock).toNumber() + 5);

    // delegating
    await governanceVotePower.delegate(accounts[3], { from: accounts[4] });
    await governanceVotePower.delegate(accounts[3], { from: accounts[5] });

    // set circulating supply to 10000
    const getCirculatingSupplyAt = web3.utils.sha3("getCirculatingSupplyAt(uint256)")!.slice(0, 10); // first 4 bytes is function selector
    await mockSupply.givenMethodReturnUint(getCirculatingSupplyAt, 10000);

    let tx = await pollingFoundation.methods["propose(string,(bool,uint256,uint256,uint256,uint256,uint256))"].sendTransaction("Proposal", 
    {
      accept: false,
      votingDelaySeconds: 3600,
      votingPeriodSeconds: 7200,
      vpBlockPeriodSeconds: 259200,
      thresholdConditionBIPS: 7500,
      majorityConditionBIPS: 5000
    }, { from: accounts[2] }) as any;
    let proposal1Id = tx.logs[0].args.proposalId.toString();

    // advance one hour to the voting period
    await time.increase(3600);

    // voting
    // accounts[3]'s delegated vote power (almost surely) won't count yet, 
    // because vote power block is chosen from the past
    await pollingFoundation.castVote(proposal1Id, 0, { from: accounts[3] });

    let proposalVP = await pollingFoundation.getProposalVotes(proposal1Id);
    expect(proposalVP[0].toString()).to.equals("0");
    expect(proposalVP[1].toString()).to.equals("1000");

    // advance to the end of the voting period
    await time.increase(7200);

    // proposal is not rejected if turnout is too low
    let state1 = await pollingFoundation.state(proposal1Id);
    expect(state1.toString()).to.equals("4");

    // let execute = pollingFoundation.methods["execute(string)"].sendTransaction("Proposal", { from: accounts[2] });
    // await expectRevert(execute, "proposal not in execution state");

    // time travel two reward epochs forward
    for (let i = 0; i <= 2 * (172800 / 1200); i++) {
      await time.increase(1200);
      await time.advanceBlock();
      await ftsoManager.daemonize();
    }
    await ftsoManager.daemonize();

    // second proposal
    let tx2 = await pollingFoundation.methods["propose(string,(bool,uint256,uint256,uint256,uint256,uint256))"].sendTransaction("Proposal 2", 
    {
      accept: false,
      votingDelaySeconds: 3600,
      votingPeriodSeconds: 7200,
      vpBlockPeriodSeconds: 259200,
      thresholdConditionBIPS: 7500,
      majorityConditionBIPS: 5000
    }, { from: accounts[2] }) as any;
    let proposal2Id = tx2.logs[0].args.proposalId.toString();

    // advance one hour to the voting period
    await time.increase(3600);

    // voting
    await pollingFoundation.castVote(proposal2Id, 0, { from: accounts[3] });

    let proposal2VP = await pollingFoundation.getProposalVotes(proposal2Id);
    expect(proposal2VP[0].toString()).to.equals("0");
    expect(proposal2VP[1].toString()).to.equals("6000");

    // advance to the end of the voting period
    await time.increase(7200);

    // proposal is not rejected, because not enough vote power voted (quorum was reached)
    let state2 = await pollingFoundation.state(proposal2Id);
    expect(state2.toString()).to.equals("4");

    ///// third proposal
    // set circulating supply to 8000
    const getCirculatingSupplyAt1 = web3.utils.sha3("getCirculatingSupplyAt(uint256)")!.slice(0, 10); // first 4 bytes is function selector
    await mockSupply.givenMethodReturnUint(getCirculatingSupplyAt1, 8000);

    let tx3 = await pollingFoundation.methods["propose(string,(bool,uint256,uint256,uint256,uint256,uint256))"].sendTransaction("Proposal 3", 
    {
      accept: false,
      votingDelaySeconds: 3600,
      votingPeriodSeconds: 7200,
      vpBlockPeriodSeconds: 259200,
      thresholdConditionBIPS: 7500,
      majorityConditionBIPS: 5000
    }, { from: accounts[2] }) as any;
    let proposal3Id = tx3.logs[0].args.proposalId.toString();

    // advance one hour to the voting period
    await time.increase(3600);

    // voting
    await pollingFoundation.castVote(proposal3Id, 0, { from: accounts[3] });

    let proposal3VP = await pollingFoundation.getProposalVotes(proposal3Id);
    expect(proposal3VP[0].toString()).to.equals("0");
    expect(proposal3VP[1].toString()).to.equals("6000");

    // advance to the end of the voting period
    await time.increase(7200);

    // proposal is rejected because quorum was reached and enough vote power voted against
    let state3 = await pollingFoundation.state(proposal3Id);
    expect(state3.toString()).to.equals("2");
  });

  it("Should not allow voting twice", async () => {
    let propose = await pollingFoundation.methods["propose(string,(bool,uint256,uint256,uint256,uint256,uint256))"].sendTransaction("Proposal", 
    {
      accept: false,
      votingDelaySeconds: 3600,
      votingPeriodSeconds: 7200,
      vpBlockPeriodSeconds: 259200,
      thresholdConditionBIPS: 7500,
      majorityConditionBIPS: 5000
    }, { from: accounts[2] }) as any;
    let proposal1Id = propose.logs[0].args.proposalId.toString();

    // advance to the voting period
    await time.increase(3600);

    await pollingFoundation.castVote(proposal1Id, 0, { from: accounts[3] });
    let castVote = pollingFoundation.castVote(proposal1Id, 0, { from: accounts[3] });
    await expectRevert(castVote, "vote already cast");
  });

  it("Should propose and execute", async () => {

    // set circulating supply to 9000
    const getCirculatingSupplyAt = web3.utils.sha3("getCirculatingSupplyAt(uint256)")!.slice(0, 10); // first 4 bytes is function selector
    await mockSupply.givenMethodReturnUint(getCirculatingSupplyAt, 9000);

    let tx = await pollingFoundation.methods["propose(string,(bool,uint256,uint256,uint256,uint256,uint256))"].sendTransaction("Proposal", 
    {
      accept: false,
      votingDelaySeconds: 3600,
      votingPeriodSeconds: 7200,
      vpBlockPeriodSeconds: 259200,
      thresholdConditionBIPS: 7500,
      majorityConditionBIPS: 5000
    }, { from: accounts[2] }) as any;
    let proposal1Id = tx.logs[0].args.proposalId.toString();  

    // advance one hour to the voting period
    await time.increase(3600);

    // voting
    await pollingFoundation.castVote(proposal1Id, 1, { from: accounts[2] });
    await pollingFoundation.castVote(proposal1Id, 1, { from: accounts[3] });
    await pollingFoundation.castVote(proposal1Id, 1, { from: accounts[4] });
    await pollingFoundation.castVote(proposal1Id, 1, { from: accounts[5] });

    let proposalVP = await pollingFoundation.getProposalVotes(proposal1Id);
    expect(proposalVP[0].toString()).to.equals("7000");
    expect(proposalVP[1].toString()).to.equals("0");
    // advance to end of the voting period
    await time.increase(7200);

    // should not be yet executed
    let state = await pollingFoundation.state(proposal1Id);
    expect(state.toNumber()).to.equal(4);

    // mark proposal as executed
    // quorum is reached and more people voted for tahtn against
    let execute = await pollingFoundation.methods["execute(string)"].sendTransaction("Proposal", { from: accounts[2] }) as any;
    
    expectEvent(execute, "ProposalExecuted", { proposalId: proposal1Id });

    let state1 = await pollingFoundation.state(proposal1Id);
    expect(state1.toNumber()).to.equal(6);
  });

  it("Should propose and execute proposal which is executable on chain", async () => {

    // set circulating supply to 7000
    const getCirculatingSupplyAt = web3.utils.sha3("getCirculatingSupplyAt(uint256)")!.slice(0, 10); // first 4 bytes is function selector
    await mockSupply.givenMethodReturnUint(getCirculatingSupplyAt, 7000);

    // propose
    let propose = await pollingFoundation.methods["propose(address[],uint256[],bytes[],string,(bool,uint256,uint256,uint256,uint256,uint256,uint256,uint256))"]
      .sendTransaction([executeMock.address], [0], [executeMock.contract.methods.setNum(3).encodeABI()], "Proposal",
      {
        accept: false,
        votingDelaySeconds: 3600,
        votingPeriodSeconds: 7200,
        executionDelaySeconds: 1500,
        executionPeriodSeconds: 2000,
        vpBlockPeriodSeconds: 259200,
        thresholdConditionBIPS: 7500,
        majorityConditionBIPS: 5000
      }, { from: accounts[2] }) as any;

    let proposal1Id = propose.logs[0].args.proposalId.toString();

    // advance to the voting period
    await time.increase(3600);

    // voting
    await pollingFoundation.castVote(proposal1Id, 1, { from: accounts[4] });
    await pollingFoundation.castVote(proposal1Id, 1, { from: accounts[5] });

    // advance to end of the voting period
    await time.increase(7200);

    // check state
    expect((await pollingFoundation.state(proposal1Id)).toString()).to.equals("3");

    // advance to the executing period
    await time.increase(1500);

    // check state
    expect((await pollingFoundation.state(proposal1Id)).toString()).to.equals("4");

    // initial parameter value
    expect((await executeMock.getNum()).toString()).to.equals("0");

    // execute
    // let descriptionHash = web3.utils.soliditySha3("Proposal") as string;
    //web3.utils.soliditySha3(web3.utils.toHex("Proposal"));
    expect((await pollingFoundation.getProposalId([executeMock.address], [0],  [executeMock.contract.methods.setNum(3).encodeABI()], "Proposal")).toString()).to.equals(proposal1Id);

    let execute = await pollingFoundation.methods["execute(address[],uint256[],bytes[],string)"].sendTransaction([executeMock.address], [0], [executeMock.contract.methods.setNum(3).encodeABI()], "Proposal", { from: accounts[2] }) as any;
    expectEvent(execute, "ProposalExecuted", { proposalId: proposal1Id });

    // parameter should be change to 3
    expect((await executeMock.getNum()).toString()).to.equals("3");

    // check state
    expect((await pollingFoundation.state(proposal1Id)).toString()).to.equals("6");
  });

  it("Should revert because proposal (executable on chain) expired", async () => {
    // propose
    let propose = await pollingFoundation.methods["propose(address[],uint256[],bytes[],string,(bool,uint256,uint256,uint256,uint256,uint256,uint256,uint256))"]
      .sendTransaction([executeMock.address], [0], [executeMock.contract.methods.setNum(3).encodeABI()], "Proposal",
      {
        accept: false,
        votingDelaySeconds: 3600,
        votingPeriodSeconds: 7200,
        executionDelaySeconds: 1500,
        executionPeriodSeconds: 2000,
        vpBlockPeriodSeconds: 259200,
        thresholdConditionBIPS: 7500,
        majorityConditionBIPS: 5000
      }, { from: accounts[2] }) as any;

    let proposal1Id = propose.logs[0].args.proposalId.toString();

    // advance to the voting period
    await time.increase(3600);

    // voting
    await pollingFoundation.castVote(proposal1Id, 1, { from: accounts[4] });
    await pollingFoundation.castVote(proposal1Id, 1, { from: accounts[5] });

    // advance to end of the execution peropd
    await time.increase(7200 + 1500 + 2000);

    // execute
    // let descriptionHash = web3.utils.soliditySha3("Proposal") as string;
    let execute = pollingFoundation.methods["execute(address[],uint256[],bytes[],string)"].sendTransaction([executeMock.address], [0], [executeMock.contract.methods.setNum(3).encodeABI()], "Proposal", { from: accounts[2] }) as any;

    // state should be "expired" and execution should revert
    expect((await pollingFoundation.state(proposal1Id)).toString()).to.equals("5");
    await expectRevert(execute, "proposal not in execution state");
  });

  it("Should revert because propose and execute parameters does not match", async () => {
    // propose
    let propose = await pollingFoundation.methods["propose(address[],uint256[],bytes[],string,(bool,uint256,uint256,uint256,uint256,uint256,uint256,uint256))"]
      .sendTransaction([executeMock.address], [0], [executeMock.contract.methods.setNum(3).encodeABI()], "Proposal",
      {
        accept: false,
        votingDelaySeconds: 3600,
        votingPeriodSeconds: 7200,
        executionDelaySeconds: 1500,
        executionPeriodSeconds: 2000,
        vpBlockPeriodSeconds: 259200,
        thresholdConditionBIPS: 7500,
        majorityConditionBIPS: 5000
      }, { from: accounts[2] }) as any;

    let proposal1Id = propose.logs[0].args.proposalId.toString();

    // advance to the voting period
    await time.increase(3600);

    // voting
    await pollingFoundation.castVote(proposal1Id, 1, { from: accounts[4] });
    await pollingFoundation.castVote(proposal1Id, 1, { from: accounts[5] });

    // advance to end of the voting period
    await time.increase(7200);

    // advance to the executing period
    await time.increase(1500);

    // initial parameter value
    expect((await executeMock.getNum()).toString()).to.equals("0");

    // execute
    // let descriptionHash = web3.utils.soliditySha3("Proposal") as string;
    let execute = pollingFoundation.methods["execute(address[],uint256[],bytes[],string)"].sendTransaction([executeMock.address], [0], [executeMock.contract.methods.setNum(4).encodeABI()], "Proposal", { from: accounts[2] }) as any;

    await expectRevert(execute, "proposal can only be executed by its proposer");
  });

  it("Should check if voter has already cast a vote", async () => {
    await governanceVotePower.delegate(accounts[5], { from: accounts[6] });
    let blockAfterDelegation = await time.latestBlock();

    for (let i = 0; i <= 172800 / 1200; i++) {
      await time.increase(1200);
      await time.advanceBlock();
      await ftsoManager.daemonize();
    }

    // set circulating supply to 10000
    const getCirculatingSupplyAt = web3.utils.sha3("getCirculatingSupplyAt(uint256)")!.slice(0, 10); // first 4 bytes is function selector
    await mockSupply.givenMethodReturnUint(getCirculatingSupplyAt, 10000);

    let tx = await pollingFoundation.methods["propose(string,(bool,uint256,uint256,uint256,uint256,uint256))"].sendTransaction("Proposal", 
    {
      accept: false,
      votingDelaySeconds: 3600,
      votingPeriodSeconds: 7200,
      vpBlockPeriodSeconds: 259200,
      thresholdConditionBIPS: 7500,
      majorityConditionBIPS: 5000
    }, { from: accounts[2] }) as any;
    let proposal1Id = tx.logs[0].args.proposalId.toString();
    let info = await pollingFoundation.getProposalInfo(proposal1Id);
    let vpBlock = info[2];

    if (vpBlock >= blockAfterDelegation) {
      expect((await pollingFoundation.getVotes(accounts[5], vpBlock)).toString()).to.equals("3100");
      expect((await pollingFoundation.getVotes(accounts[6], vpBlock)).toString()).to.equals("0");
    }
    else {
      expect((await pollingFoundation.getVotes(accounts[5], vpBlock)).toString()).to.equals("3000");
      expect((await pollingFoundation.getVotes(accounts[6], vpBlock)).toString()).to.equals("100");
    }

    // advance one hour to the voting period
    await time.increase(3600);

    // voting
    await pollingFoundation.castVoteWithReason(proposal1Id, 0, "I don't like this proposal", { from: accounts[2] });
    await pollingFoundation.castVote(proposal1Id, 1, { from: accounts[3] });
    await pollingFoundation.castVote(proposal1Id, 1, { from: accounts[5] });

    expect(await pollingFoundation.hasVoted(proposal1Id, accounts[2])).to.equals(true);
    expect(await pollingFoundation.hasVoted(proposal1Id, accounts[3])).to.equals(true);
    expect(await pollingFoundation.hasVoted(proposal1Id, accounts[4])).to.equals(false);
    expect(await pollingFoundation.hasVoted(proposal1Id, accounts[5])).to.equals(true);
  });

  it("Should check if proposal is pending", async () => {
    let tx = await pollingFoundation.methods["propose(string,(bool,uint256,uint256,uint256,uint256,uint256))"].sendTransaction("Proposal", 
    {
      accept: false,
      votingDelaySeconds: 3600,
      votingPeriodSeconds: 7200,
      vpBlockPeriodSeconds: 259200,
      thresholdConditionBIPS: 7500,
      majorityConditionBIPS: 5000
    }, { from: accounts[2] }) as any;
    let proposal1Id = tx.logs[0].args.proposalId.toString();

    expect((await pollingFoundation.state(proposal1Id)).toString()).to.equals("0");
  });

  it("Should revert if voter casts invalid vote", async () => {
    let tx = await pollingFoundation.methods["propose(string,(bool,uint256,uint256,uint256,uint256,uint256))"].sendTransaction("Proposal", 
    {
      accept: false,
      votingDelaySeconds: 3600,
      votingPeriodSeconds: 7200,
      vpBlockPeriodSeconds: 259200,
      thresholdConditionBIPS: 7500,
      majorityConditionBIPS: 5000
    }, { from: accounts[2] }) as any;
    let proposal1Id = tx.logs[0].args.proposalId.toString();

    await time.increase(3600);

    let vote = pollingFoundation.castVote(proposal1Id, 4, { from: accounts[2] });

    await expectRevert(vote, "invalid value for enum VoteType");
  });

  it("Should move execution start time of second proposal", async () => {
    // It should move execution start time of second proposal if it is before execution end time of first proposal

    // First proposal
    let propose1 = await pollingFoundation.methods["propose(address[],uint256[],bytes[],string,(bool,uint256,uint256,uint256,uint256,uint256,uint256,uint256))"]
      .sendTransaction([executeMock.address], [0], [executeMock.contract.methods.setNum(3).encodeABI()], "Proposal 1",
      {
        accept: false,
        votingDelaySeconds: 3600,
        votingPeriodSeconds: 7200,
        executionDelaySeconds: 1500,
        executionPeriodSeconds: 2000,
        vpBlockPeriodSeconds: 259200,
        thresholdConditionBIPS: 7500,
        majorityConditionBIPS: 5000
      }, { from: accounts[2] }) as any;

    let block1 = await time.latestBlock();
    let blockTs1 = (await web3.eth.getBlock(block1)).timestamp as number;

    let proposalId1 = propose1.logs[0].args.proposalId.toString();
    let info1 = await pollingFoundation.getProposalInfo(proposalId1);

    let voteStart1 = blockTs1 + 3600;
    let voteEnd1 = voteStart1 + 7200;
    let executeStart1 = voteEnd1 + 1500;
    let executeEnd1 = executeStart1 + 2000;

    expect(info1[3].toNumber()).to.equals(voteStart1);
    expect(info1[4].toNumber()).to.equals(voteEnd1);
    expect(info1[5].toNumber()).to.equals(executeStart1);
    expect(info1[6].toNumber()).to.equals(executeEnd1);

    await time.increase(100);


    // Second proposal
    let propose2 = await pollingFoundation.methods["propose(address[],uint256[],bytes[],string,(bool,uint256,uint256,uint256,uint256,uint256,uint256,uint256))"]
      .sendTransaction([executeMock.address], [0], [executeMock.contract.methods.setNum(90).encodeABI()], "Proposal 2",
      {
        accept: false,
        votingDelaySeconds: 3600,
        votingPeriodSeconds: 7200,
        executionDelaySeconds: 1500,
        executionPeriodSeconds: 2000,
        vpBlockPeriodSeconds: 259200,
        thresholdConditionBIPS: 7500,
        majorityConditionBIPS: 5000
      }, { from: accounts[2] }) as any;

    let block2 = await time.latestBlock();
    let blockTs2 = (await web3.eth.getBlock(block2)).timestamp as number;

    let proposalId2 = propose2.logs[0].args.proposalId.toString();
    let info2 = await pollingFoundation.getProposalInfo(proposalId2);

    let voteStart2 = blockTs2 + 3600;
    let voteEnd2 = voteStart2 + 7200;
    let executeStart2 = executeEnd1;
    let executeEnd2 = executeStart2 + 2000;

    expect(info2[3].toNumber()).to.equals(voteStart2);
    expect(info2[4].toNumber()).to.equals(voteEnd2);
    expect(info2[5].toNumber()).to.equals(executeStart2);
    expect(info2[6].toNumber()).to.equals(executeEnd2);
  })

  it("Should revert if voter votes outside of the voting period", async () => {
    let tx = await pollingFoundation.methods["propose(string,(bool,uint256,uint256,uint256,uint256,uint256))"].sendTransaction("Proposal",
    {
      accept: false,
      votingDelaySeconds: 3600,
      votingPeriodSeconds: 7200,
      vpBlockPeriodSeconds: 259200,
      thresholdConditionBIPS: 7500,
      majorityConditionBIPS: 5000
    }, { from: accounts[2] }) as any;
    let proposal1Id = tx.logs[0].args.proposalId.toString();

    let vote = pollingFoundation.castVote(proposal1Id, 0);
    await expectRevert(vote, "proposal not active")
  });

  it("Should revert if trying to execute the same proposal twice", async () => {
    // propose
    let propose = await pollingFoundation.methods["propose(address[],uint256[],bytes[],string,(bool,uint256,uint256,uint256,uint256,uint256,uint256,uint256))"]
      .sendTransaction([executeMock.address], [0], [executeMock.contract.methods.setNum(3).encodeABI()], "Proposal",
      {
        accept: false,
        votingDelaySeconds: 3600,
        votingPeriodSeconds: 7200,
        executionDelaySeconds: 1500,
        executionPeriodSeconds: 2000,
        vpBlockPeriodSeconds: 259200,
        thresholdConditionBIPS: 7500,
        majorityConditionBIPS: 5000
      }, { from: accounts[2] }) as any;

    let proposal1Id = propose.logs[0].args.proposalId.toString();

    // advance to the voting period
    await time.increase(3600);

    // voting
    await pollingFoundation.castVote(proposal1Id, 1, { from: accounts[4] });
    await pollingFoundation.castVote(proposal1Id, 1, { from: accounts[5] });

    // advance to end of the voting period
    await time.increase(7200);

    // check state
    expect((await pollingFoundation.state(proposal1Id)).toString()).to.equals("3");

    // advance to the executing period
    await time.increase(1500);

    // execute
    // let descriptionHash = web3.utils.soliditySha3("Proposal") as string;
    //web3.utils.soliditySha3(web3.utils.toHex("Proposal"));
    let execute = await pollingFoundation.methods["execute(address[],uint256[],bytes[],string)"].sendTransaction([executeMock.address], [0], [executeMock.contract.methods.setNum(3).encodeABI()], "Proposal", { from: accounts[2] }) as any;

    // parameter should be change to 3
    expect((await executeMock.getNum()).toString()).to.equals("3");

    // try to execute again
    let execute2 = pollingFoundation.methods["execute(address[],uint256[],bytes[],string)"].sendTransaction([executeMock.address], [0], [executeMock.contract.methods.setNum(3).encodeABI()], "Proposal", { from: accounts[2] }) as any;

    await expectRevert(execute2, "proposal already executed");
  });

  it("Should revert if proposal already exist", async () => {
    // propose
    await pollingFoundation.methods["propose(string,(bool,uint256,uint256,uint256,uint256,uint256))"].sendTransaction("Proposal", 
    {
      accept: false,
      votingDelaySeconds: 3600,
      votingPeriodSeconds: 7200,
      vpBlockPeriodSeconds: 259200,
      thresholdConditionBIPS: 7500,
      majorityConditionBIPS: 5000
    }, { from: accounts[2] }) as any;

    let propose2 = pollingFoundation.methods["propose(string,(bool,uint256,uint256,uint256,uint256,uint256))"].sendTransaction("Proposal", 
    {
      accept: false,
      votingDelaySeconds: 3600,
      votingPeriodSeconds: 7200,
      vpBlockPeriodSeconds: 259200,
      thresholdConditionBIPS: 7500,
      majorityConditionBIPS: 5000
    }, { from: accounts[3] }) as any;
    await expectRevert(propose2, "proposal already exists");
  });

  it("Should revert if length of target addresses is different than length of values", async () => {
    let propose = pollingFoundation.methods["propose(address[],uint256[],bytes[],string,(bool,uint256,uint256,uint256,uint256,uint256,uint256,uint256))"]
      .sendTransaction([executeMock.address], [0, 1], [executeMock.contract.methods.setNum(3).encodeABI()], "Proposal",
      {
        accept: false,
        votingDelaySeconds: 3600,
        votingPeriodSeconds: 7200,
        executionDelaySeconds: 1500,
        executionPeriodSeconds: 2000,
        vpBlockPeriodSeconds: 259200,
        thresholdConditionBIPS: 7500,
        majorityConditionBIPS: 5000
      }, { from: accounts[2] }) as any;

    await expectRevert(propose, "invalid proposal length");
  });

  it("Should revert if length of target addresses is different than length of calldatas", async () => {
    let propose = pollingFoundation.methods["propose(address[],uint256[],bytes[],string,(bool,uint256,uint256,uint256,uint256,uint256,uint256,uint256))"]
    .sendTransaction([executeMock.address], [0], [executeMock.contract.methods.setNum(3).encodeABI(), executeMock.contract.methods.setNum(8).encodeABI()], "Proposal",
    {
      accept: false,
      votingDelaySeconds: 3600,
      votingPeriodSeconds: 7200,
      executionDelaySeconds: 1500,
      executionPeriodSeconds: 2000,
      vpBlockPeriodSeconds: 259200,
      thresholdConditionBIPS: 7500,
      majorityConditionBIPS: 5000
    }, { from: accounts[2] }) as any;

    await expectRevert(propose, "invalid proposal length");
  });

  it("Should revert without message if execution on chain is not successful", async () => {
    // propose
    let propose = await pollingFoundation.methods["propose(address[],uint256[],bytes[],string,(bool,uint256,uint256,uint256,uint256,uint256,uint256,uint256))"]
      .sendTransaction([executeMock.address], [0], [executeMock.contract.methods.setNum1(5).encodeABI()], "Proposal",
      {
        accept: false,
        votingDelaySeconds: 3600,
        votingPeriodSeconds: 7200,
        executionDelaySeconds: 1500,
        executionPeriodSeconds: 2000,
        vpBlockPeriodSeconds: 259200,
        thresholdConditionBIPS: 7500,
        majorityConditionBIPS: 5000
      }, { from: accounts[2] }) as any;

    let proposal1Id = propose.logs[0].args.proposalId.toString();

    // advance to the voting period
    await time.increase(3600);

    // voting
    await pollingFoundation.castVote(proposal1Id, 1, { from: accounts[4] });
    await pollingFoundation.castVote(proposal1Id, 1, { from: accounts[5] });

    // advance to end of the voting period
    await time.increase(7200);

    // advance to the executing period
    await time.increase(1500);

    // execute
    // let descriptionHash = web3.utils.soliditySha3("Proposal") as string;
    //web3.utils.soliditySha3(web3.utils.toHex("Proposal"));
    let execute = pollingFoundation.methods["execute(address[],uint256[],bytes[],string)"].sendTransaction([executeMock.address], [0], [executeMock.contract.methods.setNum1(5).encodeABI()], "Proposal", { from: accounts[2] }) as any;
    await expectRevert(execute, "call reverted without message");
  });

  it("Should revert with message if execution on chain is not successful", async () => {
    // propose
    let propose = await pollingFoundation.methods["propose(address[],uint256[],bytes[],string,(bool,uint256,uint256,uint256,uint256,uint256,uint256,uint256))"]
      .sendTransaction([executeMock.address], [0], [executeMock.contract.methods.setNum2(5).encodeABI()], "Proposal",
      {
        accept: false,
        votingDelaySeconds: 3600,
        votingPeriodSeconds: 7200,
        executionDelaySeconds: 1500,
        executionPeriodSeconds: 2000,
        vpBlockPeriodSeconds: 259200,
        thresholdConditionBIPS: 7500,
        majorityConditionBIPS: 5000
      }, { from: accounts[2] }) as any;

    let proposal1Id = propose.logs[0].args.proposalId.toString();

    // advance to the voting period
    await time.increase(3600);

    // voting
    await pollingFoundation.castVote(proposal1Id, 1, { from: accounts[4] });
    await pollingFoundation.castVote(proposal1Id, 1, { from: accounts[5] });

    // advance to end of the voting period
    await time.increase(7200);

    // advance to the executing period
    await time.increase(1500);

    // execute
    // let descriptionHash = web3.utils.soliditySha3("Proposal") as string;
    //web3.utils.soliditySha3(web3.utils.toHex("Proposal"));
    let execute = pollingFoundation.methods["execute(address[],uint256[],bytes[],string)"].sendTransaction([executeMock.address], [0], [executeMock.contract.methods.setNum2(5).encodeABI()], "Proposal", { from: accounts[2] }) as any;
    await expectRevert(execute, "wrong number");
  });


  it("Should cast vote by signature", async () => {
    // create a proposal
    let tx = await pollingFoundation.methods["propose(string,(bool,uint256,uint256,uint256,uint256,uint256))"].sendTransaction("Proposal", 
    {
      accept: false,
      votingDelaySeconds: 3600,
      votingPeriodSeconds: 7200,
      vpBlockPeriodSeconds: 259200,
      thresholdConditionBIPS: 7500,
      majorityConditionBIPS: 5000
    }, { from: accounts[2] }) as any;
    let proposal1Id = tx.logs[0].args.proposalId.toString();

    // calculate hashTypedDataV4
    let ballotTypehash = web3.utils.keccak256("Ballot(uint256 proposalId,uint8 support)");
    let abi = web3.eth.abi.encodeParameters(['bytes32', 'uint256', 'uint8'],
      [ballotTypehash, proposal1Id, 0]);
    let structHash = web3.utils.keccak256(abi);
    // let hash = web3.utils.soliditySha3(abi) as string;

    let typeHash = web3.utils.soliditySha3("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    let hashedName = web3.utils.soliditySha3("PollingFoundation");
    let versionHex = web3.utils.utf8ToHex("1")
    let hashedVersion = web3.utils.soliditySha3(versionHex);
    let chainId = await web3.eth.getChainId();
    let thisAddress = pollingFoundation.address;

    let encodedDomainSeparator = web3.eth.abi.encodeParameters(["bytes32", "bytes32", "bytes32", "uint256", "address"], [typeHash, hashedName, hashedVersion, chainId, thisAddress])
    let domainSeparator = web3.utils.soliditySha3(encodedDomainSeparator) as string;
    let abiEncodePacked = "0x1901" + domainSeparator.slice(2) + structHash.slice(2);
    let hashTypedDataV4 = web3.utils.soliditySha3(abiEncodePacked) as string;

    // sign with private key of accounts[2]
    let signature1 = web3.eth.accounts.sign(hashTypedDataV4, "0x23c601ae397441f3ef6f1075dcb0031ff17fb079837beadaf3c84d96c6f3e569");
    let addr = web3.eth.accounts.privateKeyToAccount("0x23c601ae397441f3ef6f1075dcb0031ff17fb079837beadaf3c84d96c6f3e569");

    // advance to the voting period
    await time.increase(3600);

    let tx1 = await pollingFoundation.castVoteBySig(proposal1Id, 0, signature1.v, signature1.r, signature1.s) as any;

    // signer's address and recovered address should match
    expect(tx1.logs[0].args.voter).to.equals(addr.address);

    let info = await pollingFoundation.getProposalVotes(proposal1Id);
    expect(info[0].toString()).to.equals("0");
    expect(info[1].toString()).to.equals("1000");

    // accounts[2] tries to vote again
    let voteAgain = pollingFoundation.castVote(proposal1Id, 0, { from: addr.address });
    await expectRevert(voteAgain, "vote already cast");
  });

  it("Should revert if vote power block and end of voting period are too far apart", async () => {
    const twentyEightDays = 28 * 24 * 60 * 60;

    // propose
    let propose = pollingFoundation.methods["propose(string,(bool,uint256,uint256,uint256,uint256,uint256))"].sendTransaction("Proposal", 
    {
      accept: false,
      votingDelaySeconds: 3600,
      votingPeriodSeconds: twentyEightDays,
      vpBlockPeriodSeconds: 259200,
      thresholdConditionBIPS: 7500,
      majorityConditionBIPS: 5000
    }, { from: accounts[2] }) as any;
    await expectRevert(propose, "vote power block is too far in the past");
  });

  it("Should not change absolute or relative threshold for active proposal", async () => {
    // set circulating supply to 7000
    const getCirculatingSupplyAt = web3.utils.sha3("getCirculatingSupplyAt(uint256)")!.slice(0, 10); // first 4 bytes is function selector
    await mockSupply.givenMethodReturnUint(getCirculatingSupplyAt, 7000);

    let tx = await pollingFoundation.methods["propose(string,(bool,uint256,uint256,uint256,uint256,uint256))"].sendTransaction("Proposal", 
    {
      accept: false,
      votingDelaySeconds: 3600,
      votingPeriodSeconds: 7200,
      vpBlockPeriodSeconds: 259200,
      thresholdConditionBIPS: 7500,
      majorityConditionBIPS: 5000
    }, { from: accounts[2] }) as any;
    let proposal1Id = tx.logs[0].args.proposalId.toString();

    // event ProposalCreated
    expect(tx.logs[0].args.proposalId.toString()).to.equals(proposal1Id);
    expect(tx.logs[0].args.thresholdConditionBIPS.toString()).to.equals("7500");
    expect(tx.logs[0].args.majorityConditionBIPS.toString()).to.equals("5000");
    expect(tx.logs[0].args.circulatingSupply.toString()).to.equals("7000");

    // advance one hour to the voting period
    await time.increase(3600);

    // voting
    await pollingFoundation.castVote(proposal1Id, 0, { from: accounts[4] });
    await pollingFoundation.castVote(proposal1Id, 0, { from: accounts[5] });

    let proposalVP = await pollingFoundation.getProposalVotes(proposal1Id);
    expect(proposalVP[0].toString()).to.equals("0");
    expect(proposalVP[1].toString()).to.equals("5000");

    // advance to end of the voting period
    await time.increase(7200);

    // execute (flag as executed) 
    let execute = await pollingFoundation.methods["execute(string)"].sendTransaction("Proposal", { from: accounts[2] }) as any;
    expectEvent(execute, "ProposalExecuted", { proposalId: proposal1Id });
    let state = await pollingFoundation.state(proposal1Id);
    expect(state.toNumber()).to.equal(6);

    // create another proposal
    let tx2 = await pollingFoundation.methods["propose(string,(bool,uint256,uint256,uint256,uint256,uint256))"].sendTransaction("Proposal2", 
    {
      accept: false,
      votingDelaySeconds: 3600,
      votingPeriodSeconds: 7200,
      vpBlockPeriodSeconds: 259200,
      thresholdConditionBIPS: 6500,
      majorityConditionBIPS: 5500
    }, { from: accounts[2] }) as any;
    let proposal2Id = tx2.logs[0].args.proposalId.toString();

    // event ProposalCreated
    expect(tx2.logs[0].args.proposalId.toString()).to.equals(proposal2Id);
    expect(tx2.logs[0].args.thresholdConditionBIPS.toString()).to.equals("6500");
    expect(tx2.logs[0].args.majorityConditionBIPS.toString()).to.equals("5500");
    expect(tx2.logs[0].args.circulatingSupply.toString()).to.equals("7000");

    // advance one hour to the voting period
    await time.increase(3600);

    // cast the same votes
    await pollingFoundation.castVote(proposal2Id, 0, { from: accounts[4] });
    await pollingFoundation.castVote(proposal2Id, 0, { from: accounts[5] });

    // advance to end of the voting period
    await time.increase(7200);

    // proposal should be rejected (defeated), beacuse absolute threshold lowered and quorum was reached
    let state2 = await pollingFoundation.state(proposal2Id);
    expect(state2.toString()).to.equals("2");

    // should not be able to execute
    let execute2 = pollingFoundation.methods["execute(string)"].sendTransaction("Proposal2", { from: accounts[2] }) as any;
    await expectRevert(execute2, "proposal not in execution state");
  });

  it("Should revert if proposal with some proposal id doesn't exists", async() => {
    let tx = pollingFoundation.state(123);
    await expectRevert(tx, "unknown proposal id")
  });

  it("Should revert on-chain proposal if sum of _values does not equal msg.value", async () => {
    // propose
    let propose = await pollingFoundation.methods["propose(address[],uint256[],bytes[],string,(bool,uint256,uint256,uint256,uint256,uint256,uint256,uint256))"]
      .sendTransaction([executeMock.address], [10], [executeMock.contract.methods.setNum(3).encodeABI()], "Proposal",
      {
        accept: false,
        votingDelaySeconds: 3600,
        votingPeriodSeconds: 7200,
        executionDelaySeconds: 1500,
        executionPeriodSeconds: 2000,
        vpBlockPeriodSeconds: 259200,
        thresholdConditionBIPS: 7500,
        majorityConditionBIPS: 5000
      }, { from: accounts[2] }) as any;

    let proposal1Id = propose.logs[0].args.proposalId.toString();

    // advance to the voting period
    await time.increase(3600);

    // voting
    await pollingFoundation.castVote(proposal1Id, 1, { from: accounts[4] });
    await pollingFoundation.castVote(proposal1Id, 1, { from: accounts[5] });

    // advance to end of the voting period
    await time.increase(7200);

    // advance to the executing period
    await time.increase(1500);

    // execute
    // let descriptionHash = web3.utils.soliditySha3("Proposal") as string;
    //web3.utils.soliditySha3(web3.utils.toHex("Proposal"));
    expect((await pollingFoundation.getProposalId([executeMock.address], [10],  [executeMock.contract.methods.setNum(3).encodeABI()], "Proposal")).toString()).to.equals(proposal1Id);

    let execute = pollingFoundation.methods["execute(address[],uint256[],bytes[],string)"].sendTransaction([executeMock.address], [10], [executeMock.contract.methods.setNum(3).encodeABI()], "Proposal", { from: accounts[2], value: "5" }) as any;

    await expectRevert(execute, "sum of _values does not equals msg.value");
  });

  it("Should cancel a proposal", async () => {
    // set circulating supply to 9000
    const getCirculatingSupplyAt = web3.utils.sha3("getCirculatingSupplyAt(uint256)")!.slice(0, 10); // first 4 bytes is function selector
    await mockSupply.givenMethodReturnUint(getCirculatingSupplyAt, 9000);

    let tx = await pollingFoundation.methods["propose(string,(bool,uint256,uint256,uint256,uint256,uint256))"].sendTransaction("Proposal", 
    {
      accept: false,
      votingDelaySeconds: 3600,
      votingPeriodSeconds: 7200,
      vpBlockPeriodSeconds: 259200,
      thresholdConditionBIPS: 7500,
      majorityConditionBIPS: 5000
    }, { from: accounts[2] }) as any;
    let proposalId = tx.logs[0].args.proposalId.toString();  

    // cancel proposal
    let cancel = await pollingFoundation.cancel(proposalId, { from: accounts[2] });
    expectEvent(cancel, "ProposalCanceled", { proposalId: proposalId });

    // advance one hour to the voting period
    await time.increase(3600);

    // should not be able to cast vote
    let vote = pollingFoundation.castVote(proposalId, 1, { from: accounts[2] });
    await expectRevert(vote, "proposal not active");

    // advance to end of the voting period
    await time.increase(7200);

    // should not be yet executed
    let state = await pollingFoundation.state(proposalId);
    expect(state.toNumber()).to.equal(7);

    // should not mark as executed
    let execute = pollingFoundation.methods["execute(string)"].sendTransaction("Proposal", { from: accounts[2] }) as any;
    await expectRevert(execute, "proposal not in execution state");

    let state1 = await pollingFoundation.state(proposalId);
    expect(state1.toNumber()).to.equal(7);
  });

  it("Should not cancel a proposal from wrong address", async () => {
    // set circulating supply to 9000
    const getCirculatingSupplyAt = web3.utils.sha3("getCirculatingSupplyAt(uint256)")!.slice(0, 10); // first 4 bytes is function selector
    await mockSupply.givenMethodReturnUint(getCirculatingSupplyAt, 9000);

    let tx = await pollingFoundation.methods["propose(string,(bool,uint256,uint256,uint256,uint256,uint256))"].sendTransaction("Proposal", 
    {
      accept: false,
      votingDelaySeconds: 3600,
      votingPeriodSeconds: 7200,
      vpBlockPeriodSeconds: 259200,
      thresholdConditionBIPS: 7500,
      majorityConditionBIPS: 5000
    }, { from: accounts[2] }) as any;
    let proposalId = tx.logs[0].args.proposalId.toString();  

    // try to cancel proposal
    let cancel =  pollingFoundation.cancel(proposalId, { from: accounts[3] });
    await expectRevert(cancel, "proposal can only be canceled by its proposer");
  });

  it("Should not cancel a proposal after vote starts", async () => {
    // set circulating supply to 9000
    const getCirculatingSupplyAt = web3.utils.sha3("getCirculatingSupplyAt(uint256)")!.slice(0, 10); // first 4 bytes is function selector
    await mockSupply.givenMethodReturnUint(getCirculatingSupplyAt, 9000);

    let tx = await pollingFoundation.methods["propose(string,(bool,uint256,uint256,uint256,uint256,uint256))"].sendTransaction("Proposal", 
    {
      accept: false,
      votingDelaySeconds: 3600,
      votingPeriodSeconds: 7200,
      vpBlockPeriodSeconds: 259200,
      thresholdConditionBIPS: 7500,
      majorityConditionBIPS: 5000
    }, { from: accounts[2] }) as any;
    let proposalId = tx.logs[0].args.proposalId.toString();  

    // advance one hour to the voting period
    await time.increase(3600);

    // try to cancel proposal
    let cancel = pollingFoundation.cancel(proposalId, { from: accounts[2] });
    await expectRevert(cancel, "proposal can only be canceled before voting starts");
  });

  it("Should change proposers and emit ProposersChanged, and revert if change is not made from governance", async () => {
    const tx = await pollingFoundation.changeProposers([accounts[4], accounts[5]], [accounts[2], accounts[3]], { from: accounts[0] });

    expect(await pollingFoundation.isProposer(accounts[2])).to.equals(false);
    expect(await pollingFoundation.isProposer(accounts[3])).to.equals(false);
    expect(await pollingFoundation.isProposer(accounts[4])).to.equals(true);
    expect(await pollingFoundation.isProposer(accounts[5])).to.equals(true);
    expect(await pollingFoundation.isProposer(accounts[6])).to.equals(true);
    expect(await pollingFoundation.isProposer(accounts[19])).to.equals(false);
    expectEvent(tx, PROPOSERSCHANGED_EVENT);

    let promise = pollingFoundation.changeProposers([accounts[4], accounts[5]], [accounts[2], accounts[3]], { from: accounts[100] });
    await expectRevert(promise, ONLY_GOVERNANCE_MSG);
  });

////////////////////////////////////////////////////////////////// accept

  it("Should propose and execute a proposal of type accept", async () => {
    // set circulating supply to 8000
    const getCirculatingSupplyAt = web3.utils.sha3("getCirculatingSupplyAt(uint256)")!.slice(0, 10); // first 4 bytes is function selector
    await mockSupply.givenMethodReturnUint(getCirculatingSupplyAt, 8000);

    let tx = await pollingFoundation.methods["propose(string,(bool,uint256,uint256,uint256,uint256,uint256))"].sendTransaction("Proposal accept", 
    {
      accept: true,
      votingDelaySeconds: 3600,
      votingPeriodSeconds: 7200,
      vpBlockPeriodSeconds: 259200,
      thresholdConditionBIPS: 5000,
      majorityConditionBIPS: 6000
    }, { from: accounts[2] }) as any;
    let proposal1Id = tx.logs[0].args.proposalId.toString();

    // advance one hour to the voting period
    await time.increase(3600);

    // voting
    await pollingFoundation.castVote(proposal1Id, 1, { from: accounts[2] });
    await pollingFoundation.castVote(proposal1Id, 1, { from: accounts[3] });
    await pollingFoundation.castVote(proposal1Id, 1, { from: accounts[4] });
    let voteTx = await pollingFoundation.castVote(proposal1Id, 1, { from: accounts[5] });
    expectEvent(voteTx, "VoteCast", { voter: accounts[5], proposalId: proposal1Id, support: toBN(1), votePower: toBN(3000), reason:"", forVotePower: toBN(7000), againstVotePower: toBN(0) }); 


    let info = await pollingFoundation.getProposalInfo(proposal1Id);

    let proposalVP = await pollingFoundation.getProposalVotes(proposal1Id);
    expect(proposalVP[0].toString()).to.equals("7000");
    expect(proposalVP[1].toString()).to.equals("0");

    expectEvent(tx, "ProposalCreated", { proposalId: proposal1Id, accept: true, thresholdConditionBIPS: toBN(5000), majorityConditionBIPS: toBN(6000), voteTimes: [info[3], info[4]], circulatingSupply: toBN(8000) }); 

    // advance to end of the voting period
    await time.increase(7200);

    // should not be yet executed
    let state = await pollingFoundation.state(proposal1Id);
    expect(state.toNumber()).to.equal(4);

    // mark proposal as executed
    let execute = await pollingFoundation.methods["execute(string)"].sendTransaction("Proposal accept", { from: accounts[2] }) as any;
    
    expectEvent(execute, "ProposalExecuted", { proposalId: proposal1Id });

    let state1 = await pollingFoundation.state(proposal1Id);
    expect(state1.toNumber()).to.equal(6);
  });

  it("Should reject proposal if not enough vote power votes for", async() => {
    // set circulating supply to 7500
    const getCirculatingSupplyAt = web3.utils.sha3("getCirculatingSupplyAt(uint256)")!.slice(0, 10); // first 4 bytes is function selector
    await mockSupply.givenMethodReturnUint(getCirculatingSupplyAt, 7500);

    let tx = await pollingFoundation.methods["propose(string,(bool,uint256,uint256,uint256,uint256,uint256))"].sendTransaction("Proposal accept", 
    {
      accept: true,
      votingDelaySeconds: 3600,
      votingPeriodSeconds: 7200,
      vpBlockPeriodSeconds: 259200,
      thresholdConditionBIPS: 3000,
      majorityConditionBIPS: 6000
    }, { from: accounts[2] }) as any;
    let proposal1Id = tx.logs[0].args.proposalId.toString();

    await time.increase(3600);

    await pollingFoundation.castVote(proposal1Id, 0, { from: accounts[2] });
    await pollingFoundation.castVote(proposal1Id, 1, { from: accounts[3] });
    await pollingFoundation.castVote(proposal1Id, 1, { from: accounts[4] });
    await pollingFoundation.castVote(proposal1Id, 0, { from: accounts[5] });

    await time.increase(7200);

    // proposal rejected (more vote power was against)
    let state1 = await pollingFoundation.state(proposal1Id);
    expect(state1.toString()).to.equals("2");

    let execute = pollingFoundation.methods["execute(string)"].sendTransaction("Proposal accept", { from: accounts[2] }) as any;
    
    await expectRevert(execute, "proposal not in execution state");
  });

  it("Should reject proposal if quorum is not achieved", async() => {
    // set circulating supply to 10000
    const getCirculatingSupplyAt = web3.utils.sha3("getCirculatingSupplyAt(uint256)")!.slice(0, 10); // first 4 bytes is function selector
    await mockSupply.givenMethodReturnUint(getCirculatingSupplyAt, 10000);

    let tx = await pollingFoundation.methods["propose(string,(bool,uint256,uint256,uint256,uint256,uint256))"].sendTransaction("Proposal accept", 
    {
      accept: true,
      votingDelaySeconds: 3600,
      votingPeriodSeconds: 7200,
      vpBlockPeriodSeconds: 259200,
      thresholdConditionBIPS: 5000,
      majorityConditionBIPS: 6000
    }, { from: accounts[2] }) as any;
    let proposal1Id = tx.logs[0].args.proposalId.toString();

    await time.increase(3600);

    await pollingFoundation.castVote(proposal1Id, 1, { from: accounts[2] });

    await time.increase(7200);

    // proposal rejected
    let state1 = await pollingFoundation.state(proposal1Id);
    expect(state1.toString()).to.equals("2");

    let execute = pollingFoundation.methods["execute(string)"].sendTransaction("Proposal accept", { from: accounts[2] }) as any;
    
    await expectRevert(execute, "proposal not in execution state");
  });

  it("Should reject proposal if quorum is not achieved 2", async() => {
    // set circulating supply to 15000
    const getCirculatingSupplyAt = web3.utils.sha3("getCirculatingSupplyAt(uint256)")!.slice(0, 10); // first 4 bytes is function selector
    await mockSupply.givenMethodReturnUint(getCirculatingSupplyAt, 15000);

    let tx = await pollingFoundation.methods["propose(string,(bool,uint256,uint256,uint256,uint256,uint256))"].sendTransaction("Proposal accept", 
    {
      accept: true,
      votingDelaySeconds: 3600,
      votingPeriodSeconds: 7200,
      vpBlockPeriodSeconds: 259200,
      thresholdConditionBIPS: 5000,
      majorityConditionBIPS: 6000
    }, { from: accounts[2] }) as any;
    let proposal1Id = tx.logs[0].args.proposalId.toString();

    await time.increase(3600);

    // more vote power voted for proposal than against (relative threshold is achieved)
    await pollingFoundation.castVote(proposal1Id, 1, { from: accounts[2] });
    await pollingFoundation.castVote(proposal1Id, 1, { from: accounts[5] });
    await pollingFoundation.castVote(proposal1Id, 1, { from: accounts[6] });
    await pollingFoundation.castVote(proposal1Id, 1, { from: accounts[3] });
    await pollingFoundation.castVote(proposal1Id, 0, { from: accounts[4] });

    await time.increase(7200);

    // proposal rejected
    let state1 = await pollingFoundation.state(proposal1Id);
    expect(state1.toString()).to.equals("2");

    let execute = pollingFoundation.methods["execute(string)"].sendTransaction("Proposal accept", { from: accounts[2] }) as any;
    
    await expectRevert(execute, "proposal not in execution state");
  });


  it("Should accept proposal if quorum is achieved ", async() => {
    // set circulating supply to 14000
    const getCirculatingSupplyAt = web3.utils.sha3("getCirculatingSupplyAt(uint256)")!.slice(0, 10); // first 4 bytes is function selector
    await mockSupply.givenMethodReturnUint(getCirculatingSupplyAt, 14000);

    let tx = await pollingFoundation.methods["propose(string,(bool,uint256,uint256,uint256,uint256,uint256))"].sendTransaction("Proposal accept",
    {
      accept: true,
      votingDelaySeconds: 3600,
      votingPeriodSeconds: 7200,
      vpBlockPeriodSeconds: 259200,
      thresholdConditionBIPS: 5000,
      majorityConditionBIPS: 6000
    }, { from: accounts[2] }) as any;
    let proposal1Id = tx.logs[0].args.proposalId.toString();

    await time.increase(3600);

    // more vote power voted for proposal than against (relative threshold is achieved)
    await pollingFoundation.castVote(proposal1Id, 1, { from: accounts[2] });
    await pollingFoundation.castVote(proposal1Id, 1, { from: accounts[5] });
    await pollingFoundation.castVote(proposal1Id, 1, { from: accounts[6] });
    await pollingFoundation.castVote(proposal1Id, 1, { from: accounts[3] });
    await pollingFoundation.castVote(proposal1Id, 0, { from: accounts[4] });

    await time.increase(7200);

    // proposal rejected
    let state1 = await pollingFoundation.state(proposal1Id);
    expect(state1.toString()).to.equals("4");

    await pollingFoundation.methods["execute(string)"].sendTransaction("Proposal accept", { from: accounts[2] }) as any;
  });

});
