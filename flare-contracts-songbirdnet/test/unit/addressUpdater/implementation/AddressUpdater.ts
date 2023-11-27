
import { constants, expectRevert } from '@openzeppelin/test-helpers';
import { AddressUpdaterInstance } from "../../../../typechain-truffle";
import { compareArrays, encodeContractNames, encodeString } from '../../../utils/test-helpers';

const getTestFile = require('../../../utils/constants').getTestFile;
const AddressUpdater = artifacts.require("AddressUpdater");
const AddressUpdatableMock = artifacts.require("AddressUpdatableMock");
const MockContract = artifacts.require("MockContract");


contract(`AddressUpdater.sol; ${getTestFile(__filename)}; AddressUpdater contract unit tests`, async accounts => {
  let addressUpdater: AddressUpdaterInstance;
  const GOVERNANCE_ADDRESS = accounts[10];
  
  const ADDRESS_UPDATER_NAME = "AddressUpdater";
  const FTSO_MANAGER_NAME = "FtsoManager";
  const FTSO_MANAGER_ADDRESS = accounts[11];

  beforeEach(async() => {
    addressUpdater = await AddressUpdater.new(GOVERNANCE_ADDRESS);
  });

  it("Should know about governance", async() => {
    // Assemble
    // Act
    const governance = await addressUpdater.governance();
    // Assert
    assert.equal(GOVERNANCE_ADDRESS, governance);
  });

  it("Should add new contract address", async() => {
    // Assemble
    // Act
    await addressUpdater.addOrUpdateContractNamesAndAddresses([FTSO_MANAGER_NAME], [FTSO_MANAGER_ADDRESS], { from: GOVERNANCE_ADDRESS });
    const ftsoManagerAddress = await addressUpdater.getContractAddress(FTSO_MANAGER_NAME);
    const ftsoManagerAddress2 = await addressUpdater.getContractAddressByHash(encodeString(FTSO_MANAGER_NAME));
    // Assert
    assert.equal(FTSO_MANAGER_ADDRESS, ftsoManagerAddress);
    assert.equal(FTSO_MANAGER_ADDRESS, ftsoManagerAddress2);
  });

  it("Should add and update contract addresses", async() => {
    // Assemble
    await addressUpdater.addOrUpdateContractNamesAndAddresses([FTSO_MANAGER_NAME], [FTSO_MANAGER_ADDRESS], { from: GOVERNANCE_ADDRESS });
    const newFtsoManagerAddress = accounts[12];
    // Act
    await addressUpdater.addOrUpdateContractNamesAndAddresses([FTSO_MANAGER_NAME, ADDRESS_UPDATER_NAME], [newFtsoManagerAddress, addressUpdater.address], { from: GOVERNANCE_ADDRESS });
    const ftsoManagerAddress = await addressUpdater.getContractAddress(FTSO_MANAGER_NAME);
    const addressUpdaterAddress = await addressUpdater.getContractAddress(ADDRESS_UPDATER_NAME);
    // Assert
    assert.notEqual(FTSO_MANAGER_ADDRESS, ftsoManagerAddress);
    assert.equal(addressUpdater.address, addressUpdaterAddress);
  });

  it("Should get contract addresses (bulk)", async() => {
    // Assemble
    await addressUpdater.addOrUpdateContractNamesAndAddresses([FTSO_MANAGER_NAME, ADDRESS_UPDATER_NAME], [FTSO_MANAGER_ADDRESS, addressUpdater.address], { from: GOVERNANCE_ADDRESS });
    // Act
    const addresses1 = await addressUpdater.getContractAddresses([FTSO_MANAGER_NAME, ADDRESS_UPDATER_NAME]);
    const addresses2 = await addressUpdater.getContractAddressesByHash([encodeString(ADDRESS_UPDATER_NAME), encodeString(FTSO_MANAGER_NAME)]);
    // Assert
    assert.equal(addresses1[0], FTSO_MANAGER_ADDRESS);
    assert.equal(addresses1[1], addressUpdater.address);
    assert.equal(addresses2[0], addressUpdater.address);
    assert.equal(addresses2[1], FTSO_MANAGER_ADDRESS);
  });

  it("Should get contract names and addresses", async() => {
    // Assemble
    await addressUpdater.addOrUpdateContractNamesAndAddresses([FTSO_MANAGER_NAME, ADDRESS_UPDATER_NAME], [FTSO_MANAGER_ADDRESS, addressUpdater.address], { from: GOVERNANCE_ADDRESS });
    // Act
    const {0: names, 1: addresses} = await addressUpdater.getContractNamesAndAddresses();
    // Assert
    assert.equal(names[0], FTSO_MANAGER_NAME);
    assert.equal(names[1], ADDRESS_UPDATER_NAME);
    assert.equal(addresses[0], FTSO_MANAGER_ADDRESS);
    assert.equal(addresses[1], addressUpdater.address);
  });

  it("Should return address(0) if contract is unknown", async() => {
    // Assemble
    await addressUpdater.addOrUpdateContractNamesAndAddresses([FTSO_MANAGER_NAME], [FTSO_MANAGER_ADDRESS], { from: GOVERNANCE_ADDRESS });
    // Act
    const contractAddress1 = await addressUpdater.getContractAddress(ADDRESS_UPDATER_NAME);
    const contractAddress2 = await addressUpdater.getContractAddressByHash(encodeString(ADDRESS_UPDATER_NAME));
    const contractAddresses1 = await addressUpdater.getContractAddresses([FTSO_MANAGER_NAME, ADDRESS_UPDATER_NAME]);
    const contractAddresses2 = await addressUpdater.getContractAddressesByHash([encodeString(FTSO_MANAGER_NAME), encodeString(ADDRESS_UPDATER_NAME)]);
    // Assert
    assert.equal(contractAddress1, constants.ZERO_ADDRESS);
    assert.equal(contractAddress2, constants.ZERO_ADDRESS);
    assert.equal(contractAddresses1[0], FTSO_MANAGER_ADDRESS);
    assert.equal(contractAddresses1[1], constants.ZERO_ADDRESS);
    assert.equal(contractAddresses2[0], FTSO_MANAGER_ADDRESS);
    assert.equal(contractAddresses2[1], constants.ZERO_ADDRESS);
  });

  it("Should revert setting addresses if invalid parameters are sent", async() => {
    // Assemble
    // Act
    const updatePromise = addressUpdater.addOrUpdateContractNamesAndAddresses([FTSO_MANAGER_NAME, ADDRESS_UPDATER_NAME], [FTSO_MANAGER_ADDRESS], { from: GOVERNANCE_ADDRESS });
    // Assert
    await expectRevert(updatePromise, "array lengths do not match")
  });

  it("Should revert setting addresses if address(0) is sent", async() => {
    // Assemble
    // Act
    const updatePromise = addressUpdater.addOrUpdateContractNamesAndAddresses([FTSO_MANAGER_NAME, ADDRESS_UPDATER_NAME], [FTSO_MANAGER_ADDRESS, constants.ZERO_ADDRESS], { from: GOVERNANCE_ADDRESS });
    // Assert
    await expectRevert(updatePromise, "address zero")
  });

  it("Should revert setting addresses if not from governance", async() => {
    // Assemble
    // Act
    const updatePromise = addressUpdater.addOrUpdateContractNamesAndAddresses([FTSO_MANAGER_NAME], [FTSO_MANAGER_ADDRESS], { from: accounts[0] });
    // Assert
    await expectRevert(updatePromise, "only governance")
  });

  it("Should update addresses on addressUpdatable contract", async() => {
    // Assemble
    const addressUpdatable = await MockContract.new();
    const addressUpdatableInterface = await AddressUpdatableMock.new(addressUpdater.address);
    await addressUpdater.addOrUpdateContractNamesAndAddresses([FTSO_MANAGER_NAME, ADDRESS_UPDATER_NAME], [FTSO_MANAGER_ADDRESS, addressUpdater.address], { from: GOVERNANCE_ADDRESS });
    // Act
    await addressUpdater.updateContractAddresses([addressUpdatable.address], { from: GOVERNANCE_ADDRESS });
    // Assert
    const updateContractAddresses = addressUpdatableInterface.contract.methods.updateContractAddresses(
      encodeContractNames([FTSO_MANAGER_NAME, ADDRESS_UPDATER_NAME]), 
      [FTSO_MANAGER_ADDRESS, addressUpdater.address]).encodeABI();
    const invocationCount = await addressUpdatable.invocationCountForCalldata.call(updateContractAddresses);
    assert.equal(invocationCount.toNumber(), 1);
  });

  it("Should revert updating addresses if not from governance", async() => {
    // Assemble
    const addressUpdatable = await MockContract.new();
    // Act
    const updatePromise = addressUpdater.updateContractAddresses([addressUpdatable.address], { from: accounts[0] });
    // Assert
    await expectRevert(updatePromise, "only governance")
  });

  it("Should update addresses on addressUpdatable contract using update method", async() => {
    // Assemble
    const addressUpdatable = await MockContract.new();
    const addressUpdatableInterface = await AddressUpdatableMock.new(addressUpdater.address);
    await addressUpdater.update([FTSO_MANAGER_NAME, ADDRESS_UPDATER_NAME], [FTSO_MANAGER_ADDRESS, addressUpdater.address], [addressUpdatable.address], { from: GOVERNANCE_ADDRESS });
    // Assert
    const updateContractAddresses = addressUpdatableInterface.contract.methods.updateContractAddresses(
      encodeContractNames([FTSO_MANAGER_NAME, ADDRESS_UPDATER_NAME]), 
      [FTSO_MANAGER_ADDRESS, addressUpdater.address]).encodeABI();
    const invocationCount = await addressUpdatable.invocationCountForCalldata.call(updateContractAddresses);
    assert.equal(invocationCount.toNumber(), 1);
  });

  it("Should revert calling update if not from governance", async() => {
    // Assemble
    const addressUpdatable = await MockContract.new();
    // Act
    const updatePromise = addressUpdater.update([FTSO_MANAGER_NAME, ADDRESS_UPDATER_NAME], [FTSO_MANAGER_ADDRESS, addressUpdater.address], [addressUpdatable.address], { from: accounts[0] });
    // Assert
    await expectRevert(updatePromise, "only governance")
  });

  it("Should remove contract addresses", async() => {
    // Assemble
    await addressUpdater.addOrUpdateContractNamesAndAddresses(["address1", "address2", "address3", "address4", "address5"], [accounts[1], accounts[2], accounts[3], accounts[4], accounts[5]], { from: GOVERNANCE_ADDRESS });
    // Act
    await addressUpdater.removeContracts(["address3", "address1"], { from: GOVERNANCE_ADDRESS });
    // Assert
    assert.equal(await addressUpdater.getContractAddress("address2"), accounts[2]);
    assert.equal(await addressUpdater.getContractAddress("address4"), accounts[4]);
    assert.equal(await addressUpdater.getContractAddress("address5"), accounts[5]);
    assert.equal(await addressUpdater.getContractAddress("address1"), constants.ZERO_ADDRESS);
    assert.equal(await addressUpdater.getContractAddress("address3"), constants.ZERO_ADDRESS);
    const data = await addressUpdater.getContractNamesAndAddresses();
    compareArrays(data[0], ["address4", "address2", "address5"]);
    compareArrays(data[1], [accounts[4], accounts[2], accounts[5]]);
  });

  it("Should remove all contract addresses", async() => {
    // Assemble
    await addressUpdater.addOrUpdateContractNamesAndAddresses(["address1", "address2", "address3", "address4", "address5"], [accounts[1], accounts[2], accounts[3], accounts[4], accounts[5]], { from: GOVERNANCE_ADDRESS });
    // Act
    await addressUpdater.removeContracts(["address3", "address1", "address2", "address4", "address5"], { from: GOVERNANCE_ADDRESS });
    // Assert
    assert.equal(await addressUpdater.getContractAddress("address1"), constants.ZERO_ADDRESS);
    assert.equal(await addressUpdater.getContractAddress("address2"), constants.ZERO_ADDRESS);
    assert.equal(await addressUpdater.getContractAddress("address3"), constants.ZERO_ADDRESS);
    assert.equal(await addressUpdater.getContractAddress("address4"), constants.ZERO_ADDRESS);
    assert.equal(await addressUpdater.getContractAddress("address5"), constants.ZERO_ADDRESS);
    const data = await addressUpdater.getContractNamesAndAddresses();
    compareArrays(data[0], []);
    compareArrays(data[1], []);
  });

  it("Should revert calling remove if not from governance", async() => {
    // Assemble
    // Act
    const removePromise = addressUpdater.removeContracts([FTSO_MANAGER_NAME, ADDRESS_UPDATER_NAME], { from: accounts[0] });
    // Assert
    await expectRevert(removePromise, "only governance")
  });

  it("Should revert calling remove if wrong contract name", async() => {
    // Assemble
    // Act
    const removePromise = addressUpdater.removeContracts([FTSO_MANAGER_NAME, ADDRESS_UPDATER_NAME], { from: GOVERNANCE_ADDRESS });
    // Assert
    await expectRevert(removePromise, "address zero")
  });
  
});
