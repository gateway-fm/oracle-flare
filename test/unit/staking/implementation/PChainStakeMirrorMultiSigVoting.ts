import { constants, expectRevert, time, expectEvent } from '@openzeppelin/test-helpers';
import {
  PChainStakeMirrorMultiSigVotingInstance
} from "../../../../typechain-truffle";
import { toBN } from '../../../utils/test-helpers';

const getTestFile = require('../../../utils/constants').getTestFile;
const Voting = artifacts.require("PChainStakeMirrorMultiSigVoting");

async function increaseTimeTo(current: BN, increase: number) {
  try {
    await time.increaseTo(current.addn(increase));
  } catch (e: any) {
    if (!(e.message.includes('Cannot increase current time') && e.message.includes('to a moment in the past'))) {
      throw e
    }
  }
}

contract(`PChainStakeMirrorMultiSigVoting.sol; ${getTestFile(__filename)}; PChain stake mirror multisig voting unit tests`, async accounts => {
  // contains a fresh contract for each test
  let voting: PChainStakeMirrorMultiSigVotingInstance;
  let voters = [accounts[1], accounts[2], accounts[3], accounts[4], accounts[5], accounts[6]];
  let startTs: BN;
  let merkleRoot: string;

  beforeEach(async () => {
    startTs = await time.latest();
    merkleRoot = web3.utils.keccak256("merkleRoot");

    voting = await Voting.new(
      accounts[0],
      startTs,
      90,
      3,
      voters
    );
  });

  it("Should revert deploying contract if voting threshold is too low", async () => {
    let deployVotingContract = Voting.new(accounts[0], startTs, 90, 1, [accounts[1]]);
    await expectRevert(deployVotingContract, "voting threshold too low");
  });

  it("Should revert deploying contract if first epoch start time is in the future", async () => {
    let deployVotingContract = Voting.new(accounts[0], startTs.addn(10), 90, 3, [accounts[1]]);
    await expectRevert(deployVotingContract, "first epoch start in the future");
  });

  it("Should revert deploying contract if trying to set too low voting threshold", async () => {
    let setThreshold = voting.setVotingThreshold(1);
    await expectRevert(setThreshold, "voting threshold too low");
  });

  it("Should change voting threshold", async () => {
    expect((await voting.getVotingThreshold()).toString()).to.equals("3");
    await voting.setVotingThreshold(4);
    expect((await voting.getVotingThreshold()).toString()).to.equals("4");
  });

  it("Should revert deploying contract if epoch duration is too short", async () => {
    let deployVotingContract = Voting.new(accounts[0], startTs, 0, 3, [accounts[1]]);
    await expectRevert(deployVotingContract, "epoch duration too short");
  });

  it("Should get epoch configuration", async () => {
    let config = await voting.getEpochConfiguration();
    expect(config[0].toString()).to.equals(startTs.toString());
    expect(config[1].toString()).to.equals("90");
  });

  it("Should get current epoch id", async () => {
    expect((await voting.getCurrentEpochId()).toString()).to.equals("0");
    await increaseTimeTo(startTs, 100);
    expect((await voting.getCurrentEpochId()).toString()).to.equals("1");
  });

  it("Should get epoch id", async () => {
    expect((await voting.getEpochId(startTs.addn(89))).toString()).to.equals("0");
    expect((await voting.getEpochId(startTs.addn(110))).toString()).to.equals("1");
    expect((await voting.getEpochId(startTs.addn(179))).toString()).to.equals("1");
    expect((await voting.getEpochId(startTs.addn(180))).toString()).to.equals("2");
    expect((await voting.getEpochId(startTs.subn(100))).toString()).to.equals("0");
  });

  it("Should change voters", async () => {
    let newVoters = [accounts[2], accounts[22], accounts[222]];
    expect((await voting.getVoters()).toString()).to.equals((voters).toString());
    // change voters
    let changeVoters = await voting.changeVoters(newVoters);
    expect((await voting.getVoters()).toString()).to.equals((newVoters).toString());
    expectEvent(changeVoters, "PChainStakeMirrorVotersSet", { voters: newVoters });
  });

  it("Should revert if epoch has not yet ended", async () => {
    let vote = voting.submitVote(0, merkleRoot, { from: accounts[1] });
    await expectRevert(vote, "epoch not ended yet");
  });

  it("Should revert if non-voter is trying to vote", async () => {
    await increaseTimeTo(startTs, 100);
    let vote = voting.submitVote(0, merkleRoot, { from: accounts[10] });
    await expectRevert(vote, "only voters");
  });

  it("Should revert if non-voter is trying to vote for validator uptime", async () => {
    let vote = voting.submitValidatorUptimeVote(0, [], { from: accounts[10] });
    await expectRevert(vote, "only voters");
  });

  it("Should accept vote for validator uptime", async () => {
    const nodeIds = ["0x0123456789012345678901234567890123456789", "0x0123456789012345678901234567890123456788"]
    const tx = await voting.submitValidatorUptimeVote(1, nodeIds, { from: accounts[1] });
    expectEvent(tx, "PChainStakeMirrorValidatorUptimeVoteSubmitted", {voter: accounts[1], nodeIds: nodeIds, timestamp: await time.latest(), rewardEpochId: toBN(1)});
  });

  it("Should revert if trying to vote twice for the same Merkle root in the same epoch", async () => {
    await increaseTimeTo(startTs, 100);
    await voting.submitVote(0, merkleRoot, { from: accounts[1] });
    let voteAgain = voting.submitVote(0, merkleRoot, { from: accounts[1] });
    await expectRevert(voteAgain, "already voted");
  });

  it("Should not revert if voting twice for different Merkle roots in the same epoch", async () => {
    await increaseTimeTo(startTs, 100);
    let merkleRoot1 = web3.utils.keccak256("merkleRoot1");
    let merkleRoot2 = web3.utils.keccak256("merkleRoot2");
    await voting.submitVote(0, merkleRoot1, { from: accounts[1] });
    await voting.submitVote(0, merkleRoot2, { from: accounts[1] });
    // check if vote count at this point is correct
    let votesData = await voting.getVotes(0);
    expect(votesData[0].merkleRoot).to.equals(merkleRoot1);
    expect(votesData[0].votes.toString()).to.equals([accounts[1]].toString());
    expect(votesData[1].merkleRoot).to.equals(merkleRoot2);
    expect(votesData[1].votes.toString()).to.equals([accounts[1]].toString());
  });

  it("Should not allow to vote if address is not on voters list anymore", async () => {
    await increaseTimeTo(startTs, 100);
    await voting.submitVote(0, merkleRoot, { from: accounts[1] });
    await voting.changeVoters([accounts[22], accounts[222]]);
    let vote = voting.submitVote(0, merkleRoot, { from: accounts[2] });
    await expectRevert(vote, "only voters");
  });

  it("Should vote and finalize", async () => {
    await increaseTimeTo(startTs, 100);
    // epoch 0
    let merkleRoot1 = web3.utils.keccak256("merkleRoot1");
    let merkleRoot2 = web3.utils.keccak256("merkleRoot2");

    // accounts[1] votes for merkle root 1
    let vote1 = await voting.submitVote(0, merkleRoot1, { from: accounts[1] });
    expectEvent(vote1, "PChainStakeMirrorVoteSubmitted", { epochId: "0", voter: accounts[1], merkleRoot: merkleRoot1 });

    // accounts[2] votes for merkle root 1
    await voting.submitVote(0, merkleRoot1, { from: accounts[2] });

    // accounts[3] votes for merkle root 2
    let vote3 = await voting.submitVote(0, merkleRoot2, { from: accounts[3] });
    expectEvent(vote3, "PChainStakeMirrorVoteSubmitted", { epochId: "0", voter: accounts[3], merkleRoot: merkleRoot2 });

    // check if vote count at this point is correct
    let votesData = await voting.getVotes(0);
    expect(votesData[0].merkleRoot).to.equals(merkleRoot1);
    expect(votesData[0].votes.toString()).to.equals([accounts[1], accounts[2]].toString());
    expect(votesData[1].merkleRoot).to.equals(merkleRoot2);
    expect(votesData[1].votes.toString()).to.equals([accounts[3]].toString());

    // accounts[4] votes for merkle root 2
    await voting.submitVote(0, merkleRoot2, { from: accounts[4] });

    // accounts[5] votes for merkle root 2; third vote (threshold) for merkle root 2. Epoch should be finalized
    await voting.submitVote(0, merkleRoot2, { from: accounts[5] });

    expect(await voting.getMerkleRoot(0)).to.equals(merkleRoot2);

    // should not allow voting because epoch is already finalized
    let vote = voting.submitVote(0, merkleRoot1, { from: accounts[6] });
    await expectRevert(vote, "epoch already finalized");

    // should not get votes if epoch is already finalized
    let getVotes = voting.getVotes(0);
    await expectRevert(getVotes, "epoch already finalized");
  });

  it("Should not reset voting if epoch is not yet finalized", async () => {
    let reset = voting.resetVoting(0);
    await expectRevert(reset, "epoch not finalized");
  });

  it("Should reset voting", async () => {
    await increaseTimeTo(startTs, 100);

    // voting
    await voting.submitVote(0, merkleRoot, { from: accounts[1] });
    await voting.submitVote(0, merkleRoot, { from: accounts[2] });
    let finalize = await voting.submitVote(0, merkleRoot, { from: accounts[3] });
    expectEvent(finalize, "PChainStakeMirrorVotingFinalized", { epochId: "0", merkleRoot: merkleRoot });

    // epoch is finalized
    expect(await voting.getMerkleRoot(0)).to.equals(merkleRoot);

    // reset voting
    let reset = await voting.resetVoting(0);
    expect(await voting.getMerkleRoot(0)).to.equals(constants.ZERO_BYTES32);
    expectEvent(reset, "PChainStakeMirrorVotingReset", { epochId: "0" })
  });

  it("Should return correct information if address should vote", async () => {
    await increaseTimeTo(startTs, 100);

    expect(await voting.shouldVote(0, accounts[1])).to.equals(true);
    expect(await voting.shouldVote(0, accounts[4])).to.equals(true);

    await voting.submitVote(0, merkleRoot, { from: accounts[1] });
    // false, because already voted
    expect(await voting.shouldVote(0, accounts[1])).to.equals(false);
    expect(await voting.shouldVote(0, accounts[4])).to.equals(true);

    await voting.submitVote(0, merkleRoot, { from: accounts[2] });
    await voting.submitVote(0, merkleRoot, { from: accounts[3] });

    // false, because not a voter
    expect(await voting.shouldVote(0, accounts[0])).to.equals(false);
    // false, because voting already finished
    expect(await voting.shouldVote(0, accounts[4])).to.equals(false);

  });

});