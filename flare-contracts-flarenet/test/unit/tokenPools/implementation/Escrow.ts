import { balance, constants, expectRevert, time } from '@openzeppelin/test-helpers';
import { Contracts } from "../../../../deployment/scripts/Contracts";
import { SupplyInstance, EscrowInstance, WNatInstance } from "../../../../typechain-truffle";
import { emptyAddressBalance } from '../../../utils/contract-test-helpers';
import { encodeContractNames } from "../../../utils/test-helpers";

const Supply = artifacts.require("Supply");

const getTestFile = require('../../../utils/constants').getTestFile;
const { calcGasCost } = require('../../../utils/eth');

const initialGenesisAmountWei = 10 ** 10;
const totalFoundationSupplyWei =  10 ** 5;
const initialCirculatingSupply = initialGenesisAmountWei - totalFoundationSupplyWei;
const burnAddress = "0x000000000000000000000000000000000000dEaD";

const BN = web3.utils.toBN;

const Escrow = artifacts.require("Escrow");
const WNat = artifacts.require("WNat");
const MockClaim = artifacts.require("GasConsumer2");

contract(`Escrow.sol; ${getTestFile(__filename)}; Escrow unit tests`, async accounts => {
  let escrow: EscrowInstance;
  let claimants: string[] = [];
  const GOVERNANCE_ADDRESS = accounts[0];
  const ADDRESS_UPDATER = accounts[16];
  let latestStart: BN;
  let wNat: WNatInstance;

  beforeEach(async () => {
    latestStart = (await time.latest()).addn(10 * 24 * 60 * 60); // in 10 days
    escrow = await Escrow.new(GOVERNANCE_ADDRESS, ADDRESS_UPDATER, latestStart);
    wNat = await WNat.new(accounts[0], "Wrapped NAT", "WNAT");
    // tell team escrow about WNat contract
    await escrow.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.WNAT]),
      [ADDRESS_UPDATER, wNat.address], {from: ADDRESS_UPDATER});
    // Build an array of claimant accounts
    for (let i = 0; i < 10; i++) {
      claimants[i] = accounts[i + 1];
    }
  });

  describe("Basic", async() => {
    it("Should revert if latest start time in the past", async () => {
      // Assemble
      // Act
      const escrowPromise = Escrow.new(GOVERNANCE_ADDRESS, ADDRESS_UPDATER, (await time.latest()).subn(5));
      // Assert
      await expectRevert(escrowPromise, "In the past");
    });

    it("Should add executors", async() => {
      // Assemble
      // Act
      await escrow.setClaimExecutors([accounts[2], accounts[3]], { from: accounts[1] });
      // Assert
      const executors = await escrow.claimExecutors(accounts[1]);
      expect(executors[0]).to.equals(accounts[2]);
      expect(executors[1]).to.equals(accounts[3]);
      expect(executors.length).to.equals(2);
    });

    it("Should remove executors", async() => {
      // Assemble
      await escrow.setClaimExecutors([accounts[2]], { from: accounts[1] });
      // Act
      await escrow.setClaimExecutors([], { from: accounts[1] });
      // Assert
      const executors = await escrow.claimExecutors(accounts[1]);
      expect(executors.length).to.equals(0);
    });

    
    it("Should add recipients", async() => {
      // Assemble
      // Act
      await escrow.setAllowedClaimRecipients([accounts[2], accounts[3]], { from: accounts[1] });
      // Assert
      const recipients = await escrow.allowedClaimRecipients(accounts[1]);
      expect(recipients[0]).to.equals(accounts[2]);
      expect(recipients[1]).to.equals(accounts[3]);
      expect(recipients.length).to.equals(2);
    });

    it("Should remove recipients", async() => {
      // Assemble
      await escrow.setAllowedClaimRecipients([accounts[2]], { from: accounts[1] });
      // Act
      await escrow.setAllowedClaimRecipients([], { from: accounts[1] });
      // Assert
      const recipients = await escrow.allowedClaimRecipients(accounts[1]);
      expect(recipients.length).to.equals(0);
    });

    it("Should claim ownership", async() => {
      // Assemble
      const locked = BN(await web3.eth.getBalance(accounts[1])).divn(10);
      await escrow.lock({from: accounts[1], value: locked});
      await escrow.proposeNewOwner(accounts[2], {from: accounts[1]});
      assert.isTrue((await escrow.lockedAmounts(accounts[1]))[0].eq(locked));
      expect(await escrow.proposedNewOwner(accounts[1])).to.equals(accounts[2]);
      // Act
      await escrow.claimNewOwner(accounts[1], {from: accounts[2]});
      // Assert
      assert.isTrue((await escrow.lockedAmounts(accounts[2]))[0].eq(locked));
      assert.isTrue((await escrow.lockedAmounts(accounts[1]))[0].eqn(0));
      expect(await escrow.proposedNewOwner(accounts[1])).to.equals(constants.ZERO_ADDRESS);
    });

    it("Should not claim ownership if not set or set wrong", async() => {
      // Assemble
      await expectRevert(escrow.claimNewOwner(accounts[2]), "Wrong old owner");
      // Act
      await escrow.proposeNewOwner(accounts[2], {from: accounts[1]});
      // Assert
      await expectRevert(escrow.claimNewOwner(accounts[0], {from: accounts[2]}), "Wrong old owner");
    });
  });

  describe("Locking", async() => {
    it("Should not be able to get claimbale bips", async() => {
      const now = (await time.latest()).addn(1);
      await expectRevert(escrow.getCurrentClaimablePercentBips(now), "Claiming not started");
    });

    it("Should enable locking", async() => {
      const locked = BN(await web3.eth.getBalance(claimants[0])).divn(10);
      await escrow.lock({from: claimants[0], value: locked});
      const lockedBalance = await escrow.lockedAmounts(claimants[0]);
      expect(locked.eq(lockedBalance[0]));
    });

    it("Should be able to lock some more", async() => {
      const locked = BN(await web3.eth.getBalance(claimants[0])).divn(10);
      await escrow.lock({from: claimants[0], value: locked});
      await escrow.lock({from: claimants[0], value: locked});
      const lockedBalance = await escrow.lockedAmounts(claimants[0]);
      expect(locked.muln(2).eq(lockedBalance[0]));
    });

    it("Should not allow claiming start to be pushed in the past", async () => {
      // Assemble
      const now = (await time.latest()).addn(10);
      await escrow.setClaimingStartTs(now);
      const claimStartTs = await escrow.claimStartTs();
      assert(claimStartTs.eq(now));
      // Act
      const before = now.subn(60 * 60 * 24 * 5);
      const restart_promise = escrow.setClaimingStartTs(before);
      // Assert
      await expectRevert(restart_promise, "Wrong start timestamp");
    });

    it("Should allow claiming start to be pushed in the future", async () => {
      // Assemble
      const now = (await time.latest()).addn(10);
      await escrow.setClaimingStartTs(now);
      const claimStartTs = await escrow.claimStartTs();
      assert(claimStartTs.eq(now));
      // Act
      const later = now.addn(60 * 60 * 24 * 5);
      await escrow.setClaimingStartTs(later);
      // Assert
      const claimStartTs2 = await escrow.claimStartTs();
      assert(claimStartTs2.eq(later));
    });

    it("Should not allow claiming start to be pushed in the future if already started", async () => {
      // Assemble
      const now = (await time.latest()).addn(1);
      await escrow.setClaimingStartTs(now);
      const claimStartTs = await escrow.claimStartTs();
      assert(claimStartTs.eq(now));
      // Act
      const later = now.addn(60 * 60 * 24 * 5);
      const restart_promise = escrow.setClaimingStartTs(later);
      // Assert
      await expectRevert(restart_promise, "Already started");
    });

    it("Should not allow claiming start to be pushed to far in the future", async () => {
      // Assemble
      const now = (await time.latest()).addn(10);
      await escrow.setClaimingStartTs(now);
      const claimStartTs = await escrow.claimStartTs();
      assert(claimStartTs.eq(now));
      // Act
      const later = now.subn(60 * 60 * 24 * 10);
      const restart_promise = escrow.setClaimingStartTs(later);
      // Assert
      await expectRevert(restart_promise, "Wrong start timestamp");
    });

  })

  describe("Collection", async() => {

    it("Should not collect before start is set", async() => {
      const locked = BN(8500)
      await escrow.lock({from: claimants[0], value: locked});
      const now = (await time.latest()).addn(2);

      const tx = escrow.claim({from: claimants[0]});
      await expectRevert(tx, "Claiming not started");
      await escrow.setClaimingStartTs(now, {from: GOVERNANCE_ADDRESS});
      // Nothing to claim
      const tx2 = escrow.claim({from: claimants[0]});
      await expectRevert(tx2, "No claimable funds");

      await time.increaseTo(now.addn(86400 * 31));
      // Should go ok
      await escrow.claim({from: claimants[0]});
    
    });

    it("Should not collect before start timestamp", async() => {
      const locked = BN(8500)
      await escrow.lock({from: claimants[0], value: locked});
      const now = (await time.latest()).addn(1);

      const tx = escrow.claim({from: claimants[0]});
      await escrow.setClaimingStartTs(now.addn(200), {from: GOVERNANCE_ADDRESS});
      await expectRevert(tx, "Claiming not started");
      await time.increaseTo(now.addn(86400 * 31));
      // Should go ok
      await escrow.claim({from: claimants[0]});
    
    });

    it("Should collect funds", async() => {
      // Lock some funds
      const locked = BN(8500)
      await escrow.lock({from: claimants[0], value: locked});
      const now = (await time.latest()).addn(1);
      await escrow.setClaimingStartTs(now, {from: GOVERNANCE_ADDRESS});

      await time.increaseTo(now.addn(86400 * 31));
      // Act
      const openingBalance = BN(await web3.eth.getBalance(claimants[0]));
      const claimResult = await escrow.claim({ from: claimants[0] });
      // Assert

      const closingBalance = BN(await web3.eth.getBalance(claimants[0]));
      let txCost = BN(await calcGasCost(claimResult));
      assert.equal(txCost.add(closingBalance).sub(openingBalance).toNumber(), 237);
      
    });

    it("Should collect funds multiple times", async() => {
      // Lock some funds
      const locked = BN(8500)
      await escrow.lock({from: claimants[0], value: locked});
      const now = (await time.latest()).addn(1);
      await escrow.setClaimingStartTs(now, {from: GOVERNANCE_ADDRESS});

      await time.increaseTo(now.addn(86400 * 31));
      // Act
      let openingBalance = BN(await web3.eth.getBalance(claimants[0]));
      let claimResult = await escrow.claim({ from: claimants[0] });
      // Assert

      let closingBalance = BN(await web3.eth.getBalance(claimants[0]));
      let txCost = BN(await calcGasCost(claimResult));
      assert.equal(txCost.add(closingBalance).sub(openingBalance).toNumber(), 237);
      
      // Claim again
      await time.increaseTo(now.addn(86400 * 31).addn(86400 * 31));
      // Act
      openingBalance = BN(await web3.eth.getBalance(claimants[0]));
      claimResult = await escrow.claim({ from: claimants[0] });
      // Assert

      closingBalance = BN(await web3.eth.getBalance(claimants[0]));
      txCost = BN(await calcGasCost(claimResult));
      assert.equal(txCost.add(closingBalance).sub(openingBalance).toNumber(), 237);

    });

    it("Should not overclaim", async() => {
      // Lock some funds
      const locked = BN(8500)
      await escrow.lock({from: claimants[0], value: locked});
      const now = (await time.latest()).addn(1);
      await escrow.setClaimingStartTs(now, {from: GOVERNANCE_ADDRESS});

      await time.increaseTo(now.addn(86400 * 31));
      // Act
      const openingBalance = BN(await web3.eth.getBalance(claimants[0]));
      const claimResult = await escrow.claim({ from: claimants[0] });
      // Assert

      const closingBalance = BN(await web3.eth.getBalance(claimants[0]));
      const txCost = BN(await calcGasCost(claimResult));
      assert.equal(txCost.add(closingBalance).sub(openingBalance).toNumber(), 237);
      
      // Claim again without time increase

      // Act
      const tx = escrow.claim({ from: claimants[0] });
      // Assert

      await expectRevert(tx, "No claimable funds");

    });

    it("Should not exaust claim before 36 months", async() => {
      // Lock some funds
      const locked = BN(8500)
      await escrow.lock({from: claimants[0], value: locked});
      const now = (await time.latest()).addn(1);
      await escrow.setClaimingStartTs(now, {from: GOVERNANCE_ADDRESS});

      await time.increaseTo(now.addn(86400 * 31));
      // Act
      let openingBalance = BN(await web3.eth.getBalance(claimants[0]));
      let claimResult = await escrow.claim({ from: claimants[0] });
      // Assert

      let closingBalance = BN(await web3.eth.getBalance(claimants[0]));
      let txCost = BN(await calcGasCost(claimResult));
      assert.equal(txCost.add(closingBalance).sub(openingBalance).toNumber(), 237);
      
      // Claim again
      await time.increaseTo(now.addn(86400 * 31).addn(86400 * 31));
      // Act
      openingBalance = BN(await web3.eth.getBalance(claimants[0]));
      claimResult = await escrow.claim({ from: claimants[0] });
      // Assert

      closingBalance = BN(await web3.eth.getBalance(claimants[0]));
      txCost = BN(await calcGasCost(claimResult));
      assert.equal(txCost.add(closingBalance).sub(openingBalance).toNumber(), 237);
      
      // Claim again after a long time
      await time.increaseTo(now.add(BN(86400).muln(30 * 35))); // 30 months

      // Act
      openingBalance = BN(await web3.eth.getBalance(claimants[0]));
      claimResult = await escrow.claim({ from: claimants[0] });
      // Assert

      closingBalance = BN(await web3.eth.getBalance(claimants[0]));
      txCost = BN(await calcGasCost(claimResult));
      assert.equal(txCost.add(closingBalance).sub(openingBalance).toNumber(), 8500 - 237 - 237 - 205); // The last month is not claimed
    });

    it("Should exaust claim in 36 months", async() => {
      // Lock some funds
      const locked = BN(8500)
      await escrow.lock({from: claimants[0], value: locked});
      const now = (await time.latest()).addn(1);
      await escrow.setClaimingStartTs(now, {from: GOVERNANCE_ADDRESS});

      await time.increaseTo(now.addn(86400 * 31));
      // Act
      let openingBalance = BN(await web3.eth.getBalance(claimants[0]));
      let claimResult = await escrow.claim({ from: claimants[0] });
      // Assert

      let closingBalance = BN(await web3.eth.getBalance(claimants[0]));
      let txCost = BN(await calcGasCost(claimResult));
      assert.equal(txCost.add(closingBalance).sub(openingBalance).toNumber(), 237);
      
      // Claim again
      await time.increaseTo(now.addn(86400 * 31).addn(86400 * 31));
      // Act
      openingBalance = BN(await web3.eth.getBalance(claimants[0]));
      claimResult = await escrow.claim({ from: claimants[0] });
      // Assert

      closingBalance = BN(await web3.eth.getBalance(claimants[0]));
      txCost = BN(await calcGasCost(claimResult));
      assert.equal(txCost.add(closingBalance).sub(openingBalance).toNumber(), 237);
      
      // Claim again after a long time
      await time.increaseTo(now.add(BN(86400).muln(30 * 36))); // 36 months

      // Act
      openingBalance = BN(await web3.eth.getBalance(claimants[0]));
      claimResult = await escrow.claim({ from: claimants[0] });
      // Assert

      closingBalance = BN(await web3.eth.getBalance(claimants[0]));
      txCost = BN(await calcGasCost(claimResult));
      assert.equal(txCost.add(closingBalance).sub(openingBalance).toNumber(), 8500 - 237 - 237);
    });
    
    it("Should enable claiming by executor", async () => {
      // Lock some funds
      const locked = BN(8500)
      await escrow.lock({from: claimants[0], value: locked});
      const now = (await time.latest()).addn(1);
      await escrow.setClaimingStartTs(now, {from: GOVERNANCE_ADDRESS});
      // add claim executor
      const executor = accounts[55];
      await escrow.setClaimExecutors([executor], { from: claimants[0] });
      // increase time to enable claiming
      await time.increaseTo(now.addn(86400 * 31));
      // Act
      await expectRevert(escrow.claimByExecutor(claimants[0], accounts[50], { from: executor }), "Recipient not allowed");
      let openingBalance = BN(await web3.eth.getBalance(claimants[0]));
      await escrow.claimByExecutor(claimants[0], claimants[0], { from: executor });
      // Assert
      let closingBalance = BN(await web3.eth.getBalance(claimants[0]));
      assert.equal(closingBalance.sub(openingBalance).toNumber(), 237);

      // remove executor
      await escrow.setClaimExecutors([], { from: claimants[0] });
      // Should revert claiming by executor or owner using wrong method
      await time.increaseTo(now.addn(86400 * 31).addn(86400 * 31));
      await expectRevert(escrow.claimByExecutor(claimants[0], claimants[0], { from: executor }), "Claim executor only");
      await expectRevert(escrow.claimByExecutor(claimants[0], claimants[0], { from: claimants[0] }), "Claim executor only");
      await escrow.claim({ from: claimants[0] })
    });

    it("Should enable claiming to a different address", async () => {
      // Lock some funds
      const locked = BN(8500)
      await escrow.lock({from: claimants[0], value: locked});
      const now = (await time.latest()).addn(1);
      await escrow.setClaimingStartTs(now, {from: GOVERNANCE_ADDRESS});

      await time.increaseTo(now.addn(86400 * 31));
      // Act
      let openingBalance = BN(await web3.eth.getBalance(claimants[0]));
      let claimResult = await escrow.claim({ from: claimants[0] });
      // Assert

      let closingBalance = BN(await web3.eth.getBalance(claimants[0]));
      let txCost = BN(await calcGasCost(claimResult));
      assert.equal(txCost.add(closingBalance).sub(openingBalance).toNumber(), 237);

      // Claim again, to a different address
      await time.increaseTo(now.addn(86400 * 31).addn(86400 * 31));
      // Act
      openingBalance = BN(await web3.eth.getBalance(claimants[1]));
      claimResult = await escrow.claimTo(claimants[1], { from: claimants[0] });
      // Assert

      closingBalance = BN(await web3.eth.getBalance(claimants[1]));
      assert.equal(closingBalance.sub(openingBalance).toNumber(), 237);

      // Claim to original address
      // Claim again after a long time
      await time.increaseTo(now.add(BN(86400).muln(30 * 36))); // 36 months

      // Act
      openingBalance = BN(await web3.eth.getBalance(claimants[0]));
      claimResult = await escrow.claim({ from: claimants[0] });
      // Assert

      closingBalance = BN(await web3.eth.getBalance(claimants[0]));
      txCost = BN(await calcGasCost(claimResult));
      assert.equal(txCost.add(closingBalance).sub(openingBalance).toNumber(), 8500 - 237 - 237);
    });

    it("Should enable wrapping, also with executors", async () => {
      // Lock some funds
      const locked = BN(8500)
      await escrow.lock({from: claimants[0], value: locked});
      const now = (await time.latest()).addn(1);
      await escrow.setClaimingStartTs(now, {from: GOVERNANCE_ADDRESS});
      await escrow.setClaimExecutors([accounts[20]], {from: claimants[0]});
      await escrow.setAllowedClaimRecipients([claimants[1]], {from: claimants[0]});

      await time.increaseTo(now.addn(86400 * 31));
      // Act
      let openingBalance = await wNat.balanceOf(claimants[0]);
      await escrow.claimAndWrap({ from: claimants[0] });
      // Assert

      let closingBalance = await wNat.balanceOf(claimants[0]);
      assert.equal(closingBalance.sub(openingBalance).toNumber(), 237);

      // Claim again, to a different address
      await time.increaseTo(now.addn(86400 * 31).addn(86400 * 31));
      // Act
      openingBalance = await wNat.balanceOf(claimants[1]);
      await escrow.claimAndWrapTo(claimants[1], { from: claimants[0] });
      // Assert

      closingBalance = await wNat.balanceOf(claimants[1]);
      assert.equal(closingBalance.sub(openingBalance).toNumber(), 237);

      // Claim again, to a different address
      await time.increaseTo(now.addn(86400 * 31).addn(86400 * 31).addn(86400 * 31));
      // Act
      openingBalance = await wNat.balanceOf(claimants[1]);
      await escrow.claimAndWrapByExecutor(claimants[0], claimants[1], { from: accounts[20] });
      // Assert

      closingBalance = await wNat.balanceOf(claimants[1]);
      assert.equal(closingBalance.sub(openingBalance).toNumber(), 237);

      // Claim to original address
      // Claim again after a long time
      await time.increaseTo(now.add(BN(86400).muln(30 * 36))); // 36 months

      // Act
      openingBalance = await wNat.balanceOf(claimants[0]);
      await escrow.claimAndWrapByExecutor(claimants[0], claimants[0], { from: accounts[20] });
      // Assert

      closingBalance = await wNat.balanceOf(claimants[0]);
      assert.equal(closingBalance.sub(openingBalance).toNumber(), 8500 - 237 - 237 - 237);
    });

    it("Should fail to claim", async() => {
       // Lock some funds
       const locked = BN(8500)
       await escrow.lock({from: claimants[0], value: locked});
       const now = (await time.latest()).addn(1);
       await escrow.setClaimingStartTs(now, {from: GOVERNANCE_ADDRESS});
 
       await time.increaseTo(now.addn(86400 * 31));
      
       let mockClaim = await MockClaim.new(5);
       let claimResult = escrow.claimTo(mockClaim.address, { from: claimants[0] });
       await expectRevert(claimResult, "Failed to call claiming contract");
    });

    it("Should enable transfering the ownership to a different address", async () => {
      // Lock some funds
      const locked = BN(8500)
      await escrow.lock({from: claimants[0], value: locked});
      const now = (await time.latest()).addn(1);
      await escrow.setClaimingStartTs(now, {from: GOVERNANCE_ADDRESS});

      await time.increaseTo(now.addn(86400 * 31));
      // Act
      let openingBalance = BN(await web3.eth.getBalance(claimants[0]));
      let claimResult = await escrow.claim({ from: claimants[0] });
      // Assert

      let closingBalance = BN(await web3.eth.getBalance(claimants[0]));
      let txCost = BN(await calcGasCost(claimResult));
      assert.equal(txCost.add(closingBalance).sub(openingBalance).toNumber(), 237);

      const lockedAmounts1 = await escrow.lockedAmounts(claimants[0]);
      expect(lockedAmounts1[0].eq(locked)).is.true;
      expect(lockedAmounts1[1].eqn(237)).is.true;

      // transfer ownership
      await escrow.proposeNewOwner(claimants[1], {from: claimants[0]});
      await escrow.claimNewOwner(claimants[0], {from: claimants[1]});
      const lockedAmounts2 = await escrow.lockedAmounts(claimants[0]);
      expect(lockedAmounts2[0].eqn(0)).is.true;
      expect(lockedAmounts2[1].eqn(0)).is.true;

      // Claim again, to a different address
      await time.increaseTo(now.addn(86400 * 31).addn(86400 * 31));
      // Act
      openingBalance = BN(await web3.eth.getBalance(claimants[0]));
      claimResult = await escrow.claimTo(claimants[0], { from: claimants[1] });
      // Assert

      closingBalance = BN(await web3.eth.getBalance(claimants[0]));
      assert.equal(closingBalance.sub(openingBalance).toNumber(), 237);

      const lockedAmounts3 = await escrow.lockedAmounts(claimants[0]);
      expect(lockedAmounts3[0].eqn(0)).is.true;
      expect(lockedAmounts3[1].eqn(0)).is.true;

      const lockedAmounts4 = await escrow.lockedAmounts(claimants[1]);
      expect(lockedAmounts4[0].eq(locked)).is.true;
      expect(lockedAmounts4[1].eqn(237 * 2)).is.true;
    });

    it("Should not enable transfering the ownership to a different address if not empty", async () => {
      // Lock some funds
      const locked = BN(8500)
      await escrow.lock({from: claimants[0], value: locked});
      await escrow.lock({from: claimants[1], value: locked});
      const now = (await time.latest()).addn(1);
      await escrow.setClaimingStartTs(now, {from: GOVERNANCE_ADDRESS});

      await time.increaseTo(now.addn(86400 * 31));
      // Act
      let openingBalance = BN(await web3.eth.getBalance(claimants[0]));
      let claimResult = await escrow.claim({ from: claimants[0] });
      await escrow.claim({ from: claimants[1] });
      // Assert

      let closingBalance = BN(await web3.eth.getBalance(claimants[0]));
      let txCost = BN(await calcGasCost(claimResult));
      assert.equal(txCost.add(closingBalance).sub(openingBalance).toNumber(), 237);

      const lockedAmounts = await escrow.lockedAmounts(claimants[0]);
      expect(lockedAmounts[0].eq(locked)).is.true;
      expect(lockedAmounts[1].eqn(237)).is.true;

      const lockedAmounts1 = await escrow.lockedAmounts(claimants[1]);
      expect(lockedAmounts1[0].eq(locked)).is.true;
      expect(lockedAmounts1[1].eqn(237)).is.true;

      // transfer ownership
      await escrow.proposeNewOwner(claimants[1], {from: claimants[0]});
      // Assert
      await expectRevert(escrow.claimNewOwner(claimants[0], {from: claimants[1]}), "Already locked");
    });
  });

  describe("Integrates with supply", async () => {
    const ADDRESS_UPDATER = accounts[16];
    const governanceAddress = accounts[10];
    const inflationAddress = accounts[9];
    // contains a fresh contract for each test 
    let supply: SupplyInstance;

    beforeEach(async() => {
        // clean up burnAddress
        await emptyAddressBalance(burnAddress, accounts[0]);
        assert.equal(Number(await balance.current(burnAddress)), 0);
        //
        supply = await Supply.new(governanceAddress, ADDRESS_UPDATER, initialGenesisAmountWei, totalFoundationSupplyWei, []);
        await supply.updateContractAddresses(
            encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION]),
            [ADDRESS_UPDATER, inflationAddress], {from: ADDRESS_UPDATER});
    });

    it("Sends correct information to supply", async() => {
      await supply.addTokenPool(escrow.address, 0, {from: governanceAddress});

      // Do some claiming
      const locked1 = BN(8500)
      const locked2 = BN(85000)
      const locked3 = BN(8500)

      await escrow.lock({from: claimants[0], value: locked1});

      // Force recalculation of supply
      await supply.updateCirculatingSupply({from: inflationAddress});
      // Supply should be decreased by locked1 amount
      const supplyAfterLock1 = await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber());
      assert.equal(supplyAfterLock1.toNumber(), initialCirculatingSupply - locked1.toNumber());
      // Inflatable supply should be decreased by locked1 amount
      const inflatableSupplyAfterLock1 = await supply.getInflatableBalance();
      assert.equal(inflatableSupplyAfterLock1.toNumber(), initialCirculatingSupply - locked1.toNumber());
      
      // Lock another guy
      await escrow.lock({from: claimants[1], value: locked2});
      // Check locked for both

      // Force recalculation of supply
      await supply.updateCirculatingSupply({from: inflationAddress});
      // Supply should be decreased by locked2 amount
      const supplyAfterLock2 = await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber());
      assert.equal(supplyAfterLock2.toNumber(), initialCirculatingSupply - locked2.toNumber() - locked1.toNumber());
      // Inflatable supply should be decreased by locked2 amount
      const inflatableSupplyAfterLock2 = await supply.getInflatableBalance();
      assert.equal(inflatableSupplyAfterLock2.toNumber(), initialCirculatingSupply - locked2.toNumber() - locked1.toNumber());

      // Move time forward
      const now = (await time.latest()).addn(1);
      await escrow.setClaimingStartTs(now, {from: GOVERNANCE_ADDRESS});
      await time.increaseTo(now.addn(86400 * 30));

      // Prime recalculation
      await supply.updateCirculatingSupply({from: inflationAddress});
      // Nothing should change until claim is made
      const supplyAfterLockBeforeClaim = await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber());
      assert.equal(supplyAfterLockBeforeClaim.toNumber(), supplyAfterLock2.toNumber());
      const inflatableSupplyBeforeClaim = await supply.getInflatableBalance();
      assert.equal(inflatableSupplyBeforeClaim.toNumber(), inflatableSupplyAfterLock2.toNumber());

      // Make claim for first one
      await escrow.claim({from: claimants[0]});

      // Prime recalculation
      await supply.updateCirculatingSupply({from: inflationAddress});
      // Supply should be increased by claimed amount (237)
      const supplyAfterClaim = await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber());
      assert.equal(supplyAfterClaim.toNumber(), supplyAfterLock2.toNumber() + 237);
      // Inflatable supply should be increased by claimed amount (237)
      const inflatableSupplyAfterClaim = await supply.getInflatableBalance();
      assert.equal(inflatableSupplyAfterClaim.toNumber(), inflatableSupplyAfterLock2.toNumber() + 237);
      // Locked and claimed amount should be ok
      const calcLocked = await supply.totalLockedWei();
      const calcClaimed = await supply.totalClaimedWei();
      assert.equal(calcLocked.toNumber(), locked2.toNumber() + locked1.toNumber());
      assert.equal(calcClaimed.toNumber(), 237);

      // Increase for another month
      await time.increaseTo(now.addn(86400 * 30 * 2));
      // Prime recalculation
      await supply.updateCirculatingSupply({from: inflationAddress});
      // Nothing should change until claim is made
      const supplyAfterLockLockBeforeClaim = await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber());
      assert.equal(supplyAfterLockLockBeforeClaim.toNumber(), supplyAfterLock2.toNumber() + 237);
      const inflatableSupplyBeforeSecondClaim = await supply.getInflatableBalance();
      assert.equal(inflatableSupplyBeforeSecondClaim.toNumber(), inflatableSupplyAfterLock2.toNumber() + 237);

      // Lock another one

      await escrow.lock({from: claimants[2], value: locked3});
      await supply.updateCirculatingSupply({from: inflationAddress});

      // Nothing should change
      const supplyAfterLock3 = await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber());
      assert.equal(supplyAfterLock3.toNumber(), supplyAfterLockLockBeforeClaim.toNumber() - locked3.toNumber());
      // Just a sanity check
      assert.equal(
        supplyAfterLock3.toNumber(), 
        initialCirculatingSupply + 237 - locked3.toNumber() - locked1.toNumber() - locked2.toNumber()
      ); 
      
      const inflatableSupplyAfterLock3 = await supply.getInflatableBalance();
      assert.equal(inflatableSupplyAfterLock3.toNumber(), supplyAfterLock3.toNumber());
      
      // Run until end of claiming period
      await time.increaseTo(now.add(BN(86400 * 30).muln(36)).addn(1));
      // Prime recalculation
      await supply.updateCirculatingSupply({from: inflationAddress});
      // Claim third in full
      await escrow.claim({from: claimants[2]});
      // Prime recalculation
      await supply.updateCirculatingSupply({from: inflationAddress});
      // Supply should be increased by claimed amount locked3
      const supplyAfterClaim3 = await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber());
      assert.equal(
        supplyAfterClaim3.toNumber(), 
        initialCirculatingSupply - locked2.toNumber() - locked1.toNumber() + 237
      );
      // Inflatable supply should be increased by claimed amount locked3
      const inflatableSupplyAfterClaim3 = await supply.getInflatableBalance();
      assert.equal(inflatableSupplyAfterClaim3.toNumber(), initialCirculatingSupply - locked2.toNumber() - locked1.toNumber() + 237);

    });
  });
});
