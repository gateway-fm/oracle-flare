import { constants, ether, expectEvent, expectRevert, time } from '@openzeppelin/test-helpers';
import { ethers, network } from "hardhat";
import { GovernanceVotePower__factory } from "../../../../typechain";
import { AddressBinderInstance, GovernanceVotePowerInstance, MockContractInstance, PChainStakeMirrorInstance, PChainStakeMirrorVerifierInstance, VPContractInstance, WNatInstance } from "../../../../typechain-truffle";
import { getTestFile } from "../../../utils/constants";
import { impersonateContract } from "../../../utils/contract-test-helpers";
import { expectEthersEvent } from "../../../utils/EventDecoder";
import { encodeContractNames, toBN, assertNumberEqual } from "../../../utils/test-helpers";
import { Contracts } from '../../../../deployment/scripts/Contracts';
import privateKeys from "../../../../test-1020-accounts.json"
import * as util from "../../../utils/key-to-address";
import { toChecksumAddress } from 'ethereumjs-util';

const WNat = artifacts.require("WNat");
const GovernanceVotePower = artifacts.require("GovernanceVotePower");
const VPContract = artifacts.require("VPContract");
const PChainStakeMirror = artifacts.require("PChainStakeMirror");
const AddressBinder = artifacts.require("AddressBinder");
const PChainVerifier = artifacts.require("PChainStakeMirrorVerifier");
const MockContract = artifacts.require("MockContract");
const GWEI = 1e9;

type PChainStake = {
  txId: string,
  stakingType: number,
  inputAddress: string,
  nodeId: string,
  startTime: number,
  endTime: number,
  weight: number,
}

async function increaseTimeTo(current: BN, increase: number) {
  try {
    await time.increaseTo(current.addn(increase));
  } catch (e: any) {
    if (!(e.message.includes('Cannot increase current time') && e.message.includes('to a moment in the past'))) {
      throw e
    }
  }
}

async function setMockStakingData(verifierMock: MockContractInstance, pChainVerifier: PChainStakeMirrorVerifierInstance, txId: string, stakingType: number, inputAddress: string, nodeId: string, startTime: BN, endTime: BN, weight: number, stakingProved: boolean = true): Promise<PChainStake> {
  let data = {
    txId: txId,
    stakingType: stakingType,
    inputAddress: inputAddress,
    nodeId: nodeId,
    startTime: startTime.toNumber(),
    endTime: endTime.toNumber(),
    weight: weight
  };

  const verifyPChainStakingMethod = pChainVerifier.contract.methods.verifyStake(data, []).encodeABI();
  await verifierMock.givenMethodReturnBool(verifyPChainStakingMethod, stakingProved);
  return data;
}

