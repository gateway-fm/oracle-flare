import { ExplicitDelegationMockInstance } from "../../../../typechain-truffle";
import { toBN } from "../../../utils/test-helpers";

// Unit tests for ExplicitDelegation through ExplicitDelegationMock contract
import { expectRevert, constants } from '@openzeppelin/test-helpers';
const getTestFile = require('../../../utils/constants').getTestFile;

const ExplicitDelegation = artifacts.require("ExplicitDelegationMock");

const MAX_TOTAL_PCT_MSG = 'Max delegation bips exceeded';

contract(`ExplicitDelegation.sol; ${ getTestFile(__filename) }; ExplicitDelegation unit tests`, async accounts => {
  // contains a fresh contract for each test
  let delegation: ExplicitDelegationMockInstance;

  // Do clean unit tests by spinning up a fresh contract for each test
  beforeEach(async () => {
    delegation = await ExplicitDelegation.new();
  });

  it("Should add a delegate explicitly", async () => {
    // Assemble
    // Act
    await delegation.addReplaceDelegate(accounts[1], 5000);
    // Assert
    const value = await delegation.getDelegatedValue(accounts[1]);
    assert.equal(value.toNumber(), 5000);
  });

  it("Should update a delegate explicitly", async () => {
    // Assemble
    await delegation.addReplaceDelegate(accounts[1], 5000);
    // Act
    await delegation.addReplaceDelegate(accounts[1], 10000);
    // Assert
    const value = await delegation.getDelegatedValue(accounts[1]);
    assert.equal(value.toNumber(), 10000);
  });

  it("Should add multiple delegates explicitly", async () => {
    // Assemble
    await delegation.addReplaceDelegate(accounts[1], 5000);
    // Act
    await delegation.addReplaceDelegate(accounts[2], 3000);
    // Assert
    const total = await delegation.getDelegatedTotal();
    assert.equal(total.toNumber(), 8000);
  });

  it("Should not find a wrong delegate", async () => {
    // Assemble
    // Act
    await delegation.addReplaceDelegate(accounts[1], 5000);
    // Assert
    const value = await delegation.getDelegatedValue(accounts[2]);
    assert.equal(value.toNumber(), 0);
  });

  it("Should remove delegate if zeroed", async () => {
    // Assemble
    await delegation.addReplaceDelegate(accounts[1], 5000);
    // Act
    await delegation.addReplaceDelegate(accounts[1], 0);
    // Assert
    const value = await delegation.getDelegatedValue(accounts[1]);
    assert.equal(value.toNumber(), 0);
  });

  it("Should see delegate from the past", async () => {
    // Assemble
    await delegation.addReplaceDelegate(accounts[1], 5000);
    const blk1 = await web3.eth.getBlockNumber();
    // Act
    await delegation.addReplaceDelegate(accounts[1], 0);
    // Assert
    const value = await delegation.getDelegatedValueAt(accounts[1], blk1);
    assert.equal(value.toNumber(), 5000);
  });

  it("Should add delegate", async () => {
    // Assemble
    await delegation.addReplaceDelegate(accounts[1], 5000);
    const blk1 = await web3.eth.getBlockNumber();
    // Act
    await delegation.addReplaceDelegate(accounts[2], 3000);
    // Assert
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
    await delegation.addReplaceDelegate(accounts[3], 1000);
    await delegation.addReplaceDelegate(accounts[2], 0);
    // Assert
    const total = await delegation.getDelegatedTotal();
    assert.equal(total.toNumber(), 6000);
    const totalBlk1 = await delegation.getDelegatedTotalAt(blk1);
    assert.equal(totalBlk1.toNumber(), 8000);
  });
});
