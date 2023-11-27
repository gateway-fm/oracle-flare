import { expectRevert, time } from '@openzeppelin/test-helpers';
import { PChainStakeMockInstance } from "../../../../typechain-truffle";

const getTestFile = require('../../../utils/constants').getTestFile;
const PChainStake = artifacts.require("PChainStakeMock");


contract(`PChainStake.sol; ${getTestFile(__filename)}; P-chain stake unit tests`, async accounts => {
  let pChainStake: PChainStakeMockInstance;

  beforeEach(async () => {
    pChainStake = await PChainStake.new();

  });

  it("Should increase and decrease balance and total supply", async () => {
    expect((await pChainStake.balanceOfAt(accounts[2], await time.latestBlock())).toNumber()).to.equals(0);
    expect((await pChainStake.totalSupplyAt(await time.latestBlock())).toNumber()).to.equals(0);
    await pChainStake.increaseBalance(accounts[2], 500);
    const block = await time.latestBlock();
    expect((await pChainStake.balanceOfAt(accounts[2], block)).toNumber()).to.equals(500);
    await pChainStake.decreaseBalance(accounts[2], 200);
    expect((await pChainStake.balanceOfAt(accounts[2], block)).toNumber()).to.equals(500);
    expect((await pChainStake.totalSupplyAt(block)).toNumber()).to.equals(500);
    expect((await pChainStake.balanceOfAt(accounts[2], await time.latestBlock())).toNumber()).to.equals(300);
    expect((await pChainStake.totalSupplyAt(await time.latestBlock())).toNumber()).to.equals(300);
  });

  it("Should increase and decrease vote power", async () => {
    const nodeId = "0x0123456789012345678901234567890123456789";
    expect((await pChainStake.votePowerOfAt(nodeId, await time.latestBlock())).toNumber()).to.equals(0);
    await pChainStake.increaseVotePower(accounts[2], nodeId, 500);
    const block = await time.latestBlock();
    expect((await pChainStake.votePowerOfAt(nodeId, block)).toNumber()).to.equals(500);
    await pChainStake.decreaseVotePower(accounts[2], nodeId, 200);
    expect((await pChainStake.votePowerOfAt(nodeId, block)).toNumber()).to.equals(500);
    expect((await pChainStake.votePowerOfAt(nodeId, await time.latestBlock())).toNumber()).to.equals(300);
  });

  it("Should revert decreasing balance below 0", async () => {
    await expectRevert(pChainStake.decreaseBalance(accounts[2], 200), "Burn too big for owner");
  });

  it("Should revert decreasing vote power below 0", async () => {
    const nodeId = "0x0123456789012345678901234567890123456789";
    await expectRevert(pChainStake.decreaseVotePower(accounts[2], nodeId, 200), "SafeMath: subtraction overflow");
  });

  it("Should revert increasing or decreasing vote power for zero node", async () => {
    const nodeId = "0x0";
    await expectRevert(pChainStake.increaseVotePower(accounts[2], nodeId, 200), "Cannot stake to zero");
    await expectRevert(pChainStake.decreaseVotePower(accounts[2], nodeId, 200), "Cannot stake to zero");
  });

});