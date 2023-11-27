// Unit tests for Delegatable behavior library, delegation activity

import { DelegatableMockContract, DelegatableMockInstance } from "../../../../../typechain-truffle";
import { toBN } from "../../../../utils/test-helpers";

import { expectRevert, time } from '@openzeppelin/test-helpers';
const {getTestFile} = require('../../../../utils/constants');

const truffleAssert = require('truffle-assertions');

const Delegatable = artifacts.require("DelegatableMock") as DelegatableMockContract;

contract(`Delegatable.sol; ${getTestFile(__filename)}; Delegation unit tests`, async accounts => {
  // contains a fresh contract for each test
  let delegatable: DelegatableMockInstance;

  // Do clean unit tests by spinning up a fresh contract for each test
  beforeEach(async () => {
    delegatable = await Delegatable.new();
  });

  it("Should add a voting power delegation by percentage", async () => {
    // Assemble
    await delegatable.mintVotePower(accounts[1], 100);
    // Act
    await delegatable.delegate(accounts[2], 1000, {from: accounts[1]});
    const { _delegateAddresses, _bips, } = await delegatable.delegatesOf(accounts[1]) as any;
    // Assert
    assert.equal(_delegateAddresses[0], accounts[2]);
    assert.equal(_bips[0], 1000);
  });

  it("Should emit delegate event when delegate by percentage successful", async() => {
    // Assemble
    await delegatable.mintVotePower(accounts[1], 100);
    // Act
    let tx = await delegatable.delegate(accounts[2], 5000, {from: accounts[1]});
    let blockNumber = await web3.eth.getBlockNumber();

    // Assert
    await truffleAssert.eventEmitted(tx, 'Delegate', (ev: any) => {
      return ev.from == accounts[1] 
        && ev.to == accounts[2] 
        && ev.priorVotePower == 0
        && ev.newVotePower == 50;
    });
  });

  it("Should emit delegate event when undelegate by percentage successful", async () => {
    // Assemble
    await delegatable.mintVotePower(accounts[1], 100);
    // Act
    await delegatable.delegate(accounts[2], 5000, { from: accounts[1] });
    let tx = await delegatable.delegate(accounts[2], 0, { from: accounts[1] });
    let blockNumber = await web3.eth.getBlockNumber();

    // Assert
    await truffleAssert.eventEmitted(tx, 'Delegate', (ev: any) => {
      return ev.from == accounts[1]
        && ev.to == accounts[2]
        && ev.priorVotePower == 50
        && ev.newVotePower == 0;
    });
  });

  it("Should add an explicit voting power delegation", async () => {
    // Assemble
    await delegatable.mintVotePower(accounts[1], 100);
    // Act
    await delegatable.delegateExplicit(accounts[2], 10, {from: accounts[1]});
    // old delgatesOf only works in percentage mode
    await expectRevert(delegatable.delegatesOf(accounts[1]), "delegatesOf does not work in AMOUNT delegation mode");
    // must use votePowerFromTo
    const bips = await delegatable.votePowerFromTo(accounts[1], accounts[2]);
    assert.equal<any>(bips, 10);
  });

  it("Should emit delegate event when explicit delegate successful", async() => {
    // Assemble
    await delegatable.mintVotePower(accounts[1], 100);
    // Act
    let tx = await delegatable.delegateExplicit(accounts[2], 50, {from: accounts[1]});
    let blockNumber = await web3.eth.getBlockNumber();

    // Assert
    await truffleAssert.eventEmitted(tx, 'Delegate', (ev: any) => {
      return ev.from == accounts[1]
        && ev.to == accounts[2]
        && ev.priorVotePower == 0
        && ev.newVotePower == 50;
    });
  });

  it("Should emit delegate event when explicit undelegate successful", async () => {
    // Assemble
    await delegatable.mintVotePower(accounts[1], 100);
    // Act
    await delegatable.delegateExplicit(accounts[2], 50, { from: accounts[1] });
    let tx = await delegatable.delegateExplicit(accounts[2], 0, { from: accounts[1] });
    let blockNumber = await web3.eth.getBlockNumber();

    // Assert
    await truffleAssert.eventEmitted(tx, 'Delegate', (ev: any) => {
      return ev.from == accounts[1]
        && ev.to == accounts[2]
        && ev.priorVotePower == 50
        && ev.newVotePower == 0;
    });
  });

  it("Should get delegation mode when delegated by percent", async() => {
    // Assemble
    await delegatable.delegate(accounts[2], 5000, {from: accounts[1]});
    // Act
    let delegationMode = await delegatable.delegationModeOf(accounts[1]);
    // Assert
    assert.equal(delegationMode as any, 1);
  });

  it("Should get delegation mode when explicitly delegated by amount", async() => {
    // Assemble
    await delegatable.mintVotePower(accounts[1], 100);
    await delegatable.delegateExplicit(accounts[2], 10, {from: accounts[1]});
    // Act
    let delegationMode = await delegatable.delegationModeOf(accounts[1]);
    // Assert
    assert.equal(delegationMode as any, 2);
  });
  
  it("Should not delegate to oneself (percent)", async () => {
    // Assemble
    await delegatable.mintVotePower(accounts[1], 100);
    // Act
    // Assert
    await expectRevert(delegatable.delegate(accounts[1], 1000, { from: accounts[1] }),
      "Cannot delegate to self");
  });

  it("Should not delegate to oneself (amount)", async () => {
    // Assemble
    await delegatable.mintVotePower(accounts[1], 100);
    // Act
    // Assert
    await expectRevert(delegatable.delegateExplicit(accounts[1], 10, { from: accounts[1] }),
      "Cannot delegate to self");
  });
  
  it("Should set cleanup block", async () => {
    // Assemble
    await time.advanceBlock();
    const blk = await web3.eth.getBlockNumber();
    await time.advanceBlock();
    // Act
    await delegatable.setCleanupBlockNumber(blk);
    // Assert
    const cleanblk = await delegatable.getCleanupBlockNumber();
    assert.equal(cleanblk.toNumber(), blk);
  });

  it("Should check cleanup block validity", async () => {
    // Assemble
    await time.advanceBlock();
    const blk = await web3.eth.getBlockNumber();
    await time.advanceBlock();
    // Act
    await delegatable.setCleanupBlockNumber(blk);
    // Assert
    await expectRevert(delegatable.setCleanupBlockNumber(blk - 1), "Cleanup block number must never decrease");
    const blk2 = await web3.eth.getBlockNumber();
    await expectRevert(delegatable.setCleanupBlockNumber(blk2 + 1), "Cleanup block must be in the past");
  });

  it("Should cleanup history (vote power)", async () => {
    // Assemble
    await delegatable.mintVotePower(accounts[1], 100);
    await time.advanceBlock();
    const blk1 = await web3.eth.getBlockNumber();
    await delegatable.mintVotePower(accounts[1], 50);
    const blk2 = await web3.eth.getBlockNumber();
    // Act
    await delegatable.setCleanupBlockNumber(toBN(blk2));
    await delegatable.mintVotePower(accounts[1], 30);
    // Assert
    // should fail at blk1
    await expectRevert(delegatable.votePowerOfAt(accounts[1], blk1), 
      "Delegatable: reading from cleaned-up block");
    // and work at blk2
    const value = await delegatable.votePowerOfAt(accounts[1], blk2);
    assert.equal(value.toNumber(), 150);
  });

  it("Should cleanup history (percentage)", async () => {
    // Assemble
    await delegatable.mintVotePower(accounts[1], 100);
    await delegatable.delegate(accounts[2], toBN(1000), { from: accounts[1] });
    await time.advanceBlock();
    const blk1 = await web3.eth.getBlockNumber();
    await delegatable.delegate(accounts[2], toBN(3000), { from: accounts[1] });
    const blk2 = await web3.eth.getBlockNumber();
    // Act
    await delegatable.setCleanupBlockNumber(toBN(blk2));
    await delegatable.delegate(accounts[2], toBN(5000), { from: accounts[1] });
    // Assert
    // should fail at blk1
    await expectRevert(delegatable.undelegatedVotePowerOfAt(accounts[1], blk1),
      "Delegatable: reading from cleaned-up block");
    // and work at blk2
    const undelegated = await delegatable.undelegatedVotePowerOfAt(accounts[1], blk2);
    assert.equal(undelegated.toNumber(), 70);
  });
  
  it("Should cleanup history (explicit)", async () => {
    // Assemble
    await delegatable.mintVotePower(accounts[1], 100);
    await delegatable.delegateExplicit(accounts[2], toBN(10), { from: accounts[1] });
    await time.advanceBlock();
    const blk1 = await web3.eth.getBlockNumber();
    await delegatable.delegateExplicit(accounts[2], toBN(30), { from: accounts[1] });
    const blk2 = await web3.eth.getBlockNumber();
    // Act
    await delegatable.setCleanupBlockNumber(toBN(blk2));
    await delegatable.delegateExplicit(accounts[2], toBN(50), { from: accounts[1] });
    // Assert
    // should fail at blk1
    await expectRevert(delegatable.undelegatedVotePowerOfAt(accounts[1], blk1),
      "Delegatable: reading from cleaned-up block");
    // and work at blk2
    const undelegated = await delegatable.undelegatedVotePowerOfAt(accounts[1], blk2);
    assert.equal(undelegated.toNumber(), 70);
  });

});