contract(`GovernanceVotePower.sol; ${getTestFile(__filename)}; GovernanceVotePower unit tests`, async accounts => {
  let wNat: WNatInstance;
  let governanceVotePower: GovernanceVotePowerInstance;
  let vpContract: VPContractInstance;
  let cbnManagerAccount = accounts[18];
  let pChainStakeMirror: PChainStakeMirrorInstance;
  let addressBinder: AddressBinderInstance;
  let pChainVerifier: PChainStakeMirrorVerifierInstance;
  let verifierMock: MockContractInstance;
  let registeredPAddresses: string[] = [];
  let registeredCAddresses: string[] = [];

  const ADDRESS_UPDATER = accounts[16];

  describe("GovernanceVotePower", async () => {

    beforeEach(async () => {
      wNat = await WNat.new(accounts[0], "Wrapped NAT", "WNAT");

      pChainStakeMirror = await PChainStakeMirror.new(
        accounts[0],
        accounts[0],
        ADDRESS_UPDATER,
        2
      );

      wNat = await WNat.new(accounts[0], "Wrapped NAT", "WNAT");
      governanceVotePower = await GovernanceVotePower.new(wNat.address, pChainStakeMirror.address);
      await wNat.setGovernanceVotePower(governanceVotePower.address);
      await wNat.setCleanupBlockNumberManager(cbnManagerAccount, { from: accounts[0] });


      addressBinder = await AddressBinder.new();
      // cleanupBlockNumberManager = await CleanupBlockNumberManager.new(accounts[0], ADDRESS_UPDATER, "FtsoManager");
      pChainVerifier = await PChainVerifier.new(ADDRESS_UPDATER, 1, 1000, 5, 5000);
      verifierMock = await MockContract.new();

      await pChainStakeMirror.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.ADDRESS_BINDER, Contracts.GOVERNANCE_VOTE_POWER, Contracts.CLEANUP_BLOCK_NUMBER_MANAGER, Contracts.P_CHAIN_STAKE_MIRROR_VERIFIER]),
        [ADDRESS_UPDATER, addressBinder.address, governanceVotePower.address, cbnManagerAccount, verifierMock.address], { from: ADDRESS_UPDATER });
      await pChainStakeMirror.activate();

    });

    describe("WNat", async () => {

      beforeEach(async () => {
        // deposit
        await wNat.deposit({ from: accounts[1], value: toBN(600) });
        await wNat.deposit({ from: accounts[3], value: toBN(200) });
        await wNat.deposit({ from: accounts[6], value: toBN(1000) });

        // allow us to send transactions in the name of wnat
        await impersonateContract(wNat.address, ether("100"), accounts[0]);
      });

      it("Should check if tokens are deposited", async () => {
        let bal1 = await wNat.balanceOf(accounts[1]);
        expect(bal1.toString()).to.equals("600");

        let bal3 = await wNat.balanceOf(accounts[3]);
        expect(bal3.toString()).to.equals("200");
      });

      it("Should check if vote power is correctly delegated", async () => {
        // delegate
        let delegate1 = await governanceVotePower.delegate(accounts[2], { from: accounts[1] });
        const blockAfterDelegate1 = await web3.eth.getBlockNumber();
        let delegates1 = await governanceVotePower.getDelegateOfAtNow(accounts[1])
        let votePower2 = await governanceVotePower.votePowerOfAt(accounts[2], blockAfterDelegate1);
        expect(delegates1).to.equals(accounts[2])
        expect(votePower2.toString()).to.equals("600")
        expectEvent(delegate1, "DelegateChanged",
          { delegator: accounts[1], fromDelegate: constants.ZERO_ADDRESS, toDelegate: accounts[2] });
        expectEvent(delegate1, "DelegateVotesChanged",
          { delegate: accounts[2], previousBalance: toBN(0), newBalance: toBN(600) });

        // delegate
        await governanceVotePower.delegate(accounts[4], { from: accounts[3] });
        const blockAfterDelegate3 = await web3.eth.getBlockNumber();
        let delegates3 = await governanceVotePower.getDelegateOfAtNow(accounts[3])
        let votePower4 = await governanceVotePower.votePowerOfAt(accounts[4], blockAfterDelegate3);
        expect(delegates3).to.equals(accounts[4]);
        expect(votePower4.toString()).to.equals("200");

        // deposit another 1000
        let deposit = await wNat.deposit({ from: accounts[3], value: toBN(1000) });
        await expectEvent.inTransaction(deposit.tx, governanceVotePower, "DelegateVotesChanged",
          { delegate: accounts[4], previousBalance: toBN(200), newBalance: toBN(1200) });
        const blockAfterDeposit = await web3.eth.getBlockNumber();
        let votePower41 = await governanceVotePower.votePowerOfAt(accounts[4], blockAfterDeposit);
        let balanceOf3 = await wNat.balanceOf(accounts[3]);
        expect(votePower41.toString()).to.equals("1200");
        expect((balanceOf3).toString()).to.equals("1200");

        // redelegate to accounts[5]
        await wNat.setCleanupBlockNumber(blockAfterDeposit, { from: cbnManagerAccount });
        let redelegate = await governanceVotePower.delegate(accounts[5], { from: accounts[3] });
        const blockAfterRedelegate = await web3.eth.getBlockNumber();
        expect(await governanceVotePower.getDelegateOfAtNow(accounts[3])).to.equals(accounts[5]);
        let votePower42 = await governanceVotePower.votePowerOfAt(accounts[4], blockAfterRedelegate);
        let votePower5 = await governanceVotePower.votePowerOfAt(accounts[5], blockAfterRedelegate);
        expect(votePower42.toString()).to.equals("0");
        expect(votePower5.toString()).to.equals("1200");
        expectEvent(redelegate, "DelegateChanged",
          { delegator: accounts[3], fromDelegate: accounts[4], toDelegate: accounts[5] });
        expectEvent(redelegate, "DelegateVotesChanged",
          { delegate: accounts[4], previousBalance: toBN(1200), newBalance: toBN(0) });
        expectEvent(redelegate, "DelegateVotesChanged",
          { delegate: accounts[5], previousBalance: toBN(0), newBalance: toBN(1200) });

        await time.advanceBlock();
        await time.advanceBlock();
        await expectRevert(governanceVotePower.votePowerOfAt(accounts[4], blockAfterDelegate3), "CheckPointHistory: reading from cleaned-up block");
      });

      it("Should delegate and emit events", async () => {
        let delegate3 = await governanceVotePower.delegate(accounts[1], { from: accounts[3] });
        let votePower1 = await governanceVotePower.getVotes(accounts[1]);
        let votePower3 = await governanceVotePower.getVotes(accounts[3]);
        expect(votePower1.toString()).to.equals("800");
        expect(votePower3.toString()).to.equals("0");
        expectEvent(delegate3, "DelegateChanged",
          { delegator: accounts[3], fromDelegate: constants.ZERO_ADDRESS, toDelegate: accounts[1] });
        expectEvent(delegate3, "DelegateVotesChanged",
          { delegate: accounts[1], previousBalance: toBN(0), newBalance: toBN(200) });
      });

      it("Should delegate, transfer and change VP", async () => {
        const blockAfterDelegation = await web3.eth.getBlockNumber();
        let votePower1 = await governanceVotePower.votePowerOfAt(accounts[1], blockAfterDelegation);
        expect(votePower1.toString()).to.equals("600");

        await governanceVotePower.delegate(accounts[4], { from: accounts[3] });
        await wNat.transfer(accounts[1], 100, { from: accounts[3] });
        const blockAfterTransfer = await web3.eth.getBlockNumber();
        let votePower12 = await governanceVotePower.votePowerOfAt(accounts[1], blockAfterTransfer);
        let votePower42 = await governanceVotePower.votePowerOfAt(accounts[4], blockAfterTransfer);
        expect(votePower12.toString()).to.equals("700");
        expect(votePower42.toString()).to.equals("100");
      });

      it("Should delegate and redelegate", async () => {
        await governanceVotePower.delegate(accounts[3], { from: accounts[1] });
        const block = await web3.eth.getBlockNumber();
        let votePower3 = await governanceVotePower.votePowerOfAt(accounts[3], block);
        expect(votePower3.toString()).to.equals("800");

        await governanceVotePower.delegate(accounts[4], { from: accounts[3] });
        const block1 = await web3.eth.getBlockNumber();
        let votePower31 = await governanceVotePower.votePowerOfAt(accounts[3], block1);
        expect(votePower31.toString()).to.equals("600");
        const blockAfterDelegation = await web3.eth.getBlockNumber();
        let votePower4 = await governanceVotePower.votePowerOfAt(accounts[4], blockAfterDelegation);
        expect(votePower4.toString()).to.equals("200");

        let undelegate = await governanceVotePower.undelegate({ from: accounts[1] });
        const block2 = await web3.eth.getBlockNumber();
        let votePower32 = await governanceVotePower.votePowerOfAt(accounts[3], block2);
        let votePower1 = await governanceVotePower.votePowerOfAt(accounts[1], block2);
        expect(votePower32.toString()).to.equals("0");
        expect(votePower1.toString()).to.equals("600");
        expectEvent(undelegate, "DelegateChanged",
          { delegator: accounts[1], fromDelegate: accounts[3], toDelegate: constants.ZERO_ADDRESS });
        expectEvent(undelegate, "DelegateVotesChanged",
          { delegate: accounts[3], previousBalance: toBN(600), newBalance: toBN(0) });
      });

      it("Delegate and undelegate", async () => {
        const block1 = await web3.eth.getBlockNumber();
        let votePower1 = await governanceVotePower.votePowerOfAt(accounts[1], block1);
        expect(votePower1.toString()).to.equals("600");

        await governanceVotePower.delegate(accounts[1], { from: accounts[3] });
        const block2 = await web3.eth.getBlockNumber();
        let votePower12 = await governanceVotePower.votePowerOfAt(accounts[1], block2);
        let votePower3 = await governanceVotePower.votePowerOfAt(accounts[3], block2);
        expect(votePower3.toString()).to.equals("0");
        expect(votePower12.toString()).to.equals("800");

        await governanceVotePower.delegate(accounts[4], { from: accounts[1] });
        const block3 = await web3.eth.getBlockNumber();
        let votePower13 = await governanceVotePower.votePowerOfAt(accounts[1], block3);
        let votePower4 = await governanceVotePower.votePowerOfAt(accounts[4], block3);
        expect(votePower4.toString()).to.equals("600");
        expect(votePower13.toString()).to.equals("200");

        await governanceVotePower.undelegate({ from: accounts[1] });
        const block4 = await web3.eth.getBlockNumber();
        let votePower14 = await governanceVotePower.votePowerOfAt(accounts[1], block4);
        let votePower32 = await governanceVotePower.votePowerOfAt(accounts[3], block4);
        expect(votePower14.toString()).to.equals("800");
        expect(votePower32.toString()).to.equals("0");
        let bal1 = await wNat.balanceOf(accounts[1]);
        let bal3 = await wNat.balanceOf(accounts[3]);
        expect(bal1.toString()).to.equals("600");
        expect(bal3.toString()).to.equals("200");

        await wNat.transfer(accounts[1], 100, { from: accounts[3] });
        const block5 = await web3.eth.getBlockNumber();
        let votePower15 = await governanceVotePower.votePowerOfAt(accounts[1], block5);
        let votePower33 = await governanceVotePower.votePowerOfAt(accounts[3], block5);
        expect(votePower15.toString()).to.equals("800");
        expect(votePower33.toString()).to.equals("0");
        let bal11 = await wNat.balanceOf(accounts[1]);
        let bal31 = await wNat.balanceOf(accounts[3]);
        expect(bal11.toString()).to.equals("700");
        expect(bal31.toString()).to.equals("100");
      });

      it("Should transfer balance and governance VP", async () => {
        await governanceVotePower.delegate(accounts[2], { from: accounts[1] });
        await governanceVotePower.delegate(accounts[4], { from: accounts[3] });

        // transfer 500
        let transfer = await wNat.transfer(accounts[3], toBN(500), { from: accounts[1] });
        const blockAfterTransfer = await web3.eth.getBlockNumber();
        let votePower21 = await governanceVotePower.votePowerOfAt(accounts[2], blockAfterTransfer);
        let votePower41 = await governanceVotePower.votePowerOfAt(accounts[4], blockAfterTransfer);
        let balanceOf1 = await wNat.balanceOf(accounts[1]);
        let balanceOf3 = await wNat.balanceOf(accounts[3]);
        expect(votePower21.toString()).to.equals("100");
        expect(votePower41.toString()).to.equals("700");
        expect(balanceOf1.toString()).to.equals("100");
        expect(balanceOf3.toString()).to.equals("700");

        await expectEvent.inTransaction(transfer.tx, governanceVotePower, "DelegateVotesChanged",
          { delegate: accounts[2], previousBalance: toBN(600), newBalance: toBN(100) });
        await expectEvent.inTransaction(transfer.tx, governanceVotePower, "DelegateVotesChanged",
          { delegate: accounts[4], previousBalance: toBN(200), newBalance: toBN(700) });

      });

      it("Should revert if ownerToken is zero address", async () => {
        let tx = GovernanceVotePower.new(constants.ZERO_ADDRESS, accounts[1]);
        await expectRevert(tx, "_ownerToken zero");
      });

      it("Should revert if pChainStakeMirror is zero address", async () => {
        let tx = GovernanceVotePower.new(accounts[1], constants.ZERO_ADDRESS);
        await expectRevert(tx, "_pChainStakeMirror zero");
      });

      it("Should delegate and then burn part of balance", async () => {
        await governanceVotePower.delegate(accounts[7], { from: accounts[6] });
        const block = await web3.eth.getBlockNumber();
        let votePower7 = await governanceVotePower.votePowerOfAt(accounts[7], block);
        expect(votePower7.toString()).to.equals("1000");

        await wNat.withdraw(500, { from: accounts[6] });
        let votePower71 = await governanceVotePower.votePowerOfAt(accounts[7], block + 1);
        expect(votePower71.toString()).to.equals("500");
        let bal6 = await wNat.balanceOf(accounts[6]);
        expect(bal6.toString()).to.equals("500");
      });

      it("Should emit delegation events", async () => {
        let del1 = await governanceVotePower.delegate(accounts[2], { from: accounts[1] });
        let del3 = await governanceVotePower.delegate(accounts[2], { from: accounts[3] });
        expectEvent(del1, "DelegateChanged",
          { delegator: accounts[1], fromDelegate: constants.ZERO_ADDRESS, toDelegate: accounts[2] });
        expectEvent(del1, "DelegateVotesChanged",
          { delegate: accounts[2], previousBalance: toBN(0), newBalance: toBN(600) });
        expectEvent(del3, "DelegateChanged",
          { delegator: accounts[3], fromDelegate: constants.ZERO_ADDRESS, toDelegate: accounts[2] });
        expectEvent(del3, "DelegateVotesChanged",
          { delegate: accounts[2], previousBalance: toBN(600), newBalance: toBN(800) });

        let undelegate1 = await governanceVotePower.undelegate({ from: accounts[1] });
        expectEvent(undelegate1, "DelegateChanged",
          { delegator: accounts[1], fromDelegate: accounts[2], toDelegate: constants.ZERO_ADDRESS });
        expectEvent(undelegate1, "DelegateVotesChanged",
          { delegate: accounts[2], previousBalance: toBN(800), newBalance: toBN(200) });
      });

      it("Should check if votePowerOfAt function works correctly", async () => {
        const block1 = await web3.eth.getBlockNumber();
        expect((await governanceVotePower.votePowerOfAt(accounts[1], block1)).toString()).to.equals("600");
        await governanceVotePower.delegate(accounts[2], { from: accounts[1] });
        expect((await governanceVotePower.votePowerOfAt(accounts[1], block1)).toString()).to.equals("600");
      });

      it("Should check if delegates checkpointing works correctly", async () => {
        expect(await governanceVotePower.getDelegateOfAtNow(accounts[1])).to.equals(constants.ZERO_ADDRESS);
        expect((await governanceVotePower.getVotes(accounts[1])).toString()).to.equals("600");
        expect((await governanceVotePower.getVotes(accounts[2])).toString()).to.equals("0");

        await governanceVotePower.delegate(accounts[2], { from: accounts[1] });
        expect(await governanceVotePower.getDelegateOfAtNow(accounts[1])).to.equals(accounts[2]);
        expect((await governanceVotePower.getVotes(accounts[1])).toString()).to.equals("0");
        expect((await governanceVotePower.getVotes(accounts[2])).toString()).to.equals("600");

        await governanceVotePower.undelegate({ from: accounts[1] });
        expect(await governanceVotePower.getDelegateOfAtNow(accounts[1])).to.equals(constants.ZERO_ADDRESS);
        expect((await governanceVotePower.getVotes(accounts[1])).toString()).to.equals("600");
        expect((await governanceVotePower.getVotes(accounts[2])).toString()).to.equals("0");

        await governanceVotePower.delegate(accounts[1], { from: accounts[3] });
        expect((await governanceVotePower.getVotes(accounts[1])).toString()).to.equals("800");
        const block = await web3.eth.getBlockNumber();

        await governanceVotePower.delegate(accounts[2], { from: accounts[1] });
        expect((await governanceVotePower.getVotes(accounts[1])).toString()).to.equals("200");
        expect((await governanceVotePower.votePowerOfAt(accounts[1], block)).toString()).to.equals("800");
      });

      it("Should revert if caller is not the owner or governance", async () => {
        let tx = governanceVotePower.setCleanerContract(accounts[100], { from: accounts[50] });
        await expectRevert(tx, "only owner token");
      });

      it("Should revert if trying to delegate to yourself", async () => {
        let tx = governanceVotePower.delegate(accounts[1], { from: accounts[1] });
        await expectRevert(tx, "can't delegate to yourself");
      });

      // it("Should revert if trying to transfer 0 tokens", async() => {
      //   let tx = wNat.transfer(accounts[2], 0, { from: accounts[1] });
      //   await expectRevert(tx, "Cannot transfer zero amount");
      // });

      it("Should unwrap (burn) some WNAT while not delegating to anyone", async () => {
        expect((await governanceVotePower.getVotes(accounts[1])).toString()).to.equals("600");
        expect(await governanceVotePower.getDelegateOfAtNow(accounts[1])).to.equals(constants.ZERO_ADDRESS);

        // unwrap
        await wNat.withdraw(100, { from: accounts[1] });
        expect((await governanceVotePower.getVotes(accounts[1])).toString()).to.equals("500");
      });

      it("Should not change governance VP when transfering WNAT", async () => {
        // if both sides are delegating to the same account, its vote power should not change
        await governanceVotePower.delegate(accounts[6], { from: accounts[1] });
        await governanceVotePower.delegate(accounts[6], { from: accounts[3] });

        expect((await wNat.balanceOf(accounts[1])).toString()).to.equals("600");
        expect((await wNat.balanceOf(accounts[3])).toString()).to.equals("200");
        expect((await wNat.balanceOf(accounts[6])).toString()).to.equals("1000");


        expect((await governanceVotePower.getVotes(accounts[1])).toString()).to.equals("0");
        expect((await governanceVotePower.getVotes(accounts[3])).toString()).to.equals("0");
        expect((await governanceVotePower.getVotes(accounts[6])).toString()).to.equals("1800");

        expect(await governanceVotePower.getDelegateOfAtNow(accounts[1])).to.equals(accounts[6]);
        expect(await governanceVotePower.getDelegateOfAtNow(accounts[3])).to.equals(accounts[6]);
        expect(await governanceVotePower.getDelegateOfAtNow(accounts[2])).to.equals(constants.ZERO_ADDRESS);

        // transfer
        await wNat.transfer(accounts[3], 100, { from: accounts[1] });

        expect((await governanceVotePower.getVotes(accounts[6])).toString()).to.equals("1800");

        expect((await wNat.balanceOf(accounts[1])).toString()).to.equals("500");
        expect((await wNat.balanceOf(accounts[3])).toString()).to.equals("300");
        expect((await wNat.balanceOf(accounts[6])).toString()).to.equals("1000");

      });

      it("Should change governance VP when transfering WNAT", async () => {
        // if both sides are delegating to the same account, its vote power should not change
        await governanceVotePower.delegate(accounts[6], { from: accounts[3] });

        expect((await governanceVotePower.getVotes(accounts[1])).toString()).to.equals("600");
        expect((await governanceVotePower.getVotes(accounts[3])).toString()).to.equals("0");
        expect((await governanceVotePower.getVotes(accounts[6])).toString()).to.equals("1200");

        expect(await governanceVotePower.getDelegateOfAtNow(accounts[1])).to.equals(constants.ZERO_ADDRESS);
        expect(await governanceVotePower.getDelegateOfAtNow(accounts[3])).to.equals(accounts[6]);
        expect(await governanceVotePower.getDelegateOfAtNow(accounts[2])).to.equals(constants.ZERO_ADDRESS);

        // transfer
        await wNat.transfer(accounts[3], 100, { from: accounts[1] });

        expect((await governanceVotePower.getVotes(accounts[6])).toString()).to.equals("1300");
        expect((await governanceVotePower.getVotes(accounts[1])).toString()).to.equals("500");
        expect((await governanceVotePower.getVotes(accounts[3])).toString()).to.equals("0");

        expect((await wNat.balanceOf(accounts[1])).toString()).to.equals("500");
        expect((await wNat.balanceOf(accounts[3])).toString()).to.equals("300");
        expect((await wNat.balanceOf(accounts[6])).toString()).to.equals("1000");
      });

      it("Should revert if cleanup block number is not in the past", async () => {
        await time.advanceBlock();
        await time.advanceBlock();
        let block = await time.latestBlock();
        let tx = governanceVotePower.setCleanupBlockNumber(block.toNumber() + 1, { from: wNat.address });
        await expectRevert(tx, "cleanup block must be in the past");
      });

      it("Should revert if cleanup block decreases", async () => {
        await time.advanceBlock();
        await time.advanceBlock();
        let block = await time.latestBlock();
        await governanceVotePower.setCleanupBlockNumber(block, { from: wNat.address });
        let tx = governanceVotePower.setCleanupBlockNumber(block.toNumber() - 1, { from: wNat.address });
        await expectRevert(tx, "cleanup block number must never decrease");
      });

      it("Should clean checkpoints (from cleaner contract)", async () => {
        await governanceVotePower.setCleanerContract(accounts[200], { from: wNat.address });
        expect(await governanceVotePower.cleanerContract()).to.equals(accounts[200]);

        await governanceVotePower.delegate(accounts[2], { from: accounts[1] });
        let block1 = await time.latestBlock();
        expect((await governanceVotePower.votePowerOfAt(accounts[2], block1)).toString()).to.equals("600");
        expect(await governanceVotePower.getDelegateOfAt(accounts[1], block1)).to.equals(accounts[2]);
        expect(await governanceVotePower.getDelegateOfAt(accounts[2], block1)).to.equals(constants.ZERO_ADDRESS);

        await governanceVotePower.delegate(accounts[2], { from: accounts[3] });
        let block2 = await time.latestBlock();
        expect((await governanceVotePower.votePowerOfAt(accounts[2], block2)).toString()).to.equals("800");
        expect(await governanceVotePower.getDelegateOfAt(accounts[3], block2)).to.equals(accounts[2]);
        expect(await governanceVotePower.getDelegateOfAt(accounts[2], block2)).to.equals(constants.ZERO_ADDRESS);

        await governanceVotePower.delegate(accounts[4], { from: accounts[6] });
        let block3 = await time.latestBlock();
        expect((await governanceVotePower.votePowerOfAt(accounts[4], block3)).toString()).to.equals("1000");
        expect(await governanceVotePower.getDelegateOfAt(accounts[4], block3)).to.equals(constants.ZERO_ADDRESS);
        expect(await governanceVotePower.getDelegateOfAt(accounts[6], block3)).to.equals(accounts[4]);

        await governanceVotePower.delegate(accounts[4], { from: accounts[3] });
        let block4 = await time.latestBlock();
        expect((await governanceVotePower.votePowerOfAt(accounts[2], block4)).toString()).to.equals("600");
        expect((await governanceVotePower.votePowerOfAt(accounts[4], block4)).toString()).to.equals("1200");
        expect(await governanceVotePower.getDelegateOfAt(accounts[3], block4)).to.equals(accounts[4]);
        expect(await governanceVotePower.getDelegateOfAt(accounts[6], block4)).to.equals(accounts[4]);


        await governanceVotePower.delegate(accounts[2], { from: accounts[6] });
        let block5 = await time.latestBlock();
        expect((await governanceVotePower.votePowerOfAt(accounts[2], block5)).toString()).to.equals("1600");
        expect((await governanceVotePower.votePowerOfAt(accounts[4], block5)).toString()).to.equals("200");
        expect(await governanceVotePower.getDelegateOfAt(accounts[6], block5)).to.equals(accounts[2]);

        // set cleanup block number
        let block = await time.latestBlock();
        await governanceVotePower.setCleanupBlockNumber(block, { from: wNat.address });
        expect((await governanceVotePower.getCleanupBlockNumber()).toString()).to.equals(block.toString());

        // should be called from cleaner contract
        let tx = governanceVotePower.delegatedGovernanceVotePowerHistoryCleanup(accounts[2], 3);
        await expectRevert(tx, "only cleaner contract");

        // cleanup of (delegated) governance vote power history
        await governanceVotePower.delegatedGovernanceVotePowerHistoryCleanup(accounts[2], 3, { from: accounts[200] });
        let vp1 = governanceVotePower.votePowerOfAt(accounts[2], block1);
        await expectRevert(vp1, "reading from cleaned-up block");
        let vp2 = governanceVotePower.votePowerOfAt(accounts[2], block2);
        await expectRevert(vp2, "reading from cleaned-up block");
        expect((await governanceVotePower.votePowerOfAt(accounts[2], block5)).toString()).to.equals("1600");
        expect((await governanceVotePower.getVotes(accounts[2])).toString()).to.equals("1600");

        await governanceVotePower.delegatedGovernanceVotePowerHistoryCleanup(accounts[4], 3, { from: accounts[200] });
        let vp3 = governanceVotePower.votePowerOfAt(accounts[4], block3);
        await expectRevert(vp3, "reading from cleaned-up block");
        let vp4 = governanceVotePower.votePowerOfAt(accounts[4], block4);
        await expectRevert(vp4, "reading from cleaned-up block");
        expect((await governanceVotePower.votePowerOfAt(accounts[4], block5)).toString()).to.equals("200");
        expect((await governanceVotePower.getVotes(accounts[4])).toString()).to.equals("200");

        // cleanup of delegates history checkpoints
        // it has only one checkpoint, so it shouldn't delete anything
        await governanceVotePower.delegatesHistoryCleanup(accounts[1], 3, { from: accounts[200] });
        expect(await governanceVotePower.getDelegateOfAt(accounts[1], block1)).to.equals(accounts[2]);
        expect(await governanceVotePower.getDelegateOfAtNow(accounts[1])).to.equals(accounts[2]);

        await governanceVotePower.delegatesHistoryCleanup(accounts[3], 3, { from: accounts[200] });
        let delegates1 = governanceVotePower.getDelegateOfAt(accounts[3], block2);
        await expectRevert(delegates1, "reading from cleaned-up block");
        expect(await governanceVotePower.getDelegateOfAt(accounts[3], block4)).to.equals(accounts[4]);
        expect(await governanceVotePower.getDelegateOfAtNow(accounts[3])).to.equals(accounts[4]);

        await governanceVotePower.delegatesHistoryCleanup(accounts[6], 3, { from: accounts[200] });
        let delegates2 = governanceVotePower.getDelegateOfAt(accounts[6], block4);
        await expectRevert(delegates2, "reading from cleaned-up block");
        expect(await governanceVotePower.getDelegateOfAt(accounts[6], block5)).to.equals(accounts[2]);
        expect(await governanceVotePower.getDelegateOfAtNow(accounts[6])).to.equals(accounts[2]);
      });

      it("Should revert if updateAtTokenTransfer is not called from owner contracts", async () => {
        let tx = governanceVotePower.updateAtTokenTransfer(accounts[1], accounts[2], 600, 0, 100);
        await expectRevert(tx, "only owner contracts");
      });

      it("Should delegate twice in the same block", async () => {
        const signer = await ethers.getSigner(accounts[1]);
        const governanceVPEth = GovernanceVotePower__factory.connect(governanceVotePower.address, signer);
        try {
          // switch to manual mining
          await network.provider.send('evm_setAutomine', [false]);
          await network.provider.send("evm_setIntervalMining", [0]);

          let tx0 = await governanceVPEth.delegate(accounts[2], { from: accounts[1] });
          let tx1 = await governanceVPEth.delegate(accounts[3], { from: accounts[1] });

          await network.provider.send('evm_mine');

          let receipt0 = await tx0.wait();
          expectEthersEvent(receipt0, governanceVPEth, 'DelegateChanged', { delegator: accounts[1], fromDelegate: constants.ZERO_ADDRESS, toDelegate: accounts[2] });

          let receipt1 = await tx1.wait();
          expectEthersEvent(receipt1, governanceVPEth, 'DelegateChanged', { delegator: accounts[1], fromDelegate: accounts[2], toDelegate: accounts[3] });
        } finally {
          await network.provider.send('evm_setAutomine', [true]);
        }
      });

      it("Should 'clean' empty checkpoints", async () => {
        await governanceVotePower.setCleanupBlockNumber(await web3.eth.getBlockNumber() - 1, { from: wNat.address });
        await governanceVotePower.setCleanerContract(accounts[77], { from: wNat.address });
        let clean = await governanceVotePower.contract.methods.delegatesHistoryCleanup(accounts[8], 1).call({ from: accounts[77] });
        await governanceVotePower.delegatesHistoryCleanup(accounts[8], 1, { from: accounts[77] });
        expect(clean).to.equals("0");
      });

      it("Should 'clean' zero address checkpoints", async () => {
        await governanceVotePower.setCleanupBlockNumber(await web3.eth.getBlockNumber() - 1, { from: wNat.address });
        await governanceVotePower.setCleanerContract(accounts[77], { from: wNat.address });
        let clean = await governanceVotePower.contract.methods.delegatesHistoryCleanup(constants.ZERO_ADDRESS, 1).call({ from: accounts[77] });
        await governanceVotePower.delegatesHistoryCleanup(constants.ZERO_ADDRESS, 1, { from: accounts[77] });
        expect(clean).to.equals("0");
      });

    });

    describe("PChain stake mirror", async () => {
      let now: BN;
      let nodeId1: string;
      let nodeId2: string;
      let weightGwei1: number;
      let weightGwei2: number;
      let weightGwei3: number;
      let stake1Id: string;
      let stake2Id: string;
      let stake3Id: string;

      beforeEach(async () => {
        // set values
        weightGwei1 = 1000;
        weightGwei2 = 500;
        weightGwei3 = 100;
        nodeId1 = "0x0123456789012345678901234567890123456789";
        nodeId2 = "0x0123456789012345678901234567890123456788";
        stake1Id = web3.utils.keccak256("stake1");
        stake2Id = web3.utils.keccak256("stake2");
        stake3Id = web3.utils.keccak256("stake3");

        // register a few addresses
        for (let i = 0; i < 4; i++) {
          let prvKey = privateKeys[i].privateKey.slice(2);
          let prvkeyBuffer = Buffer.from(prvKey, 'hex');
          let [x, y] = util.privateKeyToPublicKeyPair(prvkeyBuffer);
          let pubKey = "0x" + util.encodePublicKey(x, y, false).toString('hex');
          let pAddr = "0x" + util.publicKeyToAvalancheAddress(x, y).toString('hex');
          let cAddr = toChecksumAddress("0x" + util.publicKeyToEthereumAddress(x, y).toString('hex'));
          await addressBinder.registerAddresses(pubKey, pAddr, cAddr);
          registeredPAddresses.push(pAddr);
          registeredCAddresses.push(cAddr);
        }
        now = await time.latest();

        // first stake
        let data1 = await setMockStakingData(verifierMock, pChainVerifier, stake1Id, 0, registeredPAddresses[0], nodeId1, now.subn(10), now.addn(10), weightGwei1);
        await pChainStakeMirror.mirrorStake(data1, []);

        // second stake
        let data2 = await setMockStakingData(verifierMock, pChainVerifier, stake2Id, 0, registeredPAddresses[1], nodeId1, now.subn(10), now.addn(20), weightGwei2);
        await pChainStakeMirror.mirrorStake(data2, []);

        // third stake
        let data3 = await setMockStakingData(verifierMock, pChainVerifier, stake3Id, 0, registeredPAddresses[1], nodeId2, now.subn(10), now.addn(25), weightGwei3);
        await pChainStakeMirror.mirrorStake(data3, []);
      });

      it("Should check if governance vote power is correct", async () => {
        assertNumberEqual(await governanceVotePower.getVotes(registeredCAddresses[0]), weightGwei1 * GWEI);
        assertNumberEqual(await governanceVotePower.getVotes(registeredCAddresses[1]), (weightGwei2 + weightGwei3) * GWEI);
      });

      it("Should delegate and undelegate governance vote power", async () => {
        // check initial vote powers
        assertNumberEqual(await governanceVotePower.getVotes(registeredCAddresses[0]), weightGwei1 * GWEI);
        assertNumberEqual(await governanceVotePower.getVotes(registeredCAddresses[1]), (weightGwei2 + weightGwei3) * GWEI);
        assertNumberEqual(await governanceVotePower.getVotes(accounts[10]), 0);
        assertNumberEqual(await governanceVotePower.getVotes(accounts[11]), 0);

        // delegate
        await governanceVotePower.delegate(accounts[10], { from: registeredCAddresses[0] });
        await governanceVotePower.delegate(accounts[11], { from: registeredCAddresses[1] });
        assertNumberEqual(await governanceVotePower.getVotes(accounts[10]), weightGwei1 * GWEI);
        assertNumberEqual(await governanceVotePower.getVotes(accounts[11]), (weightGwei2 + weightGwei3) * GWEI);
        assertNumberEqual(await governanceVotePower.getVotes(registeredCAddresses[0]), 0);
        assertNumberEqual(await governanceVotePower.getVotes(registeredCAddresses[1]), 0);
        expect(await governanceVotePower.getDelegateOfAtNow(registeredCAddresses[0])).to.equals(accounts[10]);
        expect(await governanceVotePower.getDelegateOfAtNow(registeredCAddresses[1])).to.equals(accounts[11]);

        // undelegate
        await governanceVotePower.undelegate({ from: registeredCAddresses[0] });
        await governanceVotePower.undelegate({ from: registeredCAddresses[1] });
        assertNumberEqual(await governanceVotePower.getVotes(registeredCAddresses[0]), weightGwei1 * GWEI);
        assertNumberEqual(await governanceVotePower.getVotes(registeredCAddresses[1]), (weightGwei2 + weightGwei3) * GWEI);
        assertNumberEqual(await governanceVotePower.getVotes(accounts[10]), 0);
        assertNumberEqual(await governanceVotePower.getVotes(accounts[11]), 0);
        expect(await governanceVotePower.getDelegateOfAtNow(registeredCAddresses[0])).to.equals(constants.ZERO_ADDRESS);
        expect(await governanceVotePower.getDelegateOfAtNow(registeredCAddresses[1])).to.equals(constants.ZERO_ADDRESS);
      });

      it("Should decrease governance vote power when stakes end", async () => {
        assertNumberEqual(await governanceVotePower.getVotes(registeredCAddresses[0]), weightGwei1 * GWEI);
        assertNumberEqual(await governanceVotePower.getVotes(registeredCAddresses[1]), (weightGwei2 + weightGwei3) * GWEI);
        expect(await governanceVotePower.getDelegateOfAtNow(registeredCAddresses[0])).to.equals(constants.ZERO_ADDRESS);
        expect(await governanceVotePower.getDelegateOfAtNow(registeredCAddresses[1])).to.equals(constants.ZERO_ADDRESS);
        assertNumberEqual(await pChainStakeMirror.balanceOf(registeredCAddresses[0]), weightGwei1 * GWEI);
        assertNumberEqual(await pChainStakeMirror.votePowerOf(nodeId1), (weightGwei1 + weightGwei2) * GWEI);

        // first stake ended
        await increaseTimeTo(now, 10);
        await pChainStakeMirror.daemonize();

        expect((await pChainStakeMirror.balanceOf(registeredCAddresses[0])).toNumber()).to.equals(0);
        expect((await pChainStakeMirror.balanceOf(registeredCAddresses[1])).toNumber()).to.equals((weightGwei2 + weightGwei3) * GWEI);
        assertNumberEqual(await pChainStakeMirror.votePowerOf(nodeId1), weightGwei2 * GWEI);
        assertNumberEqual(await pChainStakeMirror.votePowerOf(nodeId2), weightGwei3 * GWEI);
        assertNumberEqual(await governanceVotePower.getVotes(registeredCAddresses[0]), 0);
        assertNumberEqual(await governanceVotePower.getVotes(registeredCAddresses[1]), (weightGwei2 + weightGwei3) * GWEI);

        // second stake ends
        await increaseTimeTo(now, 20);
        await pChainStakeMirror.daemonize();

        assertNumberEqual(await pChainStakeMirror.balanceOf(registeredCAddresses[0]), 0);
        assertNumberEqual(await pChainStakeMirror.balanceOf(registeredCAddresses[1]), weightGwei3 * GWEI);
        assertNumberEqual(await pChainStakeMirror.votePowerOf(nodeId1), 0);
        assertNumberEqual(await pChainStakeMirror.votePowerOf(nodeId2), weightGwei3 * GWEI);
        assertNumberEqual(await governanceVotePower.getVotes(registeredCAddresses[0]), 0);
        assertNumberEqual(await governanceVotePower.getVotes(registeredCAddresses[1]), weightGwei3 * GWEI);

        // third stake ends
        await increaseTimeTo(now, 25);
        await pChainStakeMirror.daemonize();

        assertNumberEqual(await pChainStakeMirror.balanceOf(registeredCAddresses[0]), 0);
        assertNumberEqual(await pChainStakeMirror.balanceOf(registeredCAddresses[1]), 0);
        assertNumberEqual(await pChainStakeMirror.votePowerOf(nodeId1), 0);
        assertNumberEqual(await pChainStakeMirror.votePowerOf(nodeId2), 0);
        assertNumberEqual(await governanceVotePower.getVotes(registeredCAddresses[0]), 0);
        assertNumberEqual(await governanceVotePower.getVotes(registeredCAddresses[1]), 0);
      });

      it("Should delegate and decrease governance vote power when stakes end", async () => {
        expect(await pChainStakeMirror.governanceVotePower()).to.equals(governanceVotePower.address)
        await governanceVotePower.delegate(accounts[10], { from: registeredCAddresses[0] });
        await governanceVotePower.delegate(accounts[11], { from: registeredCAddresses[1] });

        assertNumberEqual(await governanceVotePower.getVotes(accounts[10]), weightGwei1 * GWEI);
        assertNumberEqual(await governanceVotePower.getVotes(accounts[11]), (weightGwei2 + weightGwei3) * GWEI);
        expect(await governanceVotePower.getDelegateOfAtNow(registeredCAddresses[0])).to.equals(accounts[10]);
        expect(await governanceVotePower.getDelegateOfAtNow(registeredCAddresses[1])).to.equals(accounts[11]);
        assertNumberEqual(await pChainStakeMirror.balanceOf(registeredCAddresses[0]), weightGwei1 * GWEI);
        assertNumberEqual(await pChainStakeMirror.votePowerOf(nodeId1), (weightGwei1 + weightGwei2) * GWEI);

        // first stake ended
        await increaseTimeTo(now, 10);
        await pChainStakeMirror.daemonize();

        assertNumberEqual(await governanceVotePower.getVotes(accounts[10]), 0);
        assertNumberEqual(await governanceVotePower.getVotes(accounts[11]), (weightGwei2 + weightGwei3) * GWEI);

        // second stake ended
        await increaseTimeTo(now, 20);
        await pChainStakeMirror.daemonize();
        assertNumberEqual(await governanceVotePower.getVotes(accounts[10]), 0);
        assertNumberEqual(await governanceVotePower.getVotes(accounts[11]), weightGwei3 * GWEI);

        // third stake ended
        await increaseTimeTo(now, 30);
        await pChainStakeMirror.daemonize();
        assertNumberEqual(await governanceVotePower.getVotes(accounts[10]), 0);
        assertNumberEqual(await governanceVotePower.getVotes(accounts[11]), 0);
      });
    });

    describe("PChain stake mirror and WNat", async () => {
      let now: BN;
      let nodeId1: string;
      let nodeId2: string;
      let deposit1 = 600;
      let deposit2 = 200;
      let weightGwei1: number;
      let weightGwei2: number;
      let weightGwei3: number;
      let stake1Id: string;
      let stake2Id: string;
      let stake3Id: string;

      beforeEach(async () => {
        // set values
        weightGwei1 = 1000;
        weightGwei2 = 500;
        weightGwei3 = 100;
        nodeId1 = "0x0123456789012345678901234567890123456789";
        nodeId2 = "0x0123456789012345678901234567890123456788";
        stake1Id = web3.utils.keccak256("stake1");
        stake2Id = web3.utils.keccak256("stake2");
        stake3Id = web3.utils.keccak256("stake3");

        // register a few addresses
        for (let i = 0; i < 4; i++) {
          let prvKey = privateKeys[i].privateKey.slice(2);
          let prvkeyBuffer = Buffer.from(prvKey, 'hex');
          let [x, y] = util.privateKeyToPublicKeyPair(prvkeyBuffer);
          let pubKey = "0x" + util.encodePublicKey(x, y, false).toString('hex');
          let pAddr = "0x" + util.publicKeyToAvalancheAddress(x, y).toString('hex');
          let cAddr = toChecksumAddress("0x" + util.publicKeyToEthereumAddress(x, y).toString('hex'));
          await addressBinder.registerAddresses(pubKey, pAddr, cAddr);
          registeredPAddresses.push(pAddr);
          registeredCAddresses.push(cAddr);
        };

        now = await time.latest();

        // first stake
        let data1 = await setMockStakingData(verifierMock, pChainVerifier, stake1Id, 0, registeredPAddresses[0], nodeId1, now.subn(10), now.addn(10), weightGwei1);
        await pChainStakeMirror.mirrorStake(data1, []);

        // second stake
        let data2 = await setMockStakingData(verifierMock, pChainVerifier, stake2Id, 0, registeredPAddresses[1], nodeId1, now.subn(10), now.addn(20), weightGwei2);
        await pChainStakeMirror.mirrorStake(data2, []);

        // third stake
        let data3 = await setMockStakingData(verifierMock, pChainVerifier, stake3Id, 0, registeredPAddresses[1], nodeId2, now.subn(10), now.addn(25), weightGwei3);
        await pChainStakeMirror.mirrorStake(data3, []);

        // deposit
        await wNat.deposit({ from: registeredCAddresses[0], value: "600" });
        await wNat.deposit({ from: registeredCAddresses[1], value: "200" });
      });

      it("Should check if governance vote power is correct", async () => {
        assertNumberEqual(await governanceVotePower.getVotes(registeredCAddresses[0]), weightGwei1 * GWEI + deposit1);
        assertNumberEqual(await governanceVotePower.getVotes(registeredCAddresses[1]), (weightGwei2 + weightGwei3) * GWEI + deposit2);
      });

      it("Should delegate and undelegate governance vote power", async () => {
        // check initial vote powers
        assertNumberEqual(await governanceVotePower.getVotes(registeredCAddresses[0]), weightGwei1 * GWEI + deposit1);
        assertNumberEqual(await governanceVotePower.getVotes(registeredCAddresses[1]), (weightGwei2 + weightGwei3) * GWEI + deposit2);
        assertNumberEqual(await governanceVotePower.getVotes(accounts[10]), 0);
        assertNumberEqual(await governanceVotePower.getVotes(accounts[11]), 0);

        // delegate
        await governanceVotePower.delegate(accounts[10], { from: registeredCAddresses[0] });
        await governanceVotePower.delegate(accounts[11], { from: registeredCAddresses[1] });
        assertNumberEqual(await governanceVotePower.getVotes(accounts[10]), weightGwei1 * GWEI + deposit1);
        assertNumberEqual(await governanceVotePower.getVotes(accounts[11]), (weightGwei2 + weightGwei3) * GWEI + deposit2);
        assertNumberEqual(await governanceVotePower.getVotes(registeredCAddresses[0]), 0);
        assertNumberEqual(await governanceVotePower.getVotes(registeredCAddresses[1]), 0);
        expect(await governanceVotePower.getDelegateOfAtNow(registeredCAddresses[0])).to.equals(accounts[10]);
        expect(await governanceVotePower.getDelegateOfAtNow(registeredCAddresses[1])).to.equals(accounts[11]);

        // undelegate
        await governanceVotePower.undelegate({ from: registeredCAddresses[0] });
        await governanceVotePower.undelegate({ from: registeredCAddresses[1] });
        assertNumberEqual(await governanceVotePower.getVotes(registeredCAddresses[0]), weightGwei1 * GWEI + deposit1);
        assertNumberEqual(await governanceVotePower.getVotes(registeredCAddresses[1]), (weightGwei2 + weightGwei3) * GWEI + deposit2);
        assertNumberEqual(await governanceVotePower.getVotes(accounts[10]), 0);
        assertNumberEqual(await governanceVotePower.getVotes(accounts[11]), 0);
        expect(await governanceVotePower.getDelegateOfAtNow(registeredCAddresses[0])).to.equals(constants.ZERO_ADDRESS);
        expect(await governanceVotePower.getDelegateOfAtNow(registeredCAddresses[1])).to.equals(constants.ZERO_ADDRESS);
      });

      it("Should decrease governance vote power when stakes end", async () => {
        assertNumberEqual(await governanceVotePower.getVotes(registeredCAddresses[0]), weightGwei1 * GWEI + deposit1);
        assertNumberEqual(await governanceVotePower.getVotes(registeredCAddresses[1]), (weightGwei2 + weightGwei3) * GWEI + deposit2);
        expect(await governanceVotePower.getDelegateOfAtNow(registeredCAddresses[0])).to.equals(constants.ZERO_ADDRESS);
        expect(await governanceVotePower.getDelegateOfAtNow(registeredCAddresses[1])).to.equals(constants.ZERO_ADDRESS);
        assertNumberEqual(await pChainStakeMirror.balanceOf(registeredCAddresses[0]), weightGwei1 * GWEI);
        assertNumberEqual(await pChainStakeMirror.votePowerOf(nodeId1), (weightGwei1 + weightGwei2) * GWEI);

        // first stake ended
        await increaseTimeTo(now, 10);
        await pChainStakeMirror.daemonize();

        expect((await pChainStakeMirror.balanceOf(registeredCAddresses[0])).toNumber()).to.equals(0);
        expect((await pChainStakeMirror.balanceOf(registeredCAddresses[1])).toNumber()).to.equals((weightGwei2 + weightGwei3) * GWEI);
        assertNumberEqual(await pChainStakeMirror.votePowerOf(nodeId1), weightGwei2 * GWEI);
        assertNumberEqual(await pChainStakeMirror.votePowerOf(nodeId2), weightGwei3 * GWEI);
        assertNumberEqual(await governanceVotePower.getVotes(registeredCAddresses[0]), deposit1);
        assertNumberEqual(await governanceVotePower.getVotes(registeredCAddresses[1]), (weightGwei2 + weightGwei3) * GWEI + deposit2);

        // second stake ends
        await increaseTimeTo(now, 20);
        await pChainStakeMirror.daemonize();

        assertNumberEqual(await pChainStakeMirror.balanceOf(registeredCAddresses[0]), 0);
        assertNumberEqual(await pChainStakeMirror.balanceOf(registeredCAddresses[1]), weightGwei3 * GWEI);
        assertNumberEqual(await pChainStakeMirror.votePowerOf(nodeId1), 0);
        assertNumberEqual(await pChainStakeMirror.votePowerOf(nodeId2), weightGwei3 * GWEI);
        assertNumberEqual(await governanceVotePower.getVotes(registeredCAddresses[0]), deposit1);
        assertNumberEqual(await governanceVotePower.getVotes(registeredCAddresses[1]), weightGwei3 * GWEI + deposit2);

        // third stake ends
        await increaseTimeTo(now, 25);
        await pChainStakeMirror.daemonize();

        assertNumberEqual(await pChainStakeMirror.balanceOf(registeredCAddresses[0]), 0);
        assertNumberEqual(await pChainStakeMirror.balanceOf(registeredCAddresses[1]), 0);
        assertNumberEqual(await pChainStakeMirror.votePowerOf(nodeId1), 0);
        assertNumberEqual(await pChainStakeMirror.votePowerOf(nodeId2), 0);
        assertNumberEqual(await governanceVotePower.getVotes(registeredCAddresses[0]), deposit1);
        assertNumberEqual(await governanceVotePower.getVotes(registeredCAddresses[1]), deposit2);

        // withdraw from WNat (unwrap)
        await wNat.withdraw(deposit1, { from: registeredCAddresses[0] });
        await wNat.withdraw(deposit2, { from: registeredCAddresses[1] });
        assertNumberEqual(await governanceVotePower.getVotes(registeredCAddresses[0]), 0);
        assertNumberEqual(await governanceVotePower.getVotes(registeredCAddresses[1]), 0);
      });

      it("Should delegate and decrease governance vote power when stakes end", async () => {
        expect(await pChainStakeMirror.governanceVotePower()).to.equals(governanceVotePower.address)
        await governanceVotePower.delegate(accounts[10], { from: registeredCAddresses[0] });
        await governanceVotePower.delegate(accounts[11], { from: registeredCAddresses[1] });

        assertNumberEqual(await governanceVotePower.getVotes(accounts[10]), weightGwei1 * GWEI + deposit1);
        assertNumberEqual(await governanceVotePower.getVotes(accounts[11]), (weightGwei2 + weightGwei3) * GWEI + deposit2);
        expect(await governanceVotePower.getDelegateOfAtNow(registeredCAddresses[0])).to.equals(accounts[10]);
        expect(await governanceVotePower.getDelegateOfAtNow(registeredCAddresses[1])).to.equals(accounts[11]);
        assertNumberEqual(await pChainStakeMirror.balanceOf(registeredCAddresses[0]), weightGwei1 * GWEI);
        assertNumberEqual(await pChainStakeMirror.votePowerOf(nodeId1), (weightGwei1 + weightGwei2) * GWEI);

        // first stake ended
        await increaseTimeTo(now, 10);
        await pChainStakeMirror.daemonize();
        assertNumberEqual(await governanceVotePower.getVotes(accounts[10]), deposit1);
        assertNumberEqual(await governanceVotePower.getVotes(accounts[11]), (weightGwei2 + weightGwei3) * GWEI + deposit2);

        // second stake ended
        await increaseTimeTo(now, 20);
        await pChainStakeMirror.daemonize();
        assertNumberEqual(await governanceVotePower.getVotes(accounts[10]), deposit1);
        assertNumberEqual(await governanceVotePower.getVotes(accounts[11]), weightGwei3 * GWEI + deposit2);

        // third stake ended
        await increaseTimeTo(now, 30);
        await pChainStakeMirror.daemonize();
        assertNumberEqual(await governanceVotePower.getVotes(accounts[10]), deposit1);
        assertNumberEqual(await governanceVotePower.getVotes(accounts[11]), deposit2);

        // withdraw from WNat (unwrap)
        await wNat.withdraw(deposit1, { from: registeredCAddresses[0] });
        await wNat.withdraw(deposit2, { from: registeredCAddresses[1] });
        assertNumberEqual(await governanceVotePower.getVotes(accounts[10]), 0);
        assertNumberEqual(await governanceVotePower.getVotes(accounts[11]), 0);
      });
    });
  });

  describe("Transfer tokens, only VP", async () => {
    beforeEach(async () => {
      wNat = await WNat.new(accounts[0], "Wrapped NAT", "WNAT");
      vpContract = await VPContract.new(wNat.address, false);
      await wNat.setReadVpContract(vpContract.address);
      await wNat.setWriteVpContract(vpContract.address);
      await wNat.deposit({ from: accounts[1], value: toBN(600) });
      await wNat.deposit({ from: accounts[3], value: toBN(200) });
    });

    it("Should check how much gas uses tokens transfer", async () => {
      await wNat.delegate(accounts[2], 10000, { from: accounts[1] });
      expect((await wNat.votePowerOf(accounts[2])).toString()).to.equals("600");

      await wNat.delegate(accounts[4], 10000, { from: accounts[3] });
      expect((await wNat.votePowerOf(accounts[4])).toString()).to.equals("200");

      let tx = await wNat.transfer(accounts[3], toBN(500), { from: accounts[1] });
      console.log("transaction 1:", tx.receipt.gasUsed, "gas");
      expect((await wNat.votePowerOf(accounts[2])).toString()).to.equals("100");
      expect((await wNat.votePowerOf(accounts[4])).toString()).to.equals("700");
      expect((await wNat.balanceOf(accounts[1])).toString()).to.equals("100");
      expect((await wNat.balanceOf(accounts[3])).toString()).to.equals("700");

      let tx2 = await wNat.transfer(accounts[3], toBN(50), { from: accounts[1] });
      console.log("transaction 2:", tx2.receipt.gasUsed, "gas");
    });
  });

  describe("Transfer tokens, only VP and governance VP", async () => {
    beforeEach(async () => {
      wNat = await WNat.new(accounts[0], "Wrapped NAT", "WNAT");
      governanceVotePower = await GovernanceVotePower.new(wNat.address, pChainStakeMirror.address);
      await wNat.setGovernanceVotePower(governanceVotePower.address);
      vpContract = await VPContract.new(wNat.address, false);
      await wNat.setReadVpContract(vpContract.address);
      await wNat.setWriteVpContract(vpContract.address);

      await wNat.deposit({ from: accounts[1], value: toBN(600) });
      await wNat.deposit({ from: accounts[3], value: toBN(200) });
    });

    it("Should check how much gas is used for tokens transfer", async () => {
      await wNat.delegate(accounts[2], 10000, { from: accounts[1] });
      expect((await wNat.votePowerOf(accounts[2])).toString()).to.equals("600");

      await governanceVotePower.delegate(accounts[2], { from: accounts[1] });
      const blockAfterDelegate1 = await web3.eth.getBlockNumber();
      expect((await governanceVotePower.votePowerOfAt(accounts[2], blockAfterDelegate1)).toString()).to.equals("600");

      await wNat.delegate(accounts[4], 10000, { from: accounts[3] });
      expect((await wNat.votePowerOf(accounts[4])).toString()).to.equals("200");

      await governanceVotePower.delegate(accounts[4], { from: accounts[3] });
      const blockAfterDelegate2 = await web3.eth.getBlockNumber();
      expect((await governanceVotePower.votePowerOfAt(accounts[4], blockAfterDelegate2)).toString()).to.equals("200");

      let tx = await wNat.transfer(accounts[3], toBN(500), { from: accounts[1] });
      const blockAfterTransfer = await web3.eth.getBlockNumber();
      console.log("transaction1:", tx.receipt.gasUsed, "gas");
      expect((await wNat.votePowerOf(accounts[2])).toString()).to.equals("100");
      expect((await wNat.votePowerOf(accounts[4])).toString()).to.equals("700");
      expect((await wNat.balanceOf(accounts[1])).toString()).to.equals("100");
      expect((await wNat.balanceOf(accounts[3])).toString()).to.equals("700");
      expect((await governanceVotePower.votePowerOfAt(accounts[2], blockAfterTransfer)).toString()).to.equals("100")
      expect((await governanceVotePower.votePowerOfAt(accounts[4], blockAfterTransfer)).toString()).to.equals("700")

      let tx2 = await wNat.transfer(accounts[3], toBN(50), { from: accounts[1] });
      console.log("transaction2:", tx2.receipt.gasUsed, "gas");
    });
  });

});
