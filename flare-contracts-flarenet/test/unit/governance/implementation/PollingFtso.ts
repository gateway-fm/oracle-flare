import { expectEvent, expectRevert, time, constants } from '@openzeppelin/test-helpers';
import { expect } from "hardhat";
import { Contracts } from '../../../../deployment/scripts/Contracts';
import {
  MockContractInstance, PollingFtsoInstance
} from "../../../../typechain-truffle";
import { encodeContractNames, toBN } from "../../../utils/test-helpers";

const getTestFile = require('../../../utils/constants').getTestFile;

const MockContract = artifacts.require("MockContract");
const PollingFtso = artifacts.require("PollingFtso");

contract(`PollingFtso.sol; ${getTestFile(__filename)}; PollingFtso unit tests`, async accounts => {
  let pollingFtso: PollingFtsoInstance;
  let mockVoterWhitelister: MockContractInstance;
  let mockFtsoRewardManager: MockContractInstance;

  const ADDRESS_UPDATER = accounts[16];
  const getWhitelist = web3.utils.sha3("getFtsoWhitelistedPriceProvidersBySymbol(string)")!.slice(0, 10); // first 4 bytes is function selector
  const BURN_ADDRESS = "0x000000000000000000000000000000000000dEaD";
  const PROPOSAL_FEE = "100";
  const DAY = 86400;
  const ERR_CANT_REMOVE = "cannot remove member";

  describe("Setting, voting and proposing", async () => {

    beforeEach(async () => {
      mockVoterWhitelister = await MockContract.new();
      mockFtsoRewardManager = await MockContract.new();


      pollingFtso = await PollingFtso.new(
        accounts[0],
        ADDRESS_UPDATER
      );

      await pollingFtso.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.VOTER_WHITELISTER, Contracts.FTSO_REWARD_MANAGER]),
        [ADDRESS_UPDATER, mockVoterWhitelister.address, mockFtsoRewardManager.address], { from: ADDRESS_UPDATER });

      await pollingFtso.setMaintainer(accounts[0], { from: accounts[0] })
      await pollingFtso.setParameters(3600, 7200, 5000, 5000, 100, 3, 2, 2, 4, 2, 3, { from: accounts[0] });
      await pollingFtso.changeManagementGroupMembers([accounts[1], accounts[2], accounts[3], accounts[4], accounts[5], accounts[6], accounts[7], accounts[8]], []);
    });

    it("Should check deployment parameters", async () => {
      expect(await pollingFtso.canPropose(accounts[3])).to.equals(true);
      expect(await pollingFtso.canPropose(accounts[14])).to.equals(false);
      expect((await pollingFtso.votingDelaySeconds()).toNumber()).to.equals(3600);
      expect((await pollingFtso.votingPeriodSeconds()).toNumber()).to.equals(7200);
      expect((await pollingFtso.thresholdConditionBIPS()).toNumber()).to.equals(5000);
      expect((await pollingFtso.majorityConditionBIPS()).toNumber()).to.equals(5000);
      expect((await pollingFtso.getManagementGroupMembers()).toString()).to.equals(([accounts[1], accounts[2], accounts[3], accounts[4], accounts[5], accounts[6], accounts[7], accounts[8]]).toString());

      expect((await pollingFtso.addAfterRewardedEpochs()).toNumber()).to.equals(3);
      expect((await pollingFtso.addAfterNotChilledEpochs()).toNumber()).to.equals(2);
      expect((await pollingFtso.removeAfterNotRewardedEpochs()).toNumber()).to.equals(2);
      expect((await pollingFtso.removeAfterEligibleProposals()).toNumber()).to.equals(4);
      expect((await pollingFtso.removeAfterNonParticipatingProposals()).toNumber()).to.equals(2);
      expect((await pollingFtso.removeForDays()).toNumber()).to.equals(3);
    });

    it("Should revert changing parameters if not called from maintainer address", async () => {
      let tx = pollingFtso.setParameters(3600, 7200, 5000, 5000, 100, 3, 2, 2, 4, 2, 4, { from: accounts[100] });
      await expectRevert(tx, "only maintainer");
    });

    it("Should revert changing parameters if setting wrong parameters", async () => {
      let tx = pollingFtso.setParameters(3600, 7200, 5000, 5000, 100, 3, 2, 12, 4, 2, 4, { from: accounts[0] });
      await expectRevert(tx, "invalid parameters");
    });

    it("Should change parameters and emit event", async () => {
      let tx = await pollingFtso.setParameters(3600, 7200, 5000, 5000, 100, 3, 2, 2, 4, 2, 8, { from: accounts[0] });
      expectEvent(tx, "ParametersSet", { votingDelaySeconds: "3600", votingPeriodSeconds: "7200", thresholdConditionBIPS: "5000", majorityConditionBIPS: "5000", proposalFeeValueWei: "100", addAfterRewardedEpochs: "3", addAfterNotChilledEpochs: "2", removeAfterNotRewardedEpochs: "2", removeAfterEligibleProposals: "4", removeAfterNonParticipatingProposals: "2", removeForDays: "8" });
    });

    it("Should create proposal", async () => {
      const burnAddressOpeningBalance = toBN(await web3.eth.getBalance(BURN_ADDRESS));
      let tx = await pollingFtso.propose("Ban data provider accounts[6]", { from: accounts[2], value: PROPOSAL_FEE });
      const burnAddressClosingBalance = toBN(await web3.eth.getBalance(BURN_ADDRESS));
      expect(burnAddressClosingBalance.sub(burnAddressOpeningBalance).toString()).to.be.equal(PROPOSAL_FEE);
      let proposal1Id = tx.logs[0].args[0].toString();
      expectEvent(tx, "FtsoProposalCreated", { proposalId: proposal1Id, proposer: accounts[2], description: "Ban data provider accounts[6]", eligibleMembers: [accounts[1], accounts[2], accounts[3], accounts[4], accounts[5], accounts[6], accounts[7], accounts[8]]});


      let info = await pollingFtso.getProposalInfo(proposal1Id);
      expect(info[0]).to.equals("Ban data provider accounts[6]");

      // advance one hour to the voting period
      await time.increase(3600);

      // voting
      await pollingFtso.castVote(proposal1Id, 1, { from: accounts[2] });
      await pollingFtso.castVote(proposal1Id, 1, { from: accounts[3] });
      await pollingFtso.castVote(proposal1Id, 1, { from: accounts[4] });
      await pollingFtso.castVote(proposal1Id, 1, { from: accounts[5] });
      await pollingFtso.castVote(proposal1Id, 0, { from: accounts[6] });
      await pollingFtso.castVote(proposal1Id, 1, { from: accounts[7] });
      let cast8 = await pollingFtso.castVote(proposal1Id, 1, { from: accounts[8] });
      expectEvent(cast8, "VoteCast", { voter: accounts[8], support: "1", forVotePower: "6", againstVotePower: "1" })

      expect(await pollingFtso.hasVoted(proposal1Id, accounts[2])).to.equal(true);
      expect(await pollingFtso.hasVoted(proposal1Id, accounts[9])).to.equal(false);

      // advance to end of the voting period
      await time.increase(7200);

      // proposal succeeded
      let state = await pollingFtso.state(proposal1Id);
      expect(state.toNumber()).to.equal(4);
    });

    it("Should not be able to vote if not whitelisted", async () => {
      const burnAddressOpeningBalance = toBN(await web3.eth.getBalance(BURN_ADDRESS));
      let tx = await pollingFtso.propose("Ban data provider accounts[6]", { from: accounts[2], value: PROPOSAL_FEE });
      const burnAddressClosingBalance = toBN(await web3.eth.getBalance(BURN_ADDRESS));
      expect(burnAddressClosingBalance.sub(burnAddressOpeningBalance).toString()).to.be.equal(PROPOSAL_FEE);
      let proposal1Id = tx.logs[0].args[0].toString();

      // advance one hour to the voting period
      await time.increase(3600);

      // voting
      await pollingFtso.castVote(proposal1Id, 1, { from: accounts[2] });
      await pollingFtso.castVote(proposal1Id, 1, { from: accounts[3] });
      await pollingFtso.castVote(proposal1Id, 1, { from: accounts[4] });
      await pollingFtso.castVote(proposal1Id, 1, { from: accounts[5] });
      await pollingFtso.castVote(proposal1Id, 0, { from: accounts[6] });
      await pollingFtso.castVote(proposal1Id, 1, { from: accounts[7] });
      let vote = pollingFtso.castVote(proposal1Id, 1, { from: accounts[50] });
      await expectRevert(vote, "address is not eligible to cast a vote");

      // advance to end of the voting period
      await time.increase(7200);

      // proposal succeeded
      let state = await pollingFtso.state(proposal1Id);
      expect(state.toNumber()).to.equal(4);
    });

    it("Should revert because address is not allowed to submit a proposal", async () => {
      const burnAddressOpeningBalance = toBN(await web3.eth.getBalance(BURN_ADDRESS));
      let tx = pollingFtso.propose("Ban data provider accounts[6]", { from: accounts[15], value: PROPOSAL_FEE });
      const burnAddressClosingBalance = toBN(await web3.eth.getBalance(BURN_ADDRESS));
      // fee was not taken since proposal was not created
      expect(burnAddressClosingBalance.sub(burnAddressOpeningBalance).toString()).to.be.equal("0");

      await expectRevert(tx, "submitter is not eligible to submit a proposal");
    });

    it("Should not be rejected if turnout is too low", async () => {
      const burnAddressOpeningBalance = toBN(await web3.eth.getBalance(BURN_ADDRESS));
      let tx = await pollingFtso.propose("Ban data provider accounts[6]", { from: accounts[2], value: PROPOSAL_FEE });
      const burnAddressClosingBalance = toBN(await web3.eth.getBalance(BURN_ADDRESS));
      expect(burnAddressClosingBalance.sub(burnAddressOpeningBalance).toString()).to.be.equal(PROPOSAL_FEE);
      let proposal1Id = tx.logs[0].args[0].toString();

      // advance one hour to the voting period
      await time.increase(3600);

      // voting
      await pollingFtso.castVote(proposal1Id, 1, { from: accounts[2] });

      // advance to the end of the voting period
      await time.increase(7200);

      let state1 = await pollingFtso.state(proposal1Id);
      expect(state1.toString()).to.equals("3");
    });

    it("Should be rejected because enough vote power voted against", async () => {
      const burnAddressOpeningBalance = toBN(await web3.eth.getBalance(BURN_ADDRESS));
      let tx = await pollingFtso.propose("Ban data provider accounts[6]", { from: accounts[2], value: PROPOSAL_FEE });
      const burnAddressClosingBalance = toBN(await web3.eth.getBalance(BURN_ADDRESS));
      expect(burnAddressClosingBalance.sub(burnAddressOpeningBalance).toString()).to.be.equal(PROPOSAL_FEE);
      let proposal1Id = tx.logs[0].args[0].toString();

      // advance one hour to the voting period
      await time.increase(3600);

      // voting
      await pollingFtso.castVote(proposal1Id, 0, { from: accounts[3] });
      await pollingFtso.castVote(proposal1Id, 0, { from: accounts[4] });
      await pollingFtso.castVote(proposal1Id, 0, { from: accounts[5] });
      await pollingFtso.castVote(proposal1Id, 0, { from: accounts[6] });
      await pollingFtso.castVote(proposal1Id, 0, { from: accounts[7] });


      // advance to the end of the voting period
      await time.increase(7200);

      let state1 = await pollingFtso.state(proposal1Id);
      expect(state1.toString()).to.equals("3");
    });

    it("Should not allow voting twice", async () => {
      const burnAddressOpeningBalance = toBN(await web3.eth.getBalance(BURN_ADDRESS));
      let tx = await pollingFtso.propose("Ban data provider accounts[6]", { from: accounts[2], value: PROPOSAL_FEE });
      const burnAddressClosingBalance = toBN(await web3.eth.getBalance(BURN_ADDRESS));
      expect(burnAddressClosingBalance.sub(burnAddressOpeningBalance).toString()).to.be.equal(PROPOSAL_FEE);
      let proposal1Id = tx.logs[0].args[0].toString();

      // advance to the voting period
      await time.increase(3600);

      await pollingFtso.castVote(proposal1Id, 0, { from: accounts[3] });
      let castVote = pollingFtso.castVote(proposal1Id, 0, { from: accounts[3] });
      await expectRevert(castVote, "vote already cast");
    });


    it("Should check if proposal is pending", async () => {
      let tx = await pollingFtso.propose("Ban data provider accounts[6]", { from: accounts[2], value: PROPOSAL_FEE });
      let proposal1Id = tx.logs[0].args[0].toString();

      expect((await pollingFtso.state(proposal1Id)).toString()).to.equals("1");
    });

    it("Should revert if voter casts invalid vote", async () => {
      const burnAddressOpeningBalance = toBN(await web3.eth.getBalance(BURN_ADDRESS));
      let tx = await pollingFtso.propose("Ban data provider accounts[6]", { from: accounts[2], value: PROPOSAL_FEE });
      const burnAddressClosingBalance = toBN(await web3.eth.getBalance(BURN_ADDRESS));
      expect(burnAddressClosingBalance.sub(burnAddressOpeningBalance).toString()).to.be.equal(PROPOSAL_FEE);
      let proposal1Id = tx.logs[0].args[0].toString();

      await time.increase(3600);

      let vote = pollingFtso.castVote(proposal1Id, 4, { from: accounts[2] });

      await expectRevert(vote, "invalid value for enum VoteType");
    });

    it("Should revert if voter votes outside of the voting period", async () => {
      const burnAddressOpeningBalance = toBN(await web3.eth.getBalance(BURN_ADDRESS));
      let tx = await pollingFtso.propose("Ban data provider accounts[6]", { from: accounts[2], value: PROPOSAL_FEE });
      const burnAddressClosingBalance = toBN(await web3.eth.getBalance(BURN_ADDRESS));
      expect(burnAddressClosingBalance.sub(burnAddressOpeningBalance).toString()).to.be.equal(PROPOSAL_FEE);
      let proposal1Id = tx.logs[0].args[0].toString();

      let vote = pollingFtso.castVote(proposal1Id, 0);
      await expectRevert(vote, "proposal not active");
    });


    it("Should not revert if proposal with the same description already exist", async () => {
      const burnAddressOpeningBalance = toBN(await web3.eth.getBalance(BURN_ADDRESS));
      let propose1 = await pollingFtso.propose("Ban data provider accounts[6]", { from: accounts[2], value: PROPOSAL_FEE });
      const burnAddressClosingBalance = toBN(await web3.eth.getBalance(BURN_ADDRESS));
      expect(burnAddressClosingBalance.sub(burnAddressOpeningBalance).toString()).to.be.equal(PROPOSAL_FEE);
      let proposal1Id = propose1.logs[0].args[0].toString();
      let info1 = await pollingFtso.getProposalInfo(proposal1Id);
      expect(info1[0]).to.equals("Ban data provider accounts[6]");

      const burnAddressOpeningBalance1 = toBN(await web3.eth.getBalance(BURN_ADDRESS));
      let propose2 = await pollingFtso.propose("Ban data provider accounts[6]", { from: accounts[2], value: PROPOSAL_FEE });
      const burnAddressClosingBalance1 = toBN(await web3.eth.getBalance(BURN_ADDRESS));
      expect(burnAddressClosingBalance1.sub(burnAddressOpeningBalance1).toString()).to.be.equal(PROPOSAL_FEE);
      let proposal2Id = propose2.logs[0].args[0].toString();
      let info2 = await pollingFtso.getProposalInfo(proposal2Id);
      expect(info2[0]).to.equals("Ban data provider accounts[6]");
    });

    it("Should not change absolute or relative threshold for active proposal", async () => {
      const burnAddressOpeningBalance = toBN(await web3.eth.getBalance(BURN_ADDRESS));
      let tx = await pollingFtso.propose("Ban data provider accounts[6]", { from: accounts[2], value: PROPOSAL_FEE });
      const burnAddressClosingBalance = toBN(await web3.eth.getBalance(BURN_ADDRESS));
      expect(burnAddressClosingBalance.sub(burnAddressOpeningBalance).toString()).to.be.equal(PROPOSAL_FEE);
      let proposal1Id = tx.logs[0].args[0].toString();
      expect(proposal1Id).to.equals("1");

      // advance one hour to the voting period
      await time.increase(3600);

      // voting
      await pollingFtso.castVote(proposal1Id, 1, { from: accounts[4] });
      await pollingFtso.castVote(proposal1Id, 1, { from: accounts[5] });
      await pollingFtso.castVote(proposal1Id, 0, { from: accounts[6] });

      let proposalVP = await pollingFtso.getProposalVotes(proposal1Id);
      expect(proposalVP[0].toString()).to.equals("2");
      expect(proposalVP[1].toString()).to.equals("1");

      // advance to end of the voting period
      await time.increase(7200);

      // should be rejected, because not enough people voted (quorum was not reached)
      let state1 = await pollingFtso.state(proposal1Id);
      expect(state1.toString()).to.equals("3");

      // change parameters
      await pollingFtso.setParameters(4000, 7200, 2000, 5000, 100, 3, 2, 2, 4, 2, 3, { from: accounts[0] });

      // create another proposal
      const burnAddressOpeningBalance1 = toBN(await web3.eth.getBalance(BURN_ADDRESS));
      let tx2 = await pollingFtso.propose("Ban data provider accounts[7]", { from: accounts[2], value: PROPOSAL_FEE });
      expectEvent(tx2, "FtsoProposalCreated", { eligibleMembers: [accounts[1], accounts[2], accounts[3], accounts[4], accounts[5], accounts[6], accounts[7], accounts[8]] });
      const burnAddressClosingBalance1 = toBN(await web3.eth.getBalance(BURN_ADDRESS));
      expect(burnAddressClosingBalance1.sub(burnAddressOpeningBalance1).toString()).to.be.equal(PROPOSAL_FEE);

      let proposal2Id = tx2.logs[0].args[0].toString();
      expect(proposal2Id).to.equals("2");
      let info = await pollingFtso.getProposalInfo(proposal2Id);
      expect(info[4].toString()).to.equals("2000");

      // advance to the voting period
      await time.increase(4000);

      // // cast the same votes
      await pollingFtso.castVote(proposal2Id, 1, { from: accounts[4] });
      await pollingFtso.castVote(proposal2Id, 1, { from: accounts[5] });
      await pollingFtso.castVote(proposal2Id, 0, { from: accounts[6] });

      // advance to end of the voting period
      await time.increase(7200);

      // proposal should be accepted
      let state2 = await pollingFtso.state(proposal2Id);
      expect(state2.toString()).to.equals("4");
    });

    it("Should revert if proposal with some proposal id doesn't exists", async () => {
      let tx = pollingFtso.state(123);
      await expectRevert(tx, "unknown proposal id")
    });

    it("Should cancel a proposal", async () => {
      const burnAddressOpeningBalance = toBN(await web3.eth.getBalance(BURN_ADDRESS));
      let tx = await pollingFtso.propose("Ban data provider accounts[6]", { from: accounts[2], value: PROPOSAL_FEE });
      const burnAddressClosingBalance = toBN(await web3.eth.getBalance(BURN_ADDRESS));
      expect(burnAddressClosingBalance.sub(burnAddressOpeningBalance).toString()).to.be.equal(PROPOSAL_FEE);
      let proposalId = tx.logs[0].args[0].toString();

      // cancel proposal
      let cancel = await pollingFtso.cancel(proposalId, { from: accounts[2] });
      expectEvent(cancel, "ProposalCanceled", { proposalId: proposalId });

      // advance one hour to the voting period
      await time.increase(3600);

      // should not be able to cast vote
      let vote = pollingFtso.castVote(proposalId, 1, { from: accounts[2] });
      await expectRevert(vote, "proposal not active");

      let state1 = await pollingFtso.state(proposalId);
      expect(state1.toNumber()).to.equal(0);
    });

    it("Should cancel a proposal by proxy", async () => {
      let tx = await pollingFtso.propose("Ban data provider accounts[6]", { from: accounts[2], value: PROPOSAL_FEE });
      let proposalId = tx.logs[0].args[0].toString();

      // register proxy voter
      await pollingFtso.setProxyVoter(accounts[92], { from: accounts[2] });

      // cancel proposal
      let cancel = await pollingFtso.cancel(proposalId, { from: accounts[92] });
      expectEvent(cancel, "ProposalCanceled", { proposalId: proposalId });

      // advance one hour to the voting period
      await time.increase(3600);

      // should not be able to cast vote
      let vote = pollingFtso.castVote(proposalId, 1, { from: accounts[2] });
      await expectRevert(vote, "proposal not active");

      let state1 = await pollingFtso.state(proposalId);
      expect(state1.toNumber()).to.equal(0);
    });

    it("Should not cancel a proposal if called from wrong address", async () => {
      const burnAddressOpeningBalance = toBN(await web3.eth.getBalance(BURN_ADDRESS));
      let tx = await pollingFtso.propose("Ban data provider accounts[6]", { from: accounts[2], value: PROPOSAL_FEE });
      const burnAddressClosingBalance = toBN(await web3.eth.getBalance(BURN_ADDRESS));
      expect(burnAddressClosingBalance.sub(burnAddressOpeningBalance).toString()).to.be.equal(PROPOSAL_FEE);

      let proposalId = tx.logs[0].args[0].toString();

      // try to cancel proposal
      let cancel = pollingFtso.cancel(proposalId, { from: accounts[3] });
      await expectRevert(cancel, "proposal can only be canceled by its proposer");
    });

    it("Should not cancel a proposal after vote starts", async () => {
      const burnAddressOpeningBalance = toBN(await web3.eth.getBalance(BURN_ADDRESS));
      let tx = await pollingFtso.propose("Ban data provider accounts[6]", { from: accounts[2], value: PROPOSAL_FEE });
      const burnAddressClosingBalance = toBN(await web3.eth.getBalance(BURN_ADDRESS));
      expect(burnAddressClosingBalance.sub(burnAddressOpeningBalance).toString()).to.be.equal(PROPOSAL_FEE);

      let proposalId = tx.logs[0].args[0].toString();

      // advance one hour to the voting period
      await time.increase(3600);

      // try to cancel proposal
      let cancel = pollingFtso.cancel(proposalId, { from: accounts[2] });
      await expectRevert(cancel, "proposal can only be canceled before voting starts");
    });

    it("Should not be able to cancel the same proposal twice", async () => {
      const burnAddressOpeningBalance = toBN(await web3.eth.getBalance(BURN_ADDRESS));
      let tx = await pollingFtso.propose("Ban data provider accounts[6]", { from: accounts[2], value: PROPOSAL_FEE });
      const burnAddressClosingBalance = toBN(await web3.eth.getBalance(BURN_ADDRESS));
      expect(burnAddressClosingBalance.sub(burnAddressOpeningBalance).toString()).to.be.equal(PROPOSAL_FEE);

      let proposalId = tx.logs[0].args[0].toString();

      // cancel proposal
      await pollingFtso.cancel(proposalId, { from: accounts[2] });

      let cancelAgain = pollingFtso.cancel(proposalId, { from: accounts[2] });
      await expectRevert(cancelAgain, "proposal is already canceled");
    });

    it("Should change proposers and emit ManagementGroupMembersChanged, and revert if change is not made from maintainer address", async () => {
      const tx = await pollingFtso.changeManagementGroupMembers([accounts[9]], [accounts[2], accounts[3]], { from: accounts[0] });

      expect(await pollingFtso.canPropose(accounts[2])).to.equals(false);
      expect(await pollingFtso.canPropose(accounts[3])).to.equals(false);
      expect(await pollingFtso.canPropose(accounts[4])).to.equals(true);
      expect(await pollingFtso.canPropose(accounts[5])).to.equals(true);
      expect(await pollingFtso.canPropose(accounts[6],)).to.equals(true);
      expect(await pollingFtso.canPropose(accounts[19])).to.equals(false);
      expectEvent(tx, "ManagementGroupMemberAdded", { addedMember: accounts[9] });
      expectEvent(tx, "ManagementGroupMemberRemoved", { removedMember: accounts[2] });
      expectEvent(tx, "ManagementGroupMemberRemoved", { removedMember: accounts[3] });

      let change = pollingFtso.changeManagementGroupMembers([accounts[4], accounts[5]], [accounts[2], accounts[3]], { from: accounts[100] });
      await expectRevert(change, "only maintainer");
    });

    it("Should change maintainer and then change proposers", async () => {
      let change = pollingFtso.changeManagementGroupMembers([accounts[4], accounts[5]], [accounts[2], accounts[3]], { from: accounts[100] });
      await expectRevert(change, "only maintainer");

      let setGovernance = pollingFtso.setMaintainer(constants.ZERO_ADDRESS);
      await expectRevert(setGovernance, "zero address");
      await pollingFtso.setMaintainer(accounts[100]);
      await pollingFtso.setParameters(4000, 7200, 2000, 5000, 100, 3, 2, 2, 4, 2, 3, { from: accounts[100] });

      await pollingFtso.changeManagementGroupMembers([accounts[9]], [accounts[8], accounts[6]], { from: accounts[100] });
    });

    it("Should revert if not sending wrong fee for creating a proposal", async () => {
      let propose = pollingFtso.propose("Ban data provider accounts[6]", { from: accounts[2], value: "99" });
      await expectRevert(propose, "proposal fee invalid");
    });

    it("Should create some random proposal (not about chilling ftso provider) and cancel it", async () => {
      let propose = await pollingFtso.propose("Random proposal", { from: accounts[2], value: PROPOSAL_FEE });
      let proposalId = propose.logs[0].args[0].toString();
      expectEvent(propose, "FtsoProposalCreated", { proposalId: proposalId, proposer: accounts[2], description: "Random proposal" });


      // cancel proposal
      let cancel = await pollingFtso.cancel(proposalId, { from: accounts[2] });
      expectEvent(cancel, "ProposalCanceled", { proposalId: proposalId });

      // advance one hour to the voting period
      await time.increase(3600);

      // should not be able to cast vote
      let vote = pollingFtso.castVote(proposalId, 1, { from: accounts[2] });
      await expectRevert(vote, "proposal not active");

      let state1 = await pollingFtso.state(proposalId);
      expect(state1.toNumber()).to.equal(0);
    });

    it("Should register proxy and vote by proxy", async () => {
      let tx = await pollingFtso.propose("Ban data provider accounts[6]", { from: accounts[2], value: PROPOSAL_FEE });
      let proposal1Id = tx.logs[0].args[0].toString();

      // advance one hour to the voting period
      await time.increase(3600);

      expect(await (pollingFtso.canVote(accounts[2], proposal1Id))).to.equals(true);
      expect(await (pollingFtso.canVote(accounts[92], proposal1Id))).to.equals(false);
      await pollingFtso.setProxyVoter(accounts[92], { from: accounts[2] });
      expect(await (pollingFtso.canVote(accounts[2], proposal1Id))).to.equals(true);
      // voting
      let castVote = await pollingFtso.castVote(proposal1Id, 1, { from: accounts[92] });
      expectEvent(castVote, "VoteCast", { voter: accounts[2], support: "1", forVotePower: "1", againstVotePower: "0" });

      expect(await pollingFtso.hasVoted(proposal1Id, accounts[2])).to.equal(true);

      // should not allow provider to vote, because his proxy already voted
      let castVote1 = pollingFtso.castVote(proposal1Id, 1, { from: accounts[2] });
      await expectRevert(castVote1, "vote already cast");

      // should not allow provider's proxy to vote, because his previous proxy already voted
      let set = await pollingFtso.setProxyVoter(accounts[82], { from: accounts[2] });
      expectEvent(set, "ProxyVoterSet", { account: accounts[2], proxyVoter: accounts[82] });
      let castVote2 = pollingFtso.castVote(proposal1Id, 1, { from: accounts[82] });
      await expectRevert(castVote2, "vote already cast");

      // advance to end of the voting period
      await time.increase(7200);

      // proposal failed
      let state = await pollingFtso.state(proposal1Id);
      expect(state.toNumber()).to.equal(3);
    });

    it("Member should register another member as proxy", async () => {
      let tx = await pollingFtso.propose("Ban data provider accounts[6]", { from: accounts[2], value: PROPOSAL_FEE });
      let proposal1Id = tx.logs[0].args[0].toString();

      // advance one hour to the voting period
      await time.increase(3600);

      await pollingFtso.setProxyVoter(accounts[3], { from: accounts[2] });
      // voting
      let castVote = await pollingFtso.castVote(proposal1Id, 1, { from: accounts[3] });
      // because proxy is also member, his vote is cast in his name
      expectEvent(castVote, "VoteCast", { voter: accounts[3], support: "1", forVotePower: "1", againstVotePower: "0" });

      expect(await pollingFtso.hasVoted(proposal1Id, accounts[2])).to.equal(false);
      expect(await pollingFtso.hasVoted(proposal1Id, accounts[3])).to.equal(true);

      // should allow provider to vote, because his proxy vote in his name, not in provider's
      let cast2 = await pollingFtso.castVote(proposal1Id, 1, { from: accounts[2] });
      expectEvent(cast2, "VoteCast", { voter: accounts[2], support: "1", forVotePower: "2", againstVotePower: "0" });

      // advance to end of the voting period
      await time.increase(7200);

      // proposal failed
      let state = await pollingFtso.state(proposal1Id);
      expect(state.toNumber()).to.equal(3);
    });

    it("Should not allow proxy to vote if its providers is not whitelisted", async () => {
      let tx = await pollingFtso.propose("Ban data provider accounts[6]", { from: accounts[2], value: PROPOSAL_FEE });
      let proposal1Id = tx.logs[0].args[0].toString();

      // advance one hour to the voting period
      await time.increase(3600);

      // accounts[22] is not whitelisted
      await pollingFtso.setProxyVoter(accounts[222], { from: accounts[22] });
      let castVote = pollingFtso.castVote(proposal1Id, 1, { from: accounts[222] });
      await expectRevert(castVote, "address is not eligible to cast a vote");

      expect(await pollingFtso.hasVoted(proposal1Id, accounts[22])).to.equal(false);
      let proposalVP = await pollingFtso.getProposalVotes(proposal1Id);
      expect(proposalVP[0].toString()).to.equals("0");
      expect(proposalVP[1].toString()).to.equals("0");
    });

    it("Should register proxy which can create a proposal", async () => {
      expect(await pollingFtso.canPropose(accounts[2])).to.equals(true);
      expect(await pollingFtso.canPropose(accounts[92])).to.equals(false);
      await pollingFtso.setProxyVoter(accounts[92], { from: accounts[2] });
      await pollingFtso.setProxyVoter(accounts[94], { from: accounts[4] });
      expect(await pollingFtso.canPropose(accounts[92])).to.equals(true);
      expect(await pollingFtso.canPropose(accounts[9])).to.equals(false);
      // accounts[99] cannot propose, because accounts[9] cannot propose
      expect(await pollingFtso.canPropose(accounts[99])).to.equals(false);

      let tx1 = pollingFtso.propose("Ban data provider accounts[6]", { from: accounts[99], value: PROPOSAL_FEE });
      await expectRevert(tx1, "submitter is not eligible to submit a proposal");

      let tx = await pollingFtso.propose("Ban data provider accounts[6]", { from: accounts[92], value: PROPOSAL_FEE });
      let proposal1Id = tx.logs[0].args[0].toString();
      // proposers is accounts[2], he only created proposal through his proxy
      expectEvent(tx, "FtsoProposalCreated", { proposalId: proposal1Id, proposer: accounts[2], description: "Ban data provider accounts[6]" });

      // advance one hour to the voting period
      await time.increase(3600);

      // voting
      let castVote = await pollingFtso.castVote(proposal1Id, 1, { from: accounts[92] });
      expectEvent(castVote, "VoteCast", { voter: accounts[2], support: "1", forVotePower: "1", againstVotePower: "0" });
      expect(await pollingFtso.hasVoted(proposal1Id, accounts[2])).to.equal(true);

      // advance to end of the voting period
      await time.increase(7200);

      // proposal failed
      let state = await pollingFtso.state(proposal1Id);
      expect(state.toNumber()).to.equal(3);
    });

    it("Should create a few proposals and increase id", async () => {
      const burnAddressOpeningBalance = toBN(await web3.eth.getBalance(BURN_ADDRESS));
      for (let i = 1; i < 101; i++) {
        let tx = await pollingFtso.propose(`Ban data provider ${i + 1}`, { from: accounts[2], value: PROPOSAL_FEE });
        let proposalId = tx.logs[0].args[0].toString();
        expect(parseInt(proposalId)).to.equals(i);
      }
      const burnAddressClosingBalance = toBN(await web3.eth.getBalance(BURN_ADDRESS));
      expect(burnAddressClosingBalance.sub(burnAddressOpeningBalance).toString()).to.be.equal((parseInt(PROPOSAL_FEE) * 100).toString());
    });

    it("Should not change maintainer if not called from governance", async () => {
      let set = pollingFtso.setMaintainer(accounts[100], { from: accounts[99] });
      await expectRevert(set, "only governance");
    });

    it("Should enable maintainer to create a proposal", async () => {
      let propose = await pollingFtso.propose(`Ban data provider accounts[6]`, { from: accounts[0], value: PROPOSAL_FEE });
      expectEvent(propose, "FtsoProposalCreated");
    });

    it("Should set maintainer as proxy and then enable maintainer to create a proposal", async () => {
      await pollingFtso.setProxyVoter(accounts[0], { from: accounts[2] });
      let propose = await pollingFtso.propose(`Ban data provider accounts[6]`, { from: accounts[0], value: PROPOSAL_FEE });

      // emitted proposer should be maintainer even though he is someone's proxy
      expectEvent(propose, "FtsoProposalCreated", { proposer: accounts[0] });
    });

    it("Should not allow settings an address as proxy for two data providers", async () => {
      await pollingFtso.setProxyVoter(accounts[92], { from: accounts[2] });
      let set = pollingFtso.setProxyVoter(accounts[92], { from: accounts[3] });
      await expectRevert(set, "address is already a proxy of some data provider");
    });

    it("Should get proposal description", async () => {
      let tx = await pollingFtso.propose("Ban data provider accounts[66]", { from: accounts[2], value: PROPOSAL_FEE });
      let proposal1Id = tx.logs[0].args[0].toString();
      expectEvent(tx, "FtsoProposalCreated", { proposalId: proposal1Id, proposer: accounts[2], description: "Ban data provider accounts[66]" });


      let description = await pollingFtso.getProposalDescription(proposal1Id);
      expect(description).to.equals("Ban data provider accounts[66]");

    });

    it("Should get last proposal", async () => {
      await pollingFtso.propose("Ban data provider accounts[66]", { from: accounts[2], value: PROPOSAL_FEE });

      await pollingFtso.propose("Ban data provider accounts[67]", { from: accounts[2], value: PROPOSAL_FEE });

      let lastProposal = await pollingFtso.getLastProposal();
      expect(lastProposal[0].toString()).to.equals("2");
      expect(lastProposal[1]).to.equals("Ban data provider accounts[67]");
    });

    it("Should revert if adding existing member again", async () => {
      let add = pollingFtso.changeManagementGroupMembers([accounts[2]], [], { from: accounts[0] });
      await expectRevert(add, "account is already a member of the management group");
    });

    it("Should revert if removing non-existing member", async () => {
      let add = pollingFtso.changeManagementGroupMembers([], [accounts[10]], { from: accounts[0] });
      await expectRevert(add, "account is not a member of the management group");
    });

    it("Should set and remove proxies", async () => {
      await pollingFtso.setProxyVoter(accounts[11], { from: accounts[1] });
      expect(await pollingFtso.providerToProxy(accounts[1])).to.equals(accounts[11]);
      expect(await pollingFtso.proxyToProvider(accounts[11])).to.equals(accounts[1]);

      await pollingFtso.setProxyVoter(accounts[12], { from: accounts[2] });
      expect(await pollingFtso.providerToProxy(accounts[2])).to.equals(accounts[12]);
      expect(await pollingFtso.proxyToProvider(accounts[12])).to.equals(accounts[2]);
      let set = pollingFtso.setProxyVoter(accounts[12], { from: accounts[3] });
      await expectRevert(set, "address is already a proxy of some data provider");

      await pollingFtso.setProxyVoter(constants.ZERO_ADDRESS, { from: accounts[2] });
      expect(await pollingFtso.providerToProxy(accounts[2])).to.equals(constants.ZERO_ADDRESS);
      expect(await pollingFtso.proxyToProvider(accounts[12])).to.equals(constants.ZERO_ADDRESS);
      await pollingFtso.setProxyVoter(accounts[12], { from: accounts[3] });
      expect(await pollingFtso.providerToProxy(accounts[3])).to.equals(accounts[12]);
      expect(await pollingFtso.proxyToProvider(accounts[12])).to.equals(accounts[3]);
    });
  });

  describe("Adding and removing members", async () => {
    beforeEach(async () => {
      mockVoterWhitelister = await MockContract.new();
      mockFtsoRewardManager = await MockContract.new();

      pollingFtso = await PollingFtso.new(
        accounts[0],
        ADDRESS_UPDATER
      );

      await pollingFtso.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.VOTER_WHITELISTER, Contracts.FTSO_REWARD_MANAGER]),
        [ADDRESS_UPDATER, mockVoterWhitelister.address, mockFtsoRewardManager.address], { from: ADDRESS_UPDATER });


      const currentRewardEpoch = web3.utils.sha3("getCurrentRewardEpoch()")!.slice(0, 10); // first 4 bytes is function selector
      await mockFtsoRewardManager.givenMethodReturnUint(currentRewardEpoch, 10);

      await pollingFtso.setMaintainer(accounts[0], { from: accounts[0] })
      await pollingFtso.setParameters(3600, 7200, 5000, 5000, 100, 3, 2, 2, 4, 2, 3, { from: accounts[0] });
      await pollingFtso.changeManagementGroupMembers([accounts[1], accounts[2], accounts[3], accounts[4], accounts[5], accounts[6], accounts[7], accounts[8]], []);

    });

    it("Should revert if removing account that is not a member", async () => {
      let add = pollingFtso.removeMember(accounts[10], { from: accounts[0] });
      await expectRevert(add, "account is not a member of the management group");
    });

    it("Should revert if adding an existing member", async () => {
      await pollingFtso.setProxyVoter(accounts[92], { from: accounts[2] });
      let add = pollingFtso.addMember({ from: accounts[92] }); // adding account 2
      await expectRevert(add, "account is already a member of the management group");
    });

    it("Should add member", async () => {
      // provider was not removed, was not chilled and was receiving rewards in last epochs

      const performanceInfo = web3.utils.sha3("getDataProviderPerformanceInfo(uint256,address)")!.slice(0, 10); // first 4 bytes is function selector
      const performanceInfoReturn = web3.eth.abi.encodeParameters(['uint256', 'uint256'], [10, 100]);
      await mockFtsoRewardManager.givenMethodReturn(performanceInfo, performanceInfoReturn);

      expect(await pollingFtso.isMember(accounts[9])).to.equals(false);
      let add = await pollingFtso.addMember({ from: accounts[9] });
      expect(await pollingFtso.isMember(accounts[9])).to.equals(true);
      expectEvent(add, "ManagementGroupMemberAdded", { addedMember: accounts[9] });
    });

    it("Should not add member if he was chilled in the last epochs", async () => {
      const chilledUntil = web3.utils.sha3("chilledUntilRewardEpoch(address)")!.slice(0, 10); // first 4 bytes is function selector
      await mockVoterWhitelister.givenMethodReturnUint(chilledUntil, 9);
      expect(await pollingFtso.isMember(accounts[9])).to.equals(false);
      let add = pollingFtso.addMember({ from: accounts[9] });
      expect(await pollingFtso.isMember(accounts[9])).to.equals(false);
      await expectRevert(add, "recently chilled");
    });

    it("Should remove member and not allow him to be added again immediately", async () => {
      const performanceInfo = web3.utils.sha3("getDataProviderPerformanceInfo(uint256,address)")!.slice(0, 10); // first 4 bytes is function selector
      const performanceInfoReturn = web3.eth.abi.encodeParameters(['uint256', 'uint256'], [0, 100]);
      await mockFtsoRewardManager.givenMethodReturn(performanceInfo, performanceInfoReturn);

      const currentRewardEpoch = web3.utils.sha3("getCurrentRewardEpoch()")!.slice(0, 10); // first 4 bytes is function selector
      await mockFtsoRewardManager.givenMethodReturnUint(currentRewardEpoch, 13);

      expect(await pollingFtso.isMember(accounts[2])).to.equals(true);
      await pollingFtso.removeMember(accounts[2]);
      expect(await pollingFtso.isMember(accounts[2])).to.equals(false);

      // provider is banned from the management group for some time
      let add = pollingFtso.addMember({ from: accounts[2] });
      expect(await pollingFtso.isMember(accounts[2])).to.equals(false);
      await expectRevert(add, "recently removed");

      // provider is again receiving rewards
      const performanceInfoReturn1 = web3.eth.abi.encodeParameters(['uint256', 'uint256'], [10, 100]);
      await mockFtsoRewardManager.givenMethodReturn(performanceInfo, performanceInfoReturn1);
      let add1 = pollingFtso.addMember({ from: accounts[2] });
      // but time ban is not over yet
      expect(await pollingFtso.isMember(accounts[2])).to.equals(false);
      await expectRevert(add1, "recently removed");

      // time ban is 3 days
      await time.increase(3 * DAY);
      await pollingFtso.addMember({ from: accounts[2] });
      expect(await pollingFtso.isMember(accounts[2])).to.equals(true);
    });

    it("Should not add provider that is not receiving rewards", async () => {
      const performanceInfo = web3.utils.sha3("getDataProviderPerformanceInfo(uint256,address)")!.slice(0, 10); // first 4 bytes is function selector
      const performanceInfoReturn = web3.eth.abi.encodeParameters(['uint256', 'uint256'], [0, 100]);
      await mockFtsoRewardManager.givenMethodReturn(performanceInfo, performanceInfoReturn);

      // provider cannot be added because he did not receive rewards in one of the last reward epochs
      let add = pollingFtso.addMember({ from: accounts[9] });
      expect(await pollingFtso.isMember(accounts[9])).to.equals(false);
      await expectRevert(add, "no rewards");
    });

    it("Should not remove non-rewarding member if he was just added (by maintainer)", async () => {
      expect(await pollingFtso.isMember(accounts[2])).to.equals(true);
      let remove = pollingFtso.removeMember(accounts[2]);
      // not enough reward epochs passed to be able to remove the member
      expect(await pollingFtso.isMember(accounts[2])).to.equals(true);
      await expectRevert(remove, ERR_CANT_REMOVE);
    });

    it("Should not remove member that is receiving rewards", async () => {
      const performanceInfo = web3.utils.sha3("getDataProviderPerformanceInfo(uint256,address)")!.slice(0, 10); // first 4 bytes is function selector
      const performanceInfoReturn = web3.eth.abi.encodeParameters(['uint256', 'uint256'], [15, 100]);
      await mockFtsoRewardManager.givenMethodReturn(performanceInfo, performanceInfoReturn);

      const currentRewardEpoch = web3.utils.sha3("getCurrentRewardEpoch()")!.slice(0, 10); // first 4 bytes is function selector
      await mockFtsoRewardManager.givenMethodReturnUint(currentRewardEpoch, 13);

      let remove = pollingFtso.removeMember(accounts[3]);
      expect(await pollingFtso.isMember(accounts[3])).to.equals(true);
      await expectRevert(remove, ERR_CANT_REMOVE);
    });

    //// removing members if not participating in proposals' voting

    it("Should not remove member if participating in voting", async () => {
      expect(await pollingFtso.isMember(accounts[3])).to.equals(true);

      for (let i = 1; i < 6; i++) {
        let tx = await pollingFtso.propose(`Ban data provider ${i + 1}`, { from: accounts[2], value: PROPOSAL_FEE });
        let proposalId = tx.logs[0].args[0].toString();
        await time.increase(3600);
        if (i != 1 && i != 2) {
          await pollingFtso.castVote(proposalId, 1, { from: accounts[3] });
        }
        await pollingFtso.castVote(proposalId, 1, { from: accounts[4] });
        await pollingFtso.castVote(proposalId, 1, { from: accounts[5] });
        await pollingFtso.castVote(proposalId, 1, { from: accounts[6] });
        await pollingFtso.castVote(proposalId, 1, { from: accounts[7] });
        await time.increase(7200);
      }

      // member voted in 3 proposals of the last 4, all are finished and quorum is met - he is not removed
      let remove = pollingFtso.removeMember(accounts[3]);
      expect(await pollingFtso.isMember(accounts[3])).to.equals(true);
      await expectRevert(remove, ERR_CANT_REMOVE);
    });

    it("Should remove member if not participating in voting", async () => {
      expect(await pollingFtso.isMember(accounts[3])).to.equals(true);

      for (let i = 1; i < 5; i++) {
        let tx = await pollingFtso.propose(`Ban data provider ${i + 1}`, { from: accounts[2], value: PROPOSAL_FEE });
        let proposalId = tx.logs[0].args[0].toString();
        await time.increase(3600);
        if (i != 1 && i != 3) {
          await pollingFtso.castVote(proposalId, 1, { from: accounts[3] });
        }
        await pollingFtso.castVote(proposalId, 1, { from: accounts[4] });
        await pollingFtso.castVote(proposalId, 1, { from: accounts[5] });
        await pollingFtso.castVote(proposalId, 1, { from: accounts[6] });
        await pollingFtso.castVote(proposalId, 1, { from: accounts[7] });
        await time.increase(7200);
      }

      // member voted only in 2 of the past 4 proposals (of which all are finished and quorum is met) - he is removed
      await pollingFtso.removeMember(accounts[3]);
      expect(await pollingFtso.isMember(accounts[3])).to.equals(false);
    });

    it("Should not remove member if not enough proposals where quorum was met", async () => {
      // member was not participating in votes, but not enough proposals met the quorum
      expect(await pollingFtso.isMember(accounts[3])).to.equals(true);

      for (let i = 1; i < 5; i++) {
        let tx = await pollingFtso.propose(`Ban data provider ${i + 1}`, { from: accounts[2], value: PROPOSAL_FEE });
        let proposalId = tx.logs[0].args[0].toString();
        await time.increase(3600);
        if (i != 1 && i != 3) {
          await pollingFtso.castVote(proposalId, 1, { from: accounts[3] });
          await pollingFtso.castVote(proposalId, 1, { from: accounts[4] });
        }
        await pollingFtso.castVote(proposalId, 1, { from: accounts[5] });
        await pollingFtso.castVote(proposalId, 1, { from: accounts[6] });
        await pollingFtso.castVote(proposalId, 1, { from: accounts[7] });
        await time.increase(7200);
      }

      // member voted only in 2 of the past 4 proposals, but only 2 met the quorum - he is not removed
      let remove = pollingFtso.removeMember(accounts[3]);
      expect(await pollingFtso.isMember(accounts[3])).to.equals(true);
      await expectRevert(remove, ERR_CANT_REMOVE);
    });

    it("Should not remove member if not enough finished proposals", async () => {
      // member was not participating in votes, but not enough proposals met the quorum
      expect(await pollingFtso.isMember(accounts[3])).to.equals(true);

      for (let i = 1; i < 5; i++) {
        let tx = await pollingFtso.propose(`Ban data provider ${i + 1}`, { from: accounts[2], value: PROPOSAL_FEE });
        let proposalId = tx.logs[0].args[0].toString();
        await time.increase(3600);
        if (i != 1 && i != 3) {
          await pollingFtso.castVote(proposalId, 1, { from: accounts[3] });
        }
        await pollingFtso.castVote(proposalId, 1, { from: accounts[4] });
        await pollingFtso.castVote(proposalId, 1, { from: accounts[5] });
        await pollingFtso.castVote(proposalId, 1, { from: accounts[6] });
        await pollingFtso.castVote(proposalId, 1, { from: accounts[7] });
      }

      // member voted only in 2 of the past 4 proposals, but only 2 met the quorum - he is not removed
      let remove = pollingFtso.removeMember(accounts[3]);
      expect(await pollingFtso.isMember(accounts[3])).to.equals(true);
      await expectRevert(remove, ERR_CANT_REMOVE);
    });

    it("Should remove member and still let him cancel his proposal", async () => {
      const performanceInfo = web3.utils.sha3("getDataProviderPerformanceInfo(uint256,address)")!.slice(0, 10); // first 4 bytes is function selector
      const performanceInfoReturn = web3.eth.abi.encodeParameters(['uint256', 'uint256'], [0, 100]);
      await mockFtsoRewardManager.givenMethodReturn(performanceInfo, performanceInfoReturn);

      const currentRewardEpoch = web3.utils.sha3("getCurrentRewardEpoch()")!.slice(0, 10); // first 4 bytes is function selector
      await mockFtsoRewardManager.givenMethodReturnUint(currentRewardEpoch, 13);

      expect(await pollingFtso.isMember(accounts[2])).to.equals(true);
      let tx = await pollingFtso.propose("Ban data provider accounts[6]", { from: accounts[2], value: PROPOSAL_FEE });
      let proposalId = tx.logs[0].args[0].toString();

      await pollingFtso.removeMember(accounts[2]);
      expect(await pollingFtso.isMember(accounts[2])).to.equals(false);
      // cancel proposal
      expect((await pollingFtso.state(proposalId)).toString()).to.equals("1");
      let cancel = await pollingFtso.cancel(proposalId, { from: accounts[2] });
      expectEvent(cancel, "ProposalCanceled", { proposalId: proposalId });
      expect((await pollingFtso.state(proposalId)).toString()).to.equals("0");
    });

    it("Should revert if current epoch is not bigger than addAfterNotChilledEpochs", async () => {
      const performanceInfo = web3.utils.sha3("getDataProviderPerformanceInfo(uint256,address)")!.slice(0, 10); // first 4 bytes is function selector
      const performanceInfoReturn = web3.eth.abi.encodeParameters(['uint256', 'uint256'], [10, 100]);
      await mockFtsoRewardManager.givenMethodReturn(performanceInfo, performanceInfoReturn);

      const currentRewardEpoch = web3.utils.sha3("getCurrentRewardEpoch()")!.slice(0, 10); // first 4 bytes is function selector
      await mockFtsoRewardManager.givenMethodReturnUint(currentRewardEpoch, 1);

      let add = pollingFtso.addMember({ from: accounts[9] });
      await expectRevert(add, "subtraction overflow");
    });

  });
});