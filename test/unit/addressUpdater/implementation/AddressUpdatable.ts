
import { constants, expectRevert } from '@openzeppelin/test-helpers';
import { AddressUpdatableMockInstance } from "../../../../typechain-truffle";
import { encodeContractNames } from '../../../utils/test-helpers';

const getTestFile = require('../../../utils/constants').getTestFile;
const AddressUpdater = artifacts.require("AddressUpdater");
const AddressUpdatableMock = artifacts.require("AddressUpdatableMock");
const MockContract = artifacts.require("MockContract");


contract(`AddressUpdatable.sol; ${getTestFile(__filename)}; AddressUpdatable contract unit tests`, async accounts => {
  let addressUpdatable: AddressUpdatableMockInstance;
  const ADDRESS_UPDATER_ADDRESS = accounts[10];
  
  const ADDRESS_UPDATER_NAME = "AddressUpdater";
  const FTSO_MANAGER_NAME = "FtsoManager";
  const FTSO_MANAGER_ADDRESS = accounts[11];

  beforeEach(async() => {
    addressUpdatable = await AddressUpdatableMock.new(ADDRESS_UPDATER_ADDRESS);
  });

  it("Should know about address updater contract", async() => {
    // Assemble
    // Act
    const addressUpdaterAddress = await addressUpdatable.getAddressUpdater();
    // Assert
    assert.equal(ADDRESS_UPDATER_ADDRESS, addressUpdaterAddress);
  });

  it("Should update addresses on addressUpdatable contract", async() => {
    // Assemble
    const newAddressUpdaterAddress = accounts[12];
    // Act
    await addressUpdatable.updateContractAddresses(
      encodeContractNames([FTSO_MANAGER_NAME, ADDRESS_UPDATER_NAME]), 
      [FTSO_MANAGER_ADDRESS, newAddressUpdaterAddress], { from: ADDRESS_UPDATER_ADDRESS });
    // Assert
    const {0: nameHashes, 1: addresses} = await addressUpdatable.getContractNameHashesAndAddresses();
    assert.notEqual(ADDRESS_UPDATER_ADDRESS, newAddressUpdaterAddress);
    assert.equal(nameHashes[0], encodeContractNames([FTSO_MANAGER_NAME])[0]);
    assert.equal(nameHashes[1], encodeContractNames([ADDRESS_UPDATER_NAME])[0]);
    assert.equal(addresses[0], FTSO_MANAGER_ADDRESS);
    assert.equal(addresses[1], newAddressUpdaterAddress);
    assert.equal(await addressUpdatable.getAddressUpdater(), newAddressUpdaterAddress);
  });

  it("Should revert updating addresses if not from address updater", async() => {
    // Assemble
    // Act
    const updatePromise = addressUpdatable.updateContractAddresses(
      encodeContractNames([FTSO_MANAGER_NAME, ADDRESS_UPDATER_NAME]), 
    [FTSO_MANAGER_ADDRESS, ADDRESS_UPDATER_ADDRESS], { from: accounts[0] });
    // Assert
    await expectRevert(updatePromise, "only address updater")
  });

  it("Should revert updating addresses if address is missing", async() => {
    // Assemble
    // Act
    const updatePromise = addressUpdatable.updateContractAddresses(
      encodeContractNames([FTSO_MANAGER_NAME]), 
    [FTSO_MANAGER_ADDRESS], { from: ADDRESS_UPDATER_ADDRESS });
    // Assert
    await expectRevert(updatePromise, "address zero")
  });
  
});
