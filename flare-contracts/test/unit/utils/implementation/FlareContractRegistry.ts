
import { constants, expectRevert } from '@openzeppelin/test-helpers';
import { AddressUpdaterInstance, FlareContractRegistryInstance } from "../../../../typechain-truffle";
import { compareArrays, encodeContractNames, encodeString } from '../../../utils/test-helpers';

const getTestFile = require('../../../utils/constants').getTestFile;
const AddressUpdater = artifacts.require("AddressUpdater");
const FlareContractRegistry = artifacts.require("FlareContractRegistry");


contract(`FlareContractRegistry.sol; ${getTestFile(__filename)}; FlareContractRegistry contract unit tests`, async accounts => {
  let addressUpdater: AddressUpdaterInstance;
  let flareContractRegistry: FlareContractRegistryInstance;
  const GOVERNANCE_ADDRESS = accounts[10];

  const ADDRESS_UPDATER_NAME = "AddressUpdater";
  const FTSO_MANAGER_NAME = "FtsoManager";
  const FTSO_MANAGER_ADDRESS = accounts[11];

  beforeEach(async() => {
    addressUpdater = await AddressUpdater.new(GOVERNANCE_ADDRESS);
    flareContractRegistry = await FlareContractRegistry.new(addressUpdater.address);
  });

  it("Should get contract address", async() => {
    // Assemble
    await addressUpdater.addOrUpdateContractNamesAndAddresses([FTSO_MANAGER_NAME], [FTSO_MANAGER_ADDRESS], { from: GOVERNANCE_ADDRESS });
    // Act
    const ftsoManagerAddress = await flareContractRegistry.getContractAddressByName(FTSO_MANAGER_NAME);
    const ftsoManagerAddress2 = await flareContractRegistry.getContractAddressByHash(encodeString(FTSO_MANAGER_NAME));
    // Assert
    assert.equal(FTSO_MANAGER_ADDRESS, ftsoManagerAddress);
    assert.equal(FTSO_MANAGER_ADDRESS, ftsoManagerAddress2);
  });

  it("Should get updated contract addresses", async() => {
    // Assemble
    await addressUpdater.addOrUpdateContractNamesAndAddresses([FTSO_MANAGER_NAME], [FTSO_MANAGER_ADDRESS], { from: GOVERNANCE_ADDRESS });
    const newFtsoManagerAddress = accounts[12];
    // Act
    await addressUpdater.addOrUpdateContractNamesAndAddresses([FTSO_MANAGER_NAME, ADDRESS_UPDATER_NAME], [newFtsoManagerAddress, addressUpdater.address], { from: GOVERNANCE_ADDRESS });
    const ftsoManagerAddress = await flareContractRegistry.getContractAddressByName(FTSO_MANAGER_NAME);
    const addressUpdaterAddress = await flareContractRegistry.getContractAddressByHash(encodeString(ADDRESS_UPDATER_NAME));
    // Assert
    assert.notEqual(FTSO_MANAGER_ADDRESS, ftsoManagerAddress);
    assert.equal(newFtsoManagerAddress, ftsoManagerAddress);
    assert.equal(addressUpdater.address, addressUpdaterAddress);
  });

  it("Should get contract addresses (bulk)", async() => {
    // Assemble
    await addressUpdater.addOrUpdateContractNamesAndAddresses([FTSO_MANAGER_NAME, ADDRESS_UPDATER_NAME], [FTSO_MANAGER_ADDRESS, addressUpdater.address], { from: GOVERNANCE_ADDRESS });
    // Act
    const addresses1 = await flareContractRegistry.getContractAddressesByName([FTSO_MANAGER_NAME, ADDRESS_UPDATER_NAME]);
    const addresses2 = await flareContractRegistry.getContractAddressesByHash([encodeString(ADDRESS_UPDATER_NAME), encodeString(FTSO_MANAGER_NAME)]);
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
    const {0: names, 1: addresses} = await flareContractRegistry.getAllContracts();
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
    const contractAddress1 = await flareContractRegistry.getContractAddressByName(ADDRESS_UPDATER_NAME);
    const contractAddress2 = await flareContractRegistry.getContractAddressByHash(encodeString(ADDRESS_UPDATER_NAME));
    const contractAddresses1 = await flareContractRegistry.getContractAddressesByName([FTSO_MANAGER_NAME, ADDRESS_UPDATER_NAME]);
    const contractAddresses2 = await flareContractRegistry.getContractAddressesByHash([encodeString(FTSO_MANAGER_NAME), encodeString(ADDRESS_UPDATER_NAME)]);
    // Assert
    assert.equal(contractAddress1, constants.ZERO_ADDRESS);
    assert.equal(contractAddress2, constants.ZERO_ADDRESS);
    assert.equal(contractAddresses1[0], FTSO_MANAGER_ADDRESS);
    assert.equal(contractAddresses1[1], constants.ZERO_ADDRESS);
    assert.equal(contractAddresses2[0], FTSO_MANAGER_ADDRESS);
    assert.equal(contractAddresses2[1], constants.ZERO_ADDRESS);
  });

  it("Should revert updating addresses if not from address updater", async() => {
    // Assemble
    // Act
    const updatePromise = flareContractRegistry.updateContractAddresses([encodeString(FTSO_MANAGER_NAME)], [FTSO_MANAGER_ADDRESS], { from: accounts[0] });
    // Assert
    await expectRevert(updatePromise, "only address updater")
  });

  it("Should update address updater ", async() => {
    // Assemble
    flareContractRegistry = await FlareContractRegistry.new(accounts[1]);
    assert.equal(await flareContractRegistry.getAddressUpdater(), accounts[1]);
    // Act
    await flareContractRegistry.updateContractAddresses([encodeString(ADDRESS_UPDATER_NAME), encodeString(FTSO_MANAGER_NAME)], [accounts[10], accounts[11]], { from: accounts[1] });
    // Assert
    assert.equal(await flareContractRegistry.getAddressUpdater(), accounts[10]);
  });
});
