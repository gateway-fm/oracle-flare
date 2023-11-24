import {
  IncentivePoolTreasuryInstance,
} from "../../../../typechain-truffle";

import { expectRevert, time } from '@openzeppelin/test-helpers';
import {getTestFile} from '../../../utils/constants';

const IncentivePoolTreasury = artifacts.require("IncentivePoolTreasury");
const MockContract = artifacts.require("MockContract");

const ONLY_GOVERNANCE_MSG = "only governance";

const BN = web3.utils.toBN;


contract(`IncentivePoolTreasury.sol; ${getTestFile(__filename)}; Incentive pool treasury unit tests`, async accounts => {
  const governance = accounts[1];
  let incentivePoolTreasury : IncentivePoolTreasuryInstance

  describe("Treasury", async () => {
    beforeEach(async () => {
      incentivePoolTreasury = await IncentivePoolTreasury.new(governance);
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

    it("should update IncentivePool", async() => {
      const mockContract = await MockContract.new();

      await incentivePoolTreasury.setIncentivePoolContract(mockContract.address, {from: governance});
      assert.equal(await incentivePoolTreasury.incentivePool(), mockContract.address);

      const mockContract2 = await MockContract.new();

      await incentivePoolTreasury.setIncentivePoolContract(mockContract2.address, {from: governance});
      assert.equal(await incentivePoolTreasury.incentivePool(), mockContract2.address);
    })

    it("should only receive funds from governance", async() => {
      await web3.eth.sendTransaction({to: incentivePoolTreasury.address, value: BN(10), from: governance});

      const tx = web3.eth.sendTransaction({to: incentivePoolTreasury.address, value: BN(10), from: accounts[0]});
      await expectRevert(tx, ONLY_GOVERNANCE_MSG);

      assert.equal((await web3.eth.getBalance(incentivePoolTreasury.address)).toString(), "10");
    });

    it("Should setMaxPullRequest only from governance", async () => {
      await expectRevert(incentivePoolTreasury.setMaxPullRequest(BN(1000), { from: accounts[5] }), ONLY_GOVERNANCE_MSG);
    });
  });

  describe("Pull funds", async() => {
    beforeEach(async () => {
      incentivePoolTreasury = await IncentivePoolTreasury.new(governance);
      await incentivePoolTreasury.setIncentivePoolContract(accounts[15], {from: governance});
    })

    it("Should not pull if not incentive pool", async() => {
      const tx = incentivePoolTreasury.pullFunds(0, {from: accounts[10]});
      await expectRevert(tx, "incentive pool only");
    });

    it("Should not pull faster that every 23 hours", async()=> {
      await time.advanceBlock();
      const now = await time.latest();
      const timeToPull = now.add(BN(22 * 60 * 60));
      // We cheat and withdraw 0 funds -> this works on normal accounts
      await incentivePoolTreasury.pullFunds(0, {from: accounts[15]});

      await time.increaseTo(timeToPull);

      const tx = incentivePoolTreasury.pullFunds(0, {from: accounts[15]});
      await expectRevert(tx, "too often");
    });

    it("Should re pull after 23 hours", async()=> {
      await time.advanceBlock();
      const now = await time.latest();
      const timeToPull = now.add(BN(23 * 60 * 60 + 10));
      // We cheat and withdraw 0 funds -> this works on normal accounts
      await incentivePoolTreasury.pullFunds(0, {from: accounts[15]});

      await time.increaseTo(timeToPull);

      await incentivePoolTreasury.pullFunds(0, {from: accounts[15]});
    });

    it("Should not pull more than limit", async()=> {
      // We cheat and withdraw 0 funds -> this works on normal accounts
      const tx = incentivePoolTreasury.pullFunds(BN(25000001).mul(BN(10).pow(BN(18))), {from: accounts[15]});
      await expectRevert(tx, "too much");
    });

    it("Should revert on bad call", async()=> {
      // We cheat and withdraw 0 funds -> this works on normal accounts
      const tx = incentivePoolTreasury.pullFunds(10, {from: accounts[15]});
      await expectRevert(tx, "pull failed");
    });

    it("Should make sure setMaxPullRequest changes are time locked", async () => {
      // Assemble
      // first request should succeed.
      // correct amount success
      await incentivePoolTreasury.setMaxPullRequest(BN(1000), { from: governance });
      expect((await incentivePoolTreasury.maxPullRequestWei()).toNumber()).to.equals(1000);

      await expectRevert(incentivePoolTreasury.setMaxPullRequest(BN(1010),
        { from: governance }),
        "time gap too short");
      expect((await incentivePoolTreasury.maxPullRequestWei()).toNumber()).to.equals(1000);

      await time.increase(7 * 24 * 3600);
      await incentivePoolTreasury.setMaxPullRequest(BN(1010), { from: governance });
      expect((await incentivePoolTreasury.maxPullRequestWei()).toNumber()).to.equals(1010);
    });

    it("Should make sure setMaxPullRequest changes are not too large", async () => {
      // Assemble
      // the request should fail as we can only increase the maximum by 10%
      await expectRevert(incentivePoolTreasury.setMaxPullRequest(web3.utils.toWei(BN(100000000)),
        { from: governance }),
        "max pull too high");
    });

    it("Should make sure setMaxPullRequest changes just below allowed maximum go through", async () => {
      // Assemble
      await incentivePoolTreasury.setMaxPullRequest(web3.utils.toWei(BN(27500000)), { from: governance });
      expect((await incentivePoolTreasury.lastUpdateMaxPullRequestTs()).toString()).to.equals((await time.latest()).toString());
    });

    it("Should make sure setMaxPullRequest changes are not too large", async () => {
      // Assemble
      // the request should fail as we can only increase the maximum by 10%
      await expectRevert(incentivePoolTreasury.setMaxPullRequest(web3.utils.toWei(BN(27500001)),
        { from: governance }),
        "max pull too high");
    });

    it("Should make sure setMaxPullRequest cannot be set to zero", async () => {
      // Assemble
      // the request should fail as we cannot set the maximum to 0
      await expectRevert(incentivePoolTreasury.setMaxPullRequest(BN(0),
        { from: governance }),
        "max pull is zero");
    });
  });

});
