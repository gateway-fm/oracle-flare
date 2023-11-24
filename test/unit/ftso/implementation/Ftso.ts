import { constants, expectEvent, expectRevert, time } from '@openzeppelin/test-helpers';
import { MockContract } from '../../../../typechain';
import { MockContractContract, MockContractInstance, MockFtsoInstance, VPTokenContract, VPTokenInstance, WNatContract, WNatInstance } from "../../../../typechain-truffle";
import { defaultPriceEpochCyclicBufferSize, getTestFile } from "../../../utils/constants";
import { moveFromCurrentToNextEpochStart } from "../../../utils/FTSO-test-utils";
import { compareArrays, compareNumberArrays, increaseTimeTo, isAddressEligible, submitPriceHash, toBigNumber, toBN } from "../../../utils/test-helpers";
import { setDefaultVPContract } from "../../../utils/token-test-helpers";
import { ethers } from "hardhat";


const Wnat = artifacts.require("WNat") as WNatContract;
const MockWnat = artifacts.require("MockContract") as MockContractContract;
const VpToken = artifacts.require("VPToken") as VPTokenContract;
const MockVpToken = artifacts.require("MockContract") as MockContractContract;
const MockPriceSubmitter = artifacts.require("MockContract") as MockContractContract;
const MockFtsoFull = artifacts.require("MockFtso");
const MockFtso = artifacts.require("MockContract") as MockContractContract;
const Mock = artifacts.require("MockContract");

const getRandom = web3.utils.sha3("getRandom(uint256)")!.slice(0, 10); // first 4 bytes is function selector

// contains a fresh contract for each test 
let wnatInterface: WNatInstance;
let mockWnat: MockContractInstance;
let vpTokenInterface: VPTokenInstance;
let mockVpToken: MockContractInstance;
let mockPriceSubmitter: MockContractInstance;
let ftso: MockFtsoInstance;
let epochId: number;

// multi faseet ftsos
let mockFtsos: MockContractInstance[];
let mockVpTokens: MockContractInstance[];

// WARNING: using givenMethodReturn instead of givenCalldataReturn may cause problems
// there was a bug in FTSO.natVotePowerCached which used wrong votePowerBlock, but all tests pass before the change
async function setMockVotePowerAt(blockNumber: number, wnatVotePower: number, assetVotePower: number) {
  const votePowerAtCached_wnat = wnatInterface.contract.methods.totalVotePowerAtCached(blockNumber).encodeABI();
  const votePowerAtCachedReturn_wnat = web3.eth.abi.encodeParameter('uint256', wnatVotePower);
  await mockWnat.givenCalldataReturn(votePowerAtCached_wnat, votePowerAtCachedReturn_wnat);

  const votePowerAtCached_vpToken = vpTokenInterface.contract.methods.totalVotePowerAtCached(blockNumber).encodeABI();
  const votePowerAtCachedReturn_vpToken = web3.eth.abi.encodeParameter('uint256', assetVotePower);
  await mockVpToken.givenCalldataReturn(votePowerAtCached_vpToken, votePowerAtCachedReturn_vpToken);
}

async function setMockVotePowerOfAt(blockNumber: number, wnatVotePower: number, assetVotePower: number, address: string) {
  const votePowerOfAtCached_wnat = wnatInterface.contract.methods.votePowerOfAtCached(address, blockNumber).encodeABI();
  const votePowerOfAtCachedReturn_wnat = web3.eth.abi.encodeParameter('uint256', wnatVotePower);
  await mockWnat.givenCalldataReturn(votePowerOfAtCached_wnat, votePowerOfAtCachedReturn_wnat);
  const votePowerOfAtCached_vpToken = vpTokenInterface.contract.methods.votePowerOfAtCached(address, blockNumber).encodeABI();
  const votePowerOfAtCachedReturn_vpToken = web3.eth.abi.encodeParameter('uint256', assetVotePower);
  await mockVpToken.givenCalldataReturn(votePowerOfAtCached_vpToken, votePowerOfAtCachedReturn_vpToken);
}

async function setMockVotePowerAtMultiple(blockNumber: number, wnatVotePower: number, assetVotePowers: number[], currentPrices: number[]) {
  const len = assetVotePowers.length;
  assert(len == mockFtsos.length, "Xasset vote powers length does not match mock Ftso contracts length");
  assert(len == mockVpTokens.length, "Xasset vote powers length does not match mock VPToken contracts length");
  assert(len == currentPrices.length, "Xasset vote powers length does not match current prices length");
  const votePowerAtCached_wnat = wnatInterface.contract.methods.totalVotePowerAtCached(blockNumber).encodeABI();
  const votePowerAtCachedReturn_wnat = web3.eth.abi.encodeParameter('uint256', wnatVotePower);
  await mockWnat.givenCalldataReturn(votePowerAtCached_wnat, votePowerAtCachedReturn_wnat);

  for (let i = 0; i < len; i++) {
    const votePowerAtCached_vpToken = vpTokenInterface.contract.methods.totalVotePowerAtCached(blockNumber).encodeABI();
    const votePowerAtCachedReturn_vpToken = web3.eth.abi.encodeParameter('uint256', assetVotePowers[i]);
    await mockVpTokens[i].givenCalldataReturn(votePowerAtCached_vpToken, votePowerAtCachedReturn_vpToken);

    const asset_ftso = ftso.contract.methods.getAsset().encodeABI();
    const assetReturn_ftso = web3.eth.abi.encodeParameter('address', mockVpTokens[i].address);
    await mockFtsos[i].givenCalldataReturn(asset_ftso, assetReturn_ftso);

    const currentPrice_ftso = ftso.contract.methods.getCurrentPrice().encodeABI();
    const currentPriceReturn_ftso = web3.eth.abi.encodeParameters(['uint256', 'uint256'], [currentPrices[i], 1]);
    await mockFtsos[i].givenCalldataReturn(currentPrice_ftso, currentPriceReturn_ftso);
  }
}

async function setMockVotePowerOfAtMultiple(blockNumber: number, wnatVotePower: number, assetVotePowers: number[], address: string) {
  const len = assetVotePowers.length;
  assert(len == mockVpTokens.length, "Xasset vote powers length does not match mock VPToken contracts length");
  const votePowerOfAtCached_wnat = wnatInterface.contract.methods.votePowerOfAtCached(address, blockNumber).encodeABI();
  const votePowerOfAtCachedReturn_wnat = web3.eth.abi.encodeParameter('uint256', wnatVotePower);
  await mockWnat.givenCalldataReturn(votePowerOfAtCached_wnat, votePowerOfAtCachedReturn_wnat);
  for (let i = 0; i < len; i++) {
    const votePowerOfAtCached_vpToken = vpTokenInterface.contract.methods.votePowerOfAtCached(address, blockNumber).encodeABI();
    const votePowerOfAtCachedReturn_vpToken = web3.eth.abi.encodeParameter('uint256', assetVotePowers[i]);
    await mockVpTokens[i].givenCalldataReturn(votePowerOfAtCached_vpToken, votePowerOfAtCachedReturn_vpToken);
  }
}

// function getFtsoRandom(randoms: number[] , prices: number[]): BN {
//   let rand: BN = toBN(0);
//   for (let i = 0; i < randoms.length; i++) {
//     console.log("r", rand);
//     rand = rand.add(web3.utils.toBN(ethers.utils.keccak256(ethers.utils.defaultAbiCoder.encode([ "uint256", "uint256[]" ], [randoms[i], [prices[i]]]))));
//   }
//   return rand;
// }

