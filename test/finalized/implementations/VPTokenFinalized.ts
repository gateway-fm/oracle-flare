import chai from "chai";
import { solidity } from "ethereum-waffle";
import { artifacts, assert, contract, ethers, web3 } from "hardhat";
import { VPToken } from "../../../typechain";
import { VPContractContract, VPTokenMockContract, VPTokenMockInstance } from "../../../typechain-truffle";
import { newContract, waitFinalize3 } from "../../utils/test-helpers";
import { setDefaultVPContract, setDefaultVPContract_ethers } from "../../utils/token-test-helpers";

// const { expectRevert } = require('@openzeppelin/test-helpers');
chai.use(solidity);
const { expect } = chai;


// Unit tests for VPToken: checkpointable, delegatable, and ERC20 sanity tests
// const { constants } = require('@openzeppelin/test-helpers');
const getTestFile = require('../../utils/constants').getTestFile;

const VPTokenA = artifacts.require("VPTokenMock") as VPTokenMockContract

const ALREADY_DELEGATED_EXPLICIT_MSG = "Already delegated explicitly";
const ALREADY_DELEGATED_PERCENT_MSG = "Already delegated by percentage";

web3.eth.handleRevert = true;

contract(`VPToken.sol; ${ getTestFile(__filename) }; Check point unit tests`, async accounts => {
  // contains a fresh contract for each test
  let vpToken: VPTokenMockInstance;
  let vpTokenETH: VPToken;

  // Do clean unit tests by spinning up a fresh contract for each test
  beforeEach(async () => {
    let signers = await ethers.getSigners();
    vpToken = await waitFinalize3(accounts[0], () => VPTokenA.new(accounts[0], "A token", "ATOK"));
    await waitFinalize3(accounts[0], () => setDefaultVPContract(vpToken, accounts[0]));
    vpTokenETH = await newContract<VPToken>("VPTokenMock", signers[0], signers[0].address, "A token", "ATOK");
    await setDefaultVPContract_ethers(vpTokenETH, signers[0]);
  });

  it("Should be checkpointable", async () => {
    const b = [];
    // Assemble
    b[0] = await web3.eth.getBlockNumber();
    await waitFinalize3(accounts[0], () => vpToken.mint(accounts[1], 50));
    b[1] = await web3.eth.getBlockNumber();
    await waitFinalize3(accounts[0], () => vpToken.mint(accounts[1], 10));
    b[2] = await web3.eth.getBlockNumber();
    await waitFinalize3(accounts[0], () => vpToken.mint(accounts[1], 5));
    // Act
    let balanceAtBlock0 = await vpToken.balanceOfAt(accounts[1], b[0]);
    let balanceAtBlock1 = await vpToken.balanceOfAt(accounts[1], b[1]);
    let balanceAtBlock2 = await vpToken.balanceOfAt(accounts[1], b[2]);
    let balanceAtNow = await vpToken.balanceOf(accounts[1]);
    // Assert
    
    assert.equal(balanceAtBlock0.toNumber(), 0);
    assert.equal(balanceAtBlock1.toNumber(), 50);
    assert.equal(balanceAtBlock2.toNumber(), 60);
    assert.equal(balanceAtNow.toNumber(), 65);
  });

  it("Should be delegatable by percentage", async () => {
    // Assemble
    await waitFinalize3(accounts[1], () => vpToken.delegate(accounts[2], 50, { from: accounts[1] }));
    await waitFinalize3(accounts[1], () => vpToken.delegate(accounts[3], 50, { from: accounts[1] }));
    // Act
    const {_delegateAddresses, _bips, _count, _delegationMode} = await vpToken.delegatesOf(accounts[1]) as any;
    // Assert
    assert.equal(_delegateAddresses[0], accounts[2]);
    assert.equal(_bips[0], 50);
    assert.equal(_delegateAddresses[1], accounts[3]);
    assert.equal(_bips[1], 50);
    assert.equal(_count, 2);
    assert.equal(_delegationMode, 1);
  });

  it("Should undelegate all", async () => {
    // Assemble
    await waitFinalize3(accounts[1], () => vpToken.delegate(accounts[2], 50, { from: accounts[1] }));
    await waitFinalize3(accounts[1], () => vpToken.delegate(accounts[3], 50, { from: accounts[1] }));
    // Act
    await waitFinalize3(accounts[1], () => vpToken.undelegateAll({ from: accounts[1] }));
    // Assert
    const {_count, _delegationMode} = await vpToken.delegatesOf(accounts[1]) as any;
    assert.equal(_count, 0);
    assert.equal(_delegationMode, 1); // undelegateAll doesn't change delegation mode
  });

  it("Should be explicitly delegatable", async () => {
    // Assemble
    await waitFinalize3(accounts[0], () => vpToken.mint(accounts[1], 100));
    await waitFinalize3(accounts[1], () => vpToken.delegateExplicit(accounts[2], 75, { from: accounts[1] }));
    // Act
    let undelegatedVotePower = await vpToken.undelegatedVotePowerOf(accounts[1]);
    // Assert
    assert.equal(undelegatedVotePower.toNumber(), 25);
  });

  it("Should retrieve undelegated vote power", async () => {
    // Assemble
    await waitFinalize3(accounts[0], () => vpToken.mint(accounts[1], 50));
    // Act
    let undelegatedVotePower = await vpToken.undelegatedVotePowerOf(accounts[1]);
    // Assert
    assert.equal(undelegatedVotePower.toNumber(), 50);
  });

  it("Should transfer vote power from address 1 to address 2", async () => {
    // Assemble
    await waitFinalize3(accounts[0], () => vpToken.mint(accounts[1], 50));
    await waitFinalize3(accounts[0], () => vpToken.mint(accounts[2], 10));
    // Act
    await waitFinalize3(accounts[1], () => vpToken.transfer(accounts[2], 5, { from: accounts[1] }));
    // Assert
    let account1VP = await vpToken.votePowerOf(accounts[1]);
    let account2VP = await vpToken.votePowerOf(accounts[2]);
    assert.equal(account1VP.toNumber(), 45);
    assert.equal(account2VP.toNumber(), 15);
  });

  it("Should transfer historic balance from address 1 to address 2", async () => {
    // Assemble
    await waitFinalize3(accounts[0], () => vpToken.mint(accounts[1], 50));
    await waitFinalize3(accounts[0], () => vpToken.mint(accounts[2], 10));
    // Act
    await waitFinalize3(accounts[1], () => vpToken.transfer(accounts[2], 5, { from: accounts[1] }));
    // Assert
    let account1balance = await vpToken.balanceOfAt(accounts[1], await web3.eth.getBlockNumber());
    let account2balance = await vpToken.balanceOfAt(accounts[2], await web3.eth.getBlockNumber());
    assert.equal(account1balance.toNumber(), 45);
    assert.equal(account2balance.toNumber(), 15);
  });

  it("Should burn vote power", async () => {
    // Assemble
    await waitFinalize3(accounts[0], () => vpToken.mint(accounts[1], 50));
    // Act
    await waitFinalize3(accounts[1], () => vpToken.burn(5, { from: accounts[1] }));
    // Assert
    let account1VP = await vpToken.votePowerOf(accounts[1]);
    assert.equal(account1VP.toNumber(), 45);
  });

  it("Should burn historic balance", async () => {
    // Assemble
    await waitFinalize3(accounts[0], () => vpToken.mint(accounts[1], 50));
    // Act
    await waitFinalize3(accounts[1], () => vpToken.burn(5, { from: accounts[1] }));
    // Assert
    let account1balance = await vpToken.balanceOfAt(accounts[1], await web3.eth.getBlockNumber());
    assert.equal(account1balance.toNumber(), 45);
  });

  it("Should revert delegating by percent when already delegated explicit", async () => {
    // Assemble
    await waitFinalize3(accounts[0], () => vpToken.mint(accounts[1], 100));
    await waitFinalize3(accounts[1], () => vpToken.delegateExplicit(accounts[2], 50, { from: accounts[1] }));
    // Act
    web3.eth.handleRevert = true;
    // let delegatePromise = (vpToken.methods.delegate(accounts[2], 1000) as any).send({ from: accounts[1] })
    let delegatePromise = vpToken.delegate(accounts[2], 1000, { from: accounts[1] });
    // try {
    //   let pro = await delegatePromise;
    //   console.log("PRO:", pro)
    // } catch(e) {
    //   console.log("EE:", e)
    // }
    // Assert
    // await expectRevert(delegatePromise, ALREADY_DELEGATED_EXPLICT_MSG);            
    await expect(delegatePromise).to.be.revertedWith(ALREADY_DELEGATED_EXPLICIT_MSG)
  });

  it("Should revert delegating explicit when already delegated by percent", async () => {
    // Assemble
    await waitFinalize3(accounts[0], () => vpToken.mint(accounts[1], 100));
    await waitFinalize3(accounts[1], () => vpToken.delegate(accounts[2], 1000, { from: accounts[1] }));
    // Act
    let delegatePromise = vpToken.delegateExplicit(accounts[2], 50, { from: accounts[1] });
    // Assert
    // await expectRevert(delegatePromise, ALREADY_DELEGATED_PERCENT_MSG);
    await expect(delegatePromise).to.be.revertedWith(ALREADY_DELEGATED_PERCENT_MSG).catch(e => console.log("GG", e))    
  });

  it("Should sum minted vote power", async () => {
    // Assemble
    // Act
    await waitFinalize3(accounts[0], () => vpToken.mint(accounts[1], 10));
    await waitFinalize3(accounts[0], () => vpToken.mint(accounts[2], 20));
    // Assert
    assert.equal((await vpToken.totalVotePower()).toNumber(), 30);
  });

  it("Should net total vote power", async () => {
    // Assemble
    await waitFinalize3(accounts[0], () => vpToken.mint(accounts[1], 10));
    await waitFinalize3(accounts[0], () => vpToken.mint(accounts[2], 20));
    // Act
    await waitFinalize3(accounts[1], () => vpToken.burn(5, { from: accounts[1] }));
    // Assert
    assert.equal((await vpToken.totalVotePower()).toNumber(), 25);
  });

  it("Should record historic vote power", async () => {
    // Assemble
    const b = [];
    let blockAfterFirstMinting = 0;

    await waitFinalize3(accounts[0], () => vpToken.mint(accounts[1], 10));
    // await vpToken.mint(accounts[1], 10);
    await waitFinalize3(accounts[0], () => vpToken.mint(accounts[2], 20));
    b[blockAfterFirstMinting] = await web3.eth.getBlockNumber();

    // Act
    await waitFinalize3(accounts[0], () => vpToken.mint(accounts[2], 50));

    // Assert
    assert.equal((await vpToken.totalVotePowerAt(b[blockAfterFirstMinting])).toNumber(), 30);
  });

  it("Should leave total vote power alone when delegating", async () => {
    // Assemble
    await waitFinalize3(accounts[0], () => vpToken.mint(accounts[1], 20));
    // Act
    await waitFinalize3(accounts[1], () => vpToken.delegate(accounts[2], 5, { from: accounts[1] }));
    // Assert
    assert.equal((await vpToken.totalVotePower()).toNumber(), 20);
  });
});
