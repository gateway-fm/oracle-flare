// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;
pragma abicoder v2;

/**
 * Interface for the `FlareContractRegistry`.
 *
 * Entry point for all external dapps that need the latest contract addresses deployed by Flare.
 */
interface IFlareContractRegistry {
    /**
     * Returns the address of a given contract name.
     * @param _name Name of the contract.
     * @return Address of the contract, or `address(0)` if not found.
     */
    function getContractAddressByName(string calldata _name) external view returns(address);

    /**
     * Returns the address of a given contract hash.
     * @param _nameHash Hash of the contract name as: `keccak256(abi.encode(name))`.
     * @return Address of the contract, or `address(0)` if not found.
     */
    function getContractAddressByHash(bytes32 _nameHash) external view returns(address);

    /**
     * Returns the addresses of a list of contract names.
     * @param _names Array of contract names.
     * @return Array of addresses of the contracts.
     * Any of them might be `address(0)` if not found.
     */
    function getContractAddressesByName(string[] calldata _names) external view returns(address[] memory);

    /**
     * Returns the addresses of a list of contract hashes.
     * @param _nameHashes Array of contract name hashes as: `keccak256(abi.encode(name))`.
     * @return Array of addresses of the contracts.
     * Any of them might be `address(0)` if not found.
     */
    function getContractAddressesByHash(bytes32[] calldata _nameHashes) external view returns(address[] memory);

    /**
     * Returns all contract names and their corresponding addresses.
     * @return _names Array of contract names.
     * @return _addresses Array of corresponding contract addresses.
     */
    function getAllContracts() external view returns(string[] memory _names, address[] memory _addresses);
}
