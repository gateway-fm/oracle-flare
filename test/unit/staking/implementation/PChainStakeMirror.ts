import { expectEvent, expectRevert, time, constants } from '@openzeppelin/test-helpers';
import { Contracts } from "../../../../deployment/scripts/Contracts";
import {
  AddressBinderInstance,
  GovernanceVotePowerInstance,
  PChainStakeMirrorInstance,
  WNatInstance,
  PChainStakeMirrorVerifierInstance,
  MockContractInstance
} from "../../../../typechain-truffle";
import { encodeContractNames, toBN, assertNumberEqual, compareArrays } from "../../../utils/test-helpers";
import privateKeys from "../../../../test-1020-accounts.json"
import * as util from "../../../utils/key-to-address";
import { ethers, network } from 'hardhat';
import { PChainStakeMirror__factory } from '../../../../typechain';
import { expectEthersEvent } from '../../../utils/EventDecoder';
import { toChecksumAddress } from 'ethereumjs-util';

const getTestFile = require('../../../utils/constants').getTestFile;

const PChainStakeMirror = artifacts.require("PChainStakeMirror");
const GovernanceVotePower = artifacts.require("GovernanceVotePower");
const WNat = artifacts.require("WNat");
const AddressBinder = artifacts.require("AddressBinder");
const MockContract = artifacts.require("MockContract");
const PChainVerifier = artifacts.require("PChainStakeMirrorVerifier");
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
  await verifierMock.givenCalldataReturnBool(verifyPChainStakingMethod, stakingProved);
  return data;
}

