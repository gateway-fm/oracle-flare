// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../interface/IIAddressUpdatable.sol";


/**
 * Abstract base class for contracts that depend on other contracts whose addresses can change.
 *
 * The `AddressUpdater` contract keeps a list of addresses for all unique and special
 * platform contracts. By inheriting from `AddressUpdatable` a contract will receive updates
 * if any of the platform contract addresses change.
 *
 * A contract's address changes when it is redeployed, so `AddressUpdatable` offers a way
 * to keep up to date with the latest address for all dependencies.
 */
abstract contract AddressUpdatable is IIAddressUpdatable {

    // https://docs.soliditylang.org/en/v0.8.7/contracts.html#constant-and-immutable-state-variables
    // No storage slot is allocated
    bytes32 internal constant ADDRESS_STORAGE_POSITION =
        keccak256("flare.diamond.AddressUpdatable.ADDRESS_STORAGE_POSITION");

    /// Only the `AdressUpdater` contract can call this method.
    /// Its address is set at construction time but it can also update itself.
    modifier onlyAddressUpdater() {
        require (msg.sender == getAddressUpdater(), "only address updater");
        _;
    }

    constructor(address _addressUpdater) {
        setAddressUpdaterValue(_addressUpdater);
    }

    /**
     * Returns the configured address updater.
     * @return _addressUpdater The `AddresUpdater` contract that can update our
     * contract address list, as a response to a governance call.
     */
    function getAddressUpdater() public view returns (address _addressUpdater) {
        // Only direct constants are allowed in inline assembly, so we assign it here
        bytes32 position = ADDRESS_STORAGE_POSITION;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            _addressUpdater := sload(position)
        }
    }

    /**
     * External method called from AddressUpdater only.
     */
    function updateContractAddresses(
        bytes32[] memory _contractNameHashes,
        address[] memory _contractAddresses
    )
        external override
        onlyAddressUpdater
    {
        // update addressUpdater address
        setAddressUpdaterValue(_getContractAddress(_contractNameHashes, _contractAddresses, "AddressUpdater"));
        // update all other addresses
        _updateContractAddresses(_contractNameHashes, _contractAddresses);
    }

    /**
     * Informs contracts extending `AddressUpdatable` that some contract addresses have changed.
     * This is a virtual method that must be implemented.
     */
    function _updateContractAddresses(
        bytes32[] memory _contractNameHashes,
        address[] memory _contractAddresses
    ) internal virtual;

    /**
     * Helper method to get a contract's address.
     * It reverts if contract name does not exist.
     */
    function _getContractAddress(
        bytes32[] memory _nameHashes,
        address[] memory _addresses,
        string memory _nameToFind
    )
        internal pure
        returns(address)
    {
        bytes32 nameHash = keccak256(abi.encode(_nameToFind));
        address a = address(0);
        for (uint256 i = 0; i < _nameHashes.length; i++) {
            if (nameHash == _nameHashes[i]) {
                a = _addresses[i];
                break;
            }
        }
        require(a != address(0), "address zero");
        return a;
    }

    function setAddressUpdaterValue(address _addressUpdater) internal {
        // Only direct constants are allowed in inline assembly, so we assign it here
        bytes32 position = ADDRESS_STORAGE_POSITION;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            sstore(position, _addressUpdater)
        }
    }
}
