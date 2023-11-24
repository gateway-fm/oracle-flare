// Unit tests for Delegatable behavior library, revoke vote power activity

import { DelegatableMockContract, DelegatableMockInstance } from "../../../../../typechain-truffle";
import { compareArrays, toBN } from "../../../../utils/test-helpers";

const {getTestFile} = require('../../../../utils/constants');

const Delegatable = artifacts.require("DelegatableMock") as DelegatableMockContract;

contract(`Delegatable.sol; ${getTestFile(__filename)}; Revoke vote power unit tests`, async accounts => {
  // a fresh contract for each test
  let delegatable: DelegatableMockInstance;

  // Mimic asset spec test case names
  let bob = accounts[1];
  let lucy = accounts[2];
  let ed = accounts[3];
  let joe = accounts[4];

  // Store block numbers
  const b: number[] = [];

  // Do clean unit tests by spinning up a fresh contract for each test
  beforeEach(async () => {
    delegatable = await Delegatable.new();
  });

  it("Should revoke a past delegation of bad actor", async () => {
    let blockAtStart = 0;
    let blockAfterMinting = 1;
    let blockAfterBobDelegateToLucy = 2;
    let blockAfterBobDelegateToEd = 3;
    let blockAfterBobMinting = 4;
    let blockAfterBobSlashEd = 5;

    // Test Synposis:
    // Bob delegates vote power by percent to Lucy and Ed. Later, Bob gets some more
    // tokens. Then he realizes Ed may be a bad actor and reduces his VP delegation.
    // Bob also wants to revoke Ed's delegation for a past block. Ed's vote power at that
    // past block should be reduced by amount delegated by Bob. To prevent double delegation,
    // Bob does not receive the vote power back for already passed block but has no 
    // impact on current (and future) Bob's vote power. 
    // Total vote power at that historic block is reduced by the amount revoked.
    
    // Assemble
    b[blockAtStart] = await web3.eth.getBlockNumber();
    await delegatable.mintVotePower(bob, 200);
    await delegatable.mintVotePower(lucy, 100);
    await delegatable.mintVotePower(ed, 50);
    b[blockAfterMinting] = await web3.eth.getBlockNumber();
    // blockAfterMinting
    //        T    V
    // Bob    200  200
    // Lucy   100  100
    // Ed     50   50


    await delegatable.delegate(lucy, 5000, {from: bob});                 // Bob -> 100 VP -> Lucy
    b[blockAfterBobDelegateToLucy] = await web3.eth.getBlockNumber();
    // blockAfterBobDelegateToLucy
    //        T    V
    // Bob    200  100
    // Lucy   100  200
    // Ed     50   50

    await delegatable.delegate(ed, 3000, {from: bob});                   // Bob -> 60 VP -> Ed
    b[blockAfterBobDelegateToEd] = await web3.eth.getBlockNumber();
    // blockAfterBobDelegateToEd
    //        T    V
    // Bob    200  40
    // Lucy   100  200
    // Ed     50   110

    await delegatable.mintVotePower(bob, 100);                        // Bob gets 100 more tokens
    b[blockAfterBobMinting] = await web3.eth.getBlockNumber();
    // blockAfterBobMinting
    //        T    V
    // Bob    300  60
    // Lucy   100  250
    // Ed     50   140

    await delegatable.delegate(ed, 500, {from: bob});                   // Ed -> 75 VP -> Bob
    b[blockAfterBobSlashEd] = await web3.eth.getBlockNumber();
    // blockAfterBobSlashEd (the now block)
    //        T    V
    // Bob    300  135
    // Lucy   100  250
    // Ed     50   65

    // Act
    await delegatable.revokeDelegationAt(ed, b[blockAfterBobDelegateToEd], {from: bob});
    // blockAfterBobDelegateToEd
    //        T    V
    // Bob    200  40 // To prevent double delegation, revoked vote power is not returned
    // Lucy   100  200
    // Ed     50   50

    // Assert
    let edVotePowerPastBlock = await delegatable.votePowerOfAt(ed, b[blockAfterBobDelegateToEd]);
    let bobVotePowerPastBlock = await delegatable.votePowerOfAt(bob, b[blockAfterBobDelegateToEd]);
    let edVotePowerNow = await delegatable.votePowerOf(ed);
    let bobVotePowerNow = await delegatable.votePowerOf(bob);
    assert.equal(edVotePowerPastBlock as any, 50);
    assert.equal(bobVotePowerPastBlock as any, 40);
    assert.equal(edVotePowerNow as any, 65);
    assert.equal(bobVotePowerNow as any, 135);
    let { _delegateAddresses: delegatesPast, _bips: bipsPast } = await delegatable.delegatesOfAt(bob, b[blockAfterBobDelegateToEd]) as any;
    compareArrays(delegatesPast, [lucy]);
    compareArrays(bipsPast.map((x: BN) => x.toNumber()), [5000]);
    let { _delegateAddresses: delegatesNow, _bips: bipsNow } = await delegatable.delegatesOf(bob) as any;
    compareArrays(delegatesNow, [lucy, ed]);
    compareArrays(bipsNow.map((x: BN) => x.toNumber()), [5000, 500]);
    let edUndelegatedVotePowerPastBlock = await delegatable.undelegatedVotePowerOfAt(ed, b[blockAfterBobDelegateToEd]);
    let bobUndelegatedVotePowerPastBlock = await delegatable.undelegatedVotePowerOfAt(bob, b[blockAfterBobDelegateToEd]);
    let edUndelegatedVotePowerNow = await delegatable.undelegatedVotePowerOf(ed);
    let bobUndelegatedVotePowerNow = await delegatable.undelegatedVotePowerOf(bob);
    assert.equal(edUndelegatedVotePowerPastBlock.toNumber(), 50);
    assert.equal(bobUndelegatedVotePowerPastBlock.toNumber(), 40);
    assert.equal(edUndelegatedVotePowerNow.toNumber(), 50);
    assert.equal(bobUndelegatedVotePowerNow.toNumber(), 135);
  });
  
  it("Should revoke a past delegation of bad actor (explicit delegation)", async () => {
    let blockAtStart = 0;
    let blockAfterMinting = 1;
    let blockAfterBobDelegateToLucy = 2;
    let blockAfterBobDelegateToEd = 3;
    let blockAfterBobMinting = 4;
    let blockAfterBobSlashEd = 5;

    // Test Synposis:
    // Bob delegates vote power by percent to Lucy and Ed. Later, Bob gets some more
    // tokens. Then he realizes Ed may be a bad actor and reduces his VP delegation.
    // Bob also wants to revoke Ed's delegation for a past block. Ed's vote power at that
    // past block should be reduced by amount delegated by Bob at that time and given 
    // back to Bob at that block. Total vote power at that block should remain constant.

    // Assemble
    b[blockAtStart] = await web3.eth.getBlockNumber();
    await delegatable.mintVotePower(bob, 200);
    await delegatable.mintVotePower(lucy, 100);
    await delegatable.mintVotePower(ed, 50);
    b[blockAfterMinting] = await web3.eth.getBlockNumber();
    // blockAfterMinting
    //        T    V
    // Bob    200  200
    // Lucy   100  100
    // Ed     50   50


    await delegatable.delegateExplicit(lucy, 100, { from: bob });                 // Bob -> 100 VP -> Lucy
    b[blockAfterBobDelegateToLucy] = await web3.eth.getBlockNumber();
    // blockAfterBobDelegateToLucy
    //        T    V
    // Bob    200  100
    // Lucy   100  200
    // Ed     50   50

    await delegatable.delegateExplicit(ed, 60, { from: bob });                   // Bob -> 60 VP -> Ed
    b[blockAfterBobDelegateToEd] = await web3.eth.getBlockNumber();
    // blockAfterBobDelegateToEd
    //        T    V
    // Bob    200  40
    // Lucy   100  200
    // Ed     50   110

    await delegatable.mintVotePower(bob, 100);                        // Bob gets 100 more tokens
    b[blockAfterBobMinting] = await web3.eth.getBlockNumber();
    // blockAfterBobMinting
    //        T    V
    // Bob    300  140
    // Lucy   100  200
    // Ed     50   110

    await delegatable.delegateExplicit(ed, 15, { from: bob });                   // Ed -> 45 VP -> Bob
    b[blockAfterBobSlashEd] = await web3.eth.getBlockNumber();
    // blockAfterBobSlashEd (the now block)
    //        T    V
    // Bob    300  185
    // Lucy   100  200
    // Ed     50   65

    // Act
    await delegatable.revokeDelegationAt(ed, b[blockAfterBobDelegateToEd], { from: bob });
    // blockAfterBobDelegateToEd
    //        T    V
    // Bob    200  40
    // Lucy   100  200
    // Ed     50   50

    // Assert
    let edVotePowerPastBlock = await delegatable.votePowerOfAt(ed, b[blockAfterBobDelegateToEd]);
    let bobVotePowerPastBlock = await delegatable.votePowerOfAt(bob, b[blockAfterBobDelegateToEd]);
    let lucyVotePowerPastBlock = await delegatable.votePowerOfAt(lucy, b[blockAfterBobDelegateToEd]);
    let edVotePowerNow = await delegatable.votePowerOf(ed);
    let bobVotePowerNow = await delegatable.votePowerOf(bob);
    let lucyVotePowerNow = await delegatable.votePowerOf(lucy);
    assert.equal(edVotePowerPastBlock.toNumber(), 50);
    assert.equal(bobVotePowerPastBlock.toNumber(), 40);
    assert.equal(lucyVotePowerPastBlock.toNumber(), 200);
    assert.equal(edVotePowerNow.toNumber(), 65);
    assert.equal(bobVotePowerNow.toNumber(), 185);
    assert.equal(lucyVotePowerNow.toNumber(), 200);
    let edUndelegatedVotePowerPastBlock = await delegatable.undelegatedVotePowerOfAt(ed, b[blockAfterBobDelegateToEd]);
    let bobUndelegatedVotePowerPastBlock = await delegatable.undelegatedVotePowerOfAt(bob, b[blockAfterBobDelegateToEd]);
    let edUndelegatedVotePowerNow = await delegatable.undelegatedVotePowerOf(ed);
    let bobUndelegatedVotePowerNow = await delegatable.undelegatedVotePowerOf(bob);
    assert.equal(edUndelegatedVotePowerPastBlock.toNumber(), 50);
    assert.equal(bobUndelegatedVotePowerPastBlock.toNumber(), 40);
    assert.equal(edUndelegatedVotePowerNow.toNumber(), 50);
    assert.equal(bobUndelegatedVotePowerNow.toNumber(), 185);
  });
});