contract(`PChainStakeMirror.sol; ${getTestFile(__filename)}; P-chain stake mirror unit tests`, async accounts => {
  let pChainStakeMirror: PChainStakeMirrorInstance;
  let governanceVotePower: GovernanceVotePowerInstance;
  let wNat: WNatInstance;
  let addressBinder: AddressBinderInstance;
  let pChainVerifier: PChainStakeMirrorVerifierInstance;
  let verifierMock: MockContractInstance;

  const ADDRESS_UPDATER = accounts[16];
  const CLEANER_CONTRACT = accounts[100];
  const CLEANUP_BLOCK_NUMBER_MANAGER = accounts[17];

  beforeEach(async () => {
    pChainStakeMirror = await PChainStakeMirror.new(
      accounts[0],
      accounts[0],
      ADDRESS_UPDATER,
      2
    );

    wNat = await WNat.new(accounts[0], "Wrapped NAT", "WNAT");
    governanceVotePower = await GovernanceVotePower.new(wNat.address, pChainStakeMirror.address);
    await wNat.setGovernanceVotePower(governanceVotePower.address);

    addressBinder = await AddressBinder.new();
    pChainVerifier = await PChainVerifier.new(ADDRESS_UPDATER, 10, 1000, 5, 5000);

    await pChainStakeMirror.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.ADDRESS_BINDER, Contracts.GOVERNANCE_VOTE_POWER, Contracts.CLEANUP_BLOCK_NUMBER_MANAGER, Contracts.P_CHAIN_STAKE_MIRROR_VERIFIER]),
      [ADDRESS_UPDATER, addressBinder.address, governanceVotePower.address, CLEANUP_BLOCK_NUMBER_MANAGER, pChainVerifier.address], { from: ADDRESS_UPDATER });

    await pChainStakeMirror.setCleanerContract(CLEANER_CONTRACT);
  });


  describe("basic", async () => {
    it("Should change max updates per block", async () => {
      expect((await pChainStakeMirror.maxUpdatesPerBlock()).toNumber()).to.equals(2);
      let setMaxUpdatesPerBlock = await pChainStakeMirror.setMaxUpdatesPerBlock(3);
      expectEvent(setMaxUpdatesPerBlock, "MaxUpdatesPerBlockSet", { "maxUpdatesPerBlock": toBN(3) });
      expect((await pChainStakeMirror.maxUpdatesPerBlock()).toNumber()).to.equals(3);
    });

    it("Should revert changing max updates per block if not from governance", async () => {
      let setMaxUpdatesPerBlock = pChainStakeMirror.setMaxUpdatesPerBlock(3, { from: accounts[1] });
      await expectRevert(setMaxUpdatesPerBlock, "only governance");
    });

    it("Should revert revoking stake if not from governance", async () => {
      let revokeStake = pChainStakeMirror.revokeStake(web3.utils.keccak256("stake1"), "0x0123456789012345678901234567890123456786", 100, 2, { from: accounts[1] });
      await expectRevert(revokeStake, "only governance");
    });

    it("Should revert setting cleaner contract if not from governance", async () => {
      let setCleanerContract = pChainStakeMirror.setCleanerContract(CLEANER_CONTRACT, { from: accounts[1] });
      await expectRevert(setCleanerContract, "only governance");
    });

    it("Should activate and deactivate contract", async () => {
      // activate
      expect(await pChainStakeMirror.active()).to.equals(false);
      expect((await pChainStakeMirror.nextTimestampToTrigger()).toString()).to.equals("0");
      await pChainStakeMirror.activate();
      let lastTs = await time.latest();
      expect(await pChainStakeMirror.active()).to.equals(true);
      expect((await pChainStakeMirror.nextTimestampToTrigger()).toNumber()).to.equals(lastTs.toNumber());

      // deactivate
      await pChainStakeMirror.deactivate();
      expect(await pChainStakeMirror.active()).to.equals(false);

      // activate - lsat triggered timestamp should not change
      await pChainStakeMirror.activate();
      expect(await pChainStakeMirror.active()).to.equals(true);
      expect((await pChainStakeMirror.nextTimestampToTrigger()).toNumber()).to.equals(lastTs.toNumber());
    });

    it("Should set cleanup block number", async () => {
      let currentBlock = await web3.eth.getBlockNumber();
      await pChainStakeMirror.setCleanupBlockNumber(currentBlock - 1, { from: CLEANUP_BLOCK_NUMBER_MANAGER });
      expect((await pChainStakeMirror.cleanupBlockNumber()).toNumber()).to.equals(currentBlock - 1);
    });

    it("Should not set cleanup block number if not from cleanup block number manager", async () => {
      let setCleanupBlock = pChainStakeMirror.setCleanupBlockNumber(1);
      await expectRevert(setCleanupBlock, "only cleanup block manager");
    });

    it("Should get contract name", async () => {
      expect(await pChainStakeMirror.getContractName()).to.equals("PChainStakeMirror");
    });

    it("Should switch to fallback mode and decrease max updates per block", async () => {
      await pChainStakeMirror.setMaxUpdatesPerBlock(10);
      let switchTo = await pChainStakeMirror.switchToFallbackMode.call({ from: accounts[0] });
      await pChainStakeMirror.switchToFallbackMode();
      assert(switchTo);
      expect((await pChainStakeMirror.maxUpdatesPerBlock()).toNumber()).to.equals(8);
    });

    it("Switch to fallback mode should return false if max updates per block is set to 0", async () => {
      await pChainStakeMirror.setMaxUpdatesPerBlock(0);
      let switchTo = await pChainStakeMirror.switchToFallbackMode.call({ from: accounts[0] });
      await pChainStakeMirror.switchToFallbackMode();
      assert(!switchTo);
    });

    it("Daemonize should return false if contract is not yet activated", async () => {
      let daemonize = await pChainStakeMirror.daemonize.call({ from: accounts[0] });
      await pChainStakeMirror.daemonize();
      assert(!daemonize);
    });

    it("Should set cleaner contract", async () => {
      await pChainStakeMirror.setCleanerContract(CLEANER_CONTRACT);
      expect(await pChainStakeMirror.cleanerContract()).to.equals(CLEANER_CONTRACT);
    });

  });

  describe("verify", async () => {
    let registeredPAddresses: string[] = [];
    let registeredCAddresses: string[] = [];
    let now: BN;
    let nodeId1: string;
    let nodeId2: string;
    let nodeId3: string;
    let nodeId4: string;
    let weightGwei1: number;
    let weightGwei2: number;
    let weightGwei3: number;
    let weightGwei4: number;
    let currentBlock: BN;
    let stake1Id: string;
    let stake2Id: string;
    let stake3Id: string;
    let stake4Id: string;
    let stake5Id: string;

    beforeEach(async () => {
      verifierMock = await MockContract.new();
      await pChainStakeMirror.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.ADDRESS_BINDER, Contracts.GOVERNANCE_VOTE_POWER, Contracts.CLEANUP_BLOCK_NUMBER_MANAGER, Contracts.P_CHAIN_STAKE_MIRROR_VERIFIER]),
        [ADDRESS_UPDATER, addressBinder.address, governanceVotePower.address, CLEANUP_BLOCK_NUMBER_MANAGER, verifierMock.address], { from: ADDRESS_UPDATER });

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
        registeredCAddresses.push(cAddr)
      }

      // activate contract
      await pChainStakeMirror.activate();

      // set values
      weightGwei1 = 1000;
      weightGwei2 = 500;
      weightGwei3 = 100;
      weightGwei4 = 50;
      nodeId1 = "0x0123456789012345678901234567890123456789";
      nodeId2 = "0x0123456789012345678901234567890123456788";
      nodeId3 = "0x0123456789012345678901234567890123456787";
      nodeId4 = "0x0123456789012345678901234567890123456786";
      stake1Id = web3.utils.keccak256("stake1");
      stake2Id = web3.utils.keccak256("stake2");
      stake3Id = web3.utils.keccak256("stake3");
      stake4Id = web3.utils.keccak256("stake4");
      stake5Id = web3.utils.keccak256("stake5");
      now = await time.latest();
      currentBlock = await time.latestBlock()
    });

    it("Should not verify if contract is not active ", async () => {
      await pChainStakeMirror.deactivate();
      let data = await setMockStakingData(verifierMock, pChainVerifier, stake1Id, 0, registeredPAddresses[0], nodeId1, now, now.addn(1), 1000);
      let verify = pChainStakeMirror.mirrorStake(data, []);
      await expectRevert(verify, "not active");
    });

    it("Should revert if staking is not proved", async () => {
      let data = await setMockStakingData(verifierMock, pChainVerifier, stake1Id, 0, registeredPAddresses[0], nodeId1, now, now.addn(10), 1000, false)

      let verify = pChainStakeMirror.mirrorStake(data, []);
      await expectRevert(verify, "staking data invalid");
    });

    it("Should revert if staking start time is in the future", async () => {
      let data = await setMockStakingData(verifierMock, pChainVerifier, stake1Id, 0, registeredPAddresses[0], nodeId1, now.addn(10), now.addn(100), 1000);

      let verify = pChainStakeMirror.mirrorStake(data, []);
      await expectRevert(verify, "staking not started yet");
    });

    it("Should revert if staking end time is in the past", async () => {
      let data = await setMockStakingData(verifierMock, pChainVerifier, stake1Id, 0, registeredPAddresses[0], nodeId1, now.subn(10), now.subn(1), 1000);

      let verify = pChainStakeMirror.mirrorStake(data, []);
      await expectRevert(verify, "staking already ended");
    });

    it("Should revert if trying to verify stake tx with the same transaction hash and the same source address twice", async () => {
      let data = await setMockStakingData(verifierMock, pChainVerifier, stake1Id, 0, registeredPAddresses[0], nodeId1, now.subn(10), now.addn(10), 1000);
      await pChainStakeMirror.mirrorStake(data, []);

      // verify again
      let verify = pChainStakeMirror.mirrorStake(data, []);
      await expectRevert(verify, "transaction already mirrored");
    });

    it("Should verify stake tx with the same transaction hash and different source address", async () => {
      let data1 = await setMockStakingData(verifierMock, pChainVerifier, stake1Id, 0, registeredPAddresses[0], nodeId1, now.subn(10), now.addn(10), 1000);
      let data2 = await setMockStakingData(verifierMock, pChainVerifier, stake1Id, 0, registeredPAddresses[1], nodeId1, now.subn(10), now.addn(10), 1000);
      await pChainStakeMirror.mirrorStake(data1, []);
      await pChainStakeMirror.mirrorStake(data2, []);
    });

    it("Should revert if staking address is unknown", async () => {
      // address is not registered
      let prvKey = privateKeys[5].privateKey.slice(2);
      let prvkeyBuffer = Buffer.from(prvKey, 'hex');
      let [X, Y] = util.privateKeyToPublicKeyPair(prvkeyBuffer);
      let unregisteredPAddr = "0x" + util.publicKeyToAvalancheAddress(X, Y).toString('hex');

      let data = await setMockStakingData(verifierMock, pChainVerifier, stake1Id, 0, unregisteredPAddr, nodeId1, now.subn(10), now.addn(10), 1000);
      let verify = pChainStakeMirror.mirrorStake(data, []);
      await expectRevert(verify, "unknown staking address");
    });

    it("Should revert if verifying stakes to more that 3 nodes per address", async () => {
      let data1 = await setMockStakingData(verifierMock, pChainVerifier, stake1Id, 0, registeredPAddresses[0], nodeId1, now.subn(10), now.addn(100), 1000);
      let data2 = await setMockStakingData(verifierMock, pChainVerifier, stake2Id, 0, registeredPAddresses[0], nodeId2, now.subn(10), now.addn(100), 1000);
      let data3 = await setMockStakingData(verifierMock, pChainVerifier, stake3Id, 0, registeredPAddresses[0], nodeId3, now.subn(10), now.addn(100), 1000);
      let data4 = await setMockStakingData(verifierMock, pChainVerifier, stake4Id, 0, registeredPAddresses[0], nodeId1, now.subn(10), now.addn(100), 1000);
      let data5 = await setMockStakingData(verifierMock, pChainVerifier, stake5Id, 0, registeredPAddresses[0], nodeId4, now.subn(10), now.addn(100), 1000);

      await pChainStakeMirror.mirrorStake(data1, []);
      await pChainStakeMirror.mirrorStake(data2, []);
      await pChainStakeMirror.mirrorStake(data3, []);

      // can add delegation to the same node id
      await pChainStakeMirror.mirrorStake(data4, []);

      let verify = pChainStakeMirror.mirrorStake(data5, []);
      await expectRevert(verify, "Max node ids exceeded");
    });

    it("Should verify stakes and save relevant data", async () => {
      //// first stake
      let data1 = await setMockStakingData(verifierMock, pChainVerifier, stake1Id, 0, registeredPAddresses[0], nodeId1, now.subn(10), now.addn(10), weightGwei1);

      expect((await pChainStakeMirror.votePowerFromToAt(registeredCAddresses[0], nodeId1, await time.latestBlock())).toNumber()).to.equals(0);
      let stakes = await pChainStakeMirror.stakesOfAt(registeredCAddresses[1], await time.latestBlock());
      expect((stakes[0]).toString()).to.equals([].toString());
      expect((stakes[1]).toString()).to.equals([].toString());

      // verify
      await pChainStakeMirror.mirrorStake(data1, []);

      expect((await pChainStakeMirror.balanceOf(registeredCAddresses[0])).toNumber()).to.equals(weightGwei1 * GWEI);
      expect((await pChainStakeMirror.votePowerOf(nodeId1)).toNumber()).to.equals(weightGwei1 * GWEI);
      let stakes1 = await pChainStakeMirror.stakesOf(registeredCAddresses[0]);
      expect((stakes1[0]).toString()).to.equals([nodeId1].toString());
      expect((stakes1[1]).toString()).to.equals([weightGwei1 * GWEI].toString());
      expect((await pChainStakeMirror.votePowerFromTo(registeredCAddresses[0], nodeId1)).toNumber()).to.equals(weightGwei1 * GWEI);

      //// second stake
      let data2 = await setMockStakingData(verifierMock, pChainVerifier, stake2Id, 0, registeredPAddresses[1], nodeId1, now.subn(10), now.addn(20), weightGwei2);
      await pChainStakeMirror.mirrorStake(data2, []);

      expect((await pChainStakeMirror.balanceOf(registeredCAddresses[1])).toNumber()).to.equals(weightGwei2 * GWEI);
      expect((await pChainStakeMirror.votePowerOf(nodeId1)).toNumber()).to.equals((weightGwei1 + weightGwei2) * GWEI);
      let stakes2 = await pChainStakeMirror.stakesOf(registeredCAddresses[1]);
      expect((stakes2[0]).toString()).to.equals([nodeId1].toString());
      expect((stakes2[1]).toString()).to.equals([weightGwei2 * GWEI].toString());

      //// third stake
      let data3 = await setMockStakingData(verifierMock, pChainVerifier, stake3Id, 0, registeredPAddresses[1], nodeId2, now.subn(10), now.addn(25), weightGwei3);
      await pChainStakeMirror.mirrorStake(data3, []);

      let block = await time.latestBlock();
      expect((await pChainStakeMirror.balanceOf(registeredCAddresses[1])).toNumber()).to.equals((weightGwei2 + weightGwei3) * GWEI);
      expect((await pChainStakeMirror.votePowerOf(nodeId1)).toNumber()).to.equals((weightGwei1 + weightGwei2) * GWEI);
      expect((await pChainStakeMirror.votePowerOf(nodeId2)).toNumber()).to.equals(weightGwei3 * GWEI);
      expect((await pChainStakeMirror.totalSupply()).toNumber()).to.equals((weightGwei1 + weightGwei2 + weightGwei3) * GWEI);
      expect((await pChainStakeMirror.totalVotePower()).toNumber()).to.equals((weightGwei1 + weightGwei2 + weightGwei3) * GWEI);
      let stakes3 = await pChainStakeMirror.stakesOf(registeredCAddresses[1]);
      expect((stakes3[0]).toString()).to.equals([nodeId1, nodeId2].toString());
      expect((stakes3[1]).toString()).to.equals([weightGwei2 * GWEI, weightGwei3 * GWEI].toString());
      expect((await pChainStakeMirror.votePowerFromTo(registeredCAddresses[1], nodeId1)).toNumber()).to.equals(weightGwei2 * GWEI);
      expect((await pChainStakeMirror.votePowerFromTo(registeredCAddresses[1], nodeId2)).toNumber()).to.equals(weightGwei3 * GWEI);
      expect((await pChainStakeMirror.votePowerOfAt(nodeId1, block)).toNumber()).to.equals((weightGwei1 + weightGwei2) * GWEI);
      await expectRevert(pChainStakeMirror.batchVotePowerOfAt([registeredCAddresses[0], registeredCAddresses[1]], block), "Can only be used for past blocks");

      // run daemonize but no stakes are not yet expired
      await pChainStakeMirror.daemonize();
      expect((await pChainStakeMirror.balanceOf(registeredCAddresses[1])).toNumber()).to.equals((weightGwei2 + weightGwei3) * GWEI);
      expect((await pChainStakeMirror.balanceOf(registeredCAddresses[0])).toNumber()).to.equals(weightGwei1 * GWEI);
      expect((await pChainStakeMirror.votePowerOf(nodeId1)).toNumber()).to.equals((weightGwei1 + weightGwei2) * GWEI);
      expect((await pChainStakeMirror.votePowerOf(nodeId2)).toNumber()).to.equals(weightGwei3 * GWEI);

      // increase time by 10; first stake is expired
      await increaseTimeTo(now, 10);
      const signer = await ethers.getSigner(accounts[0]);
      const pChainStakeMirrorEth = PChainStakeMirror__factory.connect(pChainStakeMirror.address, signer);
      const txHash = ethers.utils.keccak256(ethers.utils.defaultAbiCoder.encode(["bytes32", "bytes20"], [stake1Id, registeredPAddresses[0]]));
      const tx = await pChainStakeMirrorEth.daemonize({from: accounts[0]});
      let receipt = await tx.wait();
      expectEthersEvent(receipt, pChainStakeMirrorEth, 'StakeEnded', { owner: registeredCAddresses[0], nodeId: nodeId1, amountWei: weightGwei1 * GWEI, txHash: txHash});
      expect((await pChainStakeMirror.balanceOf(registeredCAddresses[1])).toNumber()).to.equals((weightGwei2 + weightGwei3) * GWEI);
      expect((await pChainStakeMirror.balanceOf(registeredCAddresses[0])).toNumber()).to.equals(0);
      expect((await pChainStakeMirror.votePowerOf(nodeId1)).toNumber()).to.equals(weightGwei2 * GWEI);
      expect((await pChainStakeMirror.votePowerOf(nodeId2)).toNumber()).to.equals(weightGwei3 * GWEI);
      expect((await pChainStakeMirror.votePowerFromTo(registeredCAddresses[0], nodeId1)).toNumber()).to.equals(0);

      // increase time by 10; second stake is expired
      await increaseTimeTo(now, 20);
      await pChainStakeMirror.daemonize();
      expect((await pChainStakeMirror.balanceOf(registeredCAddresses[1])).toNumber()).to.equals(weightGwei3 * GWEI);
      expect((await pChainStakeMirror.balanceOf(registeredCAddresses[0])).toNumber()).to.equals(0);
      expect((await pChainStakeMirror.votePowerOf(nodeId1)).toNumber()).to.equals(0);
      expect((await pChainStakeMirror.votePowerOf(nodeId2)).toNumber()).to.equals(weightGwei3 * GWEI);
      expect((await pChainStakeMirror.votePowerFromTo(registeredCAddresses[1], nodeId1)).toNumber()).to.equals(0);
      expect((await pChainStakeMirror.votePowerFromTo(registeredCAddresses[1], nodeId2)).toNumber()).to.equals(weightGwei3 * GWEI);

      // increase time by 10; second third is expired
      await increaseTimeTo(now, 25);
      await pChainStakeMirror.daemonize();
      expect((await pChainStakeMirror.balanceOf(registeredCAddresses[1])).toNumber()).to.equals(0);
      expect((await pChainStakeMirror.balanceOf(registeredCAddresses[0])).toNumber()).to.equals(0);
      expect((await pChainStakeMirror.votePowerOf(nodeId1)).toNumber()).to.equals(0);
      expect((await pChainStakeMirror.votePowerOf(nodeId2)).toNumber()).to.equals(0);
      let stakes4 = await pChainStakeMirror.stakesOf(registeredCAddresses[1]);
      expect((stakes4[0]).toString()).to.equals([].toString());
      expect((stakes4[1]).toString()).to.equals([].toString());
      expect((await pChainStakeMirror.votePowerFromTo(registeredCAddresses[1], nodeId2)).toNumber()).to.equals(0);

      // check if past data is still saved
      expect((await pChainStakeMirror.balanceOfAt(registeredCAddresses[1], block)).toNumber()).to.equals((weightGwei2 + weightGwei3) * GWEI);
      expect((await pChainStakeMirror.balanceOfAt(registeredCAddresses[0], block)).toNumber()).to.equals(weightGwei1 * GWEI);
      expect((await pChainStakeMirror.votePowerOfAt(nodeId1, block)).toNumber()).to.equals((weightGwei1 + weightGwei2) * GWEI);
      expect((await pChainStakeMirror.votePowerOfAt(nodeId2, block)).toNumber()).to.equals(weightGwei3 * GWEI);
      expect((await pChainStakeMirror.totalSupplyAt(block)).toNumber()).to.equals((weightGwei1 + weightGwei2 + weightGwei3) * GWEI);
      expect((await pChainStakeMirror.totalSupply()).toNumber()).to.equals(0);
      expect((await pChainStakeMirror.totalVotePowerAt(block)).toNumber()).to.equals((weightGwei1 + weightGwei2 + weightGwei3) * GWEI);
      expect((await pChainStakeMirror.totalVotePower()).toNumber()).to.equals(0);
      let stakes5 = await pChainStakeMirror.stakesOfAt(registeredCAddresses[1], block);
      expect((stakes5[0]).toString()).to.equals([nodeId1, nodeId2].toString());
      expect((stakes5[1]).toString()).to.equals([weightGwei2 * GWEI, weightGwei3 * GWEI].toString());
      let stakes6 = await pChainStakeMirror.stakesOfAt(registeredCAddresses[1], block.subn(10));
      expect((stakes6[0]).toString()).to.equals([].toString());
      expect((stakes6[1]).toString()).to.equals([].toString());
      expect((await pChainStakeMirror.votePowerFromToAt(registeredCAddresses[0], nodeId1, block)).toNumber()).to.equals(weightGwei1 * GWEI);
      expect((await pChainStakeMirror.votePowerFromToAt(registeredCAddresses[1], nodeId1, block)).toNumber()).to.equals(weightGwei2 * GWEI);
      expect((await pChainStakeMirror.votePowerFromToAt(registeredCAddresses[1], nodeId2, block)).toNumber()).to.equals(weightGwei3 * GWEI);
      expect((await pChainStakeMirror.batchVotePowerOfAt([nodeId1, nodeId2], block)).toString()).to.equals([(weightGwei1 + weightGwei2) * GWEI, weightGwei3 * GWEI].toString());
    });

    it("Should verify multiple stakes in the same block", async () => {
      let data1 = await setMockStakingData(verifierMock, pChainVerifier, stake1Id, 0, registeredPAddresses[0], nodeId1, now.subn(15), now.addn(10), weightGwei1);
      let data2 = await setMockStakingData(verifierMock, pChainVerifier, stake2Id, 0, registeredPAddresses[0], nodeId2, now.subn(10), now.addn(10), weightGwei1);
      let data3 = await setMockStakingData(verifierMock, pChainVerifier, stake3Id, 0, registeredPAddresses[0], nodeId2, now.subn(5), now.addn(10), weightGwei1);
      const signer = await ethers.getSigner(registeredCAddresses[1]);
      const pChainStakeMirrorEth = PChainStakeMirror__factory.connect(pChainStakeMirror.address, signer);
      try {
        // switch to manual mining
        await network.provider.send('evm_setAutomine', [false]);
        await network.provider.send("evm_setIntervalMining", [0]);

        let tx1 = await pChainStakeMirrorEth.mirrorStake(data1, []);
        let tx2 = await pChainStakeMirrorEth.mirrorStake(data2, []);
        let tx3 = await pChainStakeMirrorEth.mirrorStake(data3, []);

        await network.provider.send('evm_mine');

        let receipt1 = await tx1.wait();
        const txHash1 = ethers.utils.keccak256(ethers.utils.defaultAbiCoder.encode(["bytes32", "bytes20"], [stake1Id, registeredPAddresses[0]]));
        expectEthersEvent(receipt1, pChainStakeMirrorEth, 'StakeConfirmed', { owner: registeredCAddresses[0], nodeId: nodeId1, amountWei: weightGwei1 * GWEI, pChainTxId: stake1Id, txHash: txHash1 });

        let receipt2 = await tx2.wait();
        const txHash2 = ethers.utils.keccak256(ethers.utils.defaultAbiCoder.encode(["bytes32", "bytes20"], [stake2Id, registeredPAddresses[0]]));
        expectEthersEvent(receipt2, pChainStakeMirrorEth, 'StakeConfirmed', { owner: registeredCAddresses[0], nodeId: nodeId2, amountWei: weightGwei1 * GWEI, pChainTxId: stake2Id, txHash: txHash2 });

        let receipt3 = await tx3.wait();
        const txHash3 = ethers.utils.keccak256(ethers.utils.defaultAbiCoder.encode(["bytes32", "bytes20"], [stake3Id, registeredPAddresses[0]]));
        expectEthersEvent(receipt3, pChainStakeMirrorEth, 'StakeConfirmed', { owner: registeredCAddresses[0], nodeId: nodeId2, amountWei: weightGwei1 * GWEI, pChainTxId: stake3Id, txHash: txHash3 });
      } finally {
        await network.provider.send('evm_setAutomine', [true]);
      }
    });

    it("Should not decrease all stake values on first daemonize call if number of updates is greater than max updates per block", async () => {
      // first stake
      let data1 = await setMockStakingData(verifierMock, pChainVerifier, stake1Id, 0, registeredPAddresses[0], nodeId1, now.subn(10), now.addn(10), weightGwei1);
      await pChainStakeMirror.mirrorStake(data1, []);

      // second stake
      let data2 = await setMockStakingData(verifierMock, pChainVerifier, stake2Id, 0, registeredPAddresses[0], nodeId1, now.subn(10), now.addn(10), weightGwei2);
      await pChainStakeMirror.mirrorStake(data2, []);

      // third stake
      let data3 = await setMockStakingData(verifierMock, pChainVerifier, stake3Id, 0, registeredPAddresses[0], nodeId2, now.subn(10), now.addn(15), weightGwei3);
      await pChainStakeMirror.mirrorStake(data3, []);

      // fourth stake
      let data4 = await setMockStakingData(verifierMock, pChainVerifier, stake4Id, 0, registeredPAddresses[0], nodeId2, now.subn(10), now.addn(15), weightGwei4);
      await pChainStakeMirror.mirrorStake(data4, []);

      expect((await pChainStakeMirror.balanceOf(registeredCAddresses[0])).toNumber()).to.equals((weightGwei1 + weightGwei2 + weightGwei3 + weightGwei4) * GWEI);
      expect((await pChainStakeMirror.votePowerOf(nodeId1)).toNumber()).to.equals((weightGwei1 + weightGwei2) * GWEI);
      expect((await pChainStakeMirror.votePowerOf(nodeId2)).toNumber()).to.equals((weightGwei3 + weightGwei4) * GWEI);
      expect((await pChainStakeMirror.totalSupply()).toNumber()).to.equals((weightGwei1 + weightGwei2 + weightGwei3 + weightGwei4) * GWEI);
      expect((await pChainStakeMirror.totalVotePower()).toNumber()).to.equals((weightGwei1 + weightGwei2 + weightGwei3 + weightGwei4) * GWEI);

      // increase time by 15; all four stakes expired, but max updates per block is set to 2. Values for only the first two should be decreased.
      await increaseTimeTo(now, 15);
      await pChainStakeMirror.daemonize();
      expect((await pChainStakeMirror.balanceOf(registeredCAddresses[0])).toNumber()).to.equals((weightGwei3 + weightGwei4) * GWEI);
      expect((await pChainStakeMirror.votePowerOf(nodeId1)).toNumber()).to.equals(0);
      expect((await pChainStakeMirror.votePowerOf(nodeId2)).toNumber()).to.equals((weightGwei3 + weightGwei4) * GWEI);

      // run daemonize again (in next block) and decrease values also for the last two stakes
      await pChainStakeMirror.daemonize();
      expect((await pChainStakeMirror.balanceOf(registeredCAddresses[0])).toNumber()).to.equals(0);
      expect((await pChainStakeMirror.votePowerOf(nodeId1)).toNumber()).to.equals(0);
    });

    it("Should revert if trying to verify stake to zero nodeId", async () => {
      let data = await setMockStakingData(verifierMock, pChainVerifier, stake1Id, 0, registeredPAddresses[0], constants.ZERO_ADDRESS, now.subn(10), now.addn(10), weightGwei1);
      let verify = pChainStakeMirror.mirrorStake(data, []);
      await expectRevert(verify, "Cannot stake to zero");
    });

    it("Should verify stakes and cache vote powers", async () => {
      let data = await setMockStakingData(verifierMock, pChainVerifier, stake1Id, 0, registeredPAddresses[0], nodeId1, now.subn(10), now.addn(10), weightGwei1);

      // verify stake
      await pChainStakeMirror.mirrorStake(data, []);
      let block = await time.latestBlock();
      let cachedRevert = pChainStakeMirror.votePowerOfAtCached(nodeId1, block.addn(1));
      await expectRevert(cachedRevert, "Can only be used for past blocks");

      await time.advanceBlock();
      let tx = await pChainStakeMirror.votePowerOfAtCached(nodeId1, block);
      expectEvent(tx, "VotePowerCacheCreated");
      assertNumberEqual(await pChainStakeMirror.votePowerOfAtCached.call(nodeId1, block), weightGwei1 * GWEI);

      // cache is already created
      let tx1 = await pChainStakeMirror.votePowerOfAtCached(nodeId1, block);
      expectEvent.notEmitted(tx1, "VotePowerCacheCreated");
      assertNumberEqual(await pChainStakeMirror.votePowerOfAtCached.call(nodeId1, block), weightGwei1 * GWEI);

      await pChainStakeMirror.totalVotePowerAtCached(block);
      assertNumberEqual(await pChainStakeMirror.totalVotePowerAtCached.call(block), weightGwei1 * GWEI);
    });

    it("Should cleanup cached vote power", async () => {
      let data = await setMockStakingData(verifierMock, pChainVerifier, stake1Id, 0, registeredPAddresses[0], nodeId1, now.subn(10), now.addn(10), weightGwei1);
      await pChainStakeMirror.mirrorStake(data, []);

      let block = await time.latestBlock();
      let cachedRevert = pChainStakeMirror.votePowerOfAtCached(nodeId1, block.addn(1));
      await expectRevert(cachedRevert, "Can only be used for past blocks");

      await time.advanceBlock();
      await pChainStakeMirror.votePowerOfAtCached(nodeId1, block);
      assertNumberEqual(await pChainStakeMirror.votePowerOfAtCached.call(nodeId1, block), weightGwei1 * GWEI);

      await time.advanceBlockTo(currentBlock.addn(100));
      await pChainStakeMirror.setCleanupBlockNumber(currentBlock.addn(90), { from: CLEANUP_BLOCK_NUMBER_MANAGER });

      await pChainStakeMirror.votePowerCacheCleanup(nodeId1, block, { from: CLEANER_CONTRACT });

      // cache is cleaned - should revert
      let tx = pChainStakeMirror.votePowerOfAtCached(nodeId1, block);
      await expectRevert(tx, "CheckPointable: reading from cleaned-up block");
    });

    it("Should revert if trying to cleanup cached vote power after cleanup block", async () => {
      let data = await setMockStakingData(verifierMock, pChainVerifier, stake1Id, 0, registeredPAddresses[0], nodeId1, now.subn(10), now.addn(10), weightGwei1);
      await pChainStakeMirror.mirrorStake(data, []);

      let block = await time.latestBlock();
      let cachedRevert = pChainStakeMirror.votePowerOfAtCached(nodeId1, block.addn(1));
      await expectRevert(cachedRevert, "Can only be used for past blocks");

      await time.advanceBlock();
      await pChainStakeMirror.votePowerOfAtCached(nodeId1, block);
      assertNumberEqual(await pChainStakeMirror.votePowerOfAtCached.call(nodeId1, block), weightGwei1 * GWEI);

      await time.advanceBlockTo(currentBlock.addn(100));
      await pChainStakeMirror.setCleanupBlockNumber(currentBlock.addn(90), { from: CLEANUP_BLOCK_NUMBER_MANAGER });

      let tx = pChainStakeMirror.votePowerCacheCleanup(nodeId1, block.addn(100), { from: CLEANER_CONTRACT });
      await expectRevert(tx, "No cleanup after cleanup block");
    });

    it("Should cleanup vote power", async () => {
      let data = await setMockStakingData(verifierMock, pChainVerifier, stake1Id, 0, registeredPAddresses[0], nodeId1, now.subn(10), now.addn(10), weightGwei1);
      await pChainStakeMirror.mirrorStake(data, []);

      let block = await time.latestBlock();
      await time.advanceBlock();
      assertNumberEqual(await pChainStakeMirror.votePowerOfAt(nodeId1, block), weightGwei1 * GWEI);

      await time.advanceBlockTo(currentBlock.addn(100));
      await pChainStakeMirror.setCleanupBlockNumber(currentBlock.addn(90), { from: CLEANUP_BLOCK_NUMBER_MANAGER });

      await pChainStakeMirror.votePowerHistoryCleanup(nodeId1, 1, { from: CLEANER_CONTRACT });

      // cleaned - should revert
      await expectRevert(pChainStakeMirror.votePowerOfAt(nodeId1, block), "CheckPointable: reading from cleaned-up block");
    });

    it("Should cleanup stakes history", async () => {
      let data = await setMockStakingData(verifierMock, pChainVerifier, stake1Id, 0, registeredPAddresses[0], nodeId1, now.subn(10), now.addn(10), weightGwei1);
      await pChainStakeMirror.mirrorStake(data, []);

      let block = await time.latestBlock();
      await time.advanceBlock();
      assertNumberEqual(await pChainStakeMirror.votePowerOfAt(nodeId1, block), weightGwei1 * GWEI);

      now = await time.latest();
      let data2 = await setMockStakingData(verifierMock, pChainVerifier, stake2Id, 0, registeredPAddresses[0], nodeId1, now.subn(10), now.addn(10), weightGwei1);
      await pChainStakeMirror.mirrorStake(data2, []);

      await time.advanceBlockTo(currentBlock.addn(100));
      await pChainStakeMirror.setCleanupBlockNumber(currentBlock.addn(90), { from: CLEANUP_BLOCK_NUMBER_MANAGER });

      await pChainStakeMirror.stakesHistoryCleanup(registeredCAddresses[0], 1, { from: CLEANER_CONTRACT });
      await pChainStakeMirror.stakesHistoryCleanup(registeredCAddresses[0], 1, { from: CLEANER_CONTRACT }); // do nothing - test some path
      await pChainStakeMirror.stakesHistoryCleanup(registeredCAddresses[1], 1, { from: CLEANER_CONTRACT }); // do nothing - test some path

      // cleaned - should revert
      await expectRevert(pChainStakeMirror.stakesOfAt(registeredCAddresses[0], block), "CheckPointable: reading from cleaned-up block");
    });

    it("Should write zero VP and balance if weight is zero", async () => {
      let weight = 0;
      let data = await setMockStakingData(verifierMock, pChainVerifier, stake1Id, 0, registeredPAddresses[0], nodeId1, now.subn(10), now.addn(10), weight);
      await pChainStakeMirror.mirrorStake(data, []);

      expect((await pChainStakeMirror.balanceOf(registeredCAddresses[0])).toNumber()).to.equals(weight);
      expect((await pChainStakeMirror.votePowerOf(nodeId1)).toNumber()).to.equals(weight);
    });

    it("Should check if active stake is verified", async () => {
      let data = await setMockStakingData(verifierMock, pChainVerifier, stake1Id, 0, registeredPAddresses[0], nodeId1, now.subn(10), now.addn(10), weightGwei1);
      expect(await pChainStakeMirror.isActiveStakeMirrored(stake1Id, registeredPAddresses[0])).to.equals(false);

      await pChainStakeMirror.mirrorStake(data, []);
      expect(await pChainStakeMirror.isActiveStakeMirrored(stake1Id, registeredPAddresses[0])).to.equals(true);
    });

    it("Should revoke stake", async () => {
      // first stake
      let data1 = await setMockStakingData(verifierMock, pChainVerifier, stake1Id, 0, registeredPAddresses[0], nodeId1, now.subn(10), now.addn(10), weightGwei1);
      await pChainStakeMirror.mirrorStake(data1, []);

      // second stake
      let data2 = await setMockStakingData(verifierMock, pChainVerifier, stake2Id, 0, registeredPAddresses[0], nodeId1, now.subn(10), now.addn(10), weightGwei2);
      await pChainStakeMirror.mirrorStake(data2, []);

      // third stake
      let data3 = await setMockStakingData(verifierMock, pChainVerifier, stake3Id, 0, registeredPAddresses[0], nodeId2, now.subn(10), now.addn(10), weightGwei3);
      await pChainStakeMirror.mirrorStake(data3, []);

      // fourth stake
      let data4 = await setMockStakingData(verifierMock, pChainVerifier, stake4Id, 0, registeredPAddresses[0], nodeId2, now.subn(10), now.addn(10), weightGwei4);
      await pChainStakeMirror.mirrorStake(data4, []);

      const txHash = ethers.utils.keccak256(ethers.utils.defaultAbiCoder.encode(["bytes32", "bytes20"], [stake1Id, registeredPAddresses[0]]));
      const stakingData = await pChainStakeMirror.transactionHashToPChainStakingData(txHash);
      expect(stakingData[0]).to.equals(registeredCAddresses[0]);
      expect(stakingData[1]).to.equals(nodeId1);
      expect(stakingData[2].toNumber()).to.equals(weightGwei1);

      await expectRevert(pChainStakeMirror.revokeStake(stake1Id, registeredPAddresses[0], now.addn(11), 1, { from: accounts[0] }), "wrong end time or index");
      await expectRevert(pChainStakeMirror.revokeStake(stake1Id, registeredPAddresses[0], now.addn(10), 2, { from: accounts[0] }), "wrong end time or index");

      const tx = await pChainStakeMirror.revokeStake(stake1Id, registeredPAddresses[0], now.addn(10), 0, { from: accounts[0] });
      expectEvent(tx, "StakeEnded", { owner: registeredCAddresses[0], amountWei: toBN(weightGwei1 * GWEI), txHash: txHash });
      expectEvent(tx, "StakeRevoked", { owner: registeredCAddresses[0], amountWei: toBN(weightGwei1 * GWEI), txHash: txHash });

      await expectRevert(pChainStakeMirror.revokeStake(stake1Id, registeredPAddresses[0], now.addn(10), 0, { from: accounts[0] }), "stake not mirrored");

      expect((await pChainStakeMirror.balanceOf(registeredCAddresses[0])).toNumber()).to.equals((weightGwei2 + weightGwei3 + weightGwei4) * GWEI);
      expect((await pChainStakeMirror.votePowerOf(nodeId1)).toNumber()).to.equals((weightGwei2) * GWEI);
      expect((await pChainStakeMirror.votePowerOf(nodeId2)).toNumber()).to.equals((weightGwei3 + weightGwei4) * GWEI);
      expect((await pChainStakeMirror.totalSupply()).toNumber()).to.equals((weightGwei2 + weightGwei3 + weightGwei4) * GWEI);
      expect((await pChainStakeMirror.totalVotePower()).toNumber()).to.equals((weightGwei2 + weightGwei3 + weightGwei4) * GWEI);

      // increase time by 15; all stakes expired, but max updates per block is set to 2. Values for only the first two in array should be decreased.
      await increaseTimeTo(now, 15);
      await pChainStakeMirror.daemonize();
      expect((await pChainStakeMirror.balanceOf(registeredCAddresses[0])).toNumber()).to.equals((weightGwei4) * GWEI);
      expect((await pChainStakeMirror.votePowerOf(nodeId1)).toNumber()).to.equals(0);
      expect((await pChainStakeMirror.votePowerOf(nodeId2)).toNumber()).to.equals((weightGwei4) * GWEI);

      const txHash2 = ethers.utils.keccak256(ethers.utils.defaultAbiCoder.encode(["bytes32", "bytes20"], [stake4Id, registeredPAddresses[0]]));
      const tx2 = await pChainStakeMirror.revokeStake(stake4Id, registeredPAddresses[0], now.addn(10), 0, { from: accounts[0] });
      expectEvent(tx2, "StakeEnded", { owner: registeredCAddresses[0], amountWei: toBN(weightGwei4 * GWEI), txHash: txHash2 });
      expectEvent(tx2, "StakeRevoked", { owner: registeredCAddresses[0], amountWei: toBN(weightGwei4 * GWEI), txHash: txHash2 });
      expect((await pChainStakeMirror.balanceOf(registeredCAddresses[0])).toNumber()).to.equals(0);
      expect((await pChainStakeMirror.votePowerOf(nodeId1)).toNumber()).to.equals(0);

      // run daemonize again (in next block)
      await pChainStakeMirror.daemonize();
      expect((await pChainStakeMirror.balanceOf(registeredCAddresses[0])).toNumber()).to.equals(0);
      expect((await pChainStakeMirror.votePowerOf(nodeId1)).toNumber()).to.equals(0);
    });

    it("Should revoke stake and mirror it again", async () => {
      const endTime = now.addn(100);
      let data = await setMockStakingData(verifierMock, pChainVerifier, stake1Id, 0, registeredPAddresses[0], nodeId1, now.subn(10), endTime, weightGwei1);
      const txHash = ethers.utils.keccak256(ethers.utils.defaultAbiCoder.encode(["bytes32", "bytes20"], [stake1Id, registeredPAddresses[0]]));

      // mirror
      await pChainStakeMirror.mirrorStake(data, []);
      expect((await pChainStakeMirror.balanceOf(registeredCAddresses[0])).toNumber()).to.equals(weightGwei1 * GWEI);
      expect((await pChainStakeMirror.votePowerOf(nodeId1)).toNumber()).to.equals(weightGwei1 * GWEI);
      expect((await pChainStakeMirror.totalSupply()).toNumber()).to.equals(weightGwei1 * GWEI);
      expect((await pChainStakeMirror.totalVotePower()).toNumber()).to.equals(weightGwei1 * GWEI);
      expect(await pChainStakeMirror.endTimeToTransactionHashList(endTime, 0)).to.equals(txHash);
      compareArrays(await pChainStakeMirror.getTransactionHashList(endTime), [txHash]);

      // revoke
      await pChainStakeMirror.revokeStake(stake1Id, registeredPAddresses[0], endTime, 0, { from: accounts[0] });
      expect((await pChainStakeMirror.balanceOf(registeredCAddresses[0])).toNumber()).to.equals(0);
      expect((await pChainStakeMirror.votePowerOf(nodeId1)).toNumber()).to.equals(0);
      expect((await pChainStakeMirror.totalSupply()).toNumber()).to.equals(0);
      expect((await pChainStakeMirror.totalVotePower()).toNumber()).to.equals(0);
      await expectRevert.unspecified(pChainStakeMirror.endTimeToTransactionHashList(endTime, 0));
      compareArrays(await pChainStakeMirror.getTransactionHashList(endTime), []);

      // mirror again
      await pChainStakeMirror.mirrorStake(data, []);
      expect((await pChainStakeMirror.balanceOf(registeredCAddresses[0])).toNumber()).to.equals(weightGwei1 * GWEI);
      expect((await pChainStakeMirror.votePowerOf(nodeId1)).toNumber()).to.equals(weightGwei1 * GWEI);
      expect((await pChainStakeMirror.totalSupply()).toNumber()).to.equals(weightGwei1 * GWEI);
      expect((await pChainStakeMirror.totalVotePower()).toNumber()).to.equals(weightGwei1 * GWEI);
      expect(await pChainStakeMirror.endTimeToTransactionHashList(endTime, 0)).to.equals(txHash);
      compareArrays(await pChainStakeMirror.getTransactionHashList(endTime), [txHash]);
    });
  });

});