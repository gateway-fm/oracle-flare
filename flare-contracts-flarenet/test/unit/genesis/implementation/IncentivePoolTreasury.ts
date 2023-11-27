import {
  IncentivePoolTreasuryInstance,
} from "../../../../typechain-truffle";

import { expectRevert, time } from '@openzeppelin/test-helpers';
import {getTestFile, GOVERNANCE_GENESIS_ADDRESS} from '../../../utils/constants';

const IncentivePoolTreasury = artifacts.require("IncentivePoolTreasury");
const MockContract = artifacts.require("MockContract");

const ONLY_GOVERNANCE_MSG = "only governance";

const BN = web3.utils.toBN;



contract(`IncentivePoolTreasury.sol; ${getTestFile(__filename)}; Incentive pool treasury unit tests`, async accounts => {
  const governance = GOVERNANCE_GENESIS_ADDRESS;
  let incentivePoolTreasury : IncentivePoolTreasuryInstance

  describe("Treasury", async () => {
    beforeEach(async () => {
      incentivePoolTreasury = await IncentivePoolTreasury.new();
      await incentivePoolTreasury.initialiseFixedAddress()
    })

    it("should set IncentivePool", async() => {
      const mockContract = await MockContract.new();

      await incentivePoolTreasury.setIncentivePoolContract(mockContract.address, {from: governance});
      assert.equal(await incentivePoolTreasury.incentivePool(), mockContract.address);
    })

    it("should set IncentivePool only from governance", async() => {
      const mockContract = await MockContract.new();

      const tx = incentivePoolTreasury.setIncentivePoolContract(mockContract.address, {from: accounts[10]});
      assert.notEqual(accounts[10], governance);
      await expectRevert(tx, ONLY_GOVERNANCE_MSG);
    })

    it("should set IncentivePool only once", async() => {
      const mockContract = await MockContract.new();

      await incentivePoolTreasury.setIncentivePoolContract(mockContract.address, {from: governance});
      assert.equal(await incentivePoolTreasury.incentivePool(), mockContract.address);

      const mockContract2 = await MockContract.new();

      const tx = incentivePoolTreasury.setIncentivePoolContract(mockContract2.address, {from: governance});
      await expectRevert(tx, "already set");
    })
  })
  describe("Pull funds", async() => {
    
    beforeEach(async () => {
      incentivePoolTreasury = await IncentivePoolTreasury.new();
      await incentivePoolTreasury.initialiseFixedAddress()
      await incentivePoolTreasury.setIncentivePoolContract(accounts[15], {from: governance});

    })

    it("Should not pull if not incentive pool", async() => {
      const tx = incentivePoolTreasury.pullFunds(0, {from: accounts[10]});
      await expectRevert(tx, "incentive pool only");
    })

    it("Should not pull faster that every 23 hours", async()=>{
      await time.advanceBlock();
      const now = await time.latest();
      const timeToPull = now.add(BN(22 * 60 * 60));
      // We cheat and withdraw 0 funds -> this works on normal accounts
      await incentivePoolTreasury.pullFunds(0, {from: accounts[15]});
      
      await time.increaseTo(timeToPull);

      const tx = incentivePoolTreasury.pullFunds(0, {from: accounts[15]});
      await expectRevert(tx, "too often");
    })

    it("Should re pull after 23 hours", async()=>{
      await time.advanceBlock();
      const now = await time.latest();
      const timeToPull = now.add(BN(23 * 60 * 60 + 10));
      // We cheat and withdraw 0 funds -> this works on normal accounts
      await incentivePoolTreasury.pullFunds(0, {from: accounts[15]});
      
      await time.increaseTo(timeToPull);

      await incentivePoolTreasury.pullFunds(0, {from: accounts[15]});
    })

    it("Should not pull more than limit", async()=>{
      // We cheat and withdraw 0 funds -> this works on normal accounts
      const tx = incentivePoolTreasury.pullFunds(BN(25000001).mul(BN(10).pow(BN(18))), {from: accounts[15]});
      await expectRevert(tx, "too much");
    })

    it("Should revert on bad call", async()=>{
      // We cheat and withdraw 0 funds -> this works on normal accounts
      const tx = incentivePoolTreasury.pullFunds(10, {from: accounts[15]});
      await expectRevert(tx, "pull failed");
    })

  })

});
