import { expectRevert } from "@openzeppelin/test-helpers";
import { MockContractInstance, PChainStakeMirrorMultiSigVotingInstance, PChainStakeMirrorVerifierInstance, PChainStakeMirrorVerifierMockInstance } from "../../../../typechain-truffle";
import { MerkleTree } from '../../../utils/MerkleTree';
import { toBN } from '../../../utils/test-helpers';
const getTestFile = require('../../../utils/constants').getTestFile;

const MockContract = artifacts.require("MockContract");
const PChainStakeMirrorVerifier = artifacts.require("PChainStakeMirrorVerifier");
const PChainStakeMirrorVerifierMock = artifacts.require("PChainStakeMirrorVerifierMock");
const PChainStakeMirrorMultiSigVoting = artifacts.require("PChainStakeMirrorMultiSigVoting");


type PChainStake = {
  txId: string,
  stakingType: number,
  inputAddress: string,
  nodeId: string,
  startTime: number,
  endTime: number,
  weight: number,
}

function pChainStakeToArray(pChainStake: PChainStake): any[] {
  return [
    pChainStake.txId,
    pChainStake.stakingType,
    pChainStake.inputAddress,
    pChainStake.nodeId,
    pChainStake.startTime,
    pChainStake.endTime,
    pChainStake.weight,
  ]
}

const pChainStakeAbi = ["bytes32", "uint8", "bytes20", "bytes20", "uint64", "uint64", "uint64",];

function generateDummyData(
  len: number,
  startTime: number = 1,
  endTime: number = 2,
  weight: number = 1000,
  txIdMaker: (i: number) => string = (i) => web3.utils.keccak256("..." + i + "..."),
  stakingType: number = 0,
  nodeIdMaker: (i: number) => string = (i) => `0x0123456789012345${(i % 100).toString().padStart(2, "0")}8901234567890123456789`,

  inputAddressMaker: (i: number) => string = (i) => `0x01234567890123${(i % 100).toString().padStart(2, "0")}678901234567890123456789`,
): PChainStake[] {
  const rtr: PChainStake[] = [];
  for (let i = 0; i < len; i++) {
    const data = {
      txId: txIdMaker(i),
      stakingType,
      inputAddress: inputAddressMaker(i),
      nodeId: nodeIdMaker(i),
      startTime,
      endTime,
      weight,
    };
    rtr.push(data);
  }
  return rtr;
}

let pChainStakeMirrorMultiSigVotingInterface: PChainStakeMirrorMultiSigVotingInstance;

async function setMockMerkleRoot(pChainStakeMirrorVoting: MockContractInstance, startTime: BN, round: BN, mockData: string) {
  const epochIdMethod = pChainStakeMirrorMultiSigVotingInterface.contract.methods.getEpochId(startTime).encodeABI();
  const merkleRootMethod = pChainStakeMirrorMultiSigVotingInterface.contract.methods.getMerkleRoot(round).encodeABI();

  await pChainStakeMirrorVoting.givenCalldataReturnUint(epochIdMethod, round);
  await pChainStakeMirrorVoting.givenCalldataReturn(merkleRootMethod, mockData);
}

function hashPChainStake(pChainStake: PChainStake) {
  return web3.utils.soliditySha3(
    web3.eth.abi.encodeParameters(
      pChainStakeAbi,
      pChainStakeToArray(pChainStake)
    )
  ) as string;
}

