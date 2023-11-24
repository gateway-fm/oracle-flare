// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import "../../userInterfaces/IFlareContractRegistry.sol";
import "../../addressUpdater/implementation/AddressUpdatable.sol";
import "../../addressUpdater/interface/IIAddressUpdater.sol";


/**
 * Flare contract registry
 * Entry point for all external dapps that need the latest contract addresses deployed by Flare
 */
contract FlareContractRegistry is IFlareContractRegistry, AddressUpdatable {

    constructor(address _addressUpdater) AddressUpdatable(_addressUpdater) {
        /* empty block */
    }

    /**
     * @notice Returns contract address for the given name - might be address(0)
     * @param _name             name of the contract
     */
    function getContractAddressByName(string calldata _name) external view override returns(address) {
        return IIAddressUpdater(getAddressUpdater()).getContractAddress(_name);
    }

    /**
     * @notice Returns contract address for the given name hash - might be address(0)
     * @param _nameHash         hash of the contract name (keccak256(abi.encode(name))
     */
    function getContractAddressByHash(bytes32 _nameHash) external view override returns(address) {
        return IIAddressUpdater(getAddressUpdater()).getContractAddressByHash(_nameHash);
    }

    /**
     * @notice Returns contract addresses for the given names - might be address(0)
     * @param _names            names of the contracts
     */
    function getContractAddressesByName(string[] calldata _names) external view override returns(address[] memory) {
        return IIAddressUpdater(getAddressUpdater()).getContractAddresses(_names);
    }

    /**
     * @notice Returns contract addresses for the given name hashes - might be address(0)
     * @param _nameHashes       hashes of the contract names (keccak256(abi.encode(name))
     */
    function getContractAddressesByHash(
        bytes32[] calldata _nameHashes
    )
        external view override returns(address[] memory)
    {
        return IIAddressUpdater(getAddressUpdater()).getContractAddressesByHash(_nameHashes);
    }

    /**
     * @notice Returns all contract names and corresponding addresses
     */
    function getAllContracts() external view override returns(string[] memory, address[] memory) {
        return IIAddressUpdater(getAddressUpdater()).getContractNamesAndAddresses();
    }

    /**
     * @notice Implementation of the AddressUpdatable abstract method.
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
