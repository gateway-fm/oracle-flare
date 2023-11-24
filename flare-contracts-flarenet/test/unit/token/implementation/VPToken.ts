import { VPTokenMockInstance } from "../../../../typechain-truffle";
import { assertNumberEqual, compareArrays, compareNumberArrays, toBN } from "../../../utils/test-helpers";
import { setDefaultVPContract } from "../../../utils/token-test-helpers";

// Unit tests for VPToken: checkpointable, delegatable, and ERC20 sanity tests
import {constants, expectRevert, time} from '@openzeppelin/test-helpers';
const getTestFile = require('../../../utils/constants').getTestFile;

const VPToken = artifacts.require("VPTokenMock");
const VPContract = artifacts.require("VPContract");
const MockContract = artifacts.require("MockContract");

const ALREADY_DELEGATED_EXPLICIT_MSG = "Already delegated explicitly";
const ALREADY_DELEGATED_PERCENT_MSG = "Already delegated by percentage";


contract(`VPToken.sol; ${getTestFile(__filename)}; Check point unit tests`, async accounts => {
  // contains a fresh contract for each test
  let vpToken: VPTokenMockInstance;

  // Do clean unit tests by spinning up a fresh contract for each test
  beforeEach(async () => {
    vpToken = await VPToken.new(accounts[0], "A token", "ATOK");
    await setDefaultVPContract(vpToken, accounts[0]);
  });

  it("Should return token name", async () => {
    assert.equal(await vpToken.name(), "A token");
    assert.equal(await vpToken.symbol(), "ATOK");
  });

  it("Token decimals default to 18", async () => {
    assertNumberEqual(await vpToken.decimals(), 18);
  });

  it("Should be checkpointable", async() => {
    const b = [];
    // Assemble
    b[0] = await web3.eth.getBlockNumber();
    await vpToken.mint(accounts[1], 50);
    b[1] = await web3.eth.getBlockNumber();
    await vpToken.mint(accounts[1], 10);
    b[2] = await web3.eth.getBlockNumber();
    await vpToken.mint(accounts[1], 5);
    // Act
    let balanceAtBlock0 = await vpToken.balanceOfAt(accounts[1], b[0]);
    let balanceAtBlock1 = await vpToken.balanceOfAt(accounts[1], b[1]);
    let balanceAtBlock2 = await vpToken.balanceOfAt(accounts[1], b[2]);
    let balanceAtNow = await vpToken.balanceOf(accounts[1]);
    // Assert
    assert.equal(balanceAtBlock0 as any, 0);
    assert.equal(balanceAtBlock1 as any, 50);
    assert.equal(balanceAtBlock2 as any, 60);
    assert.equal(balanceAtNow as any, 65);
  });

  it("Should be delegatable by percentage", async() => {
    // Assemble
    await vpToken.delegate(accounts[2], 50, {from: accounts[1]});
    await vpToken.delegate(accounts[3], 50, {from: accounts[1]});
    // Act
    const { _delegateAddresses, _bips, _count, _delegationMode} = await vpToken.delegatesOf(accounts[1]) as any;
    // Assert
    assert.equal(_delegateAddresses[0], accounts[2]);
    assert.equal(_bips[0], 50);
    assert.equal(_delegateAddresses[1], accounts[3]);
    assert.equal(_bips[1], 50);
    assert.equal(_count, 2);
    assert.equal(_delegationMode, 1);
  });

  it("Should not delegate to zero", async () => {
    await expectRevert(vpToken.delegate(constants.ZERO_ADDRESS, 50, { from: accounts[1] }),
      "Cannot delegate to zero");
  });

  it("Should un-delegate for delegate bips of 0", async () => {
    // Assemble
    await vpToken.delegate(accounts[2], 50, { from: accounts[1] });
    await vpToken.delegate(accounts[2], 0, { from: accounts[1] });
    // Act
    const { _delegateAddresses, _bips, _count, _delegationMode } = await vpToken.delegatesOf(accounts[1]) as any;
    // Assert
    assert.equal(_delegateAddresses.length, 0);
    assert.equal(_bips.length, 0);
    assert.equal(_count, 0);
    assert.equal(_delegationMode, 1);
  });

  it("Should un-delegate for delegate bips of 0 - not last", async () => {
    // Assemble
    await vpToken.delegate(accounts[2], 50, { from: accounts[1] });
    await vpToken.delegate(accounts[3], 60, { from: accounts[1] });
    await vpToken.delegate(accounts[2], 0, { from: accounts[1] });
    // Act
    const { _delegateAddresses, _bips, _count, _delegationMode } = await vpToken.delegatesOf(accounts[1]) as any;
    // Assert
    compareArrays(_delegateAddresses, [accounts[3]])
    compareNumberArrays(_bips, [60])
    assert.equal(_count, 1);
    assert.equal(_delegationMode, 1);
  });

  it("Should return value of delegation", async () => {
    // Assemble
    await vpToken.mint(accounts[1], 100);
    await vpToken.delegate(accounts[2], 500, { from: accounts[1] });
    const blk1 = await web3.eth.getBlockNumber();
    await vpToken.delegate(accounts[3], 300, { from: accounts[1] });
    // Act
    const value2_1 = await vpToken.votePowerFromToAt(accounts[1], accounts[2], blk1);
    const value2_n = await vpToken.votePowerFromTo(accounts[1], accounts[2]);
    const value3_1 = await vpToken.votePowerFromToAt(accounts[1], accounts[3], blk1);
    const value3_n = await vpToken.votePowerFromTo(accounts[1], accounts[3]);
    // Assert
    assert.equal(value2_1.toNumber(), 5);
    assert.equal(value2_n.toNumber(), 5);
    assert.equal(value3_1.toNumber(), 0);
    assert.equal(value3_n.toNumber(), 3);
  });

  it("Should return 0 for non-existent delegation", async () => {
    // Assemble
    await vpToken.delegate(accounts[2], 50, { from: accounts[1] });
    const blk1 = await web3.eth.getBlockNumber();
    await vpToken.delegate(accounts[3], 50, { from: accounts[1] });
    // Act
    const value = await vpToken.votePowerFromTo(accounts[1], accounts[5]);
    const value1 = await vpToken.votePowerFromToAt(accounts[1], accounts[5], blk1);
    // Assert
    assert.equal(value.toNumber(), 0);
    assert.equal(value1.toNumber(), 0);
  });

  it("Should be explicitly delegatable", async () => {
    // Assemble
    await vpToken.mint(accounts[1], 100);
    await vpToken.delegateExplicit(accounts[2], 75, { from: accounts[1] });
    await vpToken.delegateExplicit(accounts[3], 15, { from: accounts[1] });
    // Act
    const values = [
      await vpToken.votePowerFromTo(accounts[1], accounts[2]),
      await vpToken.votePowerFromTo(accounts[1], accounts[3]),
      await vpToken.votePowerFromTo(accounts[1], accounts[5]),  // non-existent - should return 0
    ];
    const mode = await vpToken.delegationModeOf(accounts[1]);
    // Assert
    assert.equal(values[0].toNumber(), 75);
    assert.equal(values[1].toNumber(), 15);
    assert.equal(values[2].toNumber(), 0);
    assert.equal(mode.toNumber(), 2);
  });

  it("Should not explicitly delegate to zero", async () => {
    await vpToken.mint(accounts[1], 100);
    await expectRevert(vpToken.delegateExplicit(constants.ZERO_ADDRESS, 50, { from: accounts[1] }),
      "Cannot delegate to zero");
  });

  it("Should un-delegate for explicit delegate value of 0", async () => {
    // Assemble
    await vpToken.mint(accounts[1], 100);
    await vpToken.delegateExplicit(accounts[2], 50, { from: accounts[1] });
    await vpToken.delegateExplicit(accounts[2], 0, { from: accounts[1] });
    // Act
    const undelegated = await vpToken.undelegatedVotePowerOf(accounts[1]);
    // Assert
    assert.equal(undelegated.toNumber(), 100);
  });

  it("Should undelegate all", async () => {
    // Assemble
    await vpToken.mint(accounts[1], 200);
    await vpToken.delegate(accounts[2], 50, { from: accounts[1] });
    await vpToken.delegate(accounts[3], 50, { from: accounts[1] });
    // Act
    await vpToken.undelegateAll({ from: accounts[1] });
    // Assert
    const { _delegateAddresses, _bips, _count, _delegationMode } = await vpToken.delegatesOf(accounts[1]) as any;
    assert.equal(_count, 0);
    assert.equal(_delegationMode, 1);  // PERCENTAGE (mode should never be reset)
  });

  it("Should undelegate all explicit", async () => {
    // Assemble
    await vpToken.mint(accounts[1], 200);
    await vpToken.delegateExplicit(accounts[2], 40, { from: accounts[1] });
    await vpToken.delegateExplicit(accounts[3], 50, { from: accounts[1] });
    await vpToken.delegateExplicit(accounts[4], 60, { from: accounts[1] });
    // Act
    await vpToken.undelegateAllExplicit([accounts[2], accounts[3], accounts[4]], { from: accounts[1] });
    // Assert
    const delegationMode = await vpToken.delegationModeOf(accounts[1]);
    const undelegated = await vpToken.undelegatedVotePowerOf(accounts[1]);
    assert.equal(delegationMode.toNumber(), 2); // AMOUNT (mode should never be reset)
    assert.equal(undelegated.toNumber(), 200);
  });

  it("Should partially undelegate all explicit", async () => {
    // Assemble
    await vpToken.mint(accounts[1], 200);
    await vpToken.delegateExplicit(accounts[2], 40, { from: accounts[1] });
    await vpToken.delegateExplicit(accounts[3], 50, { from: accounts[1] });
    await vpToken.delegateExplicit(accounts[4], 60, { from: accounts[1] });
    // Act
    await vpToken.undelegateAllExplicit([accounts[2], accounts[3]], { from: accounts[1] });
    // Assert
    const delegationMode = await vpToken.delegationModeOf(accounts[1]);
    const undelegated = await vpToken.undelegatedVotePowerOf(accounts[1]);
    assert.equal(delegationMode.toNumber(), 2); // AMOUNT
    assert.equal(undelegated.toNumber(), 140);
  });

  it("Should not be allowed to call delegatesOf for explicit delegation", async () => {
    // Assemble
    await vpToken.mint(accounts[1], 100);
    await vpToken.delegateExplicit(accounts[2], 75, { from: accounts[1] });
    // Act
    await expectRevert(vpToken.delegatesOf(accounts[1]), "delegatesOf does not work in AMOUNT delegation mode");
  });

  it("Should be allowed to call delegatesOf with no delegation", async () => {
    // Assemble
    await vpToken.mint(accounts[1], 100);
    // Act
    const { 0: delegates } = await vpToken.delegatesOf(accounts[1]);
    const mode = await vpToken.delegationModeOf(accounts[1]);
    // Assert
    assert.equal(delegates.length, 0);
    assert.equal(mode.toNumber(), 0);   // NOTSET
  });

  it("Should retrieve undelegated vote power", async() => {
    // Assemble
    await vpToken.mint(accounts[1], 50);
    // Act
    let undelegatedVotePower = await vpToken.undelegatedVotePowerOf(accounts[1]);
    // Assert
    assert.equal(undelegatedVotePower as any, 50);
  });

  it("Should transfer vote power from address 1 to address 2", async() => {
    // Assemble
    await vpToken.mint(accounts[1], 50);
    await vpToken.mint(accounts[2], 10);
    // Act
    await vpToken.transfer(accounts[2], 5, {from: accounts[1]});
    // Assert
    let account1VP = await vpToken.votePowerOf(accounts[1]);
    let account2VP = await vpToken.votePowerOf(accounts[2]);
    assert.equal(account1VP as any, 45);
    assert.equal(account2VP as any, 15);
  });

  it("Should transfer balance from address 1 to address 2", async() => {
    // Assemble
    await vpToken.mint(accounts[1], 50);
    await vpToken.mint(accounts[2], 10);
    // Act
    await vpToken.transfer(accounts[2], 5, {from: accounts[1]});
    // Assert
    let account1balance = await vpToken.balanceOfAt(accounts[1], await web3.eth.getBlockNumber());
    let account2balance = await vpToken.balanceOfAt(accounts[2], await web3.eth.getBlockNumber());
    assert.equal(account1balance as any, 45);
    assert.equal(account2balance as any, 15);
  });

  it("Should burn vote power", async() => {
    // Assemble
    await vpToken.mint(accounts[1], 50);
    // Act
    await vpToken.burn(5, {from: accounts[1]});
    // Assert
    let account1VP = await vpToken.votePowerOf(accounts[1]);
    assert.equal(account1VP as any, 45);
  });

  it("Should burn balance", async() => {
    // Assemble
    await vpToken.mint(accounts[1], 50);
    // Act
    await vpToken.burn(5, {from: accounts[1]});
    // Assert
    let account1balance = await vpToken.balanceOfAt(accounts[1], await web3.eth.getBlockNumber());
    assert.equal(account1balance as any, 45);
  });

  it("Should revert delegating by percent when already delegated explicit", async() => {
    // Assemble
    await vpToken.mint(accounts[1], 100);
    await vpToken.delegateExplicit(accounts[2], 50, {from: accounts[1]});
    // Act
    let delegatePromise = vpToken.delegate(accounts[2], 1000, {from: accounts[1]});
    // Assert
    await expectRevert(delegatePromise, ALREADY_DELEGATED_EXPLICIT_MSG);
  });

  it("Should revert delegating explicit when already delegated by percent", async() => {
    // Assemble
    await vpToken.mint(accounts[1], 100);
    await vpToken.delegate(accounts[2], 1000, {from: accounts[1]});
    // Act
    let delegatePromise = vpToken.delegateExplicit(accounts[2], 50, {from: accounts[1]});
    // Assert
    await expectRevert(delegatePromise, ALREADY_DELEGATED_PERCENT_MSG);
  });

  it("Should revert undelegating explicit when delegated by percent", async () => {
    // Assemble
    await vpToken.mint(accounts[1], 100);
    await vpToken.delegate(accounts[2], 1000, { from: accounts[1] });
    // Act
    let delegatePromise = vpToken.undelegateAllExplicit([accounts[2]], { from: accounts[1] });
    // Assert
    await expectRevert(delegatePromise, ALREADY_DELEGATED_PERCENT_MSG);
  });

  it("Should revert undelegating by percent when delegated explicit", async () => {
    // Assemble
    await vpToken.mint(accounts[1], 100);
    await vpToken.delegateExplicit(accounts[2], 50, { from: accounts[1] });
    // Act
    let delegatePromise = vpToken.undelegateAll({ from: accounts[1] });
    // Assert
    await expectRevert(delegatePromise, ALREADY_DELEGATED_EXPLICIT_MSG);
  });

  it("Should sum minted vote power", async() => {
    // Assemble
    // Act
    await vpToken.mint(accounts[1], 10);
    await vpToken.mint(accounts[2], 20);
    // Assert
    assert.equal(await vpToken.totalVotePower() as any, 30);
  });  

  it("Should net total vote power", async() => {
    // Assemble
    await vpToken.mint(accounts[1], 10);
    await vpToken.mint(accounts[2], 20);
    // Act
    await vpToken.burn(5, {from: accounts[1]});
    // Assert
    assert.equal(await vpToken.totalVotePower() as any, 25);
  });

  it("Should record historic vote power", async() => {
    // Assemble
    const b = [];
    let blockAfterFirstMinting = 0;

    await vpToken.mint(accounts[1], 10);
    await vpToken.mint(accounts[2], 20);
    b[blockAfterFirstMinting] = await web3.eth.getBlockNumber();

    // Act
    await vpToken.mint(accounts[2], 50);

    // Assert
    assert.equal(await vpToken.totalVotePowerAt(b[blockAfterFirstMinting]) as any, 30);
  });

  it("Should leave total vote power alone when delegating", async() => {
    // Assemble
    await vpToken.mint(accounts[1], 20);
    // Act
    await vpToken.delegate(accounts[2], 5, {from: accounts[1]});
    // Assert
    assert.equal(await vpToken.totalVotePower() as any, 20);
  });  

  it("Should correctly calculate undelegated vote power", async () => {
    // Assemble
    await vpToken.mint(accounts[1], 200);
    await vpToken.mint(accounts[2], 50);
    await vpToken.mint(accounts[3], 20);
    // Act
    await vpToken.delegate(accounts[2], 3000, { from: accounts[1] });
    await vpToken.delegate(accounts[3], 4000, { from: accounts[2] });
    // vote powers
    //      B     VP     UVP
    // 1   200    140    140
    // 2   50     90     30
    // 1   20     40     20
    // Assert
    assert.equal((await vpToken.votePowerOf(accounts[1])).toNumber(), 140);
    assert.equal((await vpToken.votePowerOf(accounts[2])).toNumber(), 90);
    assert.equal((await vpToken.votePowerOf(accounts[3])).toNumber(), 40);
    assert.equal((await vpToken.undelegatedVotePowerOf(accounts[1])).toNumber(), 140);
    assert.equal((await vpToken.undelegatedVotePowerOf(accounts[2])).toNumber(), 30);
    assert.equal((await vpToken.undelegatedVotePowerOf(accounts[3])).toNumber(), 20);
  });

  it("Should correctly handle historic undelegated vote power", async () => {
    // Assemble
    await vpToken.mint(accounts[1], 20);
    const blockBeforeDelegate1 = await web3.eth.getBlockNumber();
    // Act
    await vpToken.delegate(accounts[2], 3000, { from: accounts[1] });
    const blockAfterDelegate1 = await web3.eth.getBlockNumber();
    // mint and delegate some more
    await vpToken.mint(accounts[1], 30);
    await vpToken.delegate(accounts[2], 9000, { from: accounts[1] });
    // Assert
    assert.equal((await vpToken.undelegatedVotePowerOfAt(accounts[1], 0)).toNumber(), 0);
    assert.equal((await vpToken.undelegatedVotePowerOfAt(accounts[1], blockBeforeDelegate1)).toNumber(), 20);
    assert.equal((await vpToken.undelegatedVotePowerOfAt(accounts[1], blockAfterDelegate1)).toNumber(), 14);
    assert.equal((await vpToken.undelegatedVotePowerOf(accounts[1])).toNumber(), 5);
  });

  it("Should correctly calculate undelegated vote power (explicit delegation)", async () => {
    // Assemble
    await vpToken.mint(accounts[1], 200);
    await vpToken.mint(accounts[2], 50);
    await vpToken.mint(accounts[3], 20);
    // Act
    await vpToken.delegateExplicit(accounts[2], 60, { from: accounts[1] });
    await vpToken.delegateExplicit(accounts[3], 20, { from: accounts[2] });
    // vote powers
    //      B     VP     UVP
    // 1   200    140    140
    // 2   50     90     30
    // 1   20     40     20
    // Assert
    assert.equal((await vpToken.votePowerOf(accounts[1])).toNumber(), 140);
    assert.equal((await vpToken.votePowerOf(accounts[2])).toNumber(), 90);
    assert.equal((await vpToken.votePowerOf(accounts[3])).toNumber(), 40);
    assert.equal((await vpToken.undelegatedVotePowerOf(accounts[1])).toNumber(), 140);
    assert.equal((await vpToken.undelegatedVotePowerOf(accounts[2])).toNumber(), 30);
    assert.equal((await vpToken.undelegatedVotePowerOf(accounts[3])).toNumber(), 20);
  });

  it("Should correctly handle historic undelegated vote power (explicit delegation)", async () => {
    // Assemble
    await vpToken.mint(accounts[1], 20);
    const blockBeforeDelegate1 = await web3.eth.getBlockNumber();
    // Act
    await vpToken.delegateExplicit(accounts[2], 6, { from: accounts[1] });
    const blockAfterDelegate1 = await web3.eth.getBlockNumber();
    // mint and delegate some more
    await vpToken.mint(accounts[1], 30);
    await vpToken.delegateExplicit(accounts[2], 45, { from: accounts[1] });
    // Assert
    assert.equal((await vpToken.undelegatedVotePowerOfAt(accounts[1], 0)).toNumber(), 0);
    assert.equal((await vpToken.undelegatedVotePowerOfAt(accounts[1], blockBeforeDelegate1)).toNumber(), 20);
    assert.equal((await vpToken.undelegatedVotePowerOfAt(accounts[1], blockAfterDelegate1)).toNumber(), 14);
    assert.equal((await vpToken.undelegatedVotePowerOf(accounts[1])).toNumber(), 5);
  });

  it("Should revoke vote power", async () => {
    // Assemble
    await vpToken.mint(accounts[1], 200);
    // Act
    await vpToken.delegate(accounts[2], 3000, { from: accounts[1] });
    const blockAfterDelegate1 = await web3.eth.getBlockNumber();
    await vpToken.mint(accounts[1], 100);
    await vpToken.delegate(accounts[2], 4000, { from: accounts[1] });
    // revoke
    await vpToken.revokeDelegationAt(accounts[2], blockAfterDelegate1, { from: accounts[1] });
    // Assert
    assert.equal((await vpToken.votePowerFromToAt(accounts[1], accounts[2], blockAfterDelegate1)).toNumber(), 0);
    assert.equal((await vpToken.undelegatedVotePowerOfAt(accounts[1], blockAfterDelegate1)).toNumber(), 140);
    assert.equal((await vpToken.votePowerOfAt(accounts[1], blockAfterDelegate1)).toNumber(), 140);
    assert.equal((await vpToken.votePowerOfAt(accounts[2], blockAfterDelegate1)).toNumber(), 0);
    
    assert.equal((await vpToken.votePowerFromTo(accounts[1], accounts[2])).toNumber(), 120);
    assert.equal((await vpToken.undelegatedVotePowerOf(accounts[1])).toNumber(), 180);
    assert.equal((await vpToken.votePowerOf(accounts[1])).toNumber(), 180);
    assert.equal((await vpToken.votePowerOf(accounts[2])).toNumber(), 120);
  });

  it("Should revoke vote power (explicit)", async () => {
    // Assemble
    await vpToken.mint(accounts[1], 200);
    // Act
    await vpToken.delegateExplicit(accounts[2], 60, { from: accounts[1] });
    const blockAfterDelegate1 = await web3.eth.getBlockNumber();
    await vpToken.mint(accounts[1], 100);
    await vpToken.delegateExplicit(accounts[2], 120, { from: accounts[1] });
    // revoke
    await vpToken.revokeDelegationAt(accounts[2], blockAfterDelegate1, { from: accounts[1] });
    // Assert
    assert.equal((await vpToken.votePowerOfAt(accounts[1], blockAfterDelegate1)).toNumber(), 140);
    assert.equal((await vpToken.votePowerOfAt(accounts[2], blockAfterDelegate1)).toNumber(), 0);
    assert.equal((await vpToken.votePowerFromToAt(accounts[1], accounts[2], blockAfterDelegate1)).toNumber(), 0);
    assert.equal((await vpToken.undelegatedVotePowerOfAt(accounts[1], blockAfterDelegate1)).toNumber(), 140);
    //
    assert.equal((await vpToken.votePowerFromTo(accounts[1], accounts[2])).toNumber(), 120);
    assert.equal((await vpToken.undelegatedVotePowerOf(accounts[1])).toNumber(), 180);
    assert.equal((await vpToken.votePowerOf(accounts[1])).toNumber(), 180);
    assert.equal((await vpToken.votePowerOf(accounts[2])).toNumber(), 120);
  });

  it("Should not revoke vote power twice", async () => {
    // Assemble
    await vpToken.mint(accounts[1], 200);
    // Act
    await vpToken.delegate(accounts[2], 3000, { from: accounts[1] });
    const blockAfterDelegate1 = await web3.eth.getBlockNumber();
    await vpToken.mint(accounts[1], 100);
    await vpToken.delegate(accounts[2], 4000, { from: accounts[1] });
    // revoke
    await vpToken.revokeDelegationAt(accounts[2], blockAfterDelegate1, { from: accounts[1] });
    // Assert
    await expectRevert(vpToken.revokeDelegationAt(accounts[2], blockAfterDelegate1, { from: accounts[1] }),
      "Already revoked");
  });

  it("Do nothing if revoking non-existent delegation", async () => {
    // Assemble
    await vpToken.mint(accounts[1], 200);
    // Act
    await vpToken.delegate(accounts[2], 3000, { from: accounts[1] });
    const blockAfterDelegate1 = await web3.eth.getBlockNumber();
    await vpToken.mint(accounts[1], 100);
    await vpToken.delegate(accounts[2], 4000, { from: accounts[1] });
    // revoke
    await vpToken.revokeDelegationAt(accounts[5], blockAfterDelegate1, { from: accounts[1] });
    // Assert
    const { 0: delegates } = await vpToken.delegatesOfAt(accounts[1], blockAfterDelegate1);
    compareArrays(delegates, [accounts[2]]);
  });

  it("Any undelegate should work with empty delegation", async () => {
    // Assemble
    await vpToken.mint(accounts[1], 200);
    // Act
    await vpToken.undelegateAll({ from: accounts[1] });
    await vpToken.undelegateAllExplicit([], { from: accounts[1] });
    // Assert
    const mode = await vpToken.delegationModeOf(accounts[1]);
    assert.equal(mode.toNumber(), 0); // NOT_SET
  });

  it("Vote power delegation can be read with empty delegation (returns 0)", async () => {
    // Assemble
    await vpToken.mint(accounts[1], 200);
    const blk1 = await web3.eth.getBlockNumber();
    await time.advanceBlock();
    // Act
    const value = await vpToken.votePowerFromTo(accounts[1], accounts[2]);
    const value1 = await vpToken.votePowerFromToAt(accounts[1], accounts[2], blk1);
    // Assert
    assert.equal(value.toNumber(), 0);
    assert.equal(value1.toNumber(), 0);
  });

  it("Any undelegate should work with empty delegation", async () => {
    // Assemble
    await vpToken.mint(accounts[1], 200);
    // Act
    await vpToken.undelegateAll({ from: accounts[1] });
    await vpToken.undelegateAllExplicit([], { from: accounts[1] });
    // Assert
    const mode = await vpToken.delegationModeOf(accounts[1]);
    assert.equal(mode.toNumber(), 0); // NOT_SET
  });

  it("Should not revoke vote power in present / future", async () => {
    // Assemble
    await vpToken.mint(accounts[1], 200);
    // Act
    await vpToken.delegate(accounts[2], 3000, { from: accounts[1] });
    const blockAfterDelegate1 = await web3.eth.getBlockNumber();
    await time.advanceBlock();
    // Assert
    await expectRevert(vpToken.revokeDelegationAtNow(accounts[2], { from: accounts[1] }),
      "Revoke is only for the past, use undelegate for the present");
    await expectRevert(vpToken.revokeDelegationAt(accounts[2], blockAfterDelegate1 + 10, { from: accounts[1] }),
      "Revoke is only for the past, use undelegate for the present");
  });

  it("Should cache vote power and return same as uncached", async () => {
    // Assemble
    await vpToken.mint(accounts[1], 200);
    const block1 = await web3.eth.getBlockNumber();
    // Act
    await time.advanceBlock();
    // Assert
    // read original value
    const origVP = await vpToken.votePowerOfAt(accounts[1], block1);
    assert.equal(origVP.toNumber(), 200);
    // first time read cached value (read from original, store to cache)
    const cachedVP = await vpToken.votePowerOfAtCached.call(accounts[1], block1);
    assert.equal(cachedVP.toNumber(), 200);
    // must run without .call to actually store the cached value
    await vpToken.votePowerOfAtCached(accounts[1], block1);
    // second time read cached value (read from cache - should return the same)
    const cachedVP2 = await vpToken.votePowerOfAtCached.call(accounts[1], block1);
    assert.equal(cachedVP2.toNumber(), 200);
  });

  it("Should not call cached vote power in present / future", async () => {
    // Assemble
    await vpToken.mint(accounts[1], 200);
    const block1 = await web3.eth.getBlockNumber();
    // Act
    await time.advanceBlock();
    // Assert
    await expectRevert(vpToken.votePowerOfAtNowCached.call(accounts[1]),
      "Can only be used for past blocks");
    await expectRevert(vpToken.votePowerOfAtCached.call(accounts[1], block1 + 10),
      "Can only be used for past blocks");
  });

  it("Should cache total vote power and return same as uncached", async () => {
    // Assemble
    await vpToken.mint(accounts[1], 200);
    await vpToken.mint(accounts[2], 40);
    const block1 = await web3.eth.getBlockNumber();
    // Act
    await time.advanceBlock();
    // Assert
    const value = 240;
    // read original value
    const origVP = await vpToken.totalVotePowerAt(block1);
    assert.equal(origVP.toNumber(), value);
    // first time read cached value (read from original, store to cache)
    const cachedVP = await vpToken.totalVotePowerAtCached.call(block1);
    assert.equal(cachedVP.toNumber(), value);
    // must run without .call to actually store the cached value
    await vpToken.totalVotePowerAtCached(block1);
    // second time read cached value (read from cache - should return the same)
    const cachedVP2 = await vpToken.totalVotePowerAtCached.call(block1);
    assert.equal(cachedVP2.toNumber(), value);
  });

  it("Should not call cached total vote power in present / future", async () => {
    // Assemble
    await vpToken.mint(accounts[1], 200);
    const block1 = await web3.eth.getBlockNumber();
    // Act
    await time.advanceBlock();
    // Assert
    await expectRevert(vpToken.votePowerAtNowCached.call(),
      "Can only be used for past blocks");
    await expectRevert(vpToken.totalVotePowerAtCached.call(block1 + 10),
      "Can only be used for past blocks");
  });

  it("Should not transfer tokens to oneself (amount)", async () => {
    // Assemble
    await vpToken.mint(accounts[1], 100);
    // Act
    // Assert
    await expectRevert(vpToken.transfer(accounts[1], 10, { from: accounts[1] }),
      "Cannot transfer to self");
  });

  it("Should not delegate to oneself (percent)", async () => {
    // Assemble
    await vpToken.mint(accounts[1], 100);
    // Act
    // Assert
    await expectRevert(vpToken.delegate(accounts[1], 1000, { from: accounts[1] }),
      "Cannot delegate to self");
  });

  it("Should not delegate to oneself (amount)", async () => {
    // Assemble
    await vpToken.mint(accounts[1], 100);
    // Act
    // Assert
    await expectRevert(vpToken.delegateExplicit(accounts[1], 10, { from: accounts[1] }),
      "Cannot delegate to self");
  });

  it("Should check cleanup block validity", async () => {
    // Assemble
    await vpToken.setCleanupBlockNumberManager(accounts[8]);
    await time.advanceBlock();
    const blk = await web3.eth.getBlockNumber();
    await time.advanceBlock();
    // Act
    await vpToken.setCleanupBlockNumber(blk, { from: accounts[8] });
    // Assert
    await expectRevert(vpToken.setCleanupBlockNumber(blk - 1, { from: accounts[8] }), "Cleanup block number must never decrease");
    const blk2 = await web3.eth.getBlockNumber();
    await expectRevert(vpToken.setCleanupBlockNumber(blk2 + 1, { from: accounts[8] }), "Cleanup block must be in the past");
  });

  it("Should cleanup history", async () => {
    // Assemble
    await vpToken.setCleanupBlockNumberManager(accounts[8]);
    await vpToken.mint(accounts[1], 100);
    await time.advanceBlock();
    const blk1 = await web3.eth.getBlockNumber();
    await vpToken.transfer(accounts[2], toBN(10), { from: accounts[1] });
    const blk2 = await web3.eth.getBlockNumber();
    // Act
    await vpToken.setCleanupBlockNumber(toBN(blk2), { from: accounts[8] });
    await vpToken.transfer(accounts[2], toBN(10), { from: accounts[1] });
    const blk3 = await web3.eth.getBlockNumber();
    // Assert
    // should fail at blk1
    await expectRevert(vpToken.balanceOfAt(accounts[1], blk1),
      "CheckPointable: reading from cleaned-up block");
    // and work at blk2
    const value = await vpToken.balanceOfAt(accounts[1], blk2);
    assert.equal(value.toNumber(), 90);
    const value2 = await vpToken.balanceOfAt(accounts[1], blk3);
    assert.equal(value2.toNumber(), 80);
  });

  it("Should cleanup history (delegation)", async () => {
    // Assemble
    await vpToken.setCleanupBlockNumberManager(accounts[8]);
    await vpToken.mint(accounts[1], 100);
    await vpToken.delegate(accounts[2], toBN(1000), { from: accounts[1] });
    await time.advanceBlock();
    const blk1 = await web3.eth.getBlockNumber();
    await vpToken.delegate(accounts[2], toBN(3000), { from: accounts[1] });
    const blk2 = await web3.eth.getBlockNumber();
    // Act
    await vpToken.setCleanupBlockNumber(toBN(blk2), { from: accounts[8] });
    await vpToken.delegate(accounts[2], toBN(5000), { from: accounts[1] });
    // Assert
    // should fail at blk1
    await expectRevert(vpToken.undelegatedVotePowerOfAt(accounts[1], blk1),
      "CheckPointable: reading from cleaned-up block");
    // and work at blk2
    const undelegated = await vpToken.undelegatedVotePowerOfAt(accounts[1], blk2);
    assert.equal(undelegated.toNumber(), 70);
  });

  it("May set cleaner and cleanup block without VPContract", async () => {
    // Assemble
    await vpToken.setCleanupBlockNumberManager(accounts[8]);
    await vpToken.mint(accounts[1], 100);
    await vpToken.delegate(accounts[2], 1000, { from: accounts[1] });
    await time.advanceBlock();
    const blk1 = await web3.eth.getBlockNumber();
    await vpToken.delegate(accounts[2], 3000, { from: accounts[1] });
    const blk2 = await web3.eth.getBlockNumber();
    await vpToken.delegate(accounts[3], 2000, { from: accounts[1] });
    const blk3 = await web3.eth.getBlockNumber();
    // Act
    await vpToken.setWriteVpContract(constants.ZERO_ADDRESS);
    await vpToken.setReadVpContract(constants.ZERO_ADDRESS);
    await vpToken.setCleanerContract(accounts[5]);
    await vpToken.setCleanupBlockNumber(blk2, { from: accounts[8] });
    const vpcontract = await VPContract.new(vpToken.address, true);
    await vpToken.setWriteVpContract(vpcontract.address);
    await vpToken.delegate(accounts[2], 4000, { from: accounts[1] }); // trigger some cleanup
    await vpToken.setCleanerContract(accounts[5]);
    await vpToken.setCleanupBlockNumber(blk3, { from: accounts[8] });
    await vpToken.delegate(accounts[2], 5000, { from: accounts[1] }); // trigger some cleanup
    await vpToken.setReadVpContract(vpcontract.address);
    // Assert
    // should fail at blk1
    await expectRevert(vpToken.undelegatedVotePowerOfAt(accounts[1], blk2),
      "CheckPointable: reading from cleaned-up block");
    // and work at blk2
    const undelegated = await vpToken.undelegatedVotePowerOfAt(accounts[1], blk3);
    assert.equal(undelegated.toNumber(), 100);
  });

  it("Can add governance vote power contract", async () => {
    // Assemble
    const governanceVotePower = await MockContract.new();
    const ownerTokenCall = web3.eth.abi.encodeFunctionCall({ type: 'function', name: 'ownerToken', inputs: [] }, []);
    await governanceVotePower.givenMethodReturnAddress(ownerTokenCall, vpToken.address);
    // Act
    await vpToken.setGovernanceVotePower(governanceVotePower.address);
    // Assert
    assert.equal(await vpToken.governanceVotePower(), governanceVotePower.address);
  });

  it("Cannot set governance vote power contract if not owned by this token", async () => {
    // Assemble
    const governanceVotePower = await MockContract.new();
    const ownerTokenCall = web3.eth.abi.encodeFunctionCall({ type: 'function', name: 'ownerToken', inputs: [] }, []);
    await governanceVotePower.givenMethodReturnAddress(ownerTokenCall, constants.ZERO_ADDRESS);
    // Act
    // Assert
    await expectRevert(vpToken.setGovernanceVotePower(governanceVotePower.address),
      "Governance vote power contract does not belong to this token.");
  });

  it("Can execute methods with governance vote power set", async () => {
    // Assemble
    await vpToken.setCleanupBlockNumberManager(accounts[8]);
    const governanceVotePower = await MockContract.new();
    const ownerTokenCall = web3.eth.abi.encodeFunctionCall({ type: 'function', name: 'ownerToken', inputs: [] }, []);
    await governanceVotePower.givenMethodReturnAddress(ownerTokenCall, vpToken.address);
    await vpToken.setGovernanceVotePower(governanceVotePower.address);
    await governanceVotePower.givenAnyReturnBool(true);
    // Act
    await vpToken.mint(accounts[1], 100);
    await vpToken.transfer(accounts[2], 50, { from: accounts[1] });
    await vpToken.setCleanupBlockNumber(1, { from: accounts[8] });
    await vpToken.setCleanerContract(accounts[5]);
    // Assert
    const invocations = await governanceVotePower.invocationCount.call();
    assert.equal(invocations.toNumber(), 4);  // updateAtTokenTransfer*2, setCleanupBlockNumber*1, setCleanerContract*1
  });

  it("May use vpToken transfer without VPContract", async () => {
    // Assemble
    const vpToken1 = await VPToken.new(accounts[0], "A token without VPContract", "ATOK");
    // Act
    await vpToken1.mint(accounts[1], 100);
    const blk1 = await web3.eth.getBlockNumber();
    await vpToken1.transfer(accounts[2], 10, { from: accounts[1] });
    // Assert
    assertNumberEqual(await vpToken1.balanceOf(accounts[1]), 90);
    assertNumberEqual(await vpToken1.balanceOf(accounts[2]), 10);
    assertNumberEqual(await vpToken1.balanceOfAt(accounts[1], blk1), 100);
    assertNumberEqual(await vpToken1.balanceOfAt(accounts[2], blk1), 0);
  });

  it("Should not use vote power methods without VPContract", async () => {
    // Assemble
    const vpToken1 = await VPToken.new(accounts[0], "A token without VPContract", "ATOK");
    await vpToken1.mint(accounts[1], 100);
    const blk1 = await web3.eth.getBlockNumber();
    await time.advanceBlock();
    // Act
    // Assert
    await expectRevert(vpToken1.delegate(accounts[2], 10, { from: accounts[1] }),
      "Token missing write VPContract");
    await expectRevert(vpToken1.delegateExplicit(accounts[2], 10, { from: accounts[1] }),
      "Token missing write VPContract");
    // revokeDelegationAt is exception - it is noop without vpcontracts
    await vpToken1.revokeDelegationAt(accounts[2], blk1, { from: accounts[1] });
    await expectRevert(vpToken1.undelegateAll({ from: accounts[1] }),
      "Token missing write VPContract");
    await expectRevert(vpToken1.undelegateAllExplicit([accounts[2]], { from: accounts[1] }),
      "Token missing write VPContract");
  });

  it("Should not use vote power read methods without VPContract", async () => {
    // Assemble
    const vpToken1 = await VPToken.new(accounts[0], "A token without VPContract", "ATOK");
    await vpToken1.mint(accounts[1], 100);
    // Act
    // Assert
    await expectRevert(vpToken1.votePowerOf(accounts[1]), 
      "Token missing read VPContract");
    await expectRevert(vpToken1.votePowerOfAt(accounts[1], 3),
      "Token missing read VPContract");
    await expectRevert(vpToken1.votePowerOfAtCached(accounts[1], 3),
      "Token missing read VPContract");
    await expectRevert(vpToken1.delegatesOf(accounts[1]),
      "Token missing read VPContract");
    await expectRevert(vpToken1.delegatesOfAt(accounts[1], 3),
      "Token missing read VPContract");
    await expectRevert(vpToken1.votePowerFromTo(accounts[1], accounts[2]),
      "Token missing read VPContract");
    await expectRevert(vpToken1.votePowerFromToAt(accounts[1], accounts[2], 3),
      "Token missing read VPContract");
  });

  it("Should not set vpContract if owned by different token", async () => {
    // Assemble
    const newVpContract = await VPContract.new(vpToken.address, false);
    const newVpToken = await VPToken.new(accounts[0], "A token", "ATOK");
    // Act
    // Assert
    await expectRevert(newVpToken.setWriteVpContract(newVpContract.address),
      "VPContract not owned by this token");
    await expectRevert(newVpToken.setReadVpContract(newVpContract.address),
      "VPContract not owned by this token");
  });

  it("Should not change writeVpContract once it is set if replacement is not correctly configured", async () => {
    // Assemble
    const newVpContract = await VPContract.new(vpToken.address, false);
    // Act
    // Assert
    await expectRevert(vpToken.setWriteVpContract(newVpContract.address),
      "VPContract not configured for replacement");
  });

  it("May change readVpContract even if not configured for replacement", async () => {
    // Assemble
    const newVpContract = await VPContract.new(vpToken.address, false);
    // Act
    await vpToken.setReadVpContract(newVpContract.address)
    // Assert
    assert.equal(await vpToken.getReadVpContract(), newVpContract.address);
  });

  it("May change vpContract if replacement is suitable", async () => {
    // Assemble
    const newVpContract = await VPContract.new(vpToken.address, true);
    // Act
    await vpToken.setWriteVpContract(newVpContract.address);
    await vpToken.setReadVpContract(newVpContract.address)
    // Assert
    assert.equal(await vpToken.getWriteVpContract(), newVpContract.address);
    assert.equal(await vpToken.getReadVpContract(), newVpContract.address);
    assert.equal(await vpToken.writeVotePowerContract(), newVpContract.address);
    assert.equal(await vpToken.readVotePowerContract(), newVpContract.address);
  });

  it("Initial VPContract should have isReplacement false", async () => {
    // Assemble
    // Act
    const writeVpContractAddr = await vpToken.getWriteVpContract();
    const writeVpContract = await VPContract.at(writeVpContractAddr);
    const readVpContractAddr = await vpToken.getReadVpContract();
    const readVpContract = await VPContract.at(readVpContractAddr);
    // Assert
    assert.isFalse(await writeVpContract.isReplacement());
    assert.isFalse(await readVpContract.isReplacement());
  });

  it("Replacement VPContract should have isReplacement true", async () => {
    // Assemble
    await setDefaultVPContract(vpToken, accounts[0]);
    // Act
    const writeVpContractAddr = await vpToken.getWriteVpContract();
    const writeVpContract = await VPContract.at(writeVpContractAddr);
    const readVpContractAddr = await vpToken.getReadVpContract();
    const readVpContract = await VPContract.at(readVpContractAddr);
    // Assert
    assert.isTrue(await writeVpContract.isReplacement());
    assert.isTrue(await readVpContract.isReplacement());
  });

  it("After setting VPContract, vpContractInitialized is true", async () => {
    // Assemble
    const vpToken1 = await VPToken.new(accounts[0], "A token without VPContract", "ATOK");
    // Assert
    assert.isFalse(await vpToken1.vpContractInitialized());
    await setDefaultVPContract(vpToken1, accounts[0]);
    assert.isTrue(await vpToken1.vpContractInitialized());
  });

  it("After transfer without VPContract, VPContract must have isReplacement true", async () => {
    // Assemble
    const vpToken1 = await VPToken.new(accounts[0], "A token without VPContract", "ATOK");
    // Act
    await vpToken1.mint(accounts[1], 100);
    await vpToken1.transfer(accounts[2], 10, { from: accounts[1] });
    const newVpContract = await VPContract.new(vpToken1.address, false);
    // Assert
    await expectRevert(vpToken1.setWriteVpContract(newVpContract.address),
      "VPContract not configured for replacement");
  });

  it("After transfer without VPContract, VPContract should have isReplacement true", async () => {
    // Assemble
    const vpToken1 = await VPToken.new(accounts[0], "A token without VPContract", "ATOK");
    // Act
    await vpToken1.mint(accounts[1], 100);
    await vpToken1.transfer(accounts[2], 10, { from: accounts[1] });
    await setDefaultVPContract(vpToken1, accounts[0]);
    const vpContractAddr = await vpToken1.getWriteVpContract();
    const vpContract = await VPContract.at(vpContractAddr);
    // Assert
    assert.isTrue(await vpContract.isReplacement());
  });

  it("Can remove VPContract and then set it again", async () => {
    // Assemble
    await vpToken.setWriteVpContract(constants.ZERO_ADDRESS);
    await vpToken.setReadVpContract(constants.ZERO_ADDRESS);
    // Act
    await vpToken.mint(accounts[1], 100);
    await vpToken.transfer(accounts[2], 10, { from: accounts[1] });
    await setDefaultVPContract(vpToken, accounts[0]);
    await vpToken.delegateExplicit(accounts[2], 10, { from: accounts[1] });
    // Assert
    assertNumberEqual(await vpToken.votePowerOf(accounts[1]), 80);
    assertNumberEqual(await vpToken.votePowerOf(accounts[2]), 20);
  });
  
  it("Only governance can set vp contracts", async () => {
    // Assemble
    const newVpContract = await VPContract.new(vpToken.address, true);
    // Act
    // Assert
    await expectRevert(vpToken.setWriteVpContract(newVpContract.address, { from: accounts[1] }),
      "only governance");
    await expectRevert(vpToken.setReadVpContract(newVpContract.address, { from: accounts[1] }),
      "only governance");
  });

  it("Only governance can set governance vp contracts", async () => {
    // Assemble
    const governanceVotePower = await MockContract.new();
    const ownerTokenCall = web3.eth.abi.encodeFunctionCall({ type: 'function', name: 'ownerToken', inputs: [] }, []);
    await governanceVotePower.givenMethodReturnAddress(ownerTokenCall, vpToken.address);
    // Act
    // Assert
    await expectRevert(vpToken.setGovernanceVotePower(governanceVotePower.address, { from: accounts[1] }),
      "only governance");
  });

  it("Only governance can set cleaner contract", async () => {
    // Assemble
    const historyCleaner = await MockContract.new();
    // Act
    // Assert
    await expectRevert(vpToken.setCleanerContract(historyCleaner.address, { from: accounts[1] }),
      "only governance");
  });

  it("Only cleanup block number manager can set cleanup block", async () => {
    // Assemble
    await vpToken.setCleanupBlockNumberManager(accounts[10]);
    await time.advanceBlock();
    await time.advanceBlock();
    // Act
    // Assert
    const promise = vpToken.setCleanupBlockNumber(1, { from: accounts[0] });  // governance
    await expectRevert(promise, "only cleanup block manager");  // cannot be called by governance
    assertNumberEqual(await vpToken.cleanupBlockNumber(), 0);
    await vpToken.setCleanupBlockNumber(2, { from: accounts[10] });  // cleanup block number manager
    assertNumberEqual(await vpToken.cleanupBlockNumber(), 2);
    await expectRevert(vpToken.setCleanupBlockNumber(1, { from: accounts[1] }),
      "only cleanup block manager");
  });

  it("Can read batch vote powers", async () => {
    // Assemble
    await vpToken.mint(accounts[1], 100);
    await vpToken.mint(accounts[2], 200);
    await vpToken.delegate(accounts[3], 5000, { from: accounts[1] });
    const blk1 = await web3.eth.getBlockNumber();
    await time.advanceBlock();
    // Act
    const result = await vpToken.batchVotePowerOfAt([accounts[1], accounts[2], accounts[3]], blk1);
    // Assert
    compareNumberArrays(result, [50, 200, 50]);
  });

  it("Can only read batch vote powers from the past", async () => {
    // Assemble
    await vpToken.mint(accounts[1], 100);
    await vpToken.mint(accounts[2], 200);
    await vpToken.delegate(accounts[3], 5000, { from: accounts[1] });
    const blk1 = await web3.eth.getBlockNumber();
    // Act
    // Assert
    await expectRevert(vpToken.batchVotePowerOfAt([accounts[1], accounts[2], accounts[3]], blk1 + 2),
      "a");
  });

  it("Cannot mint more than 2^128", async () => {
    const maxuint192 = toBN(2).pow(toBN(192)).subn(1);
    // can mint 2^128-1
    await vpToken.mint(accounts[1], maxuint192);
    // cannot mint total supply of 2^128
    await expectRevert(vpToken.mint(accounts[2], 1), 
      "value doesn't fit in 192 bits");
    // after burn, can mint again
    await vpToken.burn(1000, { from: accounts[1] });
    await vpToken.mint(accounts[2], 1000);
    // can transfer any minted amount
    await expectRevert(vpToken.transfer(accounts[2], maxuint192, { from: accounts[1] }), 
      "ERC20: transfer amount exceeds balance");
    const maxTransferValue = maxuint192.subn(1000);
    await vpToken.transfer(accounts[2], maxTransferValue, { from: accounts[1] });
  });

  it("Can read batch vote powers", async () => {
    // Assemble
    await vpToken.mint(accounts[1], 100);
    await vpToken.mint(accounts[2], 200);
    await vpToken.delegate(accounts[3], 5000, { from: accounts[1] });
    const blk1 = await web3.eth.getBlockNumber();
    await time.advanceBlock();
    // Act
    const result = await vpToken.batchVotePowerOfAt([accounts[1], accounts[2], accounts[3]], blk1);
    // Assert
    compareNumberArrays(result, [50, 200, 50]);
  });

  it("Value of votePowerOfAtIgnoringRevocation should remain the same after revocation", async () => {
    // Assemble
    await vpToken.mint(accounts[1], 200);
    // Act
    await vpToken.delegate(accounts[2], 3000, { from: accounts[1] });
    const blockAfterDelegate1 = await web3.eth.getBlockNumber();
    await vpToken.mint(accounts[1], 100);
    await vpToken.delegate(accounts[2], 4000, { from: accounts[1] });
    // revoke
    await vpToken.revokeDelegationAt(accounts[2], blockAfterDelegate1, { from: accounts[1] });
    // Assert
    assert.equal((await vpToken.votePowerOfAt(accounts[1], blockAfterDelegate1)).toNumber(), 140);
    assert.equal((await vpToken.votePowerOfAt(accounts[2], blockAfterDelegate1)).toNumber(), 0);
    assert.equal((await vpToken.votePowerOfAtIgnoringRevocation(accounts[1], blockAfterDelegate1)).toNumber(), 140);
    assert.equal((await vpToken.votePowerOfAtIgnoringRevocation(accounts[2], blockAfterDelegate1)).toNumber(), 60);
  });
  
  it("Batch delegation should work", async() => {
    async function checkDelegations(from: string, expectDelegates: string[], expectBips: number[]) {
      const { 0: delegates, 1: bips } = await vpToken.delegatesOf(from);
      compareArrays(delegates, expectDelegates);
      compareArrays(bips.map(x => Number(x)), expectBips);
    }
    async function checkDelegationsAt(from: string, expectDelegates: string[], expectBips: number[], at: number) {
      const { 0: delegates, 1: bips } = await vpToken.delegatesOfAt(from, at);
      compareArrays(delegates, expectDelegates);
      compareArrays(bips.map(x => Number(x)), expectBips);
    }
    // Assemble
    await vpToken.mint(accounts[1], 100);
    // batch delegate to empty
    await vpToken.batchDelegate([accounts[2], accounts[3]], [3000, 5000], { from: accounts[1] });
    const blk1 = await web3.eth.getBlockNumber();
    await checkDelegations(accounts[1], [accounts[2], accounts[3]], [3000, 5000]);
    // redelegate all
    await vpToken.batchDelegate([accounts[4], accounts[5]], [2000, 4000], { from: accounts[1] });
    const blk2 = await web3.eth.getBlockNumber();
    await checkDelegations(accounts[1], [accounts[4], accounts[5]], [2000, 4000]);
    // redelegate to one delegator
    await vpToken.batchDelegate([accounts[6]], [5000], { from: accounts[1] });
    const blk3 = await web3.eth.getBlockNumber();
    await checkDelegations(accounts[1], [accounts[6]], [5000]);
    // undelegate via batchDelegation
    await vpToken.batchDelegate([], [], { from: accounts[1] });
    const blk4 = await web3.eth.getBlockNumber();
    await checkDelegations(accounts[1], [], []);
    // batch delegate to empty again
    await vpToken.batchDelegate([accounts[8], accounts[9]], [1000, 2000], { from: accounts[1] });
    const blk5 = await web3.eth.getBlockNumber();
    await checkDelegations(accounts[1], [accounts[8], accounts[9]], [1000, 2000]);
    // historical delegations should be correct
    await checkDelegationsAt(accounts[1], [accounts[2], accounts[3]], [3000, 5000], blk1);
    await checkDelegationsAt(accounts[1], [accounts[4], accounts[5]], [2000, 4000], blk2);
    await checkDelegationsAt(accounts[1], [accounts[6]], [5000], blk3);
    await checkDelegationsAt(accounts[1], [], [], blk4);
    await checkDelegationsAt(accounts[1], [accounts[8], accounts[9]], [1000, 2000], blk5);
  });

  it("Batch delegation should revert properly", async () => {
    // Assemble
    await vpToken.mint(accounts[1], 100);
    // Assert
    await expectRevert(vpToken.batchDelegate([accounts[2], accounts[3]], [3000], { from: accounts[1] }),
      "Array length mismatch");
    await expectRevert(vpToken.batchDelegate([accounts[2], accounts[3], accounts[4]], [3000, 2000, 1000], { from: accounts[1] }),
      "Max delegates exceeded");
    await expectRevert(vpToken.batchDelegate([accounts[2], accounts[3]], [3000, 8000], { from: accounts[1] }),
      "Max delegation bips exceeded");
  });
});
