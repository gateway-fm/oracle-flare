
import { constants, expectRevert } from '@openzeppelin/test-helpers';
import { FtsoRegistryInstance, FtsoRegistryProxyInstance, MockContractInstance } from '../../../../typechain-truffle';
import { toBN } from "../../../utils/test-helpers";

const getTestFile = require('../../../utils/constants').getTestFile;
const MockContract = artifacts.require("MockContract");
const FtsoRegistryProxy = artifacts.require("FtsoRegistryProxy");
const FtsoRegistry = artifacts.require("FtsoRegistry");

contract(`ProxyGoverned.sol; ${getTestFile(__filename)}; ProxyGoverned contract unit tests`, async accounts => {
  let mockContract: MockContractInstance;
  let ftsoRegistryProxy: FtsoRegistryProxyInstance;
  let ftsoRegistryInterface: FtsoRegistryInstance;
  const GOVERNANCE_ADDRESS = accounts[10];

  const ERR_IMPLEMENTATION_ZERO = "implementation zero"

  beforeEach(async () => {
    mockContract = await MockContract.new();
    ftsoRegistryInterface = await FtsoRegistry.new();

    // proxy contract
    ftsoRegistryProxy = await FtsoRegistryProxy.new(GOVERNANCE_ADDRESS, mockContract.address);
    expect(await ftsoRegistryProxy.implementation()).to.equals(mockContract.address);
  });

  it("Should revert if governance zero", async () => {
    // Assemble
    // Act
    const tx = FtsoRegistryProxy.new(constants.ZERO_ADDRESS, mockContract.address);
    // Assert
    await expectRevert(tx, "_governance zero");
  });

  it("Should revert if initial implementation zero", async () => {
    // Assemble
    // Act
    const tx = FtsoRegistryProxy.new(GOVERNANCE_ADDRESS, constants.ZERO_ADDRESS);
    // Assert
    await expectRevert(tx, ERR_IMPLEMENTATION_ZERO);
  });

  it("Should revert setting implementation if not from governance", async () => {
    // Assemble
    // Act
    const tx = ftsoRegistryProxy.setImplementation(mockContract.address, { from: accounts[2] });
    // Assert
    await expectRevert(tx, "only governance");
  });

  it("Should revert setting implementation to zero", async () => {
    // Assemble
    // Act
    const tx = ftsoRegistryProxy.setImplementation(constants.ZERO_ADDRESS, { from: GOVERNANCE_ADDRESS });
    // Assert
    await expectRevert(tx, ERR_IMPLEMENTATION_ZERO);
  });

  it("Should revert if call on implementation contract reverts", async() => {
    await ftsoRegistryProxy.setImplementation(ftsoRegistryInterface.address, { from: GOVERNANCE_ADDRESS });
    let registry = await FtsoRegistry.at(ftsoRegistryProxy.address);
    let initialise = registry.initialiseRegistry(constants.ZERO_ADDRESS, { from: GOVERNANCE_ADDRESS });
    await expectRevert(initialise, "_addressUpdater zero");
  });

  it("Should receive native tokens", async() => {
    let balanceBefore = await web3.eth.getBalance(ftsoRegistryProxy.address);
    expect(balanceBefore).to.equals("0");
    await web3.eth.sendTransaction({ from: accounts[0], to: ftsoRegistryProxy.address, value: 90 });
    let balanceAfter = await web3.eth.getBalance(ftsoRegistryProxy.address);
    expect(balanceAfter).to.equals("90");
  });

  it("Should revert receiving native tokens if implementation does not have receive function", async() => {
    await ftsoRegistryProxy.setImplementation(ftsoRegistryInterface.address, { from: GOVERNANCE_ADDRESS });
    let send = web3.eth.sendTransaction({ from: accounts[0], to: ftsoRegistryProxy.address, value: 90 });
    await expectRevert(send, "Transaction reverted: function selector was not recognized and there's no fallback nor receive function")
  });

  it("Should revert if sending native tokens to non-payable function", async() => {
    await ftsoRegistryProxy.setImplementation(ftsoRegistryInterface.address, { from: GOVERNANCE_ADDRESS });
    let registry = await FtsoRegistry.at(ftsoRegistryProxy.address);
    let initialise = registry.initialiseRegistry(accounts[99], { from: GOVERNANCE_ADDRESS, value: toBN(90) });
    await expectRevert(initialise, "Transaction reverted: non-payable function was called with value 90");
  });

});
