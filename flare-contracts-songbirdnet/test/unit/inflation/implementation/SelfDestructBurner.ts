
import { constants, expectEvent, expectRevert } from '@openzeppelin/test-helpers';
const getTestFile = require('../../../utils/constants').getTestFile;

const SelfDestructBurner = artifacts.require("SelfDestructBurner");
const MockContract = artifacts.require("MockContract");

const active = web3.utils.sha3("active()")!.slice(0, 10); // first 4 bytes is function selector
const claim = web3.utils.sha3("claim(address,address,uint256,bool)")!.slice(0, 10); // first 4 bytes is function selector

contract(`SelfDestructBurner.sol; ${getTestFile(__filename)}; SelfDestructBurner unit tests`, async accounts => {

  it("Should require non-zero address for ftso reward manager", async() => {
    // Assemble
    // Act
    const promise = SelfDestructBurner.new(constants.ZERO_ADDRESS, constants.ZERO_ADDRESS);
    // Assert
    await expectRevert(promise, "address zero");
  });

  it("Should trigger ftso reward manager claim", async() => {
    // Assemble
    const ftsoRewardManager = await MockContract.new();
    await ftsoRewardManager.givenMethodReturnBool(active, true);
    const selfDestructBurner = await SelfDestructBurner.new(ftsoRewardManager.address, constants.ZERO_ADDRESS);
    // Act
    await selfDestructBurner.trigger();
    // Assert
    let invocationCountClaim = await ftsoRewardManager.invocationCountForMethod.call(claim);
    assert.equal(invocationCountClaim.toNumber(), 1);
  });

  it("Should trigger ftso reward manager and validator reward manager claims", async() => {
    // Assemble
    const ftsoRewardManager = await MockContract.new();
    await ftsoRewardManager.givenMethodReturnBool(active, true);
    const validatorRewardManager = await MockContract.new();
    await validatorRewardManager.givenMethodReturnBool(active, true);
    const selfDestructBurner = await SelfDestructBurner.new(ftsoRewardManager.address, validatorRewardManager.address);
    // Act
    await selfDestructBurner.trigger();
    // Assert
    let invocationCountClaim = await ftsoRewardManager.invocationCountForMethod.call(claim);
    assert.equal(invocationCountClaim.toNumber(), 1);

    invocationCountClaim = await validatorRewardManager.invocationCountForMethod.call(claim);
    assert.equal(invocationCountClaim.toNumber(), 1);
  });

  it("Should not trigger ftso reward manager and validator reward manager claims if not active", async() => {
    // Assemble
    const ftsoRewardManager = await MockContract.new();
    await ftsoRewardManager.givenMethodReturnBool(active, false);
    const validatorRewardManager = await MockContract.new();
    await validatorRewardManager.givenMethodReturnBool(active, false);
    const selfDestructBurner = await SelfDestructBurner.new(ftsoRewardManager.address, validatorRewardManager.address);
    // Act
    await selfDestructBurner.trigger();
    // Assert
    let invocationCountClaim = await ftsoRewardManager.invocationCountForMethod.call(claim);
    assert.equal(invocationCountClaim.toNumber(), 0);

    invocationCountClaim = await validatorRewardManager.invocationCountForMethod.call(claim);
    assert.equal(invocationCountClaim.toNumber(), 0);
  });

  it("Should not revert even if ftso reward manager and validator reward manager claims revert", async() => {
    // Assemble
    const ftsoRewardManager = await MockContract.new();
    await ftsoRewardManager.givenMethodReturnBool(active, true);
    await ftsoRewardManager.givenMethodRevertWithMessage(claim, "err");
    const validatorRewardManager = await MockContract.new();
    await validatorRewardManager.givenMethodReturnBool(active, true);
    await validatorRewardManager.givenMethodRunOutOfGas(claim);
    const selfDestructBurner = await SelfDestructBurner.new(ftsoRewardManager.address, validatorRewardManager.address);
    // Act
    const tx = await selfDestructBurner.trigger();
    // Assert
    let invocationCountClaim = await ftsoRewardManager.invocationCountForMethod.call(claim);
    assert.equal(invocationCountClaim.toNumber(), 0);

    invocationCountClaim = await validatorRewardManager.invocationCountForMethod.call(claim);
    assert.equal(invocationCountClaim.toNumber(), 0);

    expectEvent(tx, "ClaimFailed", { rewardManager: ftsoRewardManager.address});
    expectEvent(tx, "ClaimFailed", { rewardManager: validatorRewardManager.address});
  });
});
