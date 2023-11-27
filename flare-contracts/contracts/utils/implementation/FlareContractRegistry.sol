// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import "../../userInterfaces/IFlareContractRegistry.sol";
import "../../addressUpdater/implementation/AddressUpdatable.sol";
import "../../addressUpdater/interface/IIAddressUpdater.sol";


/**
 * The Flare contract registry.
 *
 * Entry point for all external dapps that need the latest contract addresses deployed by Flare.
 */
contract FlareContractRegistry is IFlareContractRegistry, AddressUpdatable {

    constructor(address _addressUpdater) AddressUpdatable(_addressUpdater) {
        /* empty block */
    }

    /**
     * @inheritdoc IFlareContractRegistry
     */
    function getContractAddressByName(string calldata _name) external view override returns(address) {
        return IIAddressUpdater(getAddressUpdater()).getContractAddress(_name);
    }

    /**
     * @inheritdoc IFlareContractRegistry
     */
    function getContractAddressByHash(bytes32 _nameHash) external view override returns(address) {
        return IIAddressUpdater(getAddressUpdater()).getContractAddressByHash(_nameHash);
    }

    /**
     * @inheritdoc IFlareContractRegistry
     */
    function getContractAddressesByName(string[] calldata _names) external view override returns(address[] memory) {
        return IIAddressUpdater(getAddressUpdater()).getContractAddresses(_names);
    }

    /**
     * @inheritdoc IFlareContractRegistry
     */
    function getContractAddressesByHash(
        bytes32[] calldata _nameHashes
    )
        external view override returns(address[] memory)
    {
        return IIAddressUpdater(getAddressUpdater()).getContractAddressesByHash(_nameHashes);
    }

    /**
     * @inheritdoc IFlareContractRegistry
     */
    function getAllContracts() external view override returns(string[] memory _names, address[] memory _addresses) {
        return IIAddressUpdater(getAddressUpdater()).getContractNamesAndAddresses();
    }

    /**
     * Implementation of the AddressUpdatable abstract method.
     */
    function _updateContractAddresses(
        bytes32[] memory _contractNameHashes,
        address[] memory _contractAddresses
    )
        internal override
    {
        /* empty block */
    }
}