contract(`Ftso.sol; ${getTestFile(__filename)}; Ftso unit tests`, async accounts => {

  describe("initialize and configure", async () => {
    beforeEach(async () => {
      wnatInterface = await Wnat.new(accounts[0], "Wrapped NAT", "WNAT");
      await setDefaultVPContract(wnatInterface, accounts[0]);
      mockWnat = await MockWnat.new();
      vpTokenInterface = await VpToken.new(accounts[0], "A token", "ATOK");
      mockVpToken = await MockVpToken.new();
      ftso = await MockFtsoFull.new(
        "ATOK",
        5,
        accounts[4],
        mockWnat.address,
        accounts[10],
        0, 120, 60,
        1, // initial token price 0.00001$
        1e10,
        defaultPriceEpochCyclicBufferSize,
        false
      );
      let timestamp = await time.latest();
      epochId = Math.floor(timestamp.toNumber() / 120) + 1;
    });

    it("Should activate ftso", async () => {
      await ftso.activateFtso(0, 120, 60, { from: accounts[10] });
      let hash = submitPriceHash(500, 123, accounts[1]);
      let epochId = await ftso.getCurrentEpochId();
      expectEvent(await ftso.submitPriceHash(epochId, hash, { from: accounts[1] }), "PriceHashSubmitted");
    });

    it("Should not activate ftso if not ftso manager", async () => {
      await expectRevert(ftso.activateFtso(0, 120, 60, { from: accounts[1] }), "Access denied");
      let hash = submitPriceHash(500, 123, accounts[1]);
      await expectRevert(ftso.submitPriceHash(epochId, hash, { from: accounts[1] }), "FTSO not active");
    });

    it("Should know about PriceSubmitter", async () => {
      expect(await ftso.priceSubmitter()).to.equals(accounts[4]);
    });

    it("Should not activate ftso if already activated", async () => {
      await ftso.activateFtso(0, 120, 60, { from: accounts[10] });
      await expectRevert(ftso.activateFtso(0, 120, 60, { from: accounts[10] }), "FTSO already activated");
      await expectRevert(ftso.activateFtso(0, 120, 60, { from: accounts[1] }), "Access denied");
    });

    it("Should not activate ftso with wrong parameters", async () => {
      await expectRevert(ftso.activateFtso(10, 120, 60, { from: accounts[10] }), "Invalid price epoch parameters");
      await expectRevert(ftso.activateFtso(0, 100, 60, { from: accounts[10] }), "Invalid price epoch parameters");
      await expectRevert(ftso.activateFtso(0, 120, 50, { from: accounts[10] }), "Invalid price epoch parameters");
    });

    it("Should deactivate ftso", async () => {
      await ftso.activateFtso(0, 120, 60, { from: accounts[10] });
      expect(await ftso.active()).to.be.true;
      await ftso.deactivateFtso({ from: accounts[10] });
      expect(await ftso.active()).to.be.false;
    });

    it("Should not deactivate ftso if not ftso manager", async () => {
      await ftso.activateFtso(0, 120, 60, { from: accounts[10] });
      expect(await ftso.active()).to.be.true;
      await expectRevert(ftso.deactivateFtso({ from: accounts[1] }), "Access denied");
      expect(await ftso.active()).to.be.true;
    });

    it("Should not deactivate ftso if already deactivated", async () => {
      await expectRevert(ftso.deactivateFtso({ from: accounts[10] }), "FTSO not active");
      await expectRevert(ftso.deactivateFtso({ from: accounts[1] }), "FTSO not active");
    });

    it("Should update initial price", async () => {
      await ftso.updateInitialPrice(900, 5000, { from: accounts[10] });
      await ftso.activateFtso(0, 120, 60, { from: accounts[10] });
      let data = await ftso.getCurrentPrice();
      expect(data[0].toNumber()).to.equals(900);
      expect(data[1].toNumber()).to.equals(5000);
    });

    it("Should not update initial price if not ftso manager", async () => {
      await expectRevert(ftso.updateInitialPrice(500, 8000, { from: accounts[1] }), "Access denied");
    });

    it("Should not update initial price if already activated", async () => {
      await ftso.activateFtso(0, 120, 60, { from: accounts[10] });
      await expectRevert(ftso.updateInitialPrice(900, 3000, { from: accounts[10] }), "FTSO already activated");
      expect((await ftso.getCurrentPrice())[0].toNumber()).to.equals(1);
    });

    it("Should revert at submit price if not activated", async () => {
      let hash = submitPriceHash(500, 123, accounts[1]);
      await expectRevert(ftso.submitPriceHash(epochId, hash, { from: accounts[1] }), "FTSO not active");
    });

    it("Should revert at reveal price if not activated", async () => {
      await expectRevert(ftso.revealPrice(1, 500, 123, { from: accounts[1] }), "FTSO not active");
      await expectRevert(ftso.revealPriceSubmitter(accounts[0], 1, 500, 123, { from: accounts[4] }), "FTSO not active");
    });

    it("Should configure epochs", async () => {
      await ftso.configureEpochs(20, 30, 400, 800, 500, 500, 0, 0, [], { from: accounts[10] });
    });

    it("Should not configure epochs ftso if not ftso manager", async () => {
      await expectRevert(ftso.configureEpochs(20, 20, 200, 800, 500, 500, 0, 0, [], { from: accounts[1] }), "Access denied");
    });

    it("Should set vote power block", async () => {
      await ftso.setVotePowerBlock(20, { from: accounts[10] });
    });

    it("Should not set vote power block if not ftso manager", async () => {
      await expectRevert(ftso.setVotePowerBlock(20, { from: accounts[1] }), "Access denied");
    });

    it("Should set asset", async () => {
      await ftso.setAsset(mockVpToken.address, { from: accounts[10] });
      expect(await ftso.assetFtsos(0)).to.equals(ftso.address);
      await expectRevert.unspecified(ftso.assetFtsos(1));
      expect(await ftso.assets(0)).to.equals(mockVpToken.address);
      await expectRevert.unspecified(ftso.assets(1));
    });

    it("Should not set asset if not ftso manager", async () => {
      await expectRevert(ftso.setAsset(mockVpToken.address, { from: accounts[1] }), "Access denied");
    });

    it("Should not get asset ftsos if not multi asset ftsos", async () => {
      await ftso.setAsset(mockVpToken.address, { from: accounts[10] });
      let addresses: string[] = await ftso.getAssetFtsos();
      expect(addresses.length).to.equals(0);
    });

    it("Should revert it vote power block is in the future", async () => {
      let tx = ftso.setVotePowerBlock(10000, { from: accounts[10] });
      await expectRevert.unspecified(tx);
    });

    it("Should return current random 0", async() => {
      let now = (await time.latest()).toNumber();
      let ftso1 = await MockFtsoFull.new(
        "ATOK",
        5,
        accounts[4],
        mockWnat.address,
        accounts[10],
        now + 10000, 120, 60,
        1, // initial token price 0.00001$
        1e10,
        defaultPriceEpochCyclicBufferSize,
        false
      );
      expect((await ftso1.getCurrentRandom()).toString()).to.equals("0");
    });

  });

  describe("epoch testing", async () => {
    beforeEach(async () => {
      mockWnat = await MockWnat.new();
      ftso = await MockFtsoFull.new(
        "ATOK",
        5,
        accounts[4],
        mockWnat.address,
        accounts[10],
        5, 120, 60,
        1, // initial token price 0.00001$
        1e10,
        defaultPriceEpochCyclicBufferSize,
        false
      );
    });

    it("Should return correct epochId", async () => {
      const epochId = await ftso.getEpochId(124);
      expect(epochId.toNumber()).to.equals(0);
      const epochId1 = await ftso.getEpochId(125);
      expect(epochId1.toNumber()).to.equals(1);
      const epochId2 = await ftso.getEpochId(126);
      expect(epochId2.toNumber()).to.equals(1);
      const epochId3 = await ftso.getEpochId(244);
      expect(epochId3.toNumber()).to.equals(1);
      const epochId4 = await ftso.getEpochId(245);
      expect(epochId4.toNumber()).to.equals(2);
    });

    it("Should return correct epoch submit start time, submit end time and reveal end time", async () => {
      const epochTimes = await ftso.getEpochTimes(0);
      const epochTimes1 = await ftso.getEpochTimes(1);
      const epochTimes2 = await ftso.getEpochTimes(2);
      const epochTimes3 = await ftso.getEpochTimes(10);
      const epochTimes4 = await ftso.getEpochTimes(500);
      // epoch submit start time
      expect(epochTimes[0].toNumber()).to.equals(5);
      expect(epochTimes1[0].toNumber()).to.equals(125);
      expect(epochTimes2[0].toNumber()).to.equals(245);
      expect(epochTimes3[0].toNumber()).to.equals(1205);
      expect(epochTimes4[0].toNumber()).to.equals(60005);
      // epoch submit end time
      expect(epochTimes[1].toNumber()).to.equals(125);
      expect(epochTimes1[1].toNumber()).to.equals(245);
      expect(epochTimes2[1].toNumber()).to.equals(365);
      expect(epochTimes3[1].toNumber()).to.equals(1325);
      expect(epochTimes4[1].toNumber()).to.equals(60125);
      // epoch reveal end time
      expect(epochTimes[2].toNumber()).to.equals(185);
      expect(epochTimes1[2].toNumber()).to.equals(305);
      expect(epochTimes2[2].toNumber()).to.equals(425);
      expect(epochTimes3[2].toNumber()).to.equals(1385);
      expect(epochTimes4[2].toNumber()).to.equals(60185);
  });

    it("Should return epoch reveal in process correctly", async () => {
      const revealInProcess = await ftso.epochRevealInProcess(10);
      expect(revealInProcess).to.equals(false);

      const epochId = await moveFromCurrentToNextEpochStart(5, 120, 1);
      const revealInProcess1 = await ftso.epochRevealInProcess(epochId - 1);
      expect(revealInProcess1).to.equals(true);
      const revealInProcess2 = await ftso.epochRevealInProcess(epochId);
      expect(revealInProcess2).to.equals(false);

      await increaseTimeTo(5 + epochId * 120 + 59);
      const revealInProcess3 = await ftso.epochRevealInProcess(epochId - 1);
      expect(revealInProcess3).to.equals(true);

      await increaseTimeTo(5 + epochId * 120 + 60);
      const revealInProcess4 = await ftso.epochRevealInProcess(epochId - 1);
      expect(revealInProcess4).to.equals(false);

      await increaseTimeTo(5 + (epochId + 1) * 120 - 1);
      const revealInProcess5 = await ftso.epochRevealInProcess(epochId);
      expect(revealInProcess5).to.equals(false);

      await increaseTimeTo(5 + (epochId + 1) * 120);
      const revealInProcess6 = await ftso.epochRevealInProcess(epochId);
      expect(revealInProcess6).to.equals(true);
    });
  });

  describe("min/max vote power threshold", async () => {
    beforeEach(async () => {
      wnatInterface = await Wnat.new(accounts[0], "Wrapped NAT", "WNAT");
      mockWnat = await MockWnat.new();
      vpTokenInterface = await VpToken.new(accounts[0], "A token", "ATOK");
      mockVpToken = await MockVpToken.new();
      ftso = await MockFtsoFull.new(
        "ATOK",
        5,
        accounts[4],
        mockWnat.address,
        accounts[10],
        0, 120, 60,
        1, // initial token price 0.00001$
        1e10,
        defaultPriceEpochCyclicBufferSize,
        false
      );

      await ftso.setAsset(mockVpToken.address, { from: accounts[10] });
      // await ftso.configureEpochs(1, 1, 1000, 10000, 50, 500, 0, 0, [accounts[5], accounts[6], accounts[7]], {from: accounts[10]});
      await ftso.configureEpochs(50, 50, 1000, 10000, 50, 15, 0, 0, [], { from: accounts[10] });
      await ftso.setVotePowerBlock(10, { from: accounts[10] });
      await ftso.activateFtso(0, 120, 60, { from: accounts[10] });

      // Force a block in order to get most up to date time
      await time.advanceBlock();
      // Get the timestamp for the just mined block
      let timestamp = await time.latest();
      epochId = Math.floor(timestamp.toNumber() / 120) + 1;
      await increaseTimeTo(epochId * 120);
    });

    it("Should change vote power to allowed max threshold", async () => {
      // round 1 - current asset price = 0
      let hash = submitPriceHash(250, 123, accounts[1]);
      await ftso.submitPriceHash(epochId, hash, { from: accounts[1] });
      await setMockVotePowerAt(10, 100000, 1000000);
      await ftso.initializeCurrentEpochStateForReveal(100000, false, { from: accounts[10] });

      await increaseTimeTo((epochId + 1) * 120); // reveal period start
      await setMockVotePowerOfAt(10, 21000, 0, accounts[1]);
      await ftso.revealPrice(epochId, 250, 123, { from: accounts[1] });

      await increaseTimeTo((epochId + 1) * 120 + 60); // reveal period end
      expectEvent(await ftso.finalizePriceEpoch(epochId, false, { from: accounts[10] }), "PriceFinalized",
        { epochId: toBN(epochId), price: toBN(250), rewardedFtso: false, lowIQRRewardPrice: toBN(250), highIQRRewardPrice: toBN(250), finalizationType: toBN(1) });

      let votesDataNat = await ftso.getEpochVotes(epochId);
      expect(votesDataNat[0]).to.eqls([accounts[1]]);
      expect(votesDataNat[1]).to.eqls([toBN(250)]);
      expect(votesDataNat[2]).to.eqls([toBN(1000000000000)]);
      expect(votesDataNat[3]).to.eqls([toBN(20000000000)]);
      expect(votesDataNat[4]).to.eqls([toBN(0)]);
      expect(votesDataNat[5]).to.eqls([true]);

      // round 2 - current asset price = 250
      await ftso.configureEpochs(50, 50, 1000, 10000, 50, 15, 0, 0, [], { from: accounts[10] });
      await ftso.setVotePowerBlock(12, { from: accounts[10] });

      let hash1 = submitPriceHash(500, 123, accounts[1]);
      await ftso.submitPriceHash(epochId + 1, hash1, { from: accounts[1] });

      await setMockVotePowerAt(12, 100000, 1000000);
      await ftso.initializeCurrentEpochStateForReveal(100000, false, { from: accounts[10] });

      await increaseTimeTo((epochId + 2) * 120); // reveal period start
      await setMockVotePowerOfAt(12, 0, 21000, accounts[1]);
      await ftso.revealPrice(epochId + 1, 500, 123, { from: accounts[1] });

      let votesDataAsset = await ftso.getEpochVotes(epochId + 1);
      expect(votesDataAsset[0]).to.eqls([accounts[1]]);
      expect(votesDataAsset[1]).to.eqls([toBN(500)]);
      expect(votesDataAsset[2]).to.eqls([toBN(1000000000000)]);
      expect(votesDataAsset[3]).to.eqls([toBN(0)]);
      expect(votesDataAsset[4]).to.eqls([toBN(20000000000)]);
      expect(votesDataAsset[5]).to.eqls([false]);
    });
  })

  describe("submit and reveal price", async () => {
    beforeEach(async () => {
      wnatInterface = await Wnat.new(accounts[0], "Wrapped NAT", "WNAT");
      await setDefaultVPContract(wnatInterface, accounts[0]);
      mockWnat = await MockWnat.new();
      vpTokenInterface = await VpToken.new(accounts[0], "A token", "ATOK");
      mockVpToken = await MockVpToken.new();
      ftso = await MockFtsoFull.new(
        "ATOK",
        5,
        accounts[4],
        mockWnat.address,
        accounts[10],
        0, 120, 60,
        1, // initial token price 0.00001$
        1e10,
        defaultPriceEpochCyclicBufferSize,
        false
      );

      await ftso.setAsset(mockVpToken.address, { from: accounts[10] });
      await ftso.configureEpochs(1, 1, 1000, 10000, 50, 500, 0, 0, [accounts[5], accounts[6], accounts[7]], { from: accounts[10] });
      await ftso.setVotePowerBlock(10, { from: accounts[10] });
      await ftso.activateFtso(0, 120, 60, { from: accounts[10] });

      // Force a block in order to get most up to date time
      await time.advanceBlock();
      // Get the timestamp for the just mined block
      let timestamp = await time.latest();
      epochId = Math.floor(timestamp.toNumber() / 120) + 1;
      await increaseTimeTo(epochId * 120);
    });

    it("Should have asset with zero address", async() => {
      let ftso2 = await MockFtsoFull.new(
        "BTOK",
        5,
        accounts[4],
        mockWnat.address,
        accounts[10],
        5, 120, 60,
        1, // initial token price 0.00001$
        1e10,
        defaultPriceEpochCyclicBufferSize,
        false
      );

      await ftso2.setAsset(mockVpToken.address, { from: accounts[10] });
      await ftso.setAssetFtsos([ftso2.address], { from: accounts[10] });

      let ftso3 = await MockFtsoFull.new(
        "CTOK",
        5,
        accounts[4],
        mockWnat.address,
        accounts[10],
        5, 120, 60,
        1, // initial token price 0.00001$
        1e10,
        defaultPriceEpochCyclicBufferSize,
        false
      );

      await ftso2.setAssetFtsos([ftso3.address], { from: accounts[10] });

      await ftso.initializeCurrentEpochStateForReveal(100000, false, { from: accounts[10] });   
    });

    it("Should submit price", async () => {
      let hash = submitPriceHash(500, 123, accounts[1]);
      expectEvent(await ftso.submitPriceHash(epochId, hash, { from: accounts[1] }), "PriceHashSubmitted", { submitter: accounts[1], epochId: toBN(epochId), hash: hash });
    });

    it("Should revert price submission on double submission", async () => {
      let hash = submitPriceHash(500, 123, accounts[1]);
      await ftso.submitPriceHash(epochId, hash, { from: accounts[1] })
      await expectRevert(ftso.submitPriceHash(epochId, hash, { from: accounts[1] }), "Duplicate submit in epoch");
    });

    it("Should revert price submission on wrong epoch id", async () => {
      let hash = submitPriceHash(500, 123, accounts[1]);
      await expectRevert(ftso.submitPriceHash(epochId + 1, hash, { from: accounts[1] }), "Wrong epoch id");
      await expectRevert(ftso.submitPriceHash(epochId - 1, hash, { from: accounts[1] }), "Wrong epoch id");
    });

    it("Should submit price multiple times - different users", async () => {
      let hash1 = submitPriceHash(500, 123, accounts[1]);
      expectEvent(await ftso.submitPriceHash(epochId, hash1, { from: accounts[1] }), "PriceHashSubmitted", { submitter: accounts[1], epochId: toBN(epochId), hash: hash1 });

      let hash2 = submitPriceHash(250, 124, accounts[1]);
      expectEvent(await ftso.submitPriceHash(epochId, hash2, { from: accounts[2] }), "PriceHashSubmitted", { submitter: accounts[2], epochId: toBN(epochId), hash: hash2 });

      let hash3 = submitPriceHash(400, 125, accounts[1]);
      expectEvent(await ftso.submitPriceHash(epochId, hash3, { from: accounts[3] }), "PriceHashSubmitted", { submitter: accounts[3], epochId: toBN(epochId), hash: hash3 });
    });

    it("Should initialize epoch state for reveal", async () => {
      await ftso.initializeCurrentEpochStateForReveal(100000, false, { from: accounts[10] });
    });

    it("Should not initialize epoch state for reveal if not ftso manager", async () => {
      await expectRevert(ftso.initializeCurrentEpochStateForReveal(100000, false, { from: accounts[1] }), "Access denied");
    });

    it("Should reveal price", async () => {
      let hash = submitPriceHash(500, 123, accounts[1]);
      expectEvent(await ftso.submitPriceHash(epochId, hash, { from: accounts[1] }), "PriceHashSubmitted", { submitter: accounts[1], epochId: toBN(epochId), hash: hash });
      await ftso.initializeCurrentEpochStateForReveal(100000, false, { from: accounts[10] });
      await increaseTimeTo((epochId + 1) * 120); // reveal period start
      await setMockVotePowerOfAt(10, 10, 0, accounts[1]);  // vote power of 0 is not allowed
      expectEvent(await ftso.revealPrice(epochId, 500, 123, { from: accounts[1] }), "PriceRevealed", { voter: accounts[1], epochId: toBN(epochId), price: toBN(500) });
    });

    it("Should reveal price - different users", async () => {
      let hash1 = submitPriceHash(500, 123, accounts[1]);
      expectEvent(await ftso.submitPriceHash(epochId, hash1, { from: accounts[1] }), "PriceHashSubmitted", { submitter: accounts[1], epochId: toBN(epochId), hash: hash1 });
      let hash2 = submitPriceHash(250, 124, accounts[2]);
      expectEvent(await ftso.submitPriceHash(epochId, hash2, { from: accounts[2] }), "PriceHashSubmitted", { submitter: accounts[2], epochId: toBN(epochId), hash: hash2 });
      let hash3 = submitPriceHash(400, 125, accounts[3]);
      expectEvent(await ftso.submitPriceHash(epochId, hash3, { from: accounts[3] }), "PriceHashSubmitted", { submitter: accounts[3], epochId: toBN(epochId), hash: hash3 });
      await ftso.initializeCurrentEpochStateForReveal(100000, false, { from: accounts[10] });
      await increaseTimeTo((epochId + 1) * 120); // reveal period start
      await setMockVotePowerOfAt(10, 10, 0, accounts[1]);  // vote power of 0 is not allowed
      expectEvent(await ftso.revealPrice(epochId, 500, 123, { from: accounts[1] }), "PriceRevealed", { voter: accounts[1], epochId: toBN(epochId), price: toBN(500) });
      await setMockVotePowerOfAt(10, 10, 0, accounts[2]);  // vote power of 0 is not allowed
      expectEvent(await ftso.revealPrice(epochId, 250, 124, { from: accounts[2] }), "PriceRevealed", { voter: accounts[2], epochId: toBN(epochId), price: toBN(250) });
      await setMockVotePowerOfAt(10, 10, 0, accounts[3]);  // vote power of 0 is not allowed
      expectEvent(await ftso.revealPrice(epochId, 400, 125, { from: accounts[3] }), "PriceRevealed", { voter: accounts[3], epochId: toBN(epochId), price: toBN(400) });
    });

    it("Should reveal price (submitter)", async () => {
      await ftso.initializeCurrentEpochStateForReveal(100000, false, { from: accounts[10] });
      await increaseTimeTo((epochId + 1) * 120); // reveal period start
      await setMockVotePowerOfAt(10, 10, 0, accounts[1]);  // vote power of 0 is not allowed
      expectEvent(await ftso.revealPriceSubmitter(accounts[1], epochId, 500, 123, { from: accounts[4] }), "PriceRevealed", { voter: accounts[1], epochId: toBN(epochId), price: toBN(500) });
    });

    it("Should not reveal price (submitter) if not from submitter", async () => {
      await ftso.initializeCurrentEpochStateForReveal(100000, false, { from: accounts[10] });
      await increaseTimeTo((epochId + 1) * 120); // reveal period start
      await setMockVotePowerOfAt(10, 10, 0, accounts[1]);  // vote power of 0 is not allowed
      await expectRevert(ftso.revealPriceSubmitter(accounts[1], epochId, 500, 123, { from: accounts[1] }), "Access denied");
    });

    it("Should reveal prices from trusted addresses for epoch in fallback mode", async () => {
      await ftso.submitPriceHash(epochId, submitPriceHash(500, 123, accounts[1]), { from: accounts[1] });
      await ftso.submitPriceHash(epochId, submitPriceHash(250, 124, accounts[2]), { from: accounts[2] });
      await ftso.submitPriceHash(epochId, submitPriceHash(400, 125, accounts[6]), { from: accounts[6] });
      await ftso.submitPriceHash(epochId, submitPriceHash(500, 126, accounts[7]), { from: accounts[7] });

      await setMockVotePowerAt(10, 50000, 1000000);
      await ftso.initializeCurrentEpochStateForReveal(50000, true, { from: accounts[10] });

      await increaseTimeTo((epochId + 1) * 120); // reveal period start
      await setMockVotePowerOfAt(10, 10, 10000, accounts[1]);
      await expectRevert(ftso.revealPrice(epochId, 500, 123, { from: accounts[1] }), "Epoch not initialized for reveal");
      await setMockVotePowerOfAt(10, 30, 0, accounts[2]);
      await expectRevert(ftso.revealPrice(epochId, 250, 124, { from: accounts[2] }), "Epoch not initialized for reveal");
      await setMockVotePowerOfAt(10, 20, 50000, accounts[6]);
      await ftso.revealPrice(epochId, 400, 125, { from: accounts[6] });
      await setMockVotePowerOfAt(10, 5, 50000, accounts[7]);
      await ftso.revealPrice(epochId, 500, 126, { from: accounts[7] });
    });

    it("Should not reveal price before submit period is over", async () => {
      let hash = submitPriceHash(500, 123, accounts[1]);
      await ftso.submitPriceHash(epochId, hash, { from: accounts[1] });
      await ftso.initializeCurrentEpochStateForReveal(50000, false, { from: accounts[10] });
      await increaseTimeTo((epochId + 1) * 120 - 2);
      await expectRevert(ftso.revealPrice(epochId, 500, 123, { from: accounts[1] }), "Reveal period not active");
    });

    it("Should not reveal price after reveal period is over", async () => {
      let hash = submitPriceHash(500, 123, accounts[1]);
      await ftso.submitPriceHash(epochId, hash, { from: accounts[1] });
      await ftso.initializeCurrentEpochStateForReveal(50000, false, { from: accounts[10] });
      await increaseTimeTo((epochId + 1) * 120 + 60 - 1);
      await expectRevert(ftso.revealPrice(epochId, 500, 123, { from: accounts[1] }), "Reveal period not active");
    });

    it("Should not reveal price twice", async () => {
      let hash = submitPriceHash(500, 123, accounts[1]);
      await ftso.submitPriceHash(epochId, hash, { from: accounts[1] });
      await ftso.initializeCurrentEpochStateForReveal(50000, false, { from: accounts[10] });
      await increaseTimeTo((epochId + 1) * 120); // reveal period start
      await setMockVotePowerOfAt(10, 10, 0, accounts[1]);  // vote power of 0 is not allowed
      expectEvent(await ftso.revealPrice(epochId, 500, 123, { from: accounts[1] }), "PriceRevealed", { voter: accounts[1], epochId: toBN(epochId), price: toBN(500) });
      await expectRevert(ftso.revealPrice(epochId, 500, 123, { from: accounts[1] }), "Price already revealed or not valid");
    });

    it("Should not reveal price if epoch is not initialized", async () => {
      let hash = submitPriceHash(500, 123, accounts[1]);
      await ftso.submitPriceHash(epochId, hash, { from: accounts[1] });
      await increaseTimeTo((epochId + 1) * 120); // reveal period start
      await expectRevert(ftso.revealPrice(epochId, 500, 123, { from: accounts[1] }), "Epoch data not available");
    });

    it("Should not reveal price if submit price was not called", async () => {
      await ftso.initializeCurrentEpochStateForReveal(50000, false, { from: accounts[10] });
      await increaseTimeTo((epochId + 1) * 120); // reveal period start
      await expectRevert(ftso.revealPrice(epochId, 500, 123, { from: accounts[1] }), "Price already revealed or not valid");
    });

    it("Should not reveal price if hash and price+random do not match", async () => {
      let hash = submitPriceHash(500, 123, accounts[1]);
      await ftso.submitPriceHash(epochId, hash, { from: accounts[1] });
      await ftso.initializeCurrentEpochStateForReveal(50000, false, { from: accounts[10] });
      await increaseTimeTo((epochId + 1) * 120); // reveal period start
      await expectRevert(ftso.revealPrice(epochId, 500, 125, { from: accounts[1] }), "Price already revealed or not valid");
    });

    it("Should not reveal price if price is too high", async () => {
      let price = toBN(2).pow(toBN(128));
      let hash = submitPriceHash(price, 123, accounts[1]);
      await ftso.submitPriceHash(epochId, hash, { from: accounts[1] });
      await ftso.initializeCurrentEpochStateForReveal(50000, false, { from: accounts[10] });
      await increaseTimeTo((epochId + 1) * 120); // reveal period start
      await expectRevert(ftso.revealPrice(epochId, price, 123, { from: accounts[1] }), "Price too high");
    });

    it("Should reduce vote power to max vote power threshold", async () => {
      // round 1 - current asset price = 0
      await ftso.submitPriceHash(epochId, submitPriceHash(500, 123, accounts[1]), { from: accounts[1] });
      await ftso.submitPriceHash(epochId, submitPriceHash(250, 124, accounts[2]), { from: accounts[2] });
      await ftso.submitPriceHash(epochId, submitPriceHash(400, 125, accounts[3]), { from: accounts[3] });

      await setMockVotePowerAt(10, 50000, 1000000);
      await ftso.initializeCurrentEpochStateForReveal(50000, false, { from: accounts[10] });

      await increaseTimeTo((epochId + 1) * 120); // reveal period start
      await setMockVotePowerOfAt(10, 1000, 100, accounts[1]);
      await ftso.revealPrice(epochId, 500, 123, { from: accounts[1] });
      await setMockVotePowerOfAt(10, 5000, 0, accounts[2]);
      await ftso.revealPrice(epochId, 250, 124, { from: accounts[2] });
      await setMockVotePowerOfAt(10, 0, 500, accounts[3]);
      await ftso.revealPrice(epochId, 400, 125, { from: accounts[3] });

      await increaseTimeTo((epochId + 1) * 120 + 60); // reveal period end
      expectEvent(await ftso.finalizePriceEpoch(epochId, false, { from: accounts[10] }), "PriceFinalized",
        { epochId: toBN(epochId), price: toBN(250), rewardedFtso: false, lowIQRRewardPrice: toBN(250), highIQRRewardPrice: toBN(250), finalizationType: toBN(1) });

      // round 2 - current asset price = 250
      await ftso.configureEpochs(5, 50, 1000, 10000, 50, 500, 0, 0, [], { from: accounts[10] });
      await ftso.setVotePowerBlock(12, { from: accounts[10] });

      await ftso.submitPriceHash(epochId + 1, submitPriceHash(500, 123, accounts[1]), { from: accounts[1] });
      await ftso.submitPriceHash(epochId + 1, submitPriceHash(250, 124, accounts[2]), { from: accounts[2] });
      await ftso.submitPriceHash(epochId + 1, submitPriceHash(400, 125, accounts[3]), { from: accounts[3] });

      await setMockVotePowerAt(12, 50000, 1000000);
      await ftso.initializeCurrentEpochStateForReveal(50000, false, { from: accounts[10] });

      //wnat - min 5000, max 10000, asset - min 10000, max 20000
      await increaseTimeTo((epochId + 2) * 120); // reveal period start
      await setMockVotePowerOfAt(12, 20000, 0, accounts[1]); // reduced to 10000/50000*1e12
      await ftso.revealPrice(epochId + 1, 500, 123, { from: accounts[1] });
      await setMockVotePowerOfAt(12, 7500, 15000, accounts[2]);
      await ftso.revealPrice(epochId + 1, 250, 124, { from: accounts[2] });
      await setMockVotePowerOfAt(12, 0, 30000, accounts[3]); // reduced to 20000/1000000*1e12
      await ftso.revealPrice(epochId + 1, 400, 125, { from: accounts[3] });

      // ok if enough vote power
      let votesData = await ftso.getEpochVotes(epochId + 1);
      expect(votesData[0]).to.eqls([accounts[1], accounts[2], accounts[3]]);
      expect(votesData[1]).to.eqls([toBN(500), toBN(250), toBN(400)]);
      expect(votesData[2]).to.eqls([toBN(285714285714), toBN(428571428570), toBN(285714285714)]);
      expect(votesData[3]).to.eqls([toBN(200000000000), toBN(150000000000), toBN(0)]);
      expect(votesData[4]).to.eqls([toBN(0), toBN(15000000000), toBN(20000000000)]);
      expect(votesData[5]).to.eqls([false, false, false]);
    });
  });

  describe("finalize price", async () => {

    beforeEach(async () => {
      wnatInterface = await Wnat.new(accounts[0], "Wrapped NAT", "WNAT");
      await setDefaultVPContract(wnatInterface, accounts[0]);
      mockWnat = await MockWnat.new();
      vpTokenInterface = await VpToken.new(accounts[0], "A token", "ATOK");
      mockVpToken = await MockVpToken.new();
      mockPriceSubmitter = await MockPriceSubmitter.new();
      ftso = await MockFtsoFull.new(
        "ATOK",
        5,
        mockPriceSubmitter.address,
        mockWnat.address,
        accounts[10],
        0, 120, 60,
        1, // initial token price 0.00001$
        10000, // price deviation threshold in BIPS (100%)
        defaultPriceEpochCyclicBufferSize,
        false
      );

      await ftso.setAsset(mockVpToken.address, { from: accounts[10] });
      await ftso.configureEpochs(1, 1, 1000, 10000, 50, 500, 0, 0, [accounts[5], accounts[6], accounts[7]], { from: accounts[10] });
      await ftso.setVotePowerBlock(10, { from: accounts[10] });
      await ftso.activateFtso(0, 120, 60, { from: accounts[10] });

      // Force a block in order to get most up to date time
      await time.advanceBlock();
      // Get the timestamp for the just mined block
      let timestamp = await time.latest();
      epochId = Math.floor(timestamp.toNumber() / 120) + 1;
      await increaseTimeTo(epochId * 120);
    });

    it("Should finalize price epoch - no votes", async () => {
      await ftso.initializeCurrentEpochStateForReveal(50000, false, { from: accounts[10] });
      await increaseTimeTo((epochId + 1) * 120 + 60); // reveal period end
      expectEvent(await ftso.finalizePriceEpoch(epochId, false, { from: accounts[10] }), "PriceFinalized",
        { epochId: toBN(epochId), price: toBN(1), rewardedFtso: false, lowIQRRewardPrice: toBN(0), highIQRRewardPrice: toBN(0), finalizationType: toBN(3) });

      await ftso.initializeCurrentEpochStateForReveal(50000, false, { from: accounts[10] });
      await increaseTimeTo((epochId + 2) * 120 + 60); // reveal period end
      expectEvent(await ftso.finalizePriceEpoch(epochId + 1, true, { from: accounts[10] }), "PriceFinalized",
        { epochId: toBN(epochId + 1), price: toBN(1), rewardedFtso: false, lowIQRRewardPrice: toBN(0), highIQRRewardPrice: toBN(0), finalizationType: toBN(3) });
    });

    it("Should not finalize more than once", async () => {
      await ftso.initializeCurrentEpochStateForReveal(50000, false, { from: accounts[10] });
      await increaseTimeTo((epochId + 1) * 120 + 60); // reveal period end
      expectEvent(await ftso.finalizePriceEpoch(epochId, false, { from: accounts[10] }), "PriceFinalized", { epochId: toBN(epochId), price: toBN(1), finalizationType: toBN(3) });
      await expectRevert(ftso.finalizePriceEpoch(epochId, false, { from: accounts[10] }), "Epoch already finalized");
      await expectRevert(ftso.fallbackFinalizePriceEpoch(epochId, { from: accounts[10] }), "Epoch already finalized");
      await expectRevert(ftso.forceFinalizePriceEpoch(epochId, { from: accounts[10] }), "Epoch already finalized");

      await ftso.initializeCurrentEpochStateForReveal(50000, false, { from: accounts[10] });
      await increaseTimeTo((epochId + 2) * 120 + 60); // reveal period end
      expectEvent(await ftso.finalizePriceEpoch(epochId + 1, true, { from: accounts[10] }), "PriceFinalized", { epochId: toBN(epochId + 1), price: toBN(1), finalizationType: toBN(3) });
    });

    it("Should finalize price epoch", async () => {
      await ftso.submitPriceHash(epochId, submitPriceHash(500, 123, accounts[1]), { from: accounts[1] });
      await ftso.submitPriceHash(epochId, submitPriceHash(250, 124, accounts[2]), { from: accounts[2] });
      await ftso.submitPriceHash(epochId, submitPriceHash(400, 125, accounts[3]), { from: accounts[3] });

      await setMockVotePowerAt(10, 50000, 1000000);
      await ftso.initializeCurrentEpochStateForReveal(50000, false, { from: accounts[10] });

      await increaseTimeTo((epochId + 1) * 120); // reveal period start
      await setMockVotePowerOfAt(10, 1000, 100, accounts[1]);
      await ftso.revealPrice(epochId, 500, 123, { from: accounts[1] });
      await setMockVotePowerOfAt(10, 5000, 0, accounts[2]);
      await ftso.revealPrice(epochId, 250, 124, { from: accounts[2] });
      await setMockVotePowerOfAt(10, 0, 500, accounts[3]);
      await ftso.revealPrice(epochId, 400, 125, { from: accounts[3] });

      await increaseTimeTo((epochId + 1) * 120 + 60); // reveal period end
      expectEvent(await ftso.finalizePriceEpoch(epochId, false, { from: accounts[10] }), "PriceFinalized",
        { epochId: toBN(epochId), price: toBN(250), rewardedFtso: false, lowIQRRewardPrice: toBN(250), highIQRRewardPrice: toBN(250), finalizationType: toBN(1) });
    });

    it("Should finalize price epoch - closestPriceFix test", async () => {
      await ftso.submitPriceHash(epochId, submitPriceHash(500, 123, accounts[1]), { from: accounts[1] });
      await ftso.submitPriceHash(epochId, submitPriceHash(250, 124, accounts[2]), { from: accounts[2] });
      await ftso.submitPriceHash(epochId, submitPriceHash(400, 125, accounts[3]), { from: accounts[3] });

      await setMockVotePowerAt(10, 3000, 1000000);
      await ftso.initializeCurrentEpochStateForReveal(3000, false, { from: accounts[10] });

      await increaseTimeTo((epochId + 1) * 120); // reveal period start
      await setMockVotePowerOfAt(10, 200, 10000, accounts[1]);
      await ftso.revealPrice(epochId, 500, 123, { from: accounts[1] });
      await setMockVotePowerOfAt(10, 200, 10000, accounts[3]);
      await ftso.revealPrice(epochId, 400, 125, { from: accounts[3] });

      await increaseTimeTo((epochId + 1) * 120 + 60); // reveal period end
      expectEvent(await ftso.finalizePriceEpoch(epochId, false, { from: accounts[10] }), "PriceFinalized",
        { epochId: toBN(epochId), price: toBN(450), rewardedFtso: false, lowIQRRewardPrice: toBN(400), highIQRRewardPrice: toBN(500), finalizationType: toBN(1) });
    });

    it("Should finalize price epoch - two epochs", async () => {
      // round 1 - current asset price = 0
      await ftso.submitPriceHash(epochId, submitPriceHash(500, 123, accounts[1]), { from: accounts[1] });
      await ftso.submitPriceHash(epochId, submitPriceHash(250, 124, accounts[2]), { from: accounts[2] });
      await ftso.submitPriceHash(epochId, submitPriceHash(400, 125, accounts[3]), { from: accounts[3] });

      await setMockVotePowerAt(10, 50000, 1000000);
      await ftso.initializeCurrentEpochStateForReveal(50000, false, { from: accounts[10] });

      await increaseTimeTo((epochId + 1) * 120); // reveal period start
      await setMockVotePowerOfAt(10, 1000, 100, accounts[1]);
      await ftso.revealPrice(epochId, 500, 123, { from: accounts[1] });
      await setMockVotePowerOfAt(10, 5000, 0, accounts[2]);
      await ftso.revealPrice(epochId, 250, 124, { from: accounts[2] });
      await setMockVotePowerOfAt(10, 0, 500, accounts[3]);
      await ftso.revealPrice(epochId, 400, 125, { from: accounts[3] });

      await increaseTimeTo((epochId + 1) * 120 + 60); // reveal period end
      expectEvent(await ftso.finalizePriceEpoch(epochId, false, { from: accounts[10] }), "PriceFinalized",
        { epochId: toBN(epochId), price: toBN(250), rewardedFtso: false, lowIQRRewardPrice: toBN(250), highIQRRewardPrice: toBN(250), finalizationType: toBN(1) });

      // round 2 - current asset price = 250
      await ftso.submitPriceHash(epochId + 1, submitPriceHash(300, 123, accounts[1]), { from: accounts[1] });
      await ftso.submitPriceHash(epochId + 1, submitPriceHash(400, 124, accounts[2]), { from: accounts[2] });
      await ftso.submitPriceHash(epochId + 1, submitPriceHash(200, 125, accounts[3]), { from: accounts[3] });

      await setMockVotePowerAt(10, 50000, 1000000);
      await ftso.initializeCurrentEpochStateForReveal(50000, false, { from: accounts[10] });

      await increaseTimeTo((epochId + 2) * 120); // reveal period start
      await setMockVotePowerOfAt(10, 1000, 10000, accounts[1]);
      await ftso.revealPrice(epochId + 1, 300, 123, { from: accounts[1] });
      await setMockVotePowerOfAt(10, 5000, 0, accounts[2]);
      await ftso.revealPrice(epochId + 1, 400, 124, { from: accounts[2] });
      await setMockVotePowerOfAt(10, 0, 50000, accounts[3]);
      await ftso.revealPrice(epochId + 1, 200, 125, { from: accounts[3] });

      await increaseTimeTo((epochId + 2) * 120 + 60); // reveal period end
      expectEvent(await ftso.finalizePriceEpoch(epochId + 1, false, { from: accounts[10] }), "PriceFinalized",
        { epochId: toBN(epochId + 1), price: toBN(300), rewardedFtso: false, lowIQRRewardPrice: toBN(200), highIQRRewardPrice: toBN(400), finalizationType: toBN(1) });
    });

    it("Should finalize price epoch - two epochs with different vote power blocks", async () => {
      // round 1 - current asset price = 0
      await ftso.submitPriceHash(epochId, submitPriceHash(500, 123, accounts[1]), { from: accounts[1] });
      await ftso.submitPriceHash(epochId, submitPriceHash(250, 124, accounts[2]), { from: accounts[2] });
      await ftso.submitPriceHash(epochId, submitPriceHash(400, 125, accounts[3]), { from: accounts[3] });

      await setMockVotePowerAt(10, 50000, 1000000);
      await ftso.initializeCurrentEpochStateForReveal(50000, false, { from: accounts[10] });
      await ftso.setVotePowerBlock(12, { from: accounts[10] });

      await increaseTimeTo((epochId + 1) * 120); // reveal period start
      await setMockVotePowerOfAt(10, 1000, 100, accounts[1]);
      await ftso.revealPrice(epochId, 500, 123, { from: accounts[1] });
      await setMockVotePowerOfAt(10, 5000, 0, accounts[2]);
      await ftso.revealPrice(epochId, 250, 124, { from: accounts[2] });
      await setMockVotePowerOfAt(10, 0, 500, accounts[3]);
      await ftso.revealPrice(epochId, 400, 125, { from: accounts[3] });

      await increaseTimeTo((epochId + 1) * 120 + 60); // reveal period end
      expectEvent(await ftso.finalizePriceEpoch(epochId, true, { from: accounts[10] }), "PriceFinalized",
        { epochId: toBN(epochId), price: toBN(250), rewardedFtso: true, lowIQRRewardPrice: toBN(250), highIQRRewardPrice: toBN(250), finalizationType: toBN(1) });

      // round 2 - current asset price = 250
      await ftso.submitPriceHash(epochId + 1, submitPriceHash(300, 123, accounts[1]), { from: accounts[1] });
      await ftso.submitPriceHash(epochId + 1, submitPriceHash(400, 124, accounts[2]), { from: accounts[2] });
      await ftso.submitPriceHash(epochId + 1, submitPriceHash(200, 125, accounts[3]), { from: accounts[3] });

      await setMockVotePowerAt(12, 20000, 100000);
      await ftso.initializeCurrentEpochStateForReveal(20000, false, { from: accounts[10] });

      await increaseTimeTo((epochId + 2) * 120); // reveal period start
      await setMockVotePowerOfAt(12, 2000, 0, accounts[1]);
      await ftso.revealPrice(epochId + 1, 300, 123, { from: accounts[1] });
      await setMockVotePowerOfAt(12, 2000, 80000, accounts[2]);
      await ftso.revealPrice(epochId + 1, 400, 124, { from: accounts[2] });
      await setMockVotePowerOfAt(12, 2000, 10000, accounts[3]);
      await ftso.revealPrice(epochId + 1, 200, 125, { from: accounts[3] });

      await increaseTimeTo((epochId + 2) * 120 + 60); // reveal period end
      expectEvent(await ftso.finalizePriceEpoch(epochId + 1, false, { from: accounts[10] }), "PriceFinalized",
        { epochId: toBN(epochId + 1), price: toBN(400), rewardedFtso: false, lowIQRRewardPrice: toBN(300), highIQRRewardPrice: toBN(400), finalizationType: toBN(1) });
    });

    it("Should finalize price epoch - two epochs - no votes in second one", async () => {
      // round 1 - current asset price = 0
      await ftso.submitPriceHash(epochId, submitPriceHash(500, 123, accounts[1]), { from: accounts[1] });
      await ftso.submitPriceHash(epochId, submitPriceHash(250, 124, accounts[2]), { from: accounts[2] });
      await ftso.submitPriceHash(epochId, submitPriceHash(400, 125, accounts[3]), { from: accounts[3] });

      await setMockVotePowerAt(10, 50000, 1000000);
      await ftso.initializeCurrentEpochStateForReveal(50000, false, { from: accounts[10] });

      await increaseTimeTo((epochId + 1) * 120); // reveal period start
      await setMockVotePowerOfAt(10, 1000, 100, accounts[1]);
      await ftso.revealPrice(epochId, 500, 123, { from: accounts[1] });
      await setMockVotePowerOfAt(10, 5000, 0, accounts[2]);
      await ftso.revealPrice(epochId, 250, 124, { from: accounts[2] });
      await setMockVotePowerOfAt(10, 0, 500, accounts[3]);
      await ftso.revealPrice(epochId, 400, 125, { from: accounts[3] });

      await increaseTimeTo((epochId + 1) * 120 + 60); // reveal period end
      expectEvent(await ftso.finalizePriceEpoch(epochId, false, { from: accounts[10] }), "PriceFinalized",
        { epochId: toBN(epochId), price: toBN(250), rewardedFtso: false, lowIQRRewardPrice: toBN(250), highIQRRewardPrice: toBN(250), finalizationType: toBN(1) });

      await ftso.initializeCurrentEpochStateForReveal(50000, false, { from: accounts[10] });

      // round 2 - current asset price = 250
      await increaseTimeTo((epochId + 2) * 120 + 60); // reveal period end
      let priceData = await ftso.getCurrentPrice();
      expectEvent(await ftso.finalizePriceEpoch(epochId + 1, false, { from: accounts[10] }), "PriceFinalized",
        { epochId: toBN(epochId + 1), price: toBN(250), rewardedFtso: false, lowIQRRewardPrice: toBN(0), highIQRRewardPrice: toBN(0), finalizationType: toBN(3) });
      let priceData2 = await ftso.getCurrentPrice();
      let priceDataFromTP = await ftso.getCurrentPriceFromTrustedProviders();
      
      expect(priceData2[1].toNumber()).to.equals(priceData[1].toNumber());
      expect(priceDataFromTP[0].toNumber()).to.equals(0);
      expect(priceDataFromTP[1].toNumber()).to.equals(0);
    });

    it("Should finalize price epoch and return rewarded addresses", async () => {
      // round 1 - current asset price = 0
      await ftso.submitPriceHash(epochId, submitPriceHash(500, 123, accounts[1]), { from: accounts[1] });
      await ftso.submitPriceHash(epochId, submitPriceHash(250, 124, accounts[2]), { from: accounts[2] });
      await ftso.submitPriceHash(epochId, submitPriceHash(400, 125, accounts[3]), { from: accounts[3] });

      await setMockVotePowerAt(10, 50000, 1000000);
      await ftso.initializeCurrentEpochStateForReveal(50000, false, { from: accounts[10] });
      await ftso.setVotePowerBlock(12, { from: accounts[10] });

      await increaseTimeTo((epochId + 1) * 120); // reveal period start
      await setMockVotePowerOfAt(10, 1000, 10000, accounts[1]);
      await ftso.revealPrice(epochId, 500, 123, { from: accounts[1] });
      await setMockVotePowerOfAt(10, 5000, 0, accounts[2]);
      await ftso.revealPrice(epochId, 250, 124, { from: accounts[2] });
      await setMockVotePowerOfAt(10, 0, 50000, accounts[3]);
      await ftso.revealPrice(epochId, 400, 125, { from: accounts[3] });

      await increaseTimeTo((epochId + 1) * 120 + 60 + 1); // reveal period end (+1 as call does not increase time)

      let data = await ftso.contract.methods.finalizePriceEpoch(epochId, true).call({ from: accounts[10] });
      expect(data._eligibleAddresses.length).to.equals(1);
      expect(data._eligibleAddresses[0]).to.equals(accounts[2]);
      expect(data._natWeights.length).to.equals(1);
      expect(data._natWeights[0]).to.equals('1000000000000000');
      expect(data._natWeightsSum).to.equals('1000000000000000');
      await ftso.finalizePriceEpoch(epochId, true, { from: accounts[10] });

      await ftso.initializeCurrentEpochStateForReveal(50000, false, { from: accounts[10] });

      // round 2 - current asset price = 250
      await increaseTimeTo((epochId + 2) * 120 + 60 + 1); // reveal period end (+1 as call does not increase time)
      let data2 = await ftso.contract.methods.finalizePriceEpoch(epochId + 1, true).call({ from: accounts[10] });
      expect(data2._eligibleAddresses.length).to.equals(0);
      expect(data2._natWeights.length).to.equals(0);
      expect(data2._natWeightsSum).to.equals('0');
      await ftso.finalizePriceEpoch(epochId + 1, true, { from: accounts[10] });

      // round 3 - current asset price = 250
      await ftso.submitPriceHash(epochId + 2, submitPriceHash(300, 123, accounts[1]), { from: accounts[1] });
      await ftso.submitPriceHash(epochId + 2, submitPriceHash(400, 124, accounts[2]), { from: accounts[2] });
      await ftso.submitPriceHash(epochId + 2, submitPriceHash(200, 125, accounts[3]), { from: accounts[3] });

      await setMockVotePowerAt(12, 20000, 100000);
      await ftso.initializeCurrentEpochStateForReveal(20000, false, { from: accounts[10] });

      await increaseTimeTo((epochId + 3) * 120); // reveal period start
      await setMockVotePowerOfAt(12, 4000, 0, accounts[1]);
      await ftso.revealPrice(epochId + 2, 300, 123, { from: accounts[1] });
      await setMockVotePowerOfAt(12, 3000, 80000, accounts[2]);
      await ftso.revealPrice(epochId + 2, 400, 124, { from: accounts[2] });
      await setMockVotePowerOfAt(12, 2000, 10000, accounts[3]);
      await ftso.revealPrice(epochId + 2, 200, 125, { from: accounts[3] });

      await increaseTimeTo((epochId + 3) * 120 + 60 + 1); // reveal period end (+1 as call does not increase time)
      const random = 121;
      let data3 = await ftso.contract.methods.finalizePriceEpoch(epochId + 2, true).call({ from: accounts[10] });

      expect(isAddressEligible(random, accounts[1])).is.true;
      expect(isAddressEligible(random, accounts[2])).is.false;
      expect(data3._eligibleAddresses.length).to.equals(1);
      let id1 = data3._eligibleAddresses.indexOf(accounts[1]);
      let id2 = data3._eligibleAddresses.indexOf(accounts[2]);
      expect(id2).to.equals(-1);
      expect(data3._eligibleAddresses[id1]).to.equals(accounts[1]);
      expect(data3._natWeights.length).to.equals(1);
      expect(data3._natWeights[id1]).to.equals('2000000000000000');
      expect(data3._natWeightsSum).to.equals('2000000000000000');
      await ftso.finalizePriceEpoch(epochId + 2, true, { from: accounts[10] });
    });

    it("Should not finalize price epoch if not ftso manager", async () => {
      await expectRevert(ftso.finalizePriceEpoch(0, true, { from: accounts[1] }), "Access denied");
    });

    it("Should finalize price epoch using trusted addresses votes if epoch has low flr turnout", async () => {
      await ftso.submitPriceHash(epochId, submitPriceHash(500, 123, accounts[1]), { from: accounts[1] });
      await ftso.submitPriceHash(epochId, submitPriceHash(250, 124, accounts[2]), { from: accounts[2] });
      await ftso.submitPriceHash(epochId, submitPriceHash(400, 125, accounts[6]), { from: accounts[6] });
      await ftso.submitPriceHash(epochId, submitPriceHash(500, 126, accounts[7]), { from: accounts[7] });

      await setMockVotePowerAt(10, 50000, 1000000);
      await ftso.initializeCurrentEpochStateForReveal(50000, false, { from: accounts[10] });

      await increaseTimeTo((epochId + 1) * 120); // reveal period start
      await setMockVotePowerOfAt(10, 10, 10000, accounts[1]);
      await ftso.revealPrice(epochId, 500, 123, { from: accounts[1] });
      await setMockVotePowerOfAt(10, 30, 0, accounts[2]);
      await ftso.revealPrice(epochId, 250, 124, { from: accounts[2] });
      await setMockVotePowerOfAt(10, 20, 50000, accounts[6]);
      await ftso.revealPrice(epochId, 400, 125, { from: accounts[6] });
      await setMockVotePowerOfAt(10, 5, 50000, accounts[7]);
      await ftso.revealPrice(epochId, 500, 126, { from: accounts[7] });

      await increaseTimeTo((epochId + 1) * 120 + 60 + 1); // reveal period end (+1 as call does not increase time)

      let data = await ftso.contract.methods.finalizePriceEpoch(epochId, true).call({ from: accounts[10] });
      expect(data._eligibleAddresses.length).to.equals(0);
      expect(data._natWeights.length).to.equals(0);
      expect(data._natWeightsSum).to.equals('0');

      let priceData = await ftso.getCurrentPrice();
      expectEvent(await ftso.finalizePriceEpoch(epochId, true, { from: accounts[10] }), "PriceFinalized",
        { epochId: toBN(epochId), price: toBN(450), rewardedFtso: false, lowIQRRewardPrice: toBN(0), highIQRRewardPrice: toBN(0), finalizationType: toBN(2) });
      let priceData2 = await ftso.getCurrentPrice();
      let priceDataFromTP = await ftso.getCurrentPriceFromTrustedProviders();
      let priceDataWithDecimals2 = await ftso.getCurrentPriceWithDecimals();
      let priceDataWithDecimalsFromTP = await ftso.getCurrentPriceWithDecimalsFromTrustedProviders();
      let decimals = await ftso.ASSET_PRICE_USD_DECIMALS();

      
      expect(priceData2[1].toNumber()).to.be.gt(priceData[1].toNumber());
      expect(priceDataFromTP[0].toNumber()).to.equals(450);
      expect(priceData2[0].toNumber()).to.equals(priceDataFromTP[0].toNumber());
      expect(priceData2[1].toNumber()).to.equals(priceDataFromTP[1].toNumber());
      expect(priceDataWithDecimals2[0].toNumber()).to.equals(priceDataFromTP[0].toNumber());
      expect(priceDataWithDecimals2[1].toNumber()).to.equals(priceDataFromTP[1].toNumber());
      expect(priceDataWithDecimals2[2].toNumber()).to.equals(decimals.toNumber());
      expect(priceDataWithDecimalsFromTP[0].toNumber()).to.equals(priceDataFromTP[0].toNumber());
      expect(priceDataWithDecimalsFromTP[1].toNumber()).to.equals(priceDataFromTP[1].toNumber());
      expect(priceDataWithDecimalsFromTP[2].toNumber()).to.equals(decimals.toNumber());
    });

    it("Should finalize price epoch using trusted addresses votes if epoch has large price deviation", async () => {
      // round 1 - current asset price = 0
      await ftso.submitPriceHash(epochId, submitPriceHash(5000, 123, accounts[1]), { from: accounts[1] });
      await ftso.submitPriceHash(epochId, submitPriceHash(2500, 124, accounts[6]), { from: accounts[6] });
      await ftso.submitPriceHash(epochId, submitPriceHash(4000, 125, accounts[7]), { from: accounts[7] });

      await setMockVotePowerAt(10, 50000, 1000000);
      await ftso.initializeCurrentEpochStateForReveal(50000, false, { from: accounts[10] });

      await increaseTimeTo((epochId + 1) * 120); // reveal period start
      await setMockVotePowerOfAt(10, 1000, 100, accounts[1]);
      await ftso.revealPrice(epochId, 5000, 123, { from: accounts[1] });
      await setMockVotePowerOfAt(10, 5000, 0, accounts[6]);
      await ftso.revealPrice(epochId, 2500, 124, { from: accounts[6] });
      await setMockVotePowerOfAt(10, 0, 500, accounts[7]);
      await ftso.revealPrice(epochId, 4000, 125, { from: accounts[7] });

      await increaseTimeTo((epochId + 1) * 120 + 60); // reveal period end
      let priceData1 = await ftso.getCurrentPrice();
      expectEvent(await ftso.finalizePriceEpoch(epochId, false, { from: accounts[10] }), "PriceFinalized",
        { epochId: toBN(epochId), price: toBN(2500), rewardedFtso: false, lowIQRRewardPrice: toBN(2500), highIQRRewardPrice: toBN(2500), finalizationType: toBN(1) });
      let priceData2 = await ftso.getCurrentPrice();
      let priceDataFromTP1 = await ftso.getCurrentPriceFromTrustedProviders();
      
      expect(priceData2[1].toNumber()).to.be.gt(priceData1[1].toNumber());
      expect(priceDataFromTP1[0].toNumber()).to.equals(3250);
      expect(priceData2[0].toNumber()).to.equals(2500);
      expect(priceData2[1].toNumber()).to.equals(priceDataFromTP1[1].toNumber());

      // round 2 - current asset price = 2500
      await ftso.submitPriceHash(epochId + 1, submitPriceHash(300, 123, accounts[1]), { from: accounts[1] });
      await ftso.submitPriceHash(epochId + 1, submitPriceHash(400, 124, accounts[6]), { from: accounts[6] });
      await ftso.submitPriceHash(epochId + 1, submitPriceHash(500, 125, accounts[7]), { from: accounts[7] });

      await setMockVotePowerAt(12, 20000, 100000);
      await ftso.initializeCurrentEpochStateForReveal(20000, false, { from: accounts[10] });

      await increaseTimeTo((epochId + 2) * 120); // reveal period start
      await setMockVotePowerOfAt(12, 2000, 0, accounts[1]);
      await ftso.revealPrice(epochId + 1, 300, 123, { from: accounts[1] });
      await setMockVotePowerOfAt(12, 2000, 80000, accounts[6]);
      await ftso.revealPrice(epochId + 1, 400, 124, { from: accounts[6] });
      await setMockVotePowerOfAt(12, 2000, 10000, accounts[7]);
      await ftso.revealPrice(epochId + 1, 500, 125, { from: accounts[7] });

      await increaseTimeTo((epochId + 2) * 120 + 60); // reveal period end
      let priceData3 = await ftso.getCurrentPrice();
      expectEvent(await ftso.finalizePriceEpoch(epochId + 1, false, { from: accounts[10] }), "PriceFinalized",
        { epochId: toBN(epochId + 1), price: toBN(450), rewardedFtso: false, lowIQRRewardPrice: toBN(0), highIQRRewardPrice: toBN(0), finalizationType: toBN(2) });
      let priceData4 = await ftso.getCurrentPrice();
      let priceDataFromTP2 = await ftso.getCurrentPriceFromTrustedProviders();
      
      expect(priceData4[1].toNumber()).to.be.gt(priceData3[1].toNumber());
      expect(priceDataFromTP2[0].toNumber()).to.equals(450);
      expect(priceData4[0].toNumber()).to.equals(priceDataFromTP2[0].toNumber());
      expect(priceData4[1].toNumber()).to.equals(priceDataFromTP2[1].toNumber());
    });

    it("Should finalize price epoch and not update price from trusted providers if no votes from trusted addresses", async () => {
      // round 1 - current asset price = 0
      await ftso.submitPriceHash(epochId, submitPriceHash(5000, 123, accounts[1]), { from: accounts[1] });
      await ftso.submitPriceHash(epochId, submitPriceHash(2500, 124, accounts[6]), { from: accounts[6] });
      await ftso.submitPriceHash(epochId, submitPriceHash(4000, 125, accounts[7]), { from: accounts[7] });

      await setMockVotePowerAt(10, 50000, 1000000);
      await ftso.initializeCurrentEpochStateForReveal(50000, false, { from: accounts[10] });

      await increaseTimeTo((epochId + 1) * 120); // reveal period start
      await setMockVotePowerOfAt(10, 1000, 100, accounts[1]);
      await ftso.revealPrice(epochId, 5000, 123, { from: accounts[1] });
      await setMockVotePowerOfAt(10, 5000, 0, accounts[6]);
      await ftso.revealPrice(epochId, 2500, 124, { from: accounts[6] });
      await setMockVotePowerOfAt(10, 0, 500, accounts[7]);
      await ftso.revealPrice(epochId, 4000, 125, { from: accounts[7] });

      await increaseTimeTo((epochId + 1) * 120 + 60); // reveal period end
      let priceData1 = await ftso.getCurrentPrice();
      expectEvent(await ftso.finalizePriceEpoch(epochId, false, { from: accounts[10] }), "PriceFinalized",
        { epochId: toBN(epochId), price: toBN(2500), rewardedFtso: false, lowIQRRewardPrice: toBN(2500), highIQRRewardPrice: toBN(2500), finalizationType: toBN(1) });
      let priceData2 = await ftso.getCurrentPrice();
      let priceDataFromTP1 = await ftso.getCurrentPriceFromTrustedProviders();
      
      expect(priceData2[1].toNumber()).to.be.gt(priceData1[1].toNumber());
      expect(priceDataFromTP1[0].toNumber()).to.equals(3250);
      expect(priceData2[0].toNumber()).to.equals(2500);
      expect(priceData2[1].toNumber()).to.equals(priceDataFromTP1[1].toNumber());

      // round 2 - current asset price = 2500
      await ftso.submitPriceHash(epochId + 1, submitPriceHash(3000, 123, accounts[1]), { from: accounts[1] });
      await ftso.submitPriceHash(epochId + 1, submitPriceHash(4000, 124, accounts[2]), { from: accounts[2] });
      await ftso.submitPriceHash(epochId + 1, submitPriceHash(2000, 125, accounts[3]), { from: accounts[3] });

      await setMockVotePowerAt(10, 50000, 1000000);
      await ftso.initializeCurrentEpochStateForReveal(50000, false, { from: accounts[10] });

      await increaseTimeTo((epochId + 2) * 120); // reveal period start
      await setMockVotePowerOfAt(10, 1000, 10000, accounts[1]);
      await ftso.revealPrice(epochId + 1, 3000, 123, { from: accounts[1] });
      await setMockVotePowerOfAt(10, 5000, 0, accounts[2]);
      await ftso.revealPrice(epochId + 1, 4000, 124, { from: accounts[2] });
      await setMockVotePowerOfAt(10, 1, 50000, accounts[3]);
      await ftso.revealPrice(epochId + 1, 2000, 125, { from: accounts[3] });

      await increaseTimeTo((epochId + 2) * 120 + 60); // reveal period end
      let priceData3 = await ftso.getCurrentPrice();
      expectEvent(await ftso.finalizePriceEpoch(epochId + 1, false, { from: accounts[10] }), "PriceFinalized",
        { epochId: toBN(epochId + 1), price: toBN(3000), rewardedFtso: false, lowIQRRewardPrice: toBN(2000), highIQRRewardPrice: toBN(4000), finalizationType: toBN(1) });
      let priceData4 = await ftso.getCurrentPrice();
      let priceDataFromTP2 = await ftso.getCurrentPriceFromTrustedProviders();
      
      expect(priceData4[1].toNumber()).to.be.gt(priceData3[1].toNumber());
      expect(priceData4[0].toNumber()).to.equals(3000);
      expect(priceDataFromTP1[0].toNumber()).to.equals(priceDataFromTP2[0].toNumber());
      expect(priceDataFromTP1[1].toNumber()).to.equals(priceDataFromTP2[1].toNumber());
    });

    it("Should finalize price epoch using force finalization if epoch has low nat turnout and trusted addresses are not set", async () => {
      await ftso.configureEpochs(1, 1, 1000, 10000, 50, 500, 0, 0, [], { from: accounts[10] });
      await ftso.submitPriceHash(epochId, submitPriceHash(500, 123, accounts[1]), { from: accounts[1] });
      await ftso.submitPriceHash(epochId, submitPriceHash(250, 124, accounts[2]), { from: accounts[2] });

      await setMockVotePowerAt(10, 50000, 1000000);
      await ftso.initializeCurrentEpochStateForReveal(50000, false, { from: accounts[10] });

      await increaseTimeTo((epochId + 1) * 120); // reveal period start
      await setMockVotePowerOfAt(10, 10, 10000, accounts[1]);
      await ftso.revealPrice(epochId, 500, 123, { from: accounts[1] });
      await setMockVotePowerOfAt(10, 30, 0, accounts[2]);
      await ftso.revealPrice(epochId, 250, 124, { from: accounts[2] });

      await increaseTimeTo((epochId + 1) * 120 + 60 + 1); // reveal period end (+1 as call does not increase time)

      let data = await ftso.contract.methods.finalizePriceEpoch(epochId, true).call({ from: accounts[10] });
      expect(data._eligibleAddresses.length).to.equals(0);
      expect(data._natWeights.length).to.equals(0);
      expect(data._natWeightsSum).to.equals('0');

      expectEvent(await ftso.finalizePriceEpoch(epochId, true, { from: accounts[10] }), "PriceFinalized",
        { epochId: toBN(epochId), price: toBN(1), rewardedFtso: false, lowIQRRewardPrice: toBN(0), highIQRRewardPrice: toBN(0), finalizationType: toBN(3) });
    });

    it("Should finalize price epoch using force finalization if epoch has low flr turnout and no votes from trusted addresses", async () => {
      await ftso.submitPriceHash(epochId, submitPriceHash(500, 123, accounts[1]), { from: accounts[1] });
      await ftso.submitPriceHash(epochId, submitPriceHash(250, 124, accounts[2]), { from: accounts[2] });

      await setMockVotePowerAt(10, 50000, 1000000);
      await ftso.initializeCurrentEpochStateForReveal(50000, false, { from: accounts[10] });

      await increaseTimeTo((epochId + 1) * 120); // reveal period start
      await setMockVotePowerOfAt(10, 10, 10000, accounts[1]);
      await ftso.revealPrice(epochId, 500, 123, { from: accounts[1] });
      await setMockVotePowerOfAt(10, 30, 0, accounts[2]);
      await ftso.revealPrice(epochId, 250, 124, { from: accounts[2] });

      await increaseTimeTo((epochId + 1) * 120 + 60 + 1); // reveal period end (+1 as call does not increase time)

      let data = await ftso.contract.methods.finalizePriceEpoch(epochId, true).call({ from: accounts[10] });
      expect(data._eligibleAddresses.length).to.equals(0);
      expect(data._natWeights.length).to.equals(0);
      expect(data._natWeightsSum).to.equals('0');

      let priceData = await ftso.getCurrentPrice();
      expectEvent(await ftso.finalizePriceEpoch(epochId, true, { from: accounts[10] }), "PriceFinalized",
        { epochId: toBN(epochId), price: toBN(1), rewardedFtso: false, lowIQRRewardPrice: toBN(0), highIQRRewardPrice: toBN(0), finalizationType: toBN(3) });
      let priceData2 = await ftso.getCurrentPrice();
      let priceDataFromTP = await ftso.getCurrentPriceFromTrustedProviders();
      
      expect(priceData2[1].toNumber()).to.equals(priceData[1].toNumber());
      expect(priceDataFromTP[0].toNumber()).to.equals(0);
      expect(priceDataFromTP[1].toNumber()).to.equals(0);
    });

    it("Should not finalize price epoch for epoch in submit price period", async () => {
      await expectRevert(ftso.finalizePriceEpoch(epochId, false, { from: accounts[10] }), "Epoch not ready for finalization");
      await increaseTimeTo((epochId + 1) * 120 - 1); // submit period end -1s
      await expectRevert(ftso.finalizePriceEpoch(epochId, false, { from: accounts[10] }), "Epoch not ready for finalization");
    });

    it("Should not finalize price epoch for epoch in reveal price period", async () => {
      await increaseTimeTo((epochId + 1) * 120 - 1); // reveal period start
      await expectRevert(ftso.finalizePriceEpoch(epochId, false, { from: accounts[10] }), "Epoch not ready for finalization");
      await increaseTimeTo((epochId + 1) * 120 + 60 - 2); // reveal period end -1s
      await expectRevert(ftso.finalizePriceEpoch(epochId, false, { from: accounts[10] }), "Epoch not ready for finalization");
    });

    it("Should not finalize price epoch for epoch in future", async () => {
      await expectRevert(ftso.finalizePriceEpoch(epochId + 1, false, { from: accounts[10] }), "Epoch not ready for finalization");
      await expectRevert(ftso.fallbackFinalizePriceEpoch(epochId + 1, { from: accounts[10] }), "Epoch not ready for finalization");
      await expectRevert(ftso.forceFinalizePriceEpoch(epochId + 1, { from: accounts[10] }), "Epoch not ready for finalization");
    });

    it("Should force finalize price epoch using average", async () => {
      expectEvent(await ftso.fallbackFinalizePriceEpoch(0, { from: accounts[10] }), "PriceFinalized",
        { epochId: toBN(0), price: toBN(0), rewardedFtso: false, lowIQRRewardPrice: toBN(0), highIQRRewardPrice: toBN(0), finalizationType: toBN(5) });
    });

    it("Should force finalize price epoch - price timestamp should not change", async () => {
      let priceData = await ftso.getCurrentPrice();
      expectEvent(await ftso.forceFinalizePriceEpoch(0, { from: accounts[10] }), "PriceFinalized",
        { epochId: toBN(0), price: toBN(0), rewardedFtso: false, lowIQRRewardPrice: toBN(0), highIQRRewardPrice: toBN(0), finalizationType: toBN(5) });
      let priceData2 = await ftso.getCurrentPrice();
      expect(priceData2[1].toNumber()).to.equals(priceData[1].toNumber());
    });

    it("Should not force finalize price epoch using fallback if not ftso manager", async () => {
      await expectRevert(ftso.fallbackFinalizePriceEpoch(0, { from: accounts[1] }), "Access denied");
    });

    it("Should not force finalize price epoch if not ftso manager", async () => {
      await expectRevert(ftso.forceFinalizePriceEpoch(0, { from: accounts[1] }), "Access denied");
    });

    it("Should return empty reward data if price deviation is too high", async () => {
      let ftso1 = await MockFtsoFull.new(
        "ATOK",
        5,
        accounts[4],
        mockWnat.address,
        accounts[10],
        0, 120, 60,
        1, // initial token price 0.00001$
        10000, // price deviation threshold in BIPS
        defaultPriceEpochCyclicBufferSize,
        false
      );

      await ftso1.setAsset(mockVpToken.address, { from: accounts[10] });
      await ftso1.configureEpochs(1, 1, 1000, 10000, 50, 500, 0, 0, [accounts[5], accounts[6], accounts[7]], { from: accounts[10] });
      await ftso1.setVotePowerBlock(10, { from: accounts[10] });
      await ftso1.activateFtso(0, 120, 60, { from: accounts[10] });

      // round 1 - current asset price = 0
      await ftso1.submitPriceHash(epochId, submitPriceHash(1, 123, accounts[1]), { from: accounts[1] });
      await ftso1.submitPriceHash(epochId, submitPriceHash(2, 124, accounts[2]), { from: accounts[2] });
      await ftso1.submitPriceHash(epochId, submitPriceHash(3, 125, accounts[3]), { from: accounts[3] });

      await setMockVotePowerAt(10, 50000, 1000000);
      await ftso1.initializeCurrentEpochStateForReveal(50000, false, { from: accounts[10] });

      await increaseTimeTo((epochId + 1) * 120); // reveal period start
      await setMockVotePowerOfAt(10, 1000, 100, accounts[1]);
      await ftso1.revealPrice(epochId, 1, 123, { from: accounts[1] });
      await setMockVotePowerOfAt(10, 5000, 0, accounts[2]);
      await ftso1.revealPrice(epochId, 2, 124, { from: accounts[2] });
      await setMockVotePowerOfAt(10, 0, 500, accounts[3]);
      await ftso1.revealPrice(epochId, 3, 125, { from: accounts[3] });

      await increaseTimeTo((epochId + 1) * 120 + 60); // reveal period end

      await ftso1.finalizePriceEpoch(epochId, false, { from: accounts[10] });
      
      // round 2
      await ftso1.submitPriceHash(epochId + 1, submitPriceHash(0, 123, accounts[1]), { from: accounts[1] });
      await ftso1.submitPriceHash(epochId + 1, submitPriceHash(0, 124, accounts[2]), { from: accounts[2] });
      await ftso1.submitPriceHash(epochId + 1, submitPriceHash(0, 125, accounts[3]), { from: accounts[3] });

      await setMockVotePowerAt(12, 20000, 100000);
      await ftso1.initializeCurrentEpochStateForReveal(20000, false, { from: accounts[10] });

      await increaseTimeTo((epochId + 2) * 120); // reveal period start
      await setMockVotePowerOfAt(12, 2000, 0, accounts[1]);
      await ftso1.revealPrice(epochId + 1, 0, 123, { from: accounts[1] });
      await setMockVotePowerOfAt(12, 2000, 80000, accounts[2]);
      await ftso1.revealPrice(epochId + 1, 0, 124, { from: accounts[2] });
      await setMockVotePowerOfAt(12, 2000, 10000, accounts[3]);
      await ftso1.revealPrice(epochId + 1, 0, 125, { from: accounts[3] });

      await increaseTimeTo((epochId + 2) * 120 + 60); // reveal period end
      let res = await ftso1.contract.methods.finalizePriceEpoch(epochId + 1, false).call({ from: accounts[10] });
      let tx = await ftso1.finalizePriceEpoch(epochId + 1, false, { from: accounts[10] });
      expect(res[2]).to.equal('0');
      expect(res[1]).to.eql([]);
      expect(res[0]).to.eql([]);
    });

    it("Should reward accounts[2] for IQR", async () => {
      // IQR = 100%, elasticBand = 0%
      await ftso.configureEpochs(1, 1, 1000, 10000, 50, 500, 0, 0, [accounts[5], accounts[6], accounts[7]], { from: accounts[10] });

      await ftso.submitPriceHash(epochId, submitPriceHash(500, 123, accounts[1]), { from: accounts[1] });
      await ftso.submitPriceHash(epochId, submitPriceHash(250, 124, accounts[2]), { from: accounts[2] });
      await ftso.submitPriceHash(epochId, submitPriceHash(400, 125, accounts[3]), { from: accounts[3] });

      await setMockVotePowerAt(10, 10**12, 0);
      await ftso.initializeCurrentEpochStateForReveal(50000, false, { from: accounts[10] });

      await increaseTimeTo((epochId + 1) * 120); // reveal period start
      await setMockVotePowerOfAt(10, 1000, 0, accounts[1]);
      await ftso.revealPrice(epochId, 500, 123, { from: accounts[1] });
      await setMockVotePowerOfAt(10, 5000, 0, accounts[2]);
      await ftso.revealPrice(epochId, 250, 124, { from: accounts[2] });
      await setMockVotePowerOfAt(10, 500, 0, accounts[3]);
      await ftso.revealPrice(epochId, 400, 125, { from: accounts[3] });

      await increaseTimeTo((epochId + 1) * 120 + 60); // reveal period end
      let finalize = await ftso.contract.methods.finalizePriceEpoch(epochId, true).call({ from: accounts[10] });
      let tx = await ftso.finalizePriceEpoch(epochId, true, { from: accounts[10] });
      expectEvent(tx, "PriceFinalized",
        { epochId: toBN(epochId), price: toBN(250), rewardedFtso: true, lowIQRRewardPrice: toBN(250), highIQRRewardPrice: toBN(250), finalizationType: toBN(1) });
    });

    it("Should not reward anyone", async () => {
      // IQR = 0%, elasticBand = 100% (width = 0 -> nobody can be rewarded)
      await ftso.configureEpochs(1, 1, 1000, 10000, 50, 500, 10000, 0, [accounts[5], accounts[6], accounts[7]], { from: accounts[10] });

      await ftso.submitPriceHash(epochId, submitPriceHash(500, 123, accounts[1]), { from: accounts[1] });
      await ftso.submitPriceHash(epochId, submitPriceHash(250, 124, accounts[2]), { from: accounts[2] });
      await ftso.submitPriceHash(epochId, submitPriceHash(400, 125, accounts[3]), { from: accounts[3] });

      await setMockVotePowerAt(10, 50000, 0);
      await ftso.initializeCurrentEpochStateForReveal(50000, false, { from: accounts[10] });

      await increaseTimeTo((epochId + 1) * 120); // reveal period start
      await setMockVotePowerOfAt(10, 1000, 0, accounts[1]);
      await ftso.revealPrice(epochId, 500, 123, { from: accounts[1] });
      await setMockVotePowerOfAt(10, 5000, 0, accounts[2]);
      await ftso.revealPrice(epochId, 250, 124, { from: accounts[2] });
      await setMockVotePowerOfAt(10, 500, 0, accounts[3]);
      await ftso.revealPrice(epochId, 400, 125, { from: accounts[3] });

      await increaseTimeTo((epochId + 1) * 120 + 60); // reveal period end
      let finalize = await ftso.contract.methods.finalizePriceEpoch(epochId, true).call({ from: accounts[10] });
      let tx = await ftso.finalizePriceEpoch(epochId, true, { from: accounts[10] });

      // even though accounts[2] sent median price, it is not rewarded since IQR part of rewards is 0%.
      expectEvent(tx, "PriceFinalized",
        { epochId: toBN(epochId), price: toBN(250), rewardedFtso: false, lowIQRRewardPrice: toBN(250), highIQRRewardPrice: toBN(250), lowElasticBandRewardPrice: toBN(250), highElasticBandRewardPrice: toBN(250), finalizationType: toBN(1) });
      expect(finalize._eligibleAddresses.length).to.equals(0);
    });

    it("Should reward accounts[2] for elastic band", async () => {
      // IQR = 0%, elasticBand = 100% (width = 1%)
      await ftso.configureEpochs(1, 1, 1000, 10000, 50, 500, 10000, 10000, [accounts[5], accounts[6], accounts[7]], { from: accounts[10] });

      await ftso.submitPriceHash(epochId, submitPriceHash(500, 123, accounts[1]), { from: accounts[1] });
      await ftso.submitPriceHash(epochId, submitPriceHash(250, 124, accounts[2]), { from: accounts[2] });
      await ftso.submitPriceHash(epochId, submitPriceHash(400, 125, accounts[3]), { from: accounts[3] });

      await setMockVotePowerAt(10, 10**12, 0);
      await ftso.initializeCurrentEpochStateForReveal(50000, false, { from: accounts[10] });

      await increaseTimeTo((epochId + 1) * 120); // reveal period start
      await setMockVotePowerOfAt(10, 1000, 0, accounts[1]);
      await ftso.revealPrice(epochId, 500, 123, { from: accounts[1] });
      await setMockVotePowerOfAt(10, 5000, 0, accounts[2]);
      await ftso.revealPrice(epochId, 250, 124, { from: accounts[2] });
      await setMockVotePowerOfAt(10, 500, 0, accounts[3]);
      await ftso.revealPrice(epochId, 400, 125, { from: accounts[3] });

      await increaseTimeTo((epochId + 1) * 120 + 60); // reveal period end
      let finalize = await ftso.contract.methods.finalizePriceEpoch(epochId, true).call({ from: accounts[10] });
      let tx = await ftso.finalizePriceEpoch(epochId, true, { from: accounts[10] });

      expectEvent(tx, "PriceFinalized",
        { epochId: toBN(epochId), price: toBN(250), rewardedFtso: true, lowIQRRewardPrice: toBN(250), highIQRRewardPrice: toBN(250), lowElasticBandRewardPrice: toBN(248), highElasticBandRewardPrice: toBN(252), finalizationType: toBN(1) });

      // only accounts[2] should be rewarded, because its price is inside elastic band
      let vp2 = 5000 * 5000 * 1e4;
      expect(finalize._eligibleAddresses.length).to.equals(1);
      expect(finalize._eligibleAddresses[0]).to.equals(accounts[2]);
      expect(finalize._natWeights[0]).to.equals(vp2.toString());
      expect(finalize._natWeightsSum).to.equals(vp2.toString());
    });

    it("Should reward all three accounts for elastic band", async () => {
      // IQR = 0%, elasticBand = 100% (width = 100%)
      await ftso.configureEpochs(1, 1, 1000, 10000, 50, 500, 10000, 1000000, [accounts[5], accounts[6], accounts[7]], { from: accounts[10] });

      await ftso.submitPriceHash(epochId, submitPriceHash(499, 123, accounts[1]), { from: accounts[1] });
      await ftso.submitPriceHash(epochId, submitPriceHash(250, 124, accounts[2]), { from: accounts[2] });
      await ftso.submitPriceHash(epochId, submitPriceHash(400, 125, accounts[3]), { from: accounts[3] });

      await setMockVotePowerAt(10, 10**12, 0);
      await ftso.initializeCurrentEpochStateForReveal(50000, false, { from: accounts[10] });

      await increaseTimeTo((epochId + 1) * 120); // reveal period start
      await setMockVotePowerOfAt(10, 1000, 0, accounts[1]);
      await ftso.revealPrice(epochId, 499, 123, { from: accounts[1] });
      await setMockVotePowerOfAt(10, 5000, 0, accounts[2]);
      await ftso.revealPrice(epochId, 250, 124, { from: accounts[2] });
      await setMockVotePowerOfAt(10, 500, 0, accounts[3]);
      await ftso.revealPrice(epochId, 400, 125, { from: accounts[3] });

      await increaseTimeTo((epochId + 1) * 120 + 60); // reveal period end
      let finalize = await ftso.contract.methods.finalizePriceEpoch(epochId, true).call({ from: accounts[10] });
      let tx = await ftso.finalizePriceEpoch(epochId, true, { from: accounts[10] });

      expectEvent(tx, "PriceFinalized",
        { epochId: toBN(epochId), price: toBN(250), rewardedFtso: true, lowIQRRewardPrice: toBN(250), highIQRRewardPrice: toBN(250), finalizationType: toBN(1) });

      // all three price providers should be rewarded, because everyone sent price inside elastic band
      let vp2 = 5000 * 5000 * 1e4;
      let vp1 = 1000 * 5000 * 1e4;
      let vp3 = 500 * 5000 * 1e4;
      expect(finalize._eligibleAddresses.length).to.equals(3);
      expect(finalize._eligibleAddresses[0]).to.equals(accounts[1]);
      expect(finalize._natWeights[0]).to.equals(vp1.toString());
      expect(finalize._natWeights[1]).to.equals(vp2.toString());
      expect(finalize._natWeights[2]).to.equals(vp3.toString());
      expect(finalize._natWeightsSum).to.equals((vp1 + vp2 + vp3).toString());
    });

    it("Should reward for IQR and elastic band", async () => {
      // IQR = 60%, elasticBand = 40% (width = 100%)
      await ftso.configureEpochs(1, 1, 1000, 10000, 50, 500, 4000, 1000000, [accounts[5], accounts[6], accounts[7]], { from: accounts[10] });

      await ftso.submitPriceHash(epochId, submitPriceHash(499, 123, accounts[1]), { from: accounts[1] });
      await ftso.submitPriceHash(epochId, submitPriceHash(250, 124, accounts[2]), { from: accounts[2] });
      await ftso.submitPriceHash(epochId, submitPriceHash(400, 125, accounts[3]), { from: accounts[3] });

      await setMockVotePowerAt(10, 10**12, 0);
      await ftso.initializeCurrentEpochStateForReveal(50000, false, { from: accounts[10] });

      await increaseTimeTo((epochId + 1) * 120); // reveal period start
      await setMockVotePowerOfAt(10, 1000, 0, accounts[1]);
      await ftso.revealPrice(epochId, 499, 123, { from: accounts[1] });
      await setMockVotePowerOfAt(10, 5000, 0, accounts[2]);
      await ftso.revealPrice(epochId, 250, 124, { from: accounts[2] });
      await setMockVotePowerOfAt(10, 500, 0, accounts[3]);
      await ftso.revealPrice(epochId, 400, 125, { from: accounts[3] });

      await increaseTimeTo((epochId + 1) * 120 + 60); // reveal period end
      let finalize = await ftso.contract.methods.finalizePriceEpoch(epochId, true).call({ from: accounts[10] });
      let tx = await ftso.finalizePriceEpoch(epochId, true, { from: accounts[10] });

      expectEvent(tx, "PriceFinalized",
        { epochId: toBN(epochId), price: toBN(250), rewardedFtso: true, lowIQRRewardPrice: toBN(250), highIQRRewardPrice: toBN(250), lowElasticBandRewardPrice: toBN(0), highElasticBandRewardPrice: toBN(500), finalizationType: toBN(1) });

      // accounts[2] is rewarded for both IQR and elastic band, accounts[1] and accounts[3] are rewarded only for elastic band
      let vp2 = (4000 * 5000 + 6000 * 6500) * 5000;
      let vp1 = 4000 * 1000 * 5000;
      let vp3 = 4000 * 500 * 5000;
      expect(finalize._eligibleAddresses.length).to.equals(3);
      expect(finalize._eligibleAddresses[0]).to.equals(accounts[1]);
      expect(finalize._natWeights[0]).to.equals(vp1.toString());
      expect(finalize._natWeights[1]).to.equals(vp2.toString());
      expect(finalize._natWeights[2]).to.equals(vp3.toString());
      expect(finalize._natWeightsSum).to.equals((vp2 + vp1 + vp3).toString());
    });

    it("Should reward only those that sent price between first and third quartile", async () => {
      // IQR = 100%, elasticBand = 0% (width = 100%)
      await ftso.configureEpochs(1, 1, 1000, 10000, 50, 500, 0, 1000000, [accounts[5], accounts[6], accounts[7]], { from: accounts[10] });

      await ftso.submitPriceHash(epochId, submitPriceHash(499, 123, accounts[1]), { from: accounts[1] });
      await ftso.submitPriceHash(epochId, submitPriceHash(250, 124, accounts[2]), { from: accounts[2] });
      await ftso.submitPriceHash(epochId, submitPriceHash(400, 125, accounts[3]), { from: accounts[3] });

      await setMockVotePowerAt(10, 10**12, 0);
      await ftso.initializeCurrentEpochStateForReveal(50000, false, { from: accounts[10] });

      await increaseTimeTo((epochId + 1) * 120); // reveal period start
      await setMockVotePowerOfAt(10, 1000, 0, accounts[1]);
      await ftso.revealPrice(epochId, 499, 123, { from: accounts[1] });
      await setMockVotePowerOfAt(10, 5000, 0, accounts[2]);
      await ftso.revealPrice(epochId, 250, 124, { from: accounts[2] });
      await setMockVotePowerOfAt(10, 500, 0, accounts[3]);
      await ftso.revealPrice(epochId, 400, 125, { from: accounts[3] });

      await increaseTimeTo((epochId + 1) * 120 + 60); // reveal period end
      let finalize = await ftso.contract.methods.finalizePriceEpoch(epochId, true).call({ from: accounts[10] });
      let tx = await ftso.finalizePriceEpoch(epochId, true, { from: accounts[10] });

      expectEvent(tx, "PriceFinalized",
        { epochId: toBN(epochId), price: toBN(250), rewardedFtso: true, lowIQRRewardPrice: toBN(250), highIQRRewardPrice: toBN(250), lowElasticBandRewardPrice: toBN(0), highElasticBandRewardPrice: toBN(500), finalizationType: toBN(1) });

      // only accounts[2] should be rewarded (accounts[1] and accounts[3] sent price inside elastic band, but are elastic band reward share is 0%)
      let vp2 = 5000 * 6500 * 1e4;
      expect(finalize._eligibleAddresses.length).to.equals(1);
      expect(finalize._eligibleAddresses[0]).to.equals(accounts[2]);
      expect(finalize._natWeights[0]).to.equals(vp2.toString());
      expect(finalize._natWeightsSum).to.equals((vp2).toString());
    });

    it("Should calculate weights", async () => {
      // IQR = 5%, elasticBand = 95% (width = 10%)
      await ftso.configureEpochs(1, 1, 1000, 10000, 50, 500, 9500, 100000, [accounts[5], accounts[6], accounts[7]], { from: accounts[10] });

      await ftso.submitPriceHash(epochId, submitPriceHash(100, 8, accounts[1]), { from: accounts[1] });
      await ftso.submitPriceHash(epochId, submitPriceHash(100, 2, accounts[2]), { from: accounts[2] });
      await ftso.submitPriceHash(epochId, submitPriceHash(100, 3, accounts[3]), { from: accounts[3] });

      await setMockVotePowerAt(10, 10**12, 0);
      await ftso.initializeCurrentEpochStateForReveal(50000, false, { from: accounts[10] });

      await increaseTimeTo((epochId + 1) * 120); // reveal period start
      await setMockVotePowerOfAt(10, 1000, 0, accounts[1]);
      await ftso.revealPrice(epochId, 100, 8, { from: accounts[1] });
      await setMockVotePowerOfAt(10, 6000, 0, accounts[2]);
      await ftso.revealPrice(epochId, 100, 2, { from: accounts[2] });
      await setMockVotePowerOfAt(10, 2000, 0, accounts[3]);
      await ftso.revealPrice(epochId, 100, 3, { from: accounts[3] });

      await increaseTimeTo((epochId + 1) * 120 + 60); // reveal period end
      let finalize = await ftso.contract.methods.finalizePriceEpoch(epochId, true).call({ from: accounts[10] });
      let tx = await ftso.finalizePriceEpoch(epochId, true, { from: accounts[10] });

      expectEvent(tx, "PriceFinalized",
        { epochId: toBN(epochId), price: toBN(100), rewardedFtso: true, lowIQRRewardPrice: toBN(100), highIQRRewardPrice: toBN(100), lowElasticBandRewardPrice: toBN(90), highElasticBandRewardPrice: toBN(110), finalizationType: toBN(1) });

      // accounts[1] and accounts[2] are rewarded for IQR and elastic band, while accounts[3] only for elastic band (not for IQR because _isAddressEligible(accounts[3] == false))
      let vp1 = (500 * 9000 + 9500 * 7000) * 1000;
      let vp2 = (500 * 9000 + 9500 * 7000) * 6000;
      let vp3 = 9500 * 7000 * 2000;
      expect(finalize._eligibleAddresses.length).to.equals(3);
      expect(finalize._eligibleAddresses[0]).to.equals(accounts[1]);
      expect(finalize._eligibleAddresses[1]).to.equals(accounts[2]);
      expect(finalize._eligibleAddresses[2]).to.equals(accounts[3]);
      expect(finalize._natWeights[0]).to.equals(vp1.toString());
      expect(finalize._natWeights[1]).to.equals(vp2.toString());
      expect(finalize._natWeights[2]).to.equals(vp3.toString());
      expect(finalize._natWeightsSum).to.equals((vp2 + vp1 + vp3).toString());
    });

    it("Should calculate weights", async () => {
      // IQR = 5%, elasticBand = 95% (width = 40%)
      await ftso.configureEpochs(1, 1, 1000, 10000, 50, 500, 9500, 400000, [accounts[11], accounts[12], accounts[13]], { from: accounts[10] });

      await ftso.submitPriceHash(epochId, submitPriceHash(10, 8, accounts[1]), { from: accounts[1] });
      await ftso.submitPriceHash(epochId, submitPriceHash(20, 2, accounts[2]), { from: accounts[2] });
      await ftso.submitPriceHash(epochId, submitPriceHash(30, 3, accounts[3]), { from: accounts[3] });
      await ftso.submitPriceHash(epochId, submitPriceHash(40, 7, accounts[4]), { from: accounts[4] });
      await ftso.submitPriceHash(epochId, submitPriceHash(50, 1, accounts[5]), { from: accounts[5] });
      await ftso.submitPriceHash(epochId, submitPriceHash(60, 12, accounts[6]), { from: accounts[6] });

      await setMockVotePowerAt(10, 10**12, 0);
      await ftso.initializeCurrentEpochStateForReveal(50000, false, { from: accounts[10] });

      await increaseTimeTo((epochId + 1) * 120); // reveal period start
      await setMockVotePowerOfAt(10, 2000, 0, accounts[1]);
      await ftso.revealPrice(epochId, 10, 8, { from: accounts[1] });
      await setMockVotePowerOfAt(10, 2000, 0, accounts[2]);
      await ftso.revealPrice(epochId, 20, 2, { from: accounts[2] });
      await setMockVotePowerOfAt(10, 2000, 0, accounts[3]);
      await ftso.revealPrice(epochId, 30, 3, { from: accounts[3] });
      await setMockVotePowerOfAt(10, 2000, 0, accounts[4]);
      await ftso.revealPrice(epochId, 40, 7, { from: accounts[4] });
      await setMockVotePowerOfAt(10, 2000, 0, accounts[5]);
      await ftso.revealPrice(epochId, 50, 1, { from: accounts[5] });
      await setMockVotePowerOfAt(10, 2000, 0, accounts[6]);
      await ftso.revealPrice(epochId, 60, 12, { from: accounts[6] });

      await increaseTimeTo((epochId + 1) * 120 + 60); // reveal period end
      let finalize = await ftso.contract.methods.finalizePriceEpoch(epochId, true).call({ from: accounts[10] });
      let tx = await ftso.finalizePriceEpoch(epochId, true, { from: accounts[10] });

      expectEvent(tx, "PriceFinalized",
        { epochId: toBN(epochId), price: toBN(35), rewardedFtso: true, lowIQRRewardPrice: toBN(20), highIQRRewardPrice: toBN(50), lowElasticBandRewardPrice: toBN(21), highElasticBandRewardPrice: toBN(49), finalizationType: toBN(1) });

      // accounts[3] and accounts[4] are rewarded for IQR and elastic band, while accounts[2] only for elastic IQR
      let vp2 = 4000 * 500 * 2000;
      let vp3 = (500 * 4000 + 9500 * 6000) * 2000;
      let vp4 = (500 * 4000 + 9500 * 6000) * 2000;
      expect(finalize._eligibleAddresses.length).to.equals(3);
      expect(finalize._eligibleAddresses[0]).to.equals(accounts[2]);
      expect(finalize._eligibleAddresses[1]).to.equals(accounts[3]);
      expect(finalize._eligibleAddresses[2]).to.equals(accounts[4]);
      expect(finalize._natWeights[0]).to.equals(vp2.toString());
      expect(finalize._natWeights[1]).to.equals(vp3.toString());
      expect(finalize._natWeights[2]).to.equals(vp4.toString());
      expect(finalize._natWeightsSum).to.equals((vp2 + vp3 + vp4).toString());
    });

  });

  describe("short cyclic FTSO buffer", async () => {

    beforeEach(async () => {
      wnatInterface = await Wnat.new(accounts[0], "Wrapped NAT", "WNAT");
      await setDefaultVPContract(wnatInterface, accounts[0]);
      mockWnat = await MockWnat.new();
      vpTokenInterface = await VpToken.new(accounts[0], "A token", "ATOK");
      mockVpToken = await MockVpToken.new();
      mockPriceSubmitter = await MockPriceSubmitter.new();
      ftso = await MockFtsoFull.new(
        "ATOK",
        5,
        mockPriceSubmitter.address,
        mockWnat.address,
        accounts[10],
        0, 120, 60,
        1, // initial token price 0.00001$
        10000, // price deviation threshold in BIPS (100%)
        2, // short cyclic buffer
        false
      );

      await ftso.setAsset(mockVpToken.address, { from: accounts[10] });
      await ftso.configureEpochs(1, 1, 1000, 10000, 50, 500, 0, 0, [accounts[5], accounts[6], accounts[7]], { from: accounts[10] });
      await ftso.setVotePowerBlock(10, { from: accounts[10] });
      await ftso.activateFtso(0, 120, 60, { from: accounts[10] });

      // Force a block in order to get most up to date time
      await time.advanceBlock();
      // Get the timestamp for the just mined block
      let timestamp = await time.latest();
      epochId = Math.floor(timestamp.toNumber() / 120) + 1;
      await increaseTimeTo(epochId * 120);
    });

    it("Should finalize price epoch - four epochs with different vote power blocks", async () => {
      // round 1 - current asset price = 0
      await ftso.submitPriceHash(epochId, submitPriceHash(500, 123, accounts[1]), { from: accounts[1] });
      await ftso.submitPriceHash(epochId, submitPriceHash(250, 124, accounts[2]), { from: accounts[2] });
      await ftso.submitPriceHash(epochId, submitPriceHash(400, 125, accounts[3]), { from: accounts[3] });

      await setMockVotePowerAt(10, 50000, 1000000);
      await ftso.initializeCurrentEpochStateForReveal(50000, false, { from: accounts[10] });
      await ftso.setVotePowerBlock(12, { from: accounts[10] });

      await increaseTimeTo((epochId + 1) * 120); // reveal period start
      await setMockVotePowerOfAt(10, 1000, 100, accounts[1]);
      await ftso.revealPrice(epochId, 500, 123, { from: accounts[1] });
      await setMockVotePowerOfAt(10, 5000, 0, accounts[2]);
      await ftso.revealPrice(epochId, 250, 124, { from: accounts[2] });
      await setMockVotePowerOfAt(10, 0, 500, accounts[3]);
      await ftso.revealPrice(epochId, 400, 125, { from: accounts[3] });

      await increaseTimeTo((epochId + 1) * 120 + 60); // reveal period end
      expectEvent(await ftso.finalizePriceEpoch(epochId, true, { from: accounts[10] }), "PriceFinalized",
        { epochId: toBN(epochId), price: toBN(250), rewardedFtso: true, lowIQRRewardPrice: toBN(250), highIQRRewardPrice: toBN(250), finalizationType: toBN(1) });

      // round 2 - current asset price = 250
      await ftso.submitPriceHash(epochId + 1, submitPriceHash(300, 123, accounts[1]), { from: accounts[1] });
      await ftso.submitPriceHash(epochId + 1, submitPriceHash(400, 124, accounts[2]), { from: accounts[2] });
      await ftso.submitPriceHash(epochId + 1, submitPriceHash(200, 125, accounts[3]), { from: accounts[3] });

      await setMockVotePowerAt(12, 20000, 100000);
      await ftso.initializeCurrentEpochStateForReveal(20000, false, { from: accounts[10] });

      await increaseTimeTo((epochId + 2) * 120); // reveal period start
      await setMockVotePowerOfAt(12, 2000, 0, accounts[1]);
      await ftso.revealPrice(epochId + 1, 300, 123, { from: accounts[1] });
      await setMockVotePowerOfAt(12, 2000, 80000, accounts[2]);
      await ftso.revealPrice(epochId + 1, 400, 124, { from: accounts[2] });
      await setMockVotePowerOfAt(12, 2000, 10000, accounts[3]);
      await ftso.revealPrice(epochId + 1, 200, 125, { from: accounts[3] });

      await increaseTimeTo((epochId + 2) * 120 + 60); // reveal period end
      expectEvent(await ftso.finalizePriceEpoch(epochId + 1, false, { from: accounts[10] }), "PriceFinalized",
        { epochId: toBN(epochId + 1), price: toBN(400), rewardedFtso: false, lowIQRRewardPrice: toBN(300), highIQRRewardPrice: toBN(400), finalizationType: toBN(1) });

      // round 3 
      await ftso.submitPriceHash(epochId + 2, submitPriceHash(300, 123, accounts[1]), { from: accounts[1] });
      await ftso.submitPriceHash(epochId + 2, submitPriceHash(400, 124, accounts[2]), { from: accounts[2] });
      await ftso.submitPriceHash(epochId + 2, submitPriceHash(200, 125, accounts[3]), { from: accounts[3] });

      await setMockVotePowerAt(12, 20000, 100000);
      await ftso.initializeCurrentEpochStateForReveal(20000, false, { from: accounts[10] });

      await increaseTimeTo((epochId + 3) * 120); // reveal period start
      await setMockVotePowerOfAt(12, 2000, 0, accounts[1]);
      await ftso.revealPrice(epochId + 2, 300, 123, { from: accounts[1] });
      await setMockVotePowerOfAt(12, 200, 100, accounts[2]);
      await ftso.revealPrice(epochId + 2, 400, 124, { from: accounts[2] });
      await setMockVotePowerOfAt(12, 2000, 100000, accounts[3]);
      await ftso.revealPrice(epochId + 2, 200, 125, { from: accounts[3] });

      await increaseTimeTo((epochId + 3) * 120 + 60); // reveal period end
      expectEvent(await ftso.finalizePriceEpoch(epochId + 2, false, { from: accounts[10] }), "PriceFinalized",
        { epochId: toBN(epochId + 2), price: toBN(200), rewardedFtso: false, lowIQRRewardPrice: toBN(200), highIQRRewardPrice: toBN(300), finalizationType: toBN(1) });

      // round 4
      await ftso.submitPriceHash(epochId + 3, submitPriceHash(300, 123, accounts[1]), { from: accounts[1] });
      await ftso.submitPriceHash(epochId + 3, submitPriceHash(400, 124, accounts[2]), { from: accounts[2] });
      await ftso.submitPriceHash(epochId + 3, submitPriceHash(200, 125, accounts[3]), { from: accounts[3] });

      await setMockVotePowerAt(12, 20000, 100000);
      await ftso.initializeCurrentEpochStateForReveal(20000, false, { from: accounts[10] });

      await increaseTimeTo((epochId + 4) * 120); // reveal period start
      await setMockVotePowerOfAt(12, 2000, 0, accounts[1]);
      await ftso.revealPrice(epochId + 3, 300, 123, { from: accounts[1] });
      await setMockVotePowerOfAt(12, 200, 100, accounts[2]);
      await ftso.revealPrice(epochId + 3, 400, 124, { from: accounts[2] });
      await setMockVotePowerOfAt(12, 2000, 100000, accounts[3]);
      await ftso.revealPrice(epochId + 3, 200, 125, { from: accounts[3] });

      await increaseTimeTo((epochId + 4) * 120 + 60); // reveal period end
      expectEvent(await ftso.finalizePriceEpoch(epochId + 3, false, { from: accounts[10] }), "PriceFinalized",
        { epochId: toBN(epochId + 3), price: toBN(200), rewardedFtso: false, lowIQRRewardPrice: toBN(200), highIQRRewardPrice: toBN(300), finalizationType: toBN(1) });
    });
  });

  describe("finalize price (without xAsset)", async () => {
    beforeEach(async () => {
      wnatInterface = await Wnat.new(accounts[0], "Wrapped NAT", "WNAT");
      await setDefaultVPContract(wnatInterface, accounts[0]);
      mockWnat = await MockWnat.new();
      vpTokenInterface = await VpToken.new(accounts[0], "A token", "ATOK");
      mockVpToken = await MockVpToken.new();
      mockPriceSubmitter = await MockPriceSubmitter.new();
      ftso = await MockFtsoFull.new(
        "ATOK",
        5,
        mockPriceSubmitter.address,
        mockWnat.address,
        accounts[10],
        0, 120, 60,
        1, // initial token price 0.00001$
        1e10,
        defaultPriceEpochCyclicBufferSize,
        false
      );

      await ftso.configureEpochs(1, 1, 1000, 10000, 50, 500, 0, 0, [], { from: accounts[10] });
      await ftso.setVotePowerBlock(10, { from: accounts[10] });
      await ftso.activateFtso(0, 120, 60, { from: accounts[10] });

      // Force a block in order to get most up to date time
      await time.advanceBlock();
      // Get the timestamp for the just mined block
      let timestamp = await time.latest();
      epochId = Math.floor(timestamp.toNumber() / 120) + 1;
      await increaseTimeTo(epochId * 120);
    });

    it("Should finalize price epoch - two epochs", async () => {
      // round 1 - current asset price = 0
      await ftso.submitPriceHash(epochId, submitPriceHash(500, 123, accounts[1]), { from: accounts[1] });
      await ftso.submitPriceHash(epochId, submitPriceHash(250, 124, accounts[2]), { from: accounts[2] });
      await ftso.submitPriceHash(epochId, submitPriceHash(400, 125, accounts[3]), { from: accounts[3] });

      await setMockVotePowerAt(10, 50000, 1000000);
      await ftso.initializeCurrentEpochStateForReveal(50000, false, { from: accounts[10] });

      await increaseTimeTo((epochId + 1) * 120); // reveal period start
      await setMockVotePowerOfAt(10, 1000, 100, accounts[1]);
      await ftso.revealPrice(epochId, 500, 123, { from: accounts[1] });
      await setMockVotePowerOfAt(10, 5000, 0, accounts[2]);
      await ftso.revealPrice(epochId, 250, 124, { from: accounts[2] });
      await setMockVotePowerOfAt(10, 1, 500, accounts[3]);
      await ftso.revealPrice(epochId, 400, 125, { from: accounts[3] });

      await increaseTimeTo((epochId + 1) * 120 + 60); // reveal period end
      expectEvent(await ftso.finalizePriceEpoch(epochId, false, { from: accounts[10] }), "PriceFinalized",
        { epochId: toBN(epochId), price: toBN(250), rewardedFtso: false, lowIQRRewardPrice: toBN(250), highIQRRewardPrice: toBN(250), finalizationType: toBN(1) });

      // round 2 - current asset price = 250
      await ftso.submitPriceHash(epochId + 1, submitPriceHash(300, 123, accounts[1]), { from: accounts[1] });
      await ftso.submitPriceHash(epochId + 1, submitPriceHash(400, 124, accounts[2]), { from: accounts[2] });
      await ftso.submitPriceHash(epochId + 1, submitPriceHash(200, 125, accounts[3]), { from: accounts[3] });

      await setMockVotePowerAt(10, 50000, 1000000);
      await ftso.initializeCurrentEpochStateForReveal(50000, false, { from: accounts[10] });

      await increaseTimeTo((epochId + 2) * 120); // reveal period start
      await setMockVotePowerOfAt(10, 1000, 10000, accounts[1]);
      await ftso.revealPrice(epochId + 1, 300, 123, { from: accounts[1] });
      await setMockVotePowerOfAt(10, 5000, 0, accounts[2]);
      await ftso.revealPrice(epochId + 1, 400, 124, { from: accounts[2] });
      await setMockVotePowerOfAt(10, 1, 50000, accounts[3]);
      await ftso.revealPrice(epochId + 1, 200, 125, { from: accounts[3] });

      await increaseTimeTo((epochId + 2) * 120 + 60); // reveal period end
      expectEvent(await ftso.finalizePriceEpoch(epochId + 1, false, { from: accounts[10] }), "PriceFinalized",
        { epochId: toBN(epochId + 1), price: toBN(400), rewardedFtso: false, lowIQRRewardPrice: toBN(400), highIQRRewardPrice: toBN(400), finalizationType: toBN(1) });
    });

    it("Should finalize price epoch - two epochs with different vote power blocks", async () => {
      // round 1 - current asset price = 0
      await ftso.submitPriceHash(epochId, submitPriceHash(500, 123, accounts[1]), { from: accounts[1] });
      await ftso.submitPriceHash(epochId, submitPriceHash(250, 124, accounts[2]), { from: accounts[2] });
      await ftso.submitPriceHash(epochId, submitPriceHash(400, 125, accounts[3]), { from: accounts[3] });

      await setMockVotePowerAt(10, 50000, 1000000);
      await ftso.initializeCurrentEpochStateForReveal(50000, false, { from: accounts[10] });
      await ftso.setVotePowerBlock(12, { from: accounts[10] });

      // should ignore xAsset amounts
      await increaseTimeTo((epochId + 1) * 120); // reveal period start
      await setMockVotePowerOfAt(10, 1000, 10000, accounts[1]);
      await ftso.revealPrice(epochId, 500, 123, { from: accounts[1] });
      await setMockVotePowerOfAt(10, 5000, 0, accounts[2]);
      await ftso.revealPrice(epochId, 250, 124, { from: accounts[2] });
      await setMockVotePowerOfAt(10, 1, 50000, accounts[3]);
      await ftso.revealPrice(epochId, 400, 125, { from: accounts[3] });

      await increaseTimeTo((epochId + 1) * 120 + 60); // reveal period end
      expectEvent(await ftso.finalizePriceEpoch(epochId, false, { from: accounts[10] }), "PriceFinalized",
        { epochId: toBN(epochId), price: toBN(250), rewardedFtso: false, lowIQRRewardPrice: toBN(250), highIQRRewardPrice: toBN(250), finalizationType: toBN(1) });

      // round 2 - current asset price = 250
      await ftso.submitPriceHash(epochId + 1, submitPriceHash(300, 123, accounts[1]), { from: accounts[1] });
      await ftso.submitPriceHash(epochId + 1, submitPriceHash(400, 124, accounts[2]), { from: accounts[2] });
      await ftso.submitPriceHash(epochId + 1, submitPriceHash(200, 125, accounts[3]), { from: accounts[3] });

      await setMockVotePowerAt(12, 20000, 100000);
      await ftso.initializeCurrentEpochStateForReveal(20000, false, { from: accounts[10] });

      // should ignore xAsset amounts
      await increaseTimeTo((epochId + 2) * 120); // reveal period start
      await setMockVotePowerOfAt(12, 2000, 0, accounts[1]);
      await ftso.revealPrice(epochId + 1, 300, 123, { from: accounts[1] });
      await setMockVotePowerOfAt(12, 2000, 80000, accounts[2]);
      await ftso.revealPrice(epochId + 1, 400, 124, { from: accounts[2] });
      await setMockVotePowerOfAt(12, 2000, 10000, accounts[3]);
      await ftso.revealPrice(epochId + 1, 200, 125, { from: accounts[3] });

      await increaseTimeTo((epochId + 2) * 120 + 60); // reveal period end
      expectEvent(await ftso.finalizePriceEpoch(epochId + 1, false, { from: accounts[10] }), "PriceFinalized",
        { epochId: toBN(epochId + 1), price: toBN(300), rewardedFtso: false, lowIQRRewardPrice: toBN(200), highIQRRewardPrice: toBN(400), finalizationType: toBN(1) });
    });

    it("Should finalize price epoch - two epochs - no votes in second one", async () => {
      // round 1 - current asset price = 0
      await ftso.submitPriceHash(epochId, submitPriceHash(500, 123, accounts[1]), { from: accounts[1] });
      await ftso.submitPriceHash(epochId, submitPriceHash(250, 124, accounts[2]), { from: accounts[2] });
      await ftso.submitPriceHash(epochId, submitPriceHash(400, 125, accounts[3]), { from: accounts[3] });

      await setMockVotePowerAt(10, 50000, 1000000);
      await ftso.initializeCurrentEpochStateForReveal(50000, false, { from: accounts[10] });

      await increaseTimeTo((epochId + 1) * 120); // reveal period start
      await setMockVotePowerOfAt(10, 1000, 10000, accounts[1]);
      await ftso.revealPrice(epochId, 500, 123, { from: accounts[1] });
      await setMockVotePowerOfAt(10, 5000, 0, accounts[2]);
      await ftso.revealPrice(epochId, 250, 124, { from: accounts[2] });
      await setMockVotePowerOfAt(10, 1, 50000, accounts[3]);
      await ftso.revealPrice(epochId, 400, 125, { from: accounts[3] });

      await increaseTimeTo((epochId + 1) * 120 + 60); // reveal period end
      expectEvent(await ftso.finalizePriceEpoch(epochId, false, { from: accounts[10] }), "PriceFinalized",
        { epochId: toBN(epochId), price: toBN(250), rewardedFtso: false, lowIQRRewardPrice: toBN(250), highIQRRewardPrice: toBN(250), finalizationType: toBN(1) });

      let priceDetails = await ftso.getCurrentPriceDetails();
      expect(priceDetails[0].toNumber()).to.equals(250);
      expect(priceDetails[1].toNumber()).to.be.gt((epochId + 1) * 120 + 60);
      expect(priceDetails[2].toNumber()).to.equals(1);
      expect(priceDetails[3].toNumber()).to.be.gt((epochId + 1) * 120 + 60);
      expect(priceDetails[4].toNumber()).to.equals(1);

      await ftso.initializeCurrentEpochStateForReveal(50000, false, { from: accounts[10] });

      // round 2 - current asset price = 250
      await increaseTimeTo((epochId + 2) * 120 + 60); // reveal period end
      expectEvent(await ftso.finalizePriceEpoch(epochId + 1, false, { from: accounts[10] }), "PriceFinalized",
        { epochId: toBN(epochId + 1), price: toBN(250), rewardedFtso: false, lowIQRRewardPrice: toBN(0), highIQRRewardPrice: toBN(0), finalizationType: toBN(3) });

      let priceDetails2 = await ftso.getCurrentPriceDetails();
      expect(priceDetails2[0].toNumber()).to.equals(250);
      expect(priceDetails2[1].toNumber()).to.equals(priceDetails[1].toNumber())
      expect(priceDetails2[2].toNumber()).to.equals(1);
      expect(priceDetails2[3].toNumber()).to.be.gt((epochId + 2) * 120 + 60);
      expect(priceDetails2[3].toNumber()).not.to.equal(priceDetails[1].toNumber());
      expect(priceDetails2[4].toNumber()).to.equals(3);
    });

    it("Should finalize price epoch and return rewarded addresses", async () => {
      // round 1 - current asset price = 0
      await ftso.submitPriceHash(epochId, submitPriceHash(500, 123, accounts[1]), { from: accounts[1] });
      await ftso.submitPriceHash(epochId, submitPriceHash(250, 124, accounts[2]), { from: accounts[2] });
      await ftso.submitPriceHash(epochId, submitPriceHash(400, 125, accounts[3]), { from: accounts[3] });

      await setMockVotePowerAt(10, 50000, 1000000);
      await ftso.initializeCurrentEpochStateForReveal(50000, false, { from: accounts[10] });
      await ftso.setVotePowerBlock(12, { from: accounts[10] });

      await increaseTimeTo((epochId + 1) * 120); // reveal period start
      await setMockVotePowerOfAt(10, 1000, 10000, accounts[1]);
      await ftso.revealPrice(epochId, 500, 123, { from: accounts[1] });
      await setMockVotePowerOfAt(10, 5000, 0, accounts[2]);
      await ftso.revealPrice(epochId, 250, 124, { from: accounts[2] });
      await setMockVotePowerOfAt(10, 1, 50000, accounts[3]);
      await ftso.revealPrice(epochId, 400, 125, { from: accounts[3] });

      await increaseTimeTo((epochId + 1) * 120 + 60 + 1); // reveal period end (+1 as call does not increase time)

      let data = await ftso.contract.methods.finalizePriceEpoch(epochId, true).call({ from: accounts[10] });
      expect(data._eligibleAddresses.length).to.equals(1);
      expect(data._eligibleAddresses[0]).to.equals(accounts[2]);
      expect(data._natWeights.length).to.equals(1);
      expect(data._natWeights[0]).to.equals('1000000000000000');
      expect(data._natWeightsSum).to.equals('1000000000000000');
      await ftso.finalizePriceEpoch(epochId, true, { from: accounts[10] });

      await ftso.initializeCurrentEpochStateForReveal(50000, false, { from: accounts[10] });

      // round 2 - current asset price = 250
      await increaseTimeTo((epochId + 2) * 120 + 60 + 1); // reveal period end (+1 as call does not increase time)
      let data2 = await ftso.contract.methods.finalizePriceEpoch(epochId + 1, true).call({ from: accounts[10] });
      expect(data2._eligibleAddresses.length).to.equals(0);
      expect(data2._natWeights.length).to.equals(0);
      expect(data2._natWeightsSum).to.equals('0');
      await ftso.finalizePriceEpoch(epochId + 1, true, { from: accounts[10] });

      // round 3 - current asset price = 250
      await ftso.submitPriceHash(epochId + 2, submitPriceHash(300, 123, accounts[1]), { from: accounts[1] });
      await ftso.submitPriceHash(epochId + 2, submitPriceHash(400, 124, accounts[2]), { from: accounts[2] });
      await ftso.submitPriceHash(epochId + 2, submitPriceHash(200, 125, accounts[3]), { from: accounts[3] });

      await setMockVotePowerAt(12, 20000, 100000);
      await ftso.initializeCurrentEpochStateForReveal(20000, false, { from: accounts[10] });

      await increaseTimeTo((epochId + 3) * 120); // reveal period start
      await setMockVotePowerOfAt(12, 4000, 0, accounts[1]);
      await ftso.revealPrice(epochId + 2, 300, 123, { from: accounts[1] });
      await setMockVotePowerOfAt(12, 3000, 80000, accounts[2]);
      await ftso.revealPrice(epochId + 2, 400, 124, { from: accounts[2] });
      await setMockVotePowerOfAt(12, 2000, 10000, accounts[3]);
      await ftso.revealPrice(epochId + 2, 200, 125, { from: accounts[3] });

      await increaseTimeTo((epochId + 3) * 120 + 60 + 1); // reveal period end (+1 as call does not increase time)
      let data3 = await ftso.contract.methods.finalizePriceEpoch(epochId + 2, true).call({ from: accounts[10] });
      expect(data3._eligibleAddresses.length).to.equals(1);
      let id1 = data3._eligibleAddresses.indexOf(accounts[1]);
      let id2 = data3._eligibleAddresses.indexOf(accounts[2]);
      expect(id2).to.equals(-1);
      expect(data3._eligibleAddresses[id1]).to.equals(accounts[1]);
      expect(data3._natWeights.length).to.equals(1);
      expect(data3._natWeights[id1]).to.equals('2000000000000000');
      expect(data3._natWeightsSum).to.equals('2000000000000000');
      await ftso.finalizePriceEpoch(epochId + 2, true, { from: accounts[10] });
    });
  });

  describe("getters", async () => {
    beforeEach(async () => {
      wnatInterface = await Wnat.new(accounts[0], "Wrapped NAT", "WNAT");
      await setDefaultVPContract(wnatInterface, accounts[0]);
      mockWnat = await MockWnat.new();
      vpTokenInterface = await VpToken.new(accounts[0], "A token", "ATOK");
      mockVpToken = await MockVpToken.new();
      ftso = await MockFtsoFull.new(
        "ATOK",
        5,
        accounts[4],
        mockWnat.address,
        accounts[10],
        0, 120, 60,
        1, // initial token price 0.00001$
        1e10,
        defaultPriceEpochCyclicBufferSize,
        false
      );

      await ftso.setAsset(mockVpToken.address, { from: accounts[10] });
      await ftso.configureEpochs(1, 1, 1000, 10000, 50, 500, 0, 0, [accounts[5], accounts[6], accounts[7]], { from: accounts[10] });
      await ftso.setVotePowerBlock(10, { from: accounts[10] });
      await ftso.activateFtso(0, 120, 60, { from: accounts[10] });

      // Force a block in order to get most up to date time
      await time.advanceBlock();
      // Get the timestamp for the just mined block
      let timestamp = await time.latest();
      epochId = Math.floor(timestamp.toNumber() / 120) + 1;
      await increaseTimeTo(epochId * 120);
    });

    it("Should get price epoch configuration", async () => {
      let data = await ftso.getPriceEpochConfiguration();
      expect(data[0].toNumber()).to.equals(0);
      expect(data[1].toNumber()).to.equals(120);
      expect(data[2].toNumber()).to.equals(60);
    });

    it("Should get epochs configuration", async () => {
      await ftso.configureEpochs(10, 100, 1000, 10000, 50, 500, 0, 0, [accounts[1]], { from: accounts[10] });
      let data = await ftso.epochsConfiguration();
      expect(data[0].toNumber()).to.equals(10);
      expect(data[1].toNumber()).to.equals(100);
      expect(data[2].toNumber()).to.equals(1000);
      expect(data[3].toNumber()).to.equals(10000);
      expect(data[4].toNumber()).to.equals(50);
      expect(data[5].toNumber()).to.equals(500);
      expect(data[8]).to.eqls([accounts[1]]);
    });

    it("Should get asset", async () => {
      let address = await ftso.getAsset();
      expect(address).to.equals(mockVpToken.address);
    });

    it("Should get initial asset price", async () => {
      let price = await ftso.getCurrentPrice();
      expect(price[0].toNumber()).to.equals(1);
      expect(price[1].toNumber()).to.be.gt(0);
    });

    it("Should not get asset if asset is not set", async () => {
      const ftso = await MockFtsoFull.new(
        "WNAT",
        5,
        accounts[4],
        mockWnat.address,
        accounts[10],
        0, 120, 60,
        1, // initial token price 0.00001$
        1e10,
        defaultPriceEpochCyclicBufferSize,
        false
      );
      let address = await ftso.getAsset();
      expect(address).to.equals(constants.ZERO_ADDRESS);
    });

    it("Should get current price", async () => {
      let price = await ftso.getCurrentPrice();
      expect(price[0].toNumber()).to.equals(1);

      await ftso.submitPriceHash(epochId, submitPriceHash(500, 123, accounts[1]), { from: accounts[1] });
      await ftso.submitPriceHash(epochId, submitPriceHash(250, 124, accounts[2]), { from: accounts[2] });
      await ftso.submitPriceHash(epochId, submitPriceHash(400, 125, accounts[3]), { from: accounts[3] });

      await setMockVotePowerAt(10, 50000, 1000000);
      await ftso.initializeCurrentEpochStateForReveal(50000, false, { from: accounts[10] });
      await ftso.setVotePowerBlock(12, { from: accounts[10] });

      await increaseTimeTo((epochId + 1) * 120); // reveal period start
      await setMockVotePowerOfAt(10, 1000, 100, accounts[1]);
      await ftso.revealPrice(epochId, 500, 123, { from: accounts[1] });
      await setMockVotePowerOfAt(10, 5000, 0, accounts[2]);
      await ftso.revealPrice(epochId, 250, 124, { from: accounts[2] });
      await setMockVotePowerOfAt(10, 0, 500, accounts[3]);
      await ftso.revealPrice(epochId, 400, 125, { from: accounts[3] });

      await increaseTimeTo((epochId + 1) * 120 + 60); // reveal period end
      await ftso.finalizePriceEpoch(epochId, false, { from: accounts[10] }); // finalize price -> new current price = 250

      let price2 = await ftso.getCurrentPrice();
      expect(price2[0].toNumber()).to.equals(250);
    });

    it("Should get epoch price", async () => {
      // should revert before initialization
      await expectRevert(ftso.getEpochPrice(epochId), "Epoch data not available");

      await increaseTimeTo(epochId * 120 + 30); // initialize price epoch
      await setMockVotePowerAt(10, 50000, 1000000);
      await ftso.initializeCurrentEpochStateForReveal(50000, false, { from: accounts[10] });

      let price = await ftso.getEpochPrice(epochId);
      expect(price.toNumber()).to.equals(0);

      await ftso.submitPriceHash(epochId, submitPriceHash(500, 123, accounts[1]), { from: accounts[1] });
      await ftso.submitPriceHash(epochId, submitPriceHash(250, 124, accounts[2]), { from: accounts[2] });
      await ftso.submitPriceHash(epochId, submitPriceHash(400, 125, accounts[3]), { from: accounts[3] });

      await ftso.setVotePowerBlock(12, { from: accounts[10] });

      await increaseTimeTo((epochId + 1) * 120); // reveal period start
      await setMockVotePowerOfAt(10, 1000, 100, accounts[1]);
      await ftso.revealPrice(epochId, 500, 123, { from: accounts[1] });
      await setMockVotePowerOfAt(10, 5000, 0, accounts[2]);
      await ftso.revealPrice(epochId, 250, 124, { from: accounts[2] });
      await setMockVotePowerOfAt(10, 0, 500, accounts[3]);
      await ftso.revealPrice(epochId, 400, 125, { from: accounts[3] });

      await increaseTimeTo((epochId + 1) * 120 + 60); // reveal period end
      await ftso.finalizePriceEpoch(epochId, false, { from: accounts[10] }); // finalize price -> epochId price = 250

      let price2 = await ftso.getEpochPrice(epochId);
      expect(price2.toNumber()).to.equals(250);

      // round 2 - current asset price = 250
      await ftso.submitPriceHash(epochId + 1, submitPriceHash(300, 123, accounts[1]), { from: accounts[1] });
      await ftso.submitPriceHash(epochId + 1, submitPriceHash(400, 124, accounts[2]), { from: accounts[2] });
      await ftso.submitPriceHash(epochId + 1, submitPriceHash(200, 125, accounts[3]), { from: accounts[3] });

      await setMockVotePowerAt(12, 20000, 100000);
      await ftso.initializeCurrentEpochStateForReveal(20000, false, { from: accounts[10] });

      await increaseTimeTo((epochId + 2) * 120); // reveal period start
      await setMockVotePowerOfAt(12, 2000, 0, accounts[1]);
      await ftso.revealPrice(epochId + 1, 300, 123, { from: accounts[1] });
      await setMockVotePowerOfAt(12, 2000, 80000, accounts[2]);
      await ftso.revealPrice(epochId + 1, 400, 124, { from: accounts[2] });
      await setMockVotePowerOfAt(12, 2000, 10000, accounts[3]);
      await ftso.revealPrice(epochId + 1, 200, 125, { from: accounts[3] });

      await increaseTimeTo((epochId + 2) * 120 + 60); // reveal period end
      await ftso.finalizePriceEpoch(epochId + 1, false, { from: accounts[10] }); // finalize price -> epochId+1 price = 400

      let price3 = await ftso.getEpochPrice(epochId);
      expect(price3.toNumber()).to.equals(250);
      let price4 = await ftso.getEpochPrice(epochId + 1);
      expect(price4.toNumber()).to.equals(400);
    });

    it("Should get epoch price for voter", async () => {
      // should revert before initialization
      await expectRevert(ftso.getEpochPriceForVoter(epochId, accounts[1]), "Epoch data not available");

      await increaseTimeTo(epochId * 120 + 30); // initialize price epoch
      await setMockVotePowerAt(10, 50000, 1000000);
      await ftso.initializeCurrentEpochStateForReveal(50000, false, { from: accounts[10] });

      let price = await ftso.getEpochPriceForVoter(epochId, accounts[1]);
      expect(price.toNumber()).to.equals(0);
      let price1 = await ftso.getEpochPriceForVoter(epochId, accounts[2]);
      expect(price1.toNumber()).to.equals(0);

      await ftso.submitPriceHash(epochId, submitPriceHash(500, 123, accounts[1]), { from: accounts[1] });
      await ftso.submitPriceHash(epochId, submitPriceHash(250, 124, accounts[2]), { from: accounts[2] });

      await ftso.setVotePowerBlock(12, { from: accounts[10] });

      await increaseTimeTo((epochId + 1) * 120); // reveal period start

      await setMockVotePowerOfAt(10, 1000, 10000, accounts[1]);
      await ftso.revealPrice(epochId, 500, 123, { from: accounts[1] });
      let price2 = ftso.getEpochPriceForVoter(epochId - 1, accounts[1]);
      await expectRevert(price2, "Epoch data not available");
      let price3 = await ftso.getEpochPriceForVoter(epochId, accounts[1]);
      expect(price3.toNumber()).to.equals(500);
      let price4 = ftso.getEpochPriceForVoter(epochId + 1, accounts[1]);
      await expectRevert(price4, "Epoch data not available");

      await setMockVotePowerOfAt(10, 5000, 0, accounts[2]);
      await ftso.revealPrice(epochId, 250, 124, { from: accounts[2] });
      let price5 = await ftso.getEpochPriceForVoter(epochId, accounts[2]);
      expect(price5.toNumber()).to.equals(250);

      await increaseTimeTo((epochId + 1) * 120 + 60); // reveal period end
      await ftso.finalizePriceEpoch(epochId, false, { from: accounts[10] });

      // round 2 - current asset price = 250
      await ftso.submitPriceHash(epochId + 1, submitPriceHash(300, 223, accounts[1]), { from: accounts[1] });
      await ftso.submitPriceHash(epochId + 1, submitPriceHash(400, 300, accounts[2]), { from: accounts[2] });

      await setMockVotePowerAt(12, 20000, 100000);
      await ftso.initializeCurrentEpochStateForReveal(20000, false, { from: accounts[10] });

      await increaseTimeTo((epochId + 2) * 120); // reveal period start
      let price6 = await ftso.getEpochPriceForVoter(epochId, accounts[1]);
      expect(price6.toNumber()).to.equals(500);

      await setMockVotePowerOfAt(12, 2000, 0, accounts[1]);
      await ftso.revealPrice(epochId + 1, 300, 223, { from: accounts[1] });
      let price7 = await ftso.getEpochPriceForVoter(epochId, accounts[1]);
      expect(price7.toNumber()).to.equals(500);
      let price8 = await ftso.getEpochPriceForVoter(epochId + 1, accounts[1]);
      expect(price8.toNumber()).to.equals(300);

      await setMockVotePowerOfAt(12, 2000, 80000, accounts[2]);
      await ftso.revealPrice(epochId + 1, 400, 300, { from: accounts[2] });
      let price9 = await ftso.getEpochPriceForVoter(epochId, accounts[2]);
      expect(price9.toNumber()).to.equals(250);
      let price10 = await ftso.getEpochPriceForVoter(epochId + 1, accounts[2]);
      expect(price10.toNumber()).to.equals(400);
    });

    it("Should get current price epoch data", async () => {
      await ftso.configureEpochs(1, 1, 1000, 10000, 50, 500, 0, 0, [accounts[5], accounts[6], accounts[7]], { from: accounts[10] });
      await setMockVotePowerAt(10, 50000, 10000000);
      let data = await ftso.getPriceEpochData();
      expect(data[0].toNumber()).to.equals(epochId);
      expect(data[1].toNumber()).to.equals((epochId + 1) * 120);
      expect(data[2].toNumber()).to.equals((epochId + 1) * 120 + 60);
      expect(data[3].toNumber()).to.equals(0);
      expect(data[4]).to.equals(false);

      await ftso.initializeCurrentEpochStateForReveal(50000, false, { from: accounts[10] });
      let data1 = await ftso.getPriceEpochData();
      expect(data1[0].toNumber()).to.equals(epochId);
      expect(data1[1].toNumber()).to.equals((epochId + 1) * 120);
      expect(data1[2].toNumber()).to.equals((epochId + 1) * 120 + 60);
      expect(data1[3].toNumber()).to.equals(10); // current price = 1
      expect(data1[4]).to.equals(false);

      await ftso.submitPriceHash(epochId, submitPriceHash(500, 123, accounts[1]), { from: accounts[1] });

      await increaseTimeTo((epochId + 1) * 120 - 1);
      let data2 = await ftso.getPriceEpochData();
      expect(data2[0].toNumber()).to.equals(epochId);
      expect(data2[1].toNumber()).to.equals((epochId + 1) * 120);
      expect(data2[2].toNumber()).to.equals((epochId + 1) * 120 + 60);
      expect(data2[3].toNumber()).to.equals(10); // current price = 1
      expect(data2[4]).to.equals(false);

      await increaseTimeTo((epochId + 1) * 120);
      let data3 = await ftso.getPriceEpochData();
      expect(data3[0].toNumber()).to.equals(epochId + 1);
      expect(data3[1].toNumber()).to.equals((epochId + 2) * 120);
      expect(data3[2].toNumber()).to.equals((epochId + 2) * 120 + 60);
      expect(data3[3].toNumber()).to.equals(0);
      expect(data3[4]).to.equals(false);

      await setMockVotePowerOfAt(10, 10000, 10000, accounts[1]);
      await ftso.revealPrice(epochId, 500, 123, { from: accounts[1] });

      await increaseTimeTo((epochId + 1) * 120 + 60);
      await ftso.finalizePriceEpoch(epochId, false, { from: accounts[10] });

      await ftso.initializeCurrentEpochStateForReveal(50000, false, { from: accounts[10] });

      let data4 = await ftso.getPriceEpochData();
      expect(data4[0].toNumber()).to.equals(epochId + 1);
      expect(data4[1].toNumber()).to.equals((epochId + 2) * 120);
      expect(data4[2].toNumber()).to.equals((epochId + 2) * 120 + 60);
      expect(data4[3].toNumber()).to.equals(10); // current price = 500
      expect(data4[4]).to.equals(false);
    });

    it("Should get current price epoch data - fallback mode", async () => {
      await ftso.configureEpochs(1, 1, 1000, 10000, 50, 500, 0, 0, [accounts[5], accounts[6], accounts[7]], { from: accounts[10] });
      await setMockVotePowerAt(10, 50000, 10000000);
      let data = await ftso.getPriceEpochData();
      expect(data[0].toNumber()).to.equals(epochId);
      expect(data[1].toNumber()).to.equals((epochId + 1) * 120);
      expect(data[2].toNumber()).to.equals((epochId + 1) * 120 + 60);
      expect(data[3].toNumber()).to.equals(0); // not yet set
      expect(data[4]).to.equals(false);

      await ftso.initializeCurrentEpochStateForReveal(50000, true, { from: accounts[10] });
      let data1 = await ftso.getPriceEpochData();
      expect(data1[0].toNumber()).to.equals(epochId);
      expect(data1[1].toNumber()).to.equals((epochId + 1) * 120);
      expect(data1[2].toNumber()).to.equals((epochId + 1) * 120 + 60);
      expect(data1[3].toNumber()).to.equals(10);
      expect(data1[4]).to.equals(true);
    });

    it("Should get current epoch id", async () => {
      let currentEpochId = await ftso.getCurrentEpochId();
      expect(currentEpochId.toNumber()).to.equals(epochId);

      await increaseTimeTo((epochId + 1) * 120 - 1);
      let currentEpochId2 = await ftso.getCurrentEpochId();
      expect(currentEpochId2.toNumber()).to.equals(epochId);

      await increaseTimeTo((epochId + 1) * 120);
      let currentEpochId3 = await ftso.getCurrentEpochId();
      expect(currentEpochId3.toNumber()).to.equals(epochId + 1);
    });

    it("Should get epoch id", async () => {
      let calcEpochId = await ftso.getEpochId(epochId * 120);
      expect(calcEpochId.toNumber()).to.equals(epochId);

      let calcEpochId2 = await ftso.getEpochId((epochId + 1) * 120 - 1);
      expect(calcEpochId2.toNumber()).to.equals(epochId);

      let calcEpochId3 = await ftso.getEpochId((epochId + 1) * 120);
      expect(calcEpochId3.toNumber()).to.equals(epochId + 1);

      let calcEpochId4 = await ftso.getEpochId(0);
      expect(calcEpochId4.toNumber()).to.equals(0);
    });

    it("Should get epoch id - no underflow", async () => {
      const ftso1 = await MockFtsoFull.new(
        "ATOK",
        5,
        accounts[4],
        mockWnat.address,
        accounts[10],
        500, 120, 60,
        1, // initial token price 0.00001$
        1e10,
        defaultPriceEpochCyclicBufferSize,
        false
      );
      await ftso1.activateFtso(500, 120, 60, { from: accounts[10] });

      let currentEpochId = await ftso1.getEpochId(0);
      expect(currentEpochId.toString()).to.equals('0');

      let timestamp = (await time.latest()).toNumber() + 500;
      ftso = await MockFtsoFull.new(
        "ATOK",
        5,
        accounts[4],
        mockWnat.address,
        accounts[10],
        timestamp, 120, 60,
        1, // initial token price 0.00001$
        1e10,
        defaultPriceEpochCyclicBufferSize,
        false
      );
      await ftso.activateFtso(timestamp, 120, 60, { from: accounts[10] });

      let currentEpochId1 = await ftso.getCurrentEpochId();
      expect(currentEpochId1.toString()).to.equals('0');

      let currentEpochId2 = await ftso.getEpochId(0);
      expect(currentEpochId2.toString()).to.equals('0');
    });

    it("Should get epoch info", async () => {
      // should revert before initialization
      await expectRevert(ftso.getFullEpochReport(epochId), "Epoch data not available");

      let data;
      let epochTimes;
      // before price submit
      await increaseTimeTo(epochId * 120 + 30); // initialize price epoch
      await setMockVotePowerAt(10, 50000, 1000000);
      await ftso.initializeCurrentEpochStateForReveal(50000, false, { from: accounts[10] });

      epochTimes = await ftso.getEpochTimes(epochId);
      expect(epochTimes[0].toNumber()).to.equals(epochId * 120);
      expect(epochTimes[1].toNumber()).to.equals((epochId + 1) * 120);
      expect(epochTimes[2].toNumber()).to.equals((epochId + 1) * 120 + 60);
      data = await ftso.getFullEpochReport(epochId);
      expect(data[0].toNumber()).to.equals(0);
      expect(data[1].toNumber()).to.equals(0);
      expect(data[2].toNumber()).to.equals(0);
      expect(data[3].toNumber()).to.equals(0);
      expect(data[4].toNumber()).to.equals(0);
      expect(data[5].toNumber()).to.equals(10);
      expect(data[6].toNumber()).to.equals(0);
      expect(data[7].length).to.equals(0);
      expect(data[8]).to.equals(false);
      expect(data[9]).to.equals(false);
      await ftso.submitPriceHash(epochId, submitPriceHash(500, 123, accounts[1]), { from: accounts[1] });
      await ftso.submitPriceHash(epochId, submitPriceHash(250, 124, accounts[2]), { from: accounts[2] });
      await ftso.submitPriceHash(epochId, submitPriceHash(400, 125, accounts[3]), { from: accounts[3] });
      await increaseTimeTo((epochId + 1) * 120); // reveal period start

      // before price reveal
      epochTimes = await ftso.getEpochTimes(epochId);
      expect(epochTimes[0].toNumber()).to.equals(epochId * 120);
      expect(epochTimes[1].toNumber()).to.equals((epochId + 1) * 120);
      expect(epochTimes[2].toNumber()).to.equals((epochId + 1) * 120 + 60);
      data = await ftso.getFullEpochReport(epochId);
      expect(data[0].toNumber()).to.equals(0);
      expect(data[1].toNumber()).to.equals(0);
      expect(data[2].toNumber()).to.equals(0);
      expect(data[3].toNumber()).to.equals(0);
      expect(data[4].toNumber()).to.equals(0);
      expect(data[5].toNumber()).to.equals(10);
      expect(data[6].toNumber()).to.equals(0);
      expect(data[7].length).to.equals(0);
      expect(data[8]).to.equals(false);
      expect(data[9]).to.equals(false);
      await setMockVotePowerOfAt(10, 1000, 100, accounts[1]);
      await ftso.revealPrice(epochId, 500, 123, { from: accounts[1] });
      await setMockVotePowerOfAt(10, 5000, 0, accounts[2]);
      await ftso.revealPrice(epochId, 250, 124, { from: accounts[2] });
      await setMockVotePowerOfAt(10, 0, 500, accounts[3]);
      await ftso.revealPrice(epochId, 400, 125, { from: accounts[3] });
      await increaseTimeTo((epochId + 1) * 120 + 60); // reveal period end

      // before price finalization
      epochTimes = await ftso.getEpochTimes(epochId);
      expect(epochTimes[0].toNumber()).to.equals(epochId * 120);
      expect(epochTimes[1].toNumber()).to.equals((epochId + 1) * 120);
      expect(epochTimes[2].toNumber()).to.equals((epochId + 1) * 120 + 60);
      data = await ftso.getFullEpochReport(epochId);
      expect(data[0].toNumber()).to.equals(0);
      expect(data[1].toNumber()).to.equals(0);
      expect(data[2].toNumber()).to.equals(0);
      expect(data[3].toNumber()).to.equals(0);
      expect(data[4].toNumber()).to.equals(3);
      expect(data[5].toNumber()).to.equals(10);
      expect(data[6].toNumber()).to.equals(0);
      expect(data[7].length).to.equals(0);
      expect(data[8]).to.equals(false);
      expect(data[9]).to.equals(false);
      await ftso.finalizePriceEpoch(epochId, false, { from: accounts[10] }); // finalize price -> epochId price = 250

      // after price finalization
      epochTimes = await ftso.getEpochTimes(epochId);
      expect(epochTimes[0].toNumber()).to.equals(epochId * 120);
      expect(epochTimes[1].toNumber()).to.equals((epochId + 1) * 120);
      expect(epochTimes[2].toNumber()).to.equals((epochId + 1) * 120 + 60);
      data = await ftso.getFullEpochReport(epochId);
      expect(data[0].toNumber()).to.be.gt((epochId + 1) * 120 + 60);
      expect(data[1].toNumber()).to.equals(250);
      expect(data[2].toNumber()).to.equals(250);
      expect(data[3].toNumber()).to.equals(250);
      expect(data[4].toNumber()).to.equals(3);
      expect(data[5].toNumber()).to.equals(10);
      expect(data[6].toNumber()).to.equals(1);
      expect(data[7].length).to.equals(0);
      expect(data[8]).to.equals(false);
      expect(data[9]).to.equals(false);
    });

    it("Should get epoch info after finalizing price epoch using trusted addresses votes when epoch has low flr turnout", async () => {
      await ftso.submitPriceHash(epochId, submitPriceHash(500, 123, accounts[1]), { from: accounts[1] });
      await ftso.submitPriceHash(epochId, submitPriceHash(250, 124, accounts[2]), { from: accounts[2] });
      await ftso.submitPriceHash(epochId, submitPriceHash(400, 125, accounts[6]), { from: accounts[6] });
      await ftso.submitPriceHash(epochId, submitPriceHash(500, 126, accounts[7]), { from: accounts[7] });

      await setMockVotePowerAt(10, 50000, 1000000);
      await ftso.initializeCurrentEpochStateForReveal(50000, false, { from: accounts[10] });

      await increaseTimeTo((epochId + 1) * 120); // reveal period start
      await setMockVotePowerOfAt(10, 10, 10000, accounts[1]);
      await ftso.revealPrice(epochId, 500, 123, { from: accounts[1] });
      await setMockVotePowerOfAt(10, 30, 0, accounts[2]);
      await ftso.revealPrice(epochId, 250, 124, { from: accounts[2] });
      await setMockVotePowerOfAt(10, 20, 50000, accounts[6]);
      await ftso.revealPrice(epochId, 400, 125, { from: accounts[6] });
      await setMockVotePowerOfAt(10, 5, 50000, accounts[7]);
      await ftso.revealPrice(epochId, 500, 126, { from: accounts[7] });

      await increaseTimeTo((epochId + 1) * 120 + 60 + 1); // reveal period end (+1 as call does not increase time)

      let data = await ftso.contract.methods.finalizePriceEpoch(epochId, true).call({ from: accounts[10] });
      expect(data._eligibleAddresses.length).to.equals(0);
      expect(data._natWeights.length).to.equals(0);
      expect(data._natWeightsSum).to.equals('0');

      expectEvent(await ftso.finalizePriceEpoch(epochId, true, { from: accounts[10] }), "PriceFinalized", { epochId: toBN(epochId), price: toBN(450), finalizationType: toBN(2) });

      let priceDetails = await ftso.getCurrentPriceDetails();
      expect(priceDetails[0].toNumber()).to.equals(450);
      expect(priceDetails[1].toNumber()).to.be.gt((epochId + 1) * 120 + 60 + 1);
      expect(priceDetails[2].toNumber()).to.equals(2);
      expect(priceDetails[3].toNumber()).to.be.gt((epochId + 1) * 120 + 60 + 1);
      expect(priceDetails[4].toNumber()).to.equals(2);

      // after price finalization
      let epochTimes = await ftso.getEpochTimes(epochId);
      expect(epochTimes[0].toNumber()).to.equals(epochId * 120);
      expect(epochTimes[1].toNumber()).to.equals((epochId + 1) * 120);
      expect(epochTimes[2].toNumber()).to.equals((epochId + 1) * 120 + 60);
      let epochData = await ftso.getFullEpochReport(epochId);
      expect(epochData[0].toNumber()).to.be.gt((epochId + 1) * 120 + 60);
      expect(epochData[1].toNumber()).to.equals(450);
      expect(epochData[2].toNumber()).to.equals(0);
      expect(epochData[3].toNumber()).to.equals(0);
      expect(epochData[4].toNumber()).to.equals(4);
      expect(epochData[5].toNumber()).to.equals(10);
      expect(epochData[6].toNumber()).to.equals(2);
      expect(epochData[7].length).to.equals(3);
      expect(epochData[7]).to.eqls([accounts[5], accounts[6], accounts[7]]);
      expect(epochData[8]).to.equals(false);
      expect(epochData[9]).to.equals(false);
    });

    it("Should get epoch info after finalizing price epoch using trusted addresses votes when epoch in fallback mode", async () => {
      await ftso.submitPriceHash(epochId, submitPriceHash(500, 123, accounts[1]), { from: accounts[1] });
      await ftso.submitPriceHash(epochId, submitPriceHash(250, 124, accounts[2]), { from: accounts[2] });
      await ftso.submitPriceHash(epochId, submitPriceHash(400, 125, accounts[6]), { from: accounts[6] });
      await ftso.submitPriceHash(epochId, submitPriceHash(500, 126, accounts[7]), { from: accounts[7] });

      await setMockVotePowerAt(10, 50000, 1000000);
      await ftso.initializeCurrentEpochStateForReveal(50000, true, { from: accounts[10] });

      await increaseTimeTo((epochId + 1) * 120); // reveal period start
      await setMockVotePowerOfAt(10, 10, 10000, accounts[1]);
      await expectRevert(ftso.revealPrice(epochId, 500, 123, { from: accounts[1] }), "Epoch not initialized for reveal");
      await setMockVotePowerOfAt(10, 30, 0, accounts[2]);
      await expectRevert(ftso.revealPrice(epochId, 250, 124, { from: accounts[2] }), "Epoch not initialized for reveal");
      await setMockVotePowerOfAt(10, 20, 50000, accounts[6]);
      await ftso.revealPrice(epochId, 400, 125, { from: accounts[6] });
      await setMockVotePowerOfAt(10, 5, 50000, accounts[7]);
      await ftso.revealPrice(epochId, 500, 126, { from: accounts[7] });

      await increaseTimeTo((epochId + 1) * 120 + 60 + 1); // reveal period end (+1 as call does not increase time)

      let data = await ftso.contract.methods.finalizePriceEpoch(epochId, true).call({ from: accounts[10] });
      expect(data._eligibleAddresses.length).to.equals(0);
      expect(data._natWeights.length).to.equals(0);
      expect(data._natWeightsSum).to.equals('0');

      expectEvent(await ftso.finalizePriceEpoch(epochId, true, { from: accounts[10] }), "PriceFinalized", { epochId: toBN(epochId), price: toBN(450), finalizationType: toBN(2) });
      let priceDetails = await ftso.getCurrentPriceDetails();
      expect(priceDetails[0].toNumber()).to.equals(450);
      expect(priceDetails[1].toNumber()).to.be.gt((epochId + 1) * 120 + 60 + 1);
      expect(priceDetails[2].toNumber()).to.equals(2);
      expect(priceDetails[3].toNumber()).to.be.gt((epochId + 1) * 120 + 60 + 1);
      expect(priceDetails[4].toNumber()).to.equals(2);

      // after price finalization
      let epochTimes = await ftso.getEpochTimes(epochId);
      expect(epochTimes[0].toNumber()).to.equals(epochId * 120);
      expect(epochTimes[1].toNumber()).to.equals((epochId + 1) * 120);
      expect(epochTimes[2].toNumber()).to.equals((epochId + 1) * 120 + 60);
      let epochData = await ftso.getFullEpochReport(epochId);
      expect(epochData[0].toNumber()).to.be.gt((epochId + 1) * 120 + 60);
      expect(epochData[1].toNumber()).to.equals(450);
      expect(epochData[2].toNumber()).to.equals(0);
      expect(epochData[3].toNumber()).to.equals(0);
      expect(epochData[4].toNumber()).to.equals(2);
      expect(epochData[5].toNumber()).to.equals(10);
      expect(epochData[6].toNumber()).to.equals(2);
      expect(epochData[7].length).to.equals(3);
      expect(epochData[7]).to.eqls([accounts[5], accounts[6], accounts[7]]);
      expect(epochData[8]).to.equals(false);
      expect(epochData[9]).to.equals(true);

      let votesData = await ftso.getEpochVotes(epochId);
      expect(votesData[0]).to.eqls([accounts[6], accounts[7]]);
      expect(votesData[1]).to.eqls([toBN(400), toBN(500)]);
      expect(votesData[2]).to.eqls([toBN(0), toBN(0)]);
      expect(votesData[3]).to.eqls([toBN(0), toBN(0)]);
      expect(votesData[4]).to.eqls([toBN(0), toBN(0)]);
      expect(votesData[5]).to.eqls([false, false]);
    });

    it("Should get epoch info after finalizing price epoch using trusted addresses votes - using fallback finalization", async () => {
      await ftso.submitPriceHash(epochId, submitPriceHash(500, 123, accounts[1]), { from: accounts[1] });
      await ftso.submitPriceHash(epochId, submitPriceHash(250, 124, accounts[2]), { from: accounts[2] });
      await ftso.submitPriceHash(epochId, submitPriceHash(400, 125, accounts[6]), { from: accounts[6] });
      await ftso.submitPriceHash(epochId, submitPriceHash(500, 126, accounts[7]), { from: accounts[7] });

      await setMockVotePowerAt(10, 50000, 1000000);
      await ftso.initializeCurrentEpochStateForReveal(50000, false, { from: accounts[10] });

      await increaseTimeTo((epochId + 1) * 120); // reveal period start
      await setMockVotePowerOfAt(10, 10, 10000, accounts[1]);
      await ftso.revealPrice(epochId, 500, 123, { from: accounts[1] });
      await setMockVotePowerOfAt(10, 30, 0, accounts[2]);
      await ftso.revealPrice(epochId, 250, 124, { from: accounts[2] });
      await setMockVotePowerOfAt(10, 20, 50000, accounts[6]);
      await ftso.revealPrice(epochId, 400, 125, { from: accounts[6] });
      await setMockVotePowerOfAt(10, 5, 50000, accounts[7]);
      await ftso.revealPrice(epochId, 500, 126, { from: accounts[7] });

      await increaseTimeTo((epochId + 1) * 120 + 60); // reveal period end

      let priceData = await ftso.getCurrentPrice();
      expectEvent(await ftso.fallbackFinalizePriceEpoch(epochId, { from: accounts[10] }), "PriceFinalized", { epochId: toBN(epochId), price: toBN(450), finalizationType: toBN(4) });
      let priceData2 = await ftso.getCurrentPrice();
      let priceDataFromTP = await ftso.getCurrentPriceFromTrustedProviders();

      let priceDetails = await ftso.getCurrentPriceDetails();
      expect(priceDetails[0].toNumber()).to.equals(450);
      expect(priceDetails[1].toNumber()).to.be.gt((epochId + 1) * 120 + 60);
      expect(priceDetails[2].toNumber()).to.equals(4);
      expect(priceDetails[3].toNumber()).to.be.gt((epochId + 1) * 120 + 60);
      expect(priceDetails[4].toNumber()).to.equals(4);

      // after price finalization
      let epochTimes = await ftso.getEpochTimes(epochId);
      expect(epochTimes[0].toNumber()).to.equals(epochId * 120);
      expect(epochTimes[1].toNumber()).to.equals((epochId + 1) * 120);
      expect(epochTimes[2].toNumber()).to.equals((epochId + 1) * 120 + 60);
      let epochData = await ftso.getFullEpochReport(epochId);
      expect(epochData[0].toNumber()).to.be.gt((epochId + 1) * 120 + 60);
      expect(epochData[1].toNumber()).to.equals(450);
      expect(epochData[2].toNumber()).to.equals(0);
      expect(epochData[3].toNumber()).to.equals(0);
      expect(epochData[4].toNumber()).to.equals(4);
      expect(epochData[5].toNumber()).to.equals(10);
      expect(epochData[6].toNumber()).to.equals(4);
      expect(epochData[7].length).to.equals(3);
      expect(epochData[7]).to.eqls([accounts[5], accounts[6], accounts[7]]);
      expect(epochData[8]).to.equals(false);
      expect(epochData[9]).to.equals(false);

      expect(priceData2[1].toNumber()).to.be.gt(priceData[1].toNumber());
      expect(priceDataFromTP[0].toNumber()).to.equals(450);
      expect(priceData2[0].toNumber()).to.equals(priceDataFromTP[0].toNumber());
      expect(priceData2[1].toNumber()).to.equals(priceDataFromTP[1].toNumber());
    });

    it("Should get epoch info after finalizing price epoch using force finalization when epoch has low flr turnout and no votes from trusted addresses", async () => {
      await ftso.submitPriceHash(epochId, submitPriceHash(500, 123, accounts[1]), { from: accounts[1] });
      await ftso.submitPriceHash(epochId, submitPriceHash(250, 124, accounts[2]), { from: accounts[2] });

      await setMockVotePowerAt(10, 50000, 1000000);
      await ftso.initializeCurrentEpochStateForReveal(50000, false, { from: accounts[10] });

      await increaseTimeTo((epochId + 1) * 120); // reveal period start
      await setMockVotePowerOfAt(10, 10, 10000, accounts[1]);
      await ftso.revealPrice(epochId, 500, 123, { from: accounts[1] });
      await setMockVotePowerOfAt(10, 30, 0, accounts[2]);
      await ftso.revealPrice(epochId, 250, 124, { from: accounts[2] });

      await increaseTimeTo((epochId + 1) * 120 + 60 + 1); // reveal period end (+1 as call does not increase time)

      let data = await ftso.contract.methods.finalizePriceEpoch(epochId, true).call({ from: accounts[10] });
      expect(data._eligibleAddresses.length).to.equals(0);
      expect(data._natWeights.length).to.equals(0);
      expect(data._natWeightsSum).to.equals('0');

      expectEvent(await ftso.finalizePriceEpoch(epochId, true, { from: accounts[10] }), "PriceFinalized", { epochId: toBN(epochId), price: toBN(1), finalizationType: toBN(3) });
      let priceDetails = await ftso.getCurrentPriceDetails();
      expect(priceDetails[0].toNumber()).to.equals(1);
      expect(priceDetails[1].toNumber()).to.be.lt((epochId + 1) * 120 + 60);
      expect(priceDetails[2].toNumber()).to.equals(0);
      expect(priceDetails[3].toNumber()).to.be.gt((epochId + 1) * 120 + 60 + 1);
      expect(priceDetails[4].toNumber()).to.equals(3);

      // after price finalization
      let epochTimes = await ftso.getEpochTimes(epochId);
      expect(epochTimes[0].toNumber()).to.equals(epochId * 120);
      expect(epochTimes[1].toNumber()).to.equals((epochId + 1) * 120);
      expect(epochTimes[2].toNumber()).to.equals((epochId + 1) * 120 + 60);
      let epochData = await ftso.getFullEpochReport(epochId);
      expect(epochData[0].toNumber()).to.be.gt((epochId + 1) * 120 + 60);
      expect(epochData[1].toNumber()).to.equals(1);
      expect(epochData[2].toNumber()).to.equals(0);
      expect(epochData[3].toNumber()).to.equals(0);
      expect(epochData[4].toNumber()).to.equals(2);
      expect(epochData[5].toNumber()).to.equals(10);
      expect(epochData[6].toNumber()).to.equals(3);
      expect(epochData[7].length).to.equals(3);
      expect(epochData[7]).to.eqls([accounts[5], accounts[6], accounts[7]]);
      expect(epochData[8]).to.equals(false);
      expect(epochData[9]).to.equals(false);
    });

    it("Should get epoch info after finalizing price epoch using force finalization and no votes from trusted addresses - using fallback finalization", async () => {
      await ftso.submitPriceHash(epochId, submitPriceHash(500, 123, accounts[1]), { from: accounts[1] });
      await ftso.submitPriceHash(epochId, submitPriceHash(250, 124, accounts[2]), { from: accounts[2] });

      await setMockVotePowerAt(10, 50000, 1000000);
      await ftso.initializeCurrentEpochStateForReveal(50000, false, { from: accounts[10] });

      await increaseTimeTo((epochId + 1) * 120); // reveal period start
      await setMockVotePowerOfAt(10, 10, 10000, accounts[1]);
      await ftso.revealPrice(epochId, 500, 123, { from: accounts[1] });
      await setMockVotePowerOfAt(10, 30, 0, accounts[2]);
      await ftso.revealPrice(epochId, 250, 124, { from: accounts[2] });

      await increaseTimeTo((epochId + 1) * 120 + 60); // reveal period end

      let priceData = await ftso.getCurrentPrice();
      expectEvent(await ftso.fallbackFinalizePriceEpoch(epochId, { from: accounts[10] }), "PriceFinalized", { epochId: toBN(epochId), price: toBN(1), finalizationType: toBN(5) });
      let priceData2 = await ftso.getCurrentPrice();
      let priceDataFromTP = await ftso.getCurrentPriceFromTrustedProviders();

      let priceDetails = await ftso.getCurrentPriceDetails();
      expect(priceDetails[0].toNumber()).to.equals(1);
      expect(priceDetails[1].toNumber()).to.be.lt((epochId + 1) * 120 + 60);
      expect(priceDetails[2].toNumber()).to.equals(0);
      expect(priceDetails[3].toNumber()).to.be.gt((epochId + 1) * 120 + 60);
      expect(priceDetails[4].toNumber()).to.equals(5);

      // after price finalization
      let epochTimes = await ftso.getEpochTimes(epochId);
      expect(epochTimes[0].toNumber()).to.equals(epochId * 120);
      expect(epochTimes[1].toNumber()).to.equals((epochId + 1) * 120);
      expect(epochTimes[2].toNumber()).to.equals((epochId + 1) * 120 + 60);
      let epochData = await ftso.getFullEpochReport(epochId);
      expect(epochData[0].toNumber()).to.be.gt((epochId + 1) * 120 + 60);
      expect(epochData[1].toNumber()).to.equals(1);
      expect(epochData[2].toNumber()).to.equals(0);
      expect(epochData[3].toNumber()).to.equals(0);
      expect(epochData[4].toNumber()).to.equals(2);
      expect(epochData[5].toNumber()).to.equals(10);
      expect(epochData[6].toNumber()).to.equals(5);
      expect(epochData[7].length).to.equals(3);
      expect(epochData[7]).to.eqls([accounts[5], accounts[6], accounts[7]]);
      expect(epochData[8]).to.equals(false);
      expect(epochData[9]).to.equals(false);

      expect(priceData2[0].toNumber()).to.be.gt(0);
      expect(priceData2[1].toNumber()).to.equals(priceData[1].toNumber());
      expect(priceDataFromTP[0].toNumber()).to.equals(0);
      expect(priceDataFromTP[1].toNumber()).to.equals(0);
    });

    it("Should not get epoch info for epoch in future", async () => {
      await expectRevert(ftso.getFullEpochReport(epochId + 1), "Epoch data not available");
    });

    it("Should get epoch votes", async () => {
      // should revert before initialization
      await expectRevert(ftso.getEpochVotes(epochId), "Epoch data not available");

      let data;
      // before price submit
      await increaseTimeTo(epochId * 120 + 30); // initialize price epoch
      await setMockVotePowerAt(10, 50000, 1000000);
      await ftso.initializeCurrentEpochStateForReveal(50000, false, { from: accounts[10] });

      data = await ftso.getEpochVotes(epochId);
      expect(data[0].length).to.equals(0);
      expect(data[1].length).to.equals(0);
      expect(data[2].length).to.equals(0);
      expect(data[3].length).to.equals(0);
      expect(data[4].length).to.equals(0);

      await ftso.submitPriceHash(epochId, submitPriceHash(500, 123, accounts[1]), { from: accounts[1] });
      await ftso.submitPriceHash(epochId, submitPriceHash(250, 124, accounts[2]), { from: accounts[2] });
      await ftso.submitPriceHash(epochId, submitPriceHash(400, 125, accounts[3]), { from: accounts[3] });
      await setMockVotePowerAt(10, 50000, 1000000);
      await increaseTimeTo((epochId + 1) * 120); // reveal period start

      // before price reveal
      data = await ftso.getEpochVotes(epochId);
      expect(data[0].length).to.equals(0);
      expect(data[1].length).to.equals(0);
      expect(data[2].length).to.equals(0);
      expect(data[3].length).to.equals(0);
      expect(data[4].length).to.equals(0);

      await setMockVotePowerOfAt(10, 1000, 100, accounts[1]);
      await ftso.revealPrice(epochId, 500, 123, { from: accounts[1] });
      await setMockVotePowerOfAt(10, 5000, 0, accounts[2]);
      await ftso.revealPrice(epochId, 250, 124, { from: accounts[2] });
      await setMockVotePowerOfAt(10, 0, 500, accounts[3]);
      await ftso.revealPrice(epochId, 400, 125, { from: accounts[3] });
      await increaseTimeTo((epochId + 1) * 120 + 60); // reveal period end

      // before price finalization
      data = await ftso.getEpochVotes(epochId);
      expect(data[0].length).to.equals(3);
      expect(data[1].length).to.equals(3);
      expect(data[2].length).to.equals(3);
      expect(data[3].length).to.equals(3);
      expect(data[4].length).to.equals(3);

      let prices = [500, 250, 400];
      let weightsNat = [20000000000, 100000000000, 0];

      compareArrays<string>(data[0], [accounts[1], accounts[2], accounts[3]]);
      compareNumberArrays(data[1], prices);
      compareNumberArrays(data[2], [166666666666, 783333333333, 50000000000]);
      compareNumberArrays(data[3], weightsNat);
      compareNumberArrays(data[4], [100000000, 0, 500000000]);
      compareArrays<boolean>(data[5], [false, false, false]);

      await ftso.finalizePriceEpoch(epochId, false, { from: accounts[10] }); // finalize price -> epochId price = 250

      // after price finalization
      data = await ftso.getEpochVotes(epochId);
      expect(data[0].length).to.equals(3);
      expect(data[1].length).to.equals(3);
      expect(data[2].length).to.equals(3);
      expect(data[3].length).to.equals(3);
      expect(data[4].length).to.equals(3);

      let id1 = data[0].indexOf(accounts[1]);
      let id2 = data[0].indexOf(accounts[2]);
      let id3 = data[0].indexOf(accounts[3]);

      compareArrays<string>([data[0][id1], data[0][id2], data[0][id3]], [accounts[1], accounts[2], accounts[3]]);
      compareNumberArrays([data[1][id1], data[1][id2], data[1][id3]], prices);
      compareNumberArrays([data[2][id1], data[2][id2], data[2][id3]], [166666666666, 783333333333, 50000000000]);
      compareNumberArrays([data[3][id1], data[3][id2], data[3][id3]], weightsNat);
      compareNumberArrays([data[4][id1], data[4][id2], data[4][id3]], [100000000, 0, 500000000]);
      compareArrays<boolean>([data[5][id1], data[5][id2], data[5][id3]], [false, true, false]);

      await ftso.submitPriceHash(epochId + 1, submitPriceHash(300, 223, accounts[1]), { from: accounts[1] });
      await ftso.submitPriceHash(epochId + 1, submitPriceHash(400, 300, accounts[2]), { from: accounts[2] });
      await ftso.submitPriceHash(epochId + 1, submitPriceHash(200, 23, accounts[3]), { from: accounts[3] });
      await ftso.setVotePowerBlock(12, { from: accounts[10] });
      await setMockVotePowerAt(12, 20000, 100000);
      await ftso.initializeCurrentEpochStateForReveal(20000, false, { from: accounts[10] });
      await increaseTimeTo((epochId + 2) * 120); // reveal period start
      await setMockVotePowerOfAt(12, 2000, 0, accounts[1]);
      await ftso.revealPrice(epochId + 1, 300, 223, { from: accounts[1] });
      await setMockVotePowerOfAt(12, 2000, 80000, accounts[2]);
      await ftso.revealPrice(epochId + 1, 400, 300, { from: accounts[2] });
      await setMockVotePowerOfAt(12, 2000, 10000, accounts[3]);
      await ftso.revealPrice(epochId + 1, 200, 23, { from: accounts[3] });
      await increaseTimeTo((epochId + 2) * 120 + 60); // reveal period end

      // before price finalization 2
      data = await ftso.getEpochVotes(epochId + 1);
      expect(data[0].length).to.equals(3);
      expect(data[1].length).to.equals(3);
      expect(data[2].length).to.equals(3);
      expect(data[3].length).to.equals(3);
      expect(data[4].length).to.equals(3);

      let prices2 = [300, 400, 200];
      let natWeights = [100000000000, 100000000000, 100000000000];
      let assetWeights = [0, 800000000000, 100000000000];

      compareArrays<string>(data[0], [accounts[1], accounts[2], accounts[3]]);
      compareNumberArrays(data[1], prices2);
      compareNumberArrays(data[2], [166666666666, 611111111110, 222222222221]);
      compareNumberArrays(data[3], natWeights);
      compareNumberArrays(data[4], assetWeights);
      compareArrays<boolean>(data[5], [false, false, false]);

      await ftso.finalizePriceEpoch(epochId + 1, false, { from: accounts[10] }); // finalize price -> epochId+1 price = 400

      // after price finalization 2
      data = await ftso.getEpochVotes(epochId + 1);
      expect(data[0].length).to.equals(3);
      expect(data[1].length).to.equals(3);
      expect(data[2].length).to.equals(3);
      expect(data[3].length).to.equals(3);
      expect(data[4].length).to.equals(3);

      id1 = data[0].indexOf(accounts[1]);
      id2 = data[0].indexOf(accounts[2]);
      id3 = data[0].indexOf(accounts[3]);

      compareArrays<string>([data[0][id1], data[0][id2], data[0][id3]], [accounts[1], accounts[2], accounts[3]]);
      compareNumberArrays([data[1][id1], data[1][id2], data[1][id3]], prices2);
      compareNumberArrays([data[2][id1], data[2][id2], data[2][id3]], [166666666666, 611111111110, 222222222221]);
      compareNumberArrays([data[3][id1], data[3][id2], data[3][id3]], natWeights);
      compareNumberArrays([data[4][id1], data[4][id2], data[4][id3]], assetWeights);
      compareArrays<boolean>([data[5][id1], data[5][id2], data[5][id3]], [true, true, false]);
    });

    it("Should not get epoch votes for epoch in future", async () => {
      await expectRevert(ftso.getEpochVotes(epochId + 1), "Epoch data not available");
    });
  });

  describe("getters (without xAsset)", async () => {
    beforeEach(async () => {
      wnatInterface = await Wnat.new(accounts[0], "Wrapped NAT", "WNAT");
      await setDefaultVPContract(wnatInterface, accounts[0]);
      mockWnat = await MockWnat.new();
      vpTokenInterface = await VpToken.new(accounts[0], "A token", "ATOK");
      mockVpToken = await MockVpToken.new();
      mockPriceSubmitter = await MockPriceSubmitter.new();
      ftso = await MockFtsoFull.new(
        "ATOK",
        5,
        mockPriceSubmitter.address,
        mockWnat.address,
        accounts[10],
        0, 120, 60,
        1, // initial token price 0.00001$
        1e10,
        defaultPriceEpochCyclicBufferSize,
        false
      );

      await ftso.configureEpochs(1, 1, 1000, 10000, 50, 500, 0, 0, [accounts[6]], { from: accounts[10] });
      await ftso.setVotePowerBlock(10, { from: accounts[10] });
      await ftso.activateFtso(0, 120, 60, { from: accounts[10] });

      // Force a block in order to get most up to date time
      await time.advanceBlock();
      // Get the timestamp for the just mined block
      let timestamp = await time.latest();
      epochId = Math.floor(timestamp.toNumber() / 120) + 1;
      await increaseTimeTo(epochId * 120);
    });

    // fixed
    it("Should get null asset", async () => {
      let address = await ftso.getAsset();
      expect(address).to.equals(constants.ZERO_ADDRESS);
    });

    it("Should get current price", async () => {
      let price = await ftso.getCurrentPrice();
      expect(price[0].toNumber()).to.equals(1);

      await ftso.submitPriceHash(epochId, submitPriceHash(500, 123, accounts[1]), { from: accounts[1] });
      await ftso.submitPriceHash(epochId, submitPriceHash(250, 124, accounts[2]), { from: accounts[2] });
      await ftso.submitPriceHash(epochId, submitPriceHash(400, 125, accounts[3]), { from: accounts[3] });

      await setMockVotePowerAt(10, 50000, 1000000);
      await ftso.initializeCurrentEpochStateForReveal(50000, false, { from: accounts[10] });
      await ftso.setVotePowerBlock(12, { from: accounts[10] });

      await increaseTimeTo((epochId + 1) * 120); // reveal period start
      await setMockVotePowerOfAt(10, 1000, 100, accounts[1]);
      await ftso.revealPrice(epochId, 500, 123, { from: accounts[1] });
      await setMockVotePowerOfAt(10, 5000, 0, accounts[2]);
      await ftso.revealPrice(epochId, 250, 124, { from: accounts[2] });
      await setMockVotePowerOfAt(10, 1, 500, accounts[3]);
      await ftso.revealPrice(epochId, 400, 125, { from: accounts[3] });

      await increaseTimeTo((epochId + 1) * 120 + 60); // reveal period end
      await ftso.finalizePriceEpoch(epochId, false, { from: accounts[10] }); // finalize price -> new current price = 250

      let price2 = await ftso.getCurrentPrice();
      expect(price2[0].toNumber()).to.equals(250);
      expect(price2[1].toNumber()).to.be.gt(price[1].toNumber());
    });

    it("Should get current price details", async () => {
      let priceDetails = await ftso.getCurrentPriceDetails();
      expect(priceDetails[0].toNumber()).to.equals(1);

      await ftso.submitPriceHash(epochId, submitPriceHash(500, 123, accounts[1]), { from: accounts[1] });
      await ftso.submitPriceHash(epochId, submitPriceHash(250, 124, accounts[2]), { from: accounts[2] });
      await ftso.submitPriceHash(epochId, submitPriceHash(400, 125, accounts[3]), { from: accounts[3] });

      await setMockVotePowerAt(10, 50000, 1000000);
      await ftso.initializeCurrentEpochStateForReveal(50000, false, { from: accounts[10] });
      await ftso.setVotePowerBlock(12, { from: accounts[10] });

      await increaseTimeTo((epochId + 1) * 120); // reveal period start
      await setMockVotePowerOfAt(10, 1000, 100, accounts[1]);
      await ftso.revealPrice(epochId, 500, 123, { from: accounts[1] });
      await setMockVotePowerOfAt(10, 5000, 0, accounts[2]);
      await ftso.revealPrice(epochId, 250, 124, { from: accounts[2] });
      await setMockVotePowerOfAt(10, 1, 500, accounts[3]);
      await ftso.revealPrice(epochId, 400, 125, { from: accounts[3] });

      await increaseTimeTo((epochId + 1) * 120 + 60); // reveal period end
      await ftso.finalizePriceEpoch(epochId, false, { from: accounts[10] }); // finalize price -> new current price = 250

      let priceDetails2 = await ftso.getCurrentPriceDetails();
      expect(priceDetails2[0].toNumber()).to.equals(250);
      expect(priceDetails2[1].toNumber()).to.be.gt(priceDetails[1].toNumber());
      expect(priceDetails2[2].toNumber()).to.equals(1);
      expect(priceDetails2[3].toNumber()).to.be.gt(priceDetails[1].toNumber()); // initial timestamp
      expect(priceDetails2[4].toNumber()).to.equals(1);
    });

    it("Should get epoch price", async () => {
      // should revert before initialization
      await expectRevert(ftso.getEpochPrice(epochId), "Epoch data not available");

      await increaseTimeTo(epochId * 120 + 30); // initialize price epoch
      await setMockVotePowerAt(10, 50000, 1000000);
      await ftso.initializeCurrentEpochStateForReveal(50000, false, { from: accounts[10] });

      let price = await ftso.getEpochPrice(epochId);
      expect(price.toNumber()).to.equals(0);

      await ftso.submitPriceHash(epochId, submitPriceHash(500, 123, accounts[1]), { from: accounts[1] });
      await ftso.submitPriceHash(epochId, submitPriceHash(250, 124, accounts[2]), { from: accounts[2] });
      await ftso.submitPriceHash(epochId, submitPriceHash(400, 125, accounts[3]), { from: accounts[3] });

      await ftso.setVotePowerBlock(12, { from: accounts[10] });

      await increaseTimeTo((epochId + 1) * 120); // reveal period start
      await setMockVotePowerOfAt(10, 1000, 10000, accounts[1]);
      await ftso.revealPrice(epochId, 500, 123, { from: accounts[1] });
      await setMockVotePowerOfAt(10, 5000, 0, accounts[2]);
      await ftso.revealPrice(epochId, 250, 124, { from: accounts[2] });
      await setMockVotePowerOfAt(10, 1, 50000, accounts[3]);
      await ftso.revealPrice(epochId, 400, 125, { from: accounts[3] });

      await increaseTimeTo((epochId + 1) * 120 + 60); // reveal period end
      await ftso.finalizePriceEpoch(epochId, false, { from: accounts[10] }); // finalize price -> epochId price = 250

      let price2 = await ftso.getEpochPrice(epochId);
      expect(price2.toNumber()).to.equals(250);

      // round 2 - current asset price = 250
      await ftso.submitPriceHash(epochId + 1, submitPriceHash(300, 123, accounts[1]), { from: accounts[1] });
      await ftso.submitPriceHash(epochId + 1, submitPriceHash(400, 124, accounts[2]), { from: accounts[2] });
      await ftso.submitPriceHash(epochId + 1, submitPriceHash(200, 125, accounts[3]), { from: accounts[3] });

      await setMockVotePowerAt(12, 20000, 100000);
      await ftso.initializeCurrentEpochStateForReveal(20000, false, { from: accounts[10] });

      await increaseTimeTo((epochId + 2) * 120); // reveal period start
      await setMockVotePowerOfAt(12, 2000, 0, accounts[1]);
      await ftso.revealPrice(epochId + 1, 300, 123, { from: accounts[1] });
      await setMockVotePowerOfAt(12, 2000, 80000, accounts[2]);
      await ftso.revealPrice(epochId + 1, 400, 124, { from: accounts[2] });
      await setMockVotePowerOfAt(12, 2000, 10000, accounts[3]);
      await ftso.revealPrice(epochId + 1, 200, 125, { from: accounts[3] });

      await increaseTimeTo((epochId + 2) * 120 + 60); // reveal period end
      await ftso.finalizePriceEpoch(epochId + 1, false, { from: accounts[10] }); // finalize price -> epochId+1 price = 300 (xAsset ignored)

      let price3 = await ftso.getEpochPrice(epochId);
      expect(price3.toNumber()).to.equals(250);
      let price4 = await ftso.getEpochPrice(epochId + 1);
      expect(price4.toNumber()).to.equals(300);
    });

    it("Should get epoch info", async () => {
      // should revert before initialization
      await expectRevert(ftso.getFullEpochReport(epochId), "Epoch data not available");

      let data;
      let epochTimes;
      // before price submit
      await increaseTimeTo(epochId * 120 + 30); // initialize price epoch
      await setMockVotePowerAt(10, 50000, 1000000);
      await ftso.initializeCurrentEpochStateForReveal(50000, false, { from: accounts[10] });

      epochTimes = await ftso.getEpochTimes(epochId);
      expect(epochTimes[0].toNumber()).to.equals(epochId * 120);
      expect(epochTimes[1].toNumber()).to.equals((epochId + 1) * 120);
      expect(epochTimes[2].toNumber()).to.equals((epochId + 1) * 120 + 60);
      data = await ftso.getFullEpochReport(epochId);
      expect(data[0].toNumber()).to.equals(0);
      expect(data[1].toNumber()).to.equals(0);
      expect(data[2].toNumber()).to.equals(0);
      expect(data[3].toNumber()).to.equals(0);
      expect(data[4].toNumber()).to.equals(0);
      expect(data[5].toNumber()).to.equals(10);
      expect(data[6].toNumber()).to.equals(0);
      expect(data[7].length).to.equals(0);
      expect(data[8]).to.equals(false);
      expect(data[9]).to.equals(false);

      await ftso.submitPriceHash(epochId, submitPriceHash(500, 123, accounts[1]), { from: accounts[1] });
      await ftso.submitPriceHash(epochId, submitPriceHash(250, 124, accounts[2]), { from: accounts[2] });
      await ftso.submitPriceHash(epochId, submitPriceHash(400, 125, accounts[3]), { from: accounts[3] });
      await increaseTimeTo((epochId + 1) * 120); // reveal period start

      // before price reveal
      epochTimes = await ftso.getEpochTimes(epochId);
      expect(epochTimes[0].toNumber()).to.equals(epochId * 120);
      expect(epochTimes[1].toNumber()).to.equals((epochId + 1) * 120);
      expect(epochTimes[2].toNumber()).to.equals((epochId + 1) * 120 + 60);
      data = await ftso.getFullEpochReport(epochId);
      expect(data[0].toNumber()).to.equals(0);
      expect(data[1].toNumber()).to.equals(0);
      expect(data[2].toNumber()).to.equals(0);
      expect(data[3].toNumber()).to.equals(0);
      expect(data[4].toNumber()).to.equals(0);
      expect(data[5].toNumber()).to.equals(10);
      expect(data[6].toNumber()).to.equals(0);
      expect(data[7].length).to.equals(0);
      expect(data[8]).to.equals(false);
      expect(data[9]).to.equals(false);

      await setMockVotePowerOfAt(10, 1000, 10000, accounts[1]);
      await ftso.revealPrice(epochId, 500, 123, { from: accounts[1] });
      await setMockVotePowerOfAt(10, 5000, 0, accounts[2]);
      await ftso.revealPrice(epochId, 250, 124, { from: accounts[2] });
      await setMockVotePowerOfAt(10, 1, 50000, accounts[3]);
      await ftso.revealPrice(epochId, 400, 125, { from: accounts[3] });
      await increaseTimeTo((epochId + 1) * 120 + 60); // reveal period end

      // before price finalization
      epochTimes = await ftso.getEpochTimes(epochId);
      expect(epochTimes[0].toNumber()).to.equals(epochId * 120);
      expect(epochTimes[1].toNumber()).to.equals((epochId + 1) * 120);
      expect(epochTimes[2].toNumber()).to.equals((epochId + 1) * 120 + 60);
      data = await ftso.getFullEpochReport(epochId);
      expect(data[0].toNumber()).to.equals(0);
      expect(data[1].toNumber()).to.equals(0);
      expect(data[2].toNumber()).to.equals(0);
      expect(data[3].toNumber()).to.equals(0);
      expect(data[4].toNumber()).to.equals(3);
      expect(data[5].toNumber()).to.equals(10);
      expect(data[6].toNumber()).to.equals(0);
      expect(data[7].length).to.equals(0);
      expect(data[8]).to.equals(false);
      expect(data[9]).to.equals(false);

      await ftso.finalizePriceEpoch(epochId, true, { from: accounts[10] }); // finalize price -> epochId price = 250

      // after price finalization
      epochTimes = await ftso.getEpochTimes(epochId);
      expect(epochTimes[0].toNumber()).to.equals(epochId * 120);
      expect(epochTimes[1].toNumber()).to.equals((epochId + 1) * 120);
      expect(epochTimes[2].toNumber()).to.equals((epochId + 1) * 120 + 60);
      data = await ftso.getFullEpochReport(epochId);
      expect(data[0].toNumber()).to.be.gt((epochId + 1) * 120 + 60);
      expect(data[1].toNumber()).to.equals(250);
      expect(data[2].toNumber()).to.equals(250);
      expect(data[3].toNumber()).to.equals(250);
      expect(data[4].toNumber()).to.equals(3);
      expect(data[5].toNumber()).to.equals(10);
      expect(data[6].toNumber()).to.equals(1);
      expect(data[7].length).to.equals(0);
      expect(data[8]).to.equals(true);
      expect(data[9]).to.equals(false);
    });

    it("Should get epoch votes", async () => {
      // should revert before initialization
      await expectRevert(ftso.getEpochVotes(epochId), "Epoch data not available");

      let data;
      // before price submit
      await increaseTimeTo(epochId * 120 + 30); // initialize price epoch
      await setMockVotePowerAt(10, 50000, 1000000);
      await ftso.initializeCurrentEpochStateForReveal(50000, false, { from: accounts[10] });

      data = await ftso.getEpochVotes(epochId);
      expect(data[0].length).to.equals(0);
      expect(data[1].length).to.equals(0);
      expect(data[2].length).to.equals(0);
      expect(data[3].length).to.equals(0);
      expect(data[4].length).to.equals(0);

      await ftso.submitPriceHash(epochId, submitPriceHash(500, 123, accounts[1]), { from: accounts[1] });
      await ftso.submitPriceHash(epochId, submitPriceHash(250, 124, accounts[2]), { from: accounts[2] });
      await ftso.submitPriceHash(epochId, submitPriceHash(400, 125, accounts[3]), { from: accounts[3] });
      await increaseTimeTo((epochId + 1) * 120); // reveal period start

      // before price reveal
      data = await ftso.getEpochVotes(epochId);
      expect(data[0].length).to.equals(0);
      expect(data[1].length).to.equals(0);
      expect(data[2].length).to.equals(0);
      expect(data[3].length).to.equals(0);
      expect(data[4].length).to.equals(0);

      await setMockVotePowerOfAt(10, 1000, 10000, accounts[1]);
      await ftso.revealPrice(epochId, 500, 123, { from: accounts[1] });
      await setMockVotePowerOfAt(10, 5000, 0, accounts[2]);
      await ftso.revealPrice(epochId, 250, 124, { from: accounts[2] });
      await setMockVotePowerOfAt(10, 0, 50000, accounts[3]);
      await ftso.revealPrice(epochId, 400, 125, { from: accounts[3] });
      await increaseTimeTo((epochId + 1) * 120 + 60); // reveal period end
      // Everyone voted
      // before price finalization
      data = await ftso.getEpochVotes(epochId);
      expect(data[0].length).to.equals(3);
      expect(data[1].length).to.equals(3);
      expect(data[2].length).to.equals(3);
      expect(data[3].length).to.equals(3);
      expect(data[4].length).to.equals(3);

      let prices = [500, 250, 400];
      let weightsNat = [20000000000, 100000000000, 0];

      compareArrays<string>(data[0], [accounts[1], accounts[2], accounts[3]]);
      compareNumberArrays(data[1], prices);
      compareNumberArrays(data[2], [166666666666, 833333333333, 0]);
      compareNumberArrays(data[3], weightsNat);
      compareNumberArrays(data[4], [0, 0, 0]); // always 0 after first price finalization, as current price was 0
      compareArrays<boolean>(data[5], [false, false, false]);

      await ftso.finalizePriceEpoch(epochId, false, { from: accounts[10] }); // finalize price -> epochId price = 250

      // after price finalization
      data = await ftso.getEpochVotes(epochId);
      expect(data[0].length).to.equals(3);
      expect(data[1].length).to.equals(3);
      expect(data[2].length).to.equals(3);
      expect(data[3].length).to.equals(3);
      expect(data[4].length).to.equals(3);

      let id1 = data[0].indexOf(accounts[1]);
      let id2 = data[0].indexOf(accounts[2]);
      let id3 = data[0].indexOf(accounts[3]);

      compareArrays<string>([data[0][id1], data[0][id2], data[0][id3]], [accounts[1], accounts[2], accounts[3]]);
      compareNumberArrays([data[1][id1], data[1][id2], data[1][id3]], prices);
      compareNumberArrays([data[2][id1], data[2][id2], data[2][id3]], [166666666666, 833333333333, 0]);
      compareNumberArrays([data[3][id1], data[3][id2], data[3][id3]], weightsNat);
      compareNumberArrays([data[4][id1], data[4][id2], data[4][id3]], [0, 0, 0]); // always 0 after first price finalization, as current price was 0
      compareArrays<boolean>([data[5][id1], data[5][id2], data[5][id3]], [false, true, false]);

      await ftso.submitPriceHash(epochId + 1, submitPriceHash(300, 223, accounts[1]), { from: accounts[1] });
      await ftso.submitPriceHash(epochId + 1, submitPriceHash(400, 300, accounts[2]), { from: accounts[2] });
      await ftso.submitPriceHash(epochId + 1, submitPriceHash(200, 23, accounts[3]), { from: accounts[3] });
      await ftso.setVotePowerBlock(12, { from: accounts[10] });
      await setMockVotePowerAt(12, 20000, 100000);
      await ftso.initializeCurrentEpochStateForReveal(20000, false, { from: accounts[10] });
      await increaseTimeTo((epochId + 2) * 120); // reveal period start
      await setMockVotePowerOfAt(12, 2000, 0, accounts[1]);
      await ftso.revealPrice(epochId + 1, 300, 223, { from: accounts[1] });
      await setMockVotePowerOfAt(12, 2000, 80000, accounts[2]);
      await ftso.revealPrice(epochId + 1, 400, 300, { from: accounts[2] });
      await setMockVotePowerOfAt(12, 2000, 10000, accounts[3]);
      await ftso.revealPrice(epochId + 1, 200, 23, { from: accounts[3] });
      await increaseTimeTo((epochId + 2) * 120 + 60); // reveal period end

      // before price finalization 2
      data = await ftso.getEpochVotes(epochId + 1);
      expect(data[0].length).to.equals(3);
      expect(data[1].length).to.equals(3);
      expect(data[2].length).to.equals(3);
      expect(data[3].length).to.equals(3);
      expect(data[4].length).to.equals(3);

      let prices2 = [300, 400, 200];
      let natWeights = [100000000000, 100000000000, 100000000000];
      let assetWeights = [0, 0, 0];

      compareArrays<string>(data[0], [accounts[1], accounts[2], accounts[3]]);
      compareNumberArrays(data[1], prices2);
      compareNumberArrays(data[2], [333333333333, 333333333333, 333333333333]);
      compareNumberArrays(data[3], natWeights);
      compareNumberArrays(data[4], assetWeights);
      compareArrays<boolean>(data[5], [false, false, false]);

      await ftso.finalizePriceEpoch(epochId + 1, false, { from: accounts[10] }); // finalize price -> epochId+1 price = 400

      // after price finalization 2
      data = await ftso.getEpochVotes(epochId + 1);
      expect(data[0].length).to.equals(3);
      expect(data[1].length).to.equals(3);
      expect(data[2].length).to.equals(3);
      expect(data[3].length).to.equals(3);
      expect(data[4].length).to.equals(3);

      id1 = data[0].indexOf(accounts[1]);
      id2 = data[0].indexOf(accounts[2]);
      id3 = data[0].indexOf(accounts[3]);

      // asset weighted votes should be ignored
      compareArrays<string>([data[0][id1], data[0][id2], data[0][id3]], [accounts[1], accounts[2], accounts[3]]);
      compareNumberArrays([data[1][id1], data[1][id2], data[1][id3]], prices2);
      compareNumberArrays([data[2][id1], data[2][id2], data[2][id3]], [333333333333, 333333333333, 333333333333]);
      compareNumberArrays([data[3][id1], data[3][id2], data[3][id3]], natWeights);
      compareNumberArrays([data[4][id1], data[4][id2], data[4][id3]], assetWeights);
      compareArrays<boolean>([data[5][id1], data[5][id2], data[5][id3]], [true, true, true]);
    });
  });
  
  describe("multi asset ftsos", async () => {

    beforeEach(async () => {
      wnatInterface = await Wnat.new(accounts[0], "Wrapped NAT", "WNAT");
      await setDefaultVPContract(wnatInterface, accounts[0]);
      mockWnat = await MockWnat.new();
      vpTokenInterface = await VpToken.new(accounts[0], "A token", "ATOK");
      mockFtsos = [];
      mockFtsos[0] = await MockFtso.new();
      mockFtsos[1] = await MockFtso.new();
      mockFtsos[2] = await MockFtso.new();
      mockVpTokens = [];
      mockVpTokens[0] = await MockVpToken.new();
      mockVpTokens[1] = await MockVpToken.new();
      mockVpTokens[2] = await MockVpToken.new();
      ftso = await MockFtsoFull.new(
        "WNAT",
        5,
        accounts[4],
        mockWnat.address,
        accounts[10],
        0, 120, 60,
        0,
        1e10,
        defaultPriceEpochCyclicBufferSize,
        false
      );

      const asset_vpToken = ftso.contract.methods.getAsset().encodeABI();
      const asset0Return_vpToken = web3.eth.abi.encodeParameter('address', mockVpTokens[0].address);
      await mockFtsos[0].givenMethodReturn(asset_vpToken, asset0Return_vpToken);
      const asset1Return_vpToken = web3.eth.abi.encodeParameter('address', mockVpTokens[1].address);
      await mockFtsos[1].givenMethodReturn(asset_vpToken, asset1Return_vpToken);
      const asset2Return_vpToken = web3.eth.abi.encodeParameter('address', mockVpTokens[2].address);
      await mockFtsos[2].givenMethodReturn(asset_vpToken, asset2Return_vpToken);

      const decimals_vpToken = vpTokenInterface.contract.methods.decimals().encodeABI();
      const decimals3Return_vpToken = web3.eth.abi.encodeParameter('uint256', 3);
      await mockVpTokens[0].givenMethodReturn(decimals_vpToken, decimals3Return_vpToken);
      const decimals1Return_vpToken = web3.eth.abi.encodeParameter('uint256', 1);
      await mockVpTokens[1].givenMethodReturn(decimals_vpToken, decimals1Return_vpToken);

      await ftso.setAssetFtsos([mockFtsos[0].address, mockFtsos[1].address, mockFtsos[2].address], { from: accounts[10] });
      await ftso.configureEpochs(1, 1, 1000, 10000, 50, 500, 0, 0, [accounts[5], accounts[6], accounts[7]], { from: accounts[10] });
      await ftso.setVotePowerBlock(10, { from: accounts[10] });
      await ftso.activateFtso(0, 120, 60, { from: accounts[10] });

      // Force a block in order to get most up to date time
      await time.advanceBlock();
      // Get the timestamp for the just mined block
      let timestamp = await time.latest();
      epochId = Math.floor(timestamp.toNumber() / 120) + 1;
      await increaseTimeTo(epochId * 120);
    });

    it("Should finalize price epoch with correct vote powers", async () => {
      await ftso.submitPriceHash(epochId, submitPriceHash(500, 123, accounts[1]), { from: accounts[1] });
      await ftso.submitPriceHash(epochId, submitPriceHash(250, 124, accounts[2]), { from: accounts[2] });
      await ftso.submitPriceHash(epochId, submitPriceHash(400, 125, accounts[3]), { from: accounts[3] });

      await setMockVotePowerAtMultiple(10, 50000, [5000000, 200000, 7500], [1000, 3, 800]);
      await ftso.initializeCurrentEpochStateForReveal(50000, false, { from: accounts[10] });

      await increaseTimeTo((epochId + 1) * 120); // reveal period start
      await setMockVotePowerOfAtMultiple(10, 1000, [1000000, 150000, 0], accounts[1]);
      await ftso.revealPrice(epochId, 500, 123, { from: accounts[1] });
      await setMockVotePowerOfAtMultiple(10, 5000, [0, 5000, 1000], accounts[2]);
      await ftso.revealPrice(epochId, 250, 124, { from: accounts[2] });
      await setMockVotePowerOfAtMultiple(10, 0, [500000, 0, 6000], accounts[3]);
      await ftso.revealPrice(epochId, 400, 125, { from: accounts[3] });

      await increaseTimeTo((epochId + 1) * 120 + 60); // reveal period end
      expectEvent(await ftso.finalizePriceEpoch(epochId, false, { from: accounts[10] }), "PriceFinalized",
        { epochId: toBN(epochId), price: toBN(400), rewardedFtso: false, lowIQRRewardPrice: toBN(250), highIQRRewardPrice: toBN(400), finalizationType: toBN(1) });

      // after price finalization
      let data = await ftso.getEpochVotes(epochId);
      expect(data[0].length).to.equals(3);
      expect(data[1].length).to.equals(3);
      expect(data[2].length).to.equals(3);
      expect(data[3].length).to.equals(3);
      expect(data[4].length).to.equals(3);

      let id1 = data[0].indexOf(accounts[1]);
      let id2 = data[0].indexOf(accounts[2]);
      let id3 = data[0].indexOf(accounts[3]);

      compareArrays<string>([data[0][id1], data[0][id2], data[0][id3]], [accounts[1], accounts[2], accounts[3]]);
      compareNumberArrays([data[1][id1], data[1][id2], data[1][id3]], [500, 250, 400]);
      compareNumberArrays([data[2][id1], data[2][id2], data[2][id3]], [144189142620, 475057955734, 380752901644]);
      compareNumberArrays([data[3][id1], data[3][id2], data[3][id3]], [20000000000, 100000000000, 0]);
      compareNumberArrays([data[4][id1], data[4][id2], data[4][id3]], [82006377077, 78685307539, 513084393928]);
      compareArrays<boolean>([data[5][id1], data[5][id2], data[5][id3]], [false, true, true]);
    });

    it("Should finalize price epoch with correct vote powers - with ftso without asset", async () => {
      let mockFtsoWithoutXasset = await MockFtso.new();
      await ftso.setAssetFtsos([mockFtsoWithoutXasset.address, mockFtsos[0].address, mockFtsos[1].address, mockFtsos[2].address], { from: accounts[10] });

      await ftso.submitPriceHash(epochId, submitPriceHash(500, 123, accounts[1]), { from: accounts[1] });
      await ftso.submitPriceHash(epochId, submitPriceHash(250, 124, accounts[2]), { from: accounts[2] });
      await ftso.submitPriceHash(epochId, submitPriceHash(400, 125, accounts[3]), { from: accounts[3] });

      const currentPrice_ftso = ftso.contract.methods.getCurrentPrice().encodeABI();
      const currentPriceReturn_ftso = web3.eth.abi.encodeParameters(['uint256', 'uint256'], [500, 1]);
      await mockFtsoWithoutXasset.givenMethodReturn(currentPrice_ftso, currentPriceReturn_ftso);

      await setMockVotePowerAtMultiple(10, 50000, [5000000, 200000, 7500], [1000, 3, 800]);
      await ftso.initializeCurrentEpochStateForReveal(50000, false, { from: accounts[10] });

      await increaseTimeTo((epochId + 1) * 120); // reveal period start
      await setMockVotePowerOfAtMultiple(10, 1000, [1000000, 150000, 0], accounts[1]);
      await ftso.revealPrice(epochId, 500, 123, { from: accounts[1] });
      await setMockVotePowerOfAtMultiple(10, 5000, [0, 5000, 1000], accounts[2]);
      await ftso.revealPrice(epochId, 250, 124, { from: accounts[2] });
      await setMockVotePowerOfAtMultiple(10, 0, [500000, 0, 6000], accounts[3]);
      await ftso.revealPrice(epochId, 400, 125, { from: accounts[3] });

      await increaseTimeTo((epochId + 1) * 120 + 60); // reveal period end
      expectEvent(await ftso.finalizePriceEpoch(epochId, false, { from: accounts[10] }), "PriceFinalized",
        { epochId: toBN(epochId), price: toBN(400), rewardedFtso: false, lowIQRRewardPrice: toBN(250), highIQRRewardPrice: toBN(400), finalizationType: toBN(1) });

      // after price finalization
      let data = await ftso.getEpochVotes(epochId);
      expect(data[0].length).to.equals(3);
      expect(data[1].length).to.equals(3);
      expect(data[2].length).to.equals(3);
      expect(data[3].length).to.equals(3);
      expect(data[4].length).to.equals(3);

      let id1 = data[0].indexOf(accounts[1]);
      let id2 = data[0].indexOf(accounts[2]);
      let id3 = data[0].indexOf(accounts[3]);

      compareArrays<string>([data[0][id1], data[0][id2], data[0][id3]], [accounts[1], accounts[2], accounts[3]]);
      compareNumberArrays([data[1][id1], data[1][id2], data[1][id3]], [500, 250, 400]);
      compareNumberArrays([data[2][id1], data[2][id2], data[2][id3]], [144189142620, 475057955734, 380752901644]);
      compareNumberArrays([data[3][id1], data[3][id2], data[3][id3]], [20000000000, 100000000000, 0]);
      compareNumberArrays([data[4][id1], data[4][id2], data[4][id3]], [82006377077, 78685307539, 513084393928]);
      compareArrays<boolean>([data[5][id1], data[5][id2], data[5][id3]], [false, true, true]);
    });

    it("Should not get asset if multi asset ftsos", async () => {
      let address = await ftso.getAsset();
      expect(address).to.equals(constants.ZERO_ADDRESS);
    });

    it("Should update assets", async () => {
      await ftso.setAssetFtsos([mockFtsos[2].address, mockFtsos[0].address], { from: accounts[10] });
      expect(await ftso.assetFtsos(0)).to.equals(mockFtsos[2].address);
      expect(await ftso.assetFtsos(1)).to.equals(mockFtsos[0].address);
      await expectRevert.unspecified(ftso.assetFtsos(2));
      expect(await ftso.assets(0)).to.equals(mockVpTokens[2].address);
      expect(await ftso.assets(1)).to.equals(mockVpTokens[0].address);
      await expectRevert.unspecified(ftso.assets(2));
    });

    it("Should not set assets if not ftso manager", async () => {
      await expectRevert(ftso.setAssetFtsos([mockFtsos[0].address, mockFtsos[1].address], { from: accounts[1] }), "Access denied");
    });
  });
});
