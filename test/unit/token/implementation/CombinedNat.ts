import { CombinedNatInstance, MockContractInstance } from "../../../../typechain-truffle";
import { assertNumberEqual } from "../../../utils/test-helpers";
import { constants, expectRevert, time } from '@openzeppelin/test-helpers';
const getTestFile = require('../../../utils/constants').getTestFile;

const MockContract = artifacts.require("MockContract");
const CombinedNat = artifacts.require("CombinedNat");

contract(`CombinedNat; ${getTestFile(__filename)}`, async accounts => {
  let wNat: MockContractInstance;
  let pChainStakeMirror: MockContractInstance;
  let combinedNat: CombinedNatInstance;

  beforeEach(async () => {
    wNat = await MockContract.new();
    pChainStakeMirror = await MockContract.new();
    combinedNat = await CombinedNat.new(wNat.address, pChainStakeMirror.address);
  });

  it("Should not deploy contract if wNat is address zero", async () => {
    let deploy = CombinedNat.new(constants.ZERO_ADDRESS, pChainStakeMirror.address);
    await expectRevert(deploy, "_wNat zero");
  });

  it("Should not deploy contract if pChainStakeMirror contract is address zero", async () => {
    let deploy = CombinedNat.new(wNat.address, constants.ZERO_ADDRESS);
    await expectRevert(deploy, "_pChainStakeMirror zero");
  });

  it("Should get total supply", async () => {
    let totalSupplyWnat = web3.utils.sha3("totalSupply()")!.slice(0, 10); // first 4 bytes is function selector
    let totalSupplyPChain = web3.utils.sha3("totalSupply()")!.slice(0, 10);
    await wNat.givenMethodReturnUint(totalSupplyWnat, 100);
    await pChainStakeMirror.givenMethodReturnUint(totalSupplyPChain, 50);
    assertNumberEqual(await combinedNat.totalSupply(), 100 + 50);
  });

  it("Should get total supply at some block", async () => {
    let totalSupplyAtWnat = web3.utils.sha3("totalSupplyAt(uint256)")!.slice(0, 10);
    let totalSupplyAtPChain = web3.utils.sha3("totalSupplyAt(uint256)")!.slice(0, 10);
    await wNat.givenMethodReturnUint(totalSupplyAtWnat, 12345);
    await pChainStakeMirror.givenMethodReturnUint(totalSupplyAtPChain, 9876);
    let block = await time.latestBlock();
    assertNumberEqual(await combinedNat.totalSupplyAt(block.subn(1)), 12345 + 9876);
  });

  it("Should get balance of an address", async () => {
    let balanceOfWnat = web3.utils.sha3("balanceOf(address)")!.slice(0, 10);
    let balanceOfPChain = web3.utils.sha3("balanceOf(address)")!.slice(0, 10);
    await wNat.givenMethodReturnUint(balanceOfWnat, 999);
    await pChainStakeMirror.givenMethodReturnUint(balanceOfPChain, 888);
    assertNumberEqual(await combinedNat.balanceOf(accounts[123]), 999 + 888);
  });

  it("Should get balance of an address at a block", async () => {
    let balanceOfAtWnat = web3.utils.sha3("balanceOfAt(address,uint256)")!.slice(0, 10);
    let balanceOfAtPChain = web3.utils.sha3("balanceOfAt(address,uint256)")!.slice(0, 10);
    await wNat.givenMethodReturnUint(balanceOfAtWnat, 786);
    await pChainStakeMirror.givenMethodReturnUint(balanceOfAtPChain, 765432);
    assertNumberEqual(await combinedNat.balanceOfAt(accounts[123], await time.latestBlock()), 786 + 765432);
  });
});