contract(`PChainStakeMirrorVerifier.sol; ${getTestFile(__filename)}; P-chain stake mirror verifier unit tests`, async accounts => {

  let pChainStakeMirrorVoting: MockContractInstance;
  let pChainStakeMirrorVerifier: PChainStakeMirrorVerifierInstance;

  before(async () => {
    pChainStakeMirrorMultiSigVotingInterface = await PChainStakeMirrorMultiSigVoting.new(accounts[0], 0, 10, 2, []);
  });

  beforeEach(async () => {

    pChainStakeMirrorVoting = await MockContract.new();

    pChainStakeMirrorVerifier = await PChainStakeMirrorVerifier.new(pChainStakeMirrorVoting.address, 1, 1000, 5, 5000);
  });

  describe("basic", async () => {
    it("Should revert providing invalid initial parameters", async () => {
      await expectRevert(PChainStakeMirrorVerifier.new(pChainStakeMirrorVoting.address, 1000, 100, 5, 5000), "durations invalid");
      await expectRevert(PChainStakeMirrorVerifier.new(pChainStakeMirrorVoting.address, 1, 1000, 5000, 500), "amounts invalid");
    });

    it("Should verify simple proof", async () => {
      const data = generateDummyData(50, 12345, 12348);
      const hashes = data.map(hashPChainStake);
      const tree = new MerkleTree(hashes);

      await setMockMerkleRoot(pChainStakeMirrorVoting, toBN(data[0].startTime), toBN(30), tree.root as string);
      function getIndex(hash: string) {
        return tree.sortedHashes.findIndex(h => h === hash);
      }
      for (let i = 0; i < data.length; i++) {
        const targetData = data[i];

        const index = getIndex(hashes[i]);
        const proof = tree.getProof(index) as string[];
        const result = await pChainStakeMirrorVerifier.verifyStake(
          targetData,
          proof
        );
        expect(result).to.equals(true);
      }
    });

    it("Should not verify wrong proof", async () => {
      const data = generateDummyData(51, 123456, 123458);
      const last = data[data.length - 1];
      const hashes = data.map(hashPChainStake);
      const tree = new MerkleTree(hashes.slice(0, hashes.length - 1));

      await setMockMerkleRoot(pChainStakeMirrorVoting, toBN(data[0].startTime), toBN(30), tree.root as string);
      function getIndex(hash: string) {
        return tree.sortedHashes.findIndex(h => h === hash);
      }
      for (let i = 1; i < data.length - 1; i++) {
        const index = getIndex(hashes[i]);
        const proof = tree.getProof(index) as string[];
        let result = await pChainStakeMirrorVerifier.verifyStake(
          data[0],
          proof
        );
        expect(result).to.equals(false);
        result = await pChainStakeMirrorVerifier.verifyStake(
          last,
          proof
        );
        expect(result).to.equals(false);
      }

      const proof = tree.getProof(getIndex(hashes[0])) as string[];
      const result = await pChainStakeMirrorVerifier.verifyStake(
        data[0],
        proof
      );
      expect(result).to.equals(true);
    });

    it("Should not verify invalid data", async () => {
      const startTime = 123456;
      const data: PChainStake[] = [];
      data.push(generateDummyData(1, startTime, 12345)[0]); // endTime < startTime
      data.push(generateDummyData(1, startTime, startTime)[0]); // stakeDuration < minDuration
      data.push(generateDummyData(1, startTime, startTime + 1001)[0]); // stakeDuration > maxDuration
      data.push(generateDummyData(1, startTime, startTime + 100, 2)[0]); // weight < minStakeAmount
      data.push(generateDummyData(1, startTime, startTime + 100, 5005)[0]); // weight > maxStakeAmount
      const hashes = data.map(hashPChainStake);
      const tree = new MerkleTree(hashes);

      await setMockMerkleRoot(pChainStakeMirrorVoting, toBN(startTime), toBN(30), tree.root as string);
      function getIndex(hash: string) {
        return tree.sortedHashes.findIndex(h => h === hash);
      }
      for (let i = 0; i < data.length; i++) {
        const targetData = data[i];

        const index = getIndex(hashes[i]);
        const proof = tree.getProof(index) as string[];
        const result = await pChainStakeMirrorVerifier.verifyStake(
          targetData,
          proof
        );
        expect(result).to.equals(false);
      }
    });

    it("Should not verify on wrong epoch id", async () => {
      const data = generateDummyData(51, 12345, 12348);
      const last = data[data.length - 1];
      const hashes = data.map(hashPChainStake);
      const tree = new MerkleTree(hashes.slice(0, hashes.length - 1));

      await setMockMerkleRoot(pChainStakeMirrorVoting, toBN(data[0].startTime), toBN(30), new MerkleTree(hashes).root as string);
      await setMockMerkleRoot(pChainStakeMirrorVoting, toBN(data[0].startTime + 50), toBN(31), tree.root as string);
      function getIndex(hash: string) {
        return tree.sortedHashes.findIndex(h => h === hash);
      }
      for (let i = 1; i < data.length - 1; i++) {
        const index = getIndex(hashes[i]);
        const proof = tree.getProof(index) as string[];
        let result = await pChainStakeMirrorVerifier.verifyStake(
          data[0],
          proof
        );
        expect(result).to.equals(false);
        result = await pChainStakeMirrorVerifier.verifyStake(
          last,
          proof
        );
        expect(result).to.equals(false);
      }
      await setMockMerkleRoot(pChainStakeMirrorVoting, toBN(data[0].startTime), toBN(30), tree.root as string);
      const proof = tree.getProof(getIndex(hashes[0])) as string[];
      const result = await pChainStakeMirrorVerifier.verifyStake(
        data[0],
        proof
      );
      expect(result).to.equals(true);
    });

  });
});

// Mock contract exposes internal methods
// The purpose of this tests is to make sure that there are no inconsistencies between the implementations of Merkle tree
// This ensures that failures in core unit tests won't be caused by the underlying implementation
contract(`PChainStakeMirrorVerifierMock.sol; ${getTestFile(__filename)}; P-chain stake mirror verifier unit tests to check consistency of implementations`, async accounts => {
  let pChainStakeMirrorVoting: MockContractInstance;
  let pChainStakeMirrorVerifier: PChainStakeMirrorVerifierMockInstance;

  beforeEach(async () => {
    pChainStakeMirrorVoting = await MockContract.new();
    pChainStakeMirrorVerifier = await PChainStakeMirrorVerifierMock.new(pChainStakeMirrorVoting.address, 1, 1000, 5, 5000);
  });

  describe("Basic sanity checks", async () => {
    it("Should correctly get Merkle root", async () => {
      const data = generateDummyData(10, 9876, 9878);

      const roots: string[] = [];
      for (let j = 1; j < 10; j++) {
        const tree = new MerkleTree(
          data.slice(0, j).map(hashPChainStake)
        )
        roots.push(tree.root as string);
        await setMockMerkleRoot(pChainStakeMirrorVoting, toBN(data[0].startTime), toBN(j), tree.root as string);
      }

      for (let j = 1; j < 10; j++) {
        const root = await pChainStakeMirrorVerifier.merkleRootForEpochId(toBN(j));
        expect(root).to.equals(roots[j - 1]);
      }

      const rootSet: Set<string> = new Set(roots);
      expect(rootSet.size).to.equals(roots.length);

    });
    it("Should agree on hashing the struct", async () => {
      const data = generateDummyData(10);
      const hashes = data.map(hashPChainStake);

      for (let i = 0; i < data.length; i++) {
        const hash = await pChainStakeMirrorVerifier.hashPChainStaking(data[i]);
        expect(hash).to.equals(hashes[i]);
      }

      // Hashes should be different
      const hashSet: Set<string> = new Set(hashes);
      expect(hashSet.size).to.equals(data.length);
    });
  });
});