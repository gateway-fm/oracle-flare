import { WNatContract, WNatInstance } from "../../../../typechain-truffle";
import { assertNumberEqual, toBN } from "../../../utils/test-helpers";
import { setDefaultVPContract } from "../../../utils/token-test-helpers";

const calcGasCost = require('../../../utils/eth').calcGasCost;
import { constants, expectEvent, expectRevert } from '@openzeppelin/test-helpers';
const getTestFile = require('../../../utils/constants').getTestFile;

const WNAT = artifacts.require("WNat") as WNatContract;
const TransferToWnat = artifacts.require("TransferToWnatMock");

const ALLOWANCE_EXCEEDED_MSG = "allowance below zero";

contract(`WNat; ${getTestFile(__filename)}`, async accounts => {
  // a fresh contract for each test
  let wNat: WNatInstance;

  // Do clean unit tests by spinning up a fresh contract for each test
  beforeEach(async () => {
    wNat = await WNAT.new(accounts[0], "Wrapped NAT", "WNAT");
    await setDefaultVPContract(wNat, accounts[0]);
  });

  it("Should accept NAT deposits.", async () => {
    // Assemble
    let natOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[1]));
    let wNatOpeningBalance = await wNat.balanceOf(accounts[1]);
    let startTotal = await wNat.totalSupply();
    // Act
    let depositResult = await wNat.deposit({value: toBN(20), from:accounts[1]});
    // Assert
    let natClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[1]));
    let wNatClosingBalance = await wNat.balanceOf(accounts[1]);
    // Compute the gas cost of the depositResult
    let txCost = await calcGasCost(depositResult);
    // Compute opening vs closing balance difference less gas cost
    let endTotal = await wNat.totalSupply();
    assert.equal(natOpeningBalance.sub(natClosingBalance).sub(txCost) as any, 20);
    assert.equal(wNatOpeningBalance.addn(20).toString(), wNatClosingBalance.toString());
    assert.equal(startTotal.addn(20).toString(), endTotal.toString());
  });

  it("Should issue WNAT when NAT deposited.", async () => {
    // Assemble
    // Act
    await wNat.deposit({value: toBN(20), from:accounts[1]});
    let balance = await wNat.balanceOf(accounts[1]);
    let totalBalance = await wNat.totalSupply();
    // Assert
    assert.equal(balance as any, 20);
    assert.equal(totalBalance as any, 20);
  });
  
  it("Should not deposit to zero", async () => {
    // Assemble
    // Act
    let callPromise = wNat.depositTo(constants.ZERO_ADDRESS, { value: toBN(2000) });
    // Assert
    await expectRevert(callPromise, "Cannot deposit to zero address");
  });

  it("Should make sure supply of WNAT is always same as locked NAT", async () => {
    // Assemble
    const recipientAccount = accounts[123];
    const senderAccount = accounts[124];
    let natOpeningBalanceRecipient = web3.utils.toBN(await web3.eth.getBalance(recipientAccount));
    let natOpeningBalanceSender = web3.utils.toBN(await web3.eth.getBalance(senderAccount));
    
    let wNatOpeningBalanceRecipient = await wNat.balanceOf(recipientAccount);
    let wNatOpeningBalanceSender = await wNat.balanceOf(senderAccount);
    let startTotal = await wNat.totalSupply();

    const depositAmount = natOpeningBalanceSender.divn(10);
    assert(depositAmount.gtn(0), "Sender should have nonzero balance for the test to produce meaningfull results");
    
    // Act
    let tx = await wNat.depositTo(recipientAccount, { value: depositAmount, from: senderAccount });
    
    let txCost = await calcGasCost(tx);

    let natBalanceAfterRecipient = web3.utils.toBN(await web3.eth.getBalance(recipientAccount));
    let natBalanceAfterSender = web3.utils.toBN(await web3.eth.getBalance(senderAccount));

    let wNatBalanceAfterRecipient = await wNat.balanceOf(recipientAccount);
    let wNatBalanceAfterSender = await wNat.balanceOf(senderAccount);

    let endTotal = await wNat.totalSupply();
    // Assert
    // NAT Balance:
    // sender: final == initial - txCost - depositedAmount
    assert.equal(natOpeningBalanceSender.toString(), natBalanceAfterSender.add(txCost).add(depositAmount).toString())
    // recipient: final == initial
    assert.equal(natOpeningBalanceRecipient.toString(), natBalanceAfterRecipient.toString())
    // WNAT:
    // sender: final == initial
    assert.equal(wNatBalanceAfterSender.toString(), wNatOpeningBalanceSender.toString());
    // recipient: final == initial + depositedAmount
    assert.equal(wNatBalanceAfterRecipient.toString(), wNatOpeningBalanceRecipient.add(depositAmount).toString());

    // Total
    assert.equal(startTotal.add(depositAmount).toString(), endTotal.toString());

  });

  it("Should burn WNAT when NAT withdrawn.", async () => {
    // Assemble
    await wNat.deposit({value: toBN(50), from:accounts[1]});
    let balanceBefore = web3.utils.toBN(await web3.eth.getBalance(accounts[1]));
    let startTotal = await wNat.totalSupply();
    // Act
    let tx = await wNat.withdraw(10, {from:accounts[1]});
    let balance = await wNat.balanceOf(accounts[1]);
    let totalBalance = await wNat.totalSupply();
    let endTotal = await wNat.totalSupply();
    // Assert
    assert.equal(balance as any, 40);
    assert.equal(totalBalance as any, 40);
    let balanceAfter = web3.utils.toBN(await web3.eth.getBalance(accounts[1]));
    assert.equal(balanceBefore.addn(10).sub(await calcGasCost(tx)).toString(), balanceAfter.toString());
    assert.equal(startTotal.subn(10).toString(), endTotal.toString());
  });
  
  it("Should redeem NAT withdrawn.", async () => {
    // Assemble
    await wNat.deposit({value: toBN(50), from:accounts[1]});
    let natOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[1]));
    let balance = await wNat.balanceOf(accounts[1]);
    // Act
    let withdrawResult = await wNat.withdraw(10, {from:accounts[1]});
    let natClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[1]));
    let txCost = await calcGasCost(withdrawResult);
    let balanceAfter = await wNat.balanceOf(accounts[1]);
    // Assert
    assert.equal(balance.subn(10).toString(), balanceAfter.toString());
    assert.equal(natOpeningBalance.sub(natClosingBalance).sub(txCost) as any, -10);
  });

  it("Should accept NAT deposits from another account.", async () => {
    // Assemble
    let a1NatOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[1]));
    let a2NatOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[2]));

    // Act
    let depositResult = await wNat.depositTo(accounts[2], {value: toBN(20), from:accounts[1]});

    // Assert
    let a1NatClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[1]));
    let a2NatClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[2]));
    let a2WnatBalance = await wNat.balanceOf(accounts[2]);
    // Compute the gas cost of the depositResult
    let txCost = await calcGasCost(depositResult);
    // Compute opening vs closing balance difference less gas cost for A1
    assert.equal(a1NatOpeningBalance.sub(a1NatClosingBalance).sub(txCost) as any, 20);
    // NAT in A2 should not change
    assert.equal(a2NatClosingBalance.sub(a2NatOpeningBalance) as any, 0);
    // WNAT for A2 should have been minted
    assert.equal(a2WnatBalance as any, 20);
  });

  it("Should burn WNAT when NAT withdrawn to another address with allowance.", async () => {
    // Assemble
    await wNat.deposit({value: toBN(50), from:accounts[1]});
    // Allow A2 to withdraw 30 from A1
    await wNat.increaseAllowance(accounts[2], 30, {from: accounts[1]})
    // Get the opening balances
    let a1NatOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[1]));
    let a2NatOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[2]));
    // Act
    // A1 spending by burning WNAT and moving NAT to A2
    let withdrawResult = await wNat.withdrawFrom(accounts[1], 30, {from: accounts[2]});
    // Assert
    // Compute the gas cost of the withdrawResult
    let txCost = await calcGasCost(withdrawResult);
    // Get the closing balances
    let a1NatClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[1]));
    let a2NatClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[2]));
    let a1Wnatbalance = await wNat.balanceOf(accounts[1]);
    assert.equal(a1Wnatbalance.toNumber(), 20);
    assert.equal(a2NatClosingBalance.sub(a2NatOpeningBalance).add(txCost).toNumber(), 30);
    assert.equal(a1NatOpeningBalance.sub(a1NatClosingBalance).toNumber(), 0);
  });

  it("Should revert when withdrawn to another address without allowance.", async () => {
    // Assemble
    await wNat.deposit({value: toBN(50), from:accounts[1]});
    await wNat.increaseAllowance(accounts[1], 20, {from: accounts[2]})
    // Act
    // A1 spending by burning WNAT and moving NAT to A2, but allowance too low
    let withdrawPromise = wNat.withdrawFrom(accounts[1], 30, {from: accounts[2]});
    // Assert
    await expectRevert(withdrawPromise, ALLOWANCE_EXCEEDED_MSG);
  });

  it("Should receive native tokens and update balance via direct native transfer (web3 send)", async () => {
    // Assemble
    // Act
    await web3.eth.sendTransaction({ to: wNat.address, value: toBN(8000), from: accounts[1] });
    // Assert
    const balance = await wNat.balanceOf(accounts[1]);
    assert.equal(balance.toNumber(), 8000);
  });

  it("Should not receive native tokens without calling deposit due to gas shortage - via transfer (2300 gas)", async () => {
    // Assemble
    const transferer = await TransferToWnat.new();
    await transferer.send(5e18);
    // Act
    let callPromise = transferer.transferToWnat(wNat.address, 8500);
    // Assert
    await expectRevert.unspecified(callPromise);
    const balance = await wNat.balanceOf(transferer.address);
    assert.equal(balance.toNumber(), 0);
  });

  it("Should not receive native tokens without calling deposit due to gas shortage - via transfer (2300 gas), event if deposited before", async () => {
    // Assemble
    const transferer = await TransferToWnat.new();
    await transferer.send(5e18);
    // Act
    await transferer.depositToWnat(wNat.address, 1500);
    let callPromise = transferer.transferToWnat(wNat.address, 8500);
    // Assert
    await expectRevert.unspecified(callPromise);
    const balance = await wNat.balanceOf(transferer.address);
    assert.equal(balance.toNumber(), 1500);
  });

  it("Should not receive native tokens without calling deposit - via unknown function call", async () => {
    // Assemble
    let funcCall = web3.eth.abi.encodeFunctionCall({ name: 'some_name', type: 'function', inputs: [] }, []);
    // Act
    let callPromise = web3.eth.call({ to: wNat.address, value: toBN(50), data: funcCall });
    // Assert
    await expectRevert(callPromise, "function selector was not recognized and there's no fallback function");
  });

  it("Should emit event on deposit.", async () => {
    // Assemble
    // Act
    let depositResult = await wNat.deposit({ value: toBN(20), from: accounts[1] });
    // Assert
    expectEvent(depositResult, "Deposit", { dst: accounts[1], amount: toBN(20) });
  });

  it("Should emit event on depositTo.", async () => {
    // Assemble
    // Act
    let depositResult = await wNat.depositTo(accounts[2], { value: toBN(20), from: accounts[1] });
    // Assert
    expectEvent(depositResult, "Deposit", { dst: accounts[2], amount: toBN(20) });
  });

  it("Should emit event on withdrawal.", async () => {
    // Assemble
    await wNat.deposit({ value: toBN(20), from: accounts[1] });
    // Act
    let withdrawResult = await wNat.withdraw(toBN(10), { from: accounts[1] });
    // Assert
    expectEvent(withdrawResult, "Withdrawal", { src: accounts[1], amount: toBN(10) });
  });

  it("Should emit event on withdrawalFrom.", async () => {
    // Assemble
    await wNat.deposit({ value: toBN(20), from: accounts[1] });
    await wNat.approve(accounts[2], toBN(10), { from: accounts[1] });
    // Act
    let withdrawResult = await wNat.withdrawFrom(accounts[1], toBN(10), { from: accounts[2] });
    // Assert
    expectEvent(withdrawResult, "Withdrawal", { src: accounts[1], amount: toBN(10) });
  });

  it("Should withdraw when requested amount more than undelegated and then redelegate remainder (delegate percentage).", async () => {
    // Assemble
    await wNat.deposit({ value: toBN(100), from: accounts[1] });
    await wNat.delegate(accounts[2], 4000, { from: accounts[1] });
    // Act
    let result = await wNat.withdraw(toBN(80), { from: accounts[1] });
    // Assert
    expectEvent(result, "Withdrawal", { src: accounts[1], amount: toBN(80) });
    assertNumberEqual(await wNat.votePowerOf(accounts[1]), 12);
    assertNumberEqual(await wNat.votePowerOf(accounts[2]), 8);
    assertNumberEqual(await wNat.votePowerFromTo(accounts[1], accounts[2]), 8);
  });

  it("Should not withdraw when amount requested more than undelegated (delegate explicit).", async () => {
    // Assemble
    await wNat.deposit({ value: toBN(100), from: accounts[1] });
    await wNat.delegateExplicit(accounts[2], 40, { from: accounts[1] });
    // Act
    let resultPromise = wNat.withdraw(toBN(80), { from: accounts[1] });
    // Assert
    await expectRevert(resultPromise, "Undelegated vote power too small");
  });

  it("Should redelegate when depositing (delegate percentage).", async () => {
    // Assemble
    await wNat.deposit({ value: toBN(100), from: accounts[1] });
    await wNat.delegate(accounts[2], 4000, { from: accounts[1] });
    // Act
    let result = await wNat.deposit({ from: accounts[1], value: toBN(50) });
    // Assert
    expectEvent(result, "Deposit", { dst: accounts[1], amount: toBN(50) });
    assertNumberEqual(await wNat.balanceOf(accounts[1]), 150);
    assertNumberEqual(await wNat.votePowerOf(accounts[1]), 90);
    assertNumberEqual(await wNat.votePowerOf(accounts[2]), 60);
    assertNumberEqual(await wNat.votePowerFromTo(accounts[1], accounts[2]), 60);
  });

  it("Should increase undelegated amount when depositing (delegate explicit).", async () => {
    // Assemble
    await wNat.deposit({ value: toBN(100), from: accounts[1] });
    await wNat.delegateExplicit(accounts[2], 40, { from: accounts[1] });
    // Act
    let result = await wNat.deposit({ from: accounts[1], value: toBN(50) });
    // Assert
    expectEvent(result, "Deposit", { dst: accounts[1], amount: toBN(50) });
    assertNumberEqual(await wNat.balanceOf(accounts[1]), 150);
    assertNumberEqual(await wNat.votePowerOf(accounts[1]), 110);
    assertNumberEqual(await wNat.votePowerOf(accounts[2]), 40);
    assertNumberEqual(await wNat.votePowerFromTo(accounts[1], accounts[2]), 40);
  });
});
