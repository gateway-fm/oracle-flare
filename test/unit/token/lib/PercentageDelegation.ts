import { PercentageDelegationMockInstance } from "../../../../typechain-truffle";
import { compareArrays, toBN } from "../../../utils/test-helpers";

// Unit tests for PercentageDelegation through PercentageDelegationMock contract
import { expectRevert, constants, time } from '@openzeppelin/test-helpers';
const getTestFile = require('../../../utils/constants').getTestFile;

const PercentageDelegation = artifacts.require("PercentageDelegationMock");

const MAX_TOTAL_PCT_MSG = 'Max delegation bips exceeded';

contract(`PercentageDelegation.sol; ${ getTestFile(__filename) }; PercentageDelegation unit tests`, async accounts => {
  // contains a fresh contract for each test
  let delegation: PercentageDelegationMockInstance;

  async function delegateExists(address: string) {
    let { 0: delegates } = await delegation.getDelegations();
    return delegates.includes(address);
  }

  async function delegateExistsAt(address: string, blockNumber: number) {
    let { 0: delegates } = await delegation.getDelegationsAt(blockNumber);
    return delegates.includes(address);
  }

  // Do clean unit tests by spinning up a fresh contract for each test
  beforeEach(async () => {
    delegation = await PercentageDelegation.new();
  });

  it("Should add a delegate by percentage", async () => {
    // Assemble
    // Act
    await delegation.addReplaceDelegate(accounts[1], 5000);
    // Assert
    const found = await delegateExists(accounts[1]);
    assert(found);
  });

  it("Should update a delegate by percentage", async () => {
    // Assemble
    await delegation.addReplaceDelegate(accounts[1], 5000);
    // Act
    await delegation.addReplaceDelegate(accounts[1], 10000);
    // Assert
    const value = await delegation.getDelegatedValue(accounts[1]);
    assert.equal(value.toNumber(), 10000);
  });

  it("Should add multiple delegates by percentage", async () => {
    // Assemble
    await delegation.addReplaceDelegate(accounts[1], 5000);
    // Act
    await delegation.addReplaceDelegate(accounts[2], 5000);
    // Assert
    const total = await delegation.getDelegatedTotal();
    assert.equal(total.toNumber(), 10000);
    const { 0: delegates } = await delegation.getDelegations();
    assert.equal(delegates.length, 2);
    const delegations = await delegation.getDelegationsRaw();
    assert(delegations.length === 2);
  });

  it("Should not find a wrong delegate", async () => {
    // Assemble
    // Act
    await delegation.addReplaceDelegate(accounts[1], 5000);
    // Assert
    const found = await delegateExists(accounts[2]);
    assert(!found);
  });

  it("Should remove delegate if zeroed", async () => {
    // Assemble
    await delegation.addReplaceDelegate(accounts[1], 5000);
    // Act
    await delegation.addReplaceDelegate(accounts[1], 0);
    // Assert
    const found = await delegateExists(accounts[1]);
    assert(!found);
  });

  it("Should add, update and remove multiple delegates in the same block", async () => {
    // Assemble
    const a = accounts[1], b = accounts[2], c = accounts[3];
    await delegation.addReplaceMultipleDelegates([a, b], [5000, 2000]);
    // Act
    //  delete b, add c, update a
    await delegation.addReplaceMultipleDelegates([b, c, a], [0, 500, 3000]);
    // Assert
    const { 0: delegates, 1: values } = await delegation.getDelegations();
    compareArrays(delegates, [a, c]);
    compareArrays(values.map(x => x.toNumber()), [3000, 500]);
    const delegations = await delegation.getDelegationsRaw();
    assert.deepEqual(delegations as any, [[a, '3000'], [c, '500']]);
});

  it("Should add, update and remove multiple delegates in the same block and do it again", async () => {
    // Assemble
    const a = accounts[1], b = accounts[2], c = accounts[3], d = accounts[4];
    await delegation.addReplaceMultipleDelegates([a, b], [5000, 2000]);
    // Act
    // delete b, add d, update a, delete d, add c
    await delegation.addReplaceMultipleDelegates([b, d, a, d, c], [0, 100, 3000, 0, 500]);
    // delete a, add d, delete c, add b
    await delegation.addReplaceMultipleDelegates([a, d, c, b], [0, 1500, 0, 800]);
    // Assert
    const { 0: delegates, 1: values } = await delegation.getDelegations();
    compareArrays(delegates, [d, b]);
    compareArrays(values.map(x => x.toNumber()), [1500, 800]);
    const delegations = await delegation.getDelegationsRaw();
    assert.deepEqual(delegations as any, [[d, '1500'], [b, '800']]);
  });

  it("Should see delegate from the past", async () => {
    // Assemble
    await delegation.addReplaceDelegate(accounts[1], 5000);
    const blk1 = await web3.eth.getBlockNumber();
    // Act
    await delegation.addReplaceDelegate(accounts[1], 0);
    // Assert
    const found = await delegateExistsAt(accounts[1], blk1);
    assert(found);
    const value = await delegation.getDelegatedValueAt(accounts[1], blk1);
    assert.equal(value.toNumber(), 5000);
  });

  it("Should see empty history before first block", async () => {
    // Assemble
    const blk0 = await web3.eth.getBlockNumber();
    // Act
    await time.advanceBlock();
    await delegation.addReplaceDelegate(accounts[1], 5000);
    // Assert
    const { 0: delegates, 1: values } = await delegation.getDelegationsAt(blk0);
    assert.equal(delegates.length, 0);
    assert.equal(values.length, 0);
    const total = await delegation.getDelegatedTotalAt(blk0);
    assert.equal(total.toNumber(), 0);
  });

  it("Should update delegate", async () => {
    // Assemble
    await delegation.addReplaceDelegate(accounts[1], 5000);
    const blk1 = await web3.eth.getBlockNumber();
    // Act
    await delegation.addReplaceDelegate(accounts[1], 3000);
    // Assert
    const found = await delegateExists(accounts[1]);
    assert(found);
    const foundBlk1 = await delegateExistsAt(accounts[1], blk1);
    assert(foundBlk1);
    const value = await delegation.getDelegatedValue(accounts[1]);
    assert.equal(value.toNumber(), 3000);
    const valueBlk1 = await delegation.getDelegatedValueAt(accounts[1], blk1);
    assert.equal(valueBlk1.toNumber(), 5000);
  });

  it("Should add delegate", async () => {
    // Assemble
    await delegation.addReplaceDelegate(accounts[1], 5000);
    const blk1 = await web3.eth.getBlockNumber();
    // Act
    await delegation.addReplaceDelegate(accounts[2], 3000);
    // Assert
    const { 0: delegates } = await delegation.getDelegations();
    assert.equal(delegates.length, 2);
    const delegations = await delegation.getDelegationsRaw();
    assert(delegations.length === 2);
    const { 0: delegatesBlk1 } = await delegation.getDelegationsAt(blk1);
    assert.equal(delegatesBlk1.length, 1);
    const value1 = await delegation.getDelegatedValue(accounts[1]);
    assert.equal(value1.toNumber(), 5000);
    const value2 = await delegation.getDelegatedValue(accounts[2]);
    assert.equal(value2.toNumber(), 3000);
  });

  it("Should get total from the past", async () => {
    // Assemble
    await delegation.addReplaceDelegate(accounts[1], 5000);
    await delegation.addReplaceDelegate(accounts[2], 3000);
    const blk1 = await web3.eth.getBlockNumber();
    // Act
    await delegation.addReplaceDelegate(accounts[2], 0);
    await delegation.addReplaceDelegate(accounts[3], 1000);
    // Assert
    const total = await delegation.getDelegatedTotal();
    assert.equal(total.toNumber(), 6000);
    const totalBlk1 = await delegation.getDelegatedTotalAt(blk1);
    assert.equal(totalBlk1.toNumber(), 8000);
  });

  it("Should clear delegates", async () => {
    // Assemble
    await delegation.addReplaceDelegate(accounts[1], 100);
    await delegation.addReplaceDelegate(accounts[2], 200);
    // Act
    await delegation.clear();
    // Assert
    const { 0: delegates } = await delegation.getDelegations();
    assert(delegates.length === 0);
    const delegations = await delegation.getDelegationsRaw();
    assert(delegations.length === 0);
    const total = await delegation.getDelegatedTotal();
    assert(total.toNumber() === 0);
  });
  
  it("Doesn't create anything for zero delegation", async () => {
    // Assemble
    // Act
    await delegation.addReplaceDelegate(accounts[1], 0);
    // Assert
    const { 0: delegates } = await delegation.getDelegations();
    assert(delegates.length === 0);
    const delegations = await delegation.getDelegationsRaw();
    assert(delegations.length === 0);
    const total = await delegation.getDelegatedTotal();
    assert(total.toNumber() === 0);
  });

  it("Doesn't clear anything for zero delegation", async () => {
    // Assemble
    // Act
    await delegation.clear();
    // Assert
    const { 0: delegates } = await delegation.getDelegations();
    assert(delegates.length === 0);
    const delegations = await delegation.getDelegationsRaw();
    assert(delegations.length === 0);
    const total = await delegation.getDelegatedTotal();
    assert(total.toNumber() === 0);
  });

  it("Should allow no more than n delegates by percent", async () => {
    let maxDelegateCount = await delegation.maxDelegateCount();
    if (accounts.length > maxDelegateCount.toNumber()) {
      // Assemble
      // Add maxDelegateCount delegates with 50 bips each
      for (let i = 1; i <= maxDelegateCount.toNumber(); i++) {
        await delegation.addReplaceDelegate(accounts[i], 50);
      }
      // Act
      let addPromise = delegation.addReplaceDelegate(accounts[maxDelegateCount.toNumber() + 1], 50);
      // Assert
      await expectRevert(addPromise, "Max delegates exceeded");
    } else {
      console.log("Not enough accounts; test skipped.");
    }
  });

  it("Should not allow single delegation by percent > 10000 bips", async () => {
    // Assemble
    // Act
    let addPromise = delegation.addReplaceDelegate(accounts[1], 10001);
    // Assert
    await expectRevert.assertion(addPromise);
  });

  it("Should not allow delegation pct total > 10000 bips", async () => {
    // Assemble
    await delegation.addReplaceDelegate(accounts[1], 2000);
    // Act
    let delegatePromise = delegation.addReplaceDelegate(accounts[2], 9000);
    // Assert
    await expectRevert(delegatePromise, MAX_TOTAL_PCT_MSG);
  });
  
  it("Should delete old checkpoints", async () => {
    // Assemble
    const b = [];
    for (let i = 0; i < 10; i++) {
      await delegation.addReplaceDelegate(accounts[1], i);
      b.push(await web3.eth.getBlockNumber());
    }
    // Act
    const cleanupBlock = b[5];
    for (let i = 0; i < 4; i++) {
      await delegation.cleanupOldCheckpoints(2, cleanupBlock);
    }
    // Assert
    for (let i = 0; i < 5; i++) {
      await expectRevert(delegation.getDelegatedValueAt(accounts[1], b[i]), "DelegationHistory: reading from cleaned-up block");
      await expectRevert(delegation.getDelegationsAt(b[i]), "DelegationHistory: reading from cleaned-up block");
      await expectRevert(delegation.getDelegatedTotalAt(b[i]), "DelegationHistory: reading from cleaned-up block");
    }
    for (let i = 5; i < 10; i++) {
      const value = await delegation.getDelegatedValueAt(accounts[1], b[i]);
      assert.equal(value.toNumber(), i);
    }
  });

  it("Delete old checkpoints shouldn't fail with empty history", async () => {
    // Assemble
    const cleanupBlock = await web3.eth.getBlockNumber();
    // Act
    await delegation.cleanupOldCheckpoints(2, cleanupBlock);
    // Assert
    const value = await delegation.getDelegatedValueAt(accounts[1], cleanupBlock);
    assert.equal(value.toNumber(), 0);
  });

  it("Should get delegate count", async () => {
    // Assemble
    // Act
    await delegation.addReplaceDelegate(accounts[1], 5000);
    const blk1 = await web3.eth.getBlockNumber();
    await delegation.addReplaceDelegate(accounts[2], 3000);
    // Assert
    const cnt1 = await delegation.getCount();
    assert.equal(cnt1.toNumber(), 2);
    const cnt2 = await delegation.getCountAt(blk1);
    assert.equal(cnt2.toNumber(), 1);
    const cnt3 = await delegation.getCountAt(0);
    assert.equal(cnt3.toNumber(), 0);
  });

});
