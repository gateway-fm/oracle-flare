// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import "../../addressUpdater/implementation/AddressUpdatable.sol";
import "../../addressUpdater/implementation/AddressUpdater.sol";
import "../interface/IIFlareAssetRegistry.sol";
import "../interface/IIFlareAssetRegistryProvider.sol";
import "../lib/StandardAttributes.sol";


contract WNatRegistryProvider is AddressUpdatable, IIFlareAssetRegistryProvider {
    bytes32 internal constant ASSET_TYPE_WNAT = keccak256("wrapped native");
    
    IIFlareAssetRegistry private registry;
    address private wnat;
    
    constructor(address _addressUpdater, IIFlareAssetRegistry _registry)
        AddressUpdatable(_addressUpdater)
    {
        registry = _registry;
        wnat = AddressUpdater(_addressUpdater).getContractAddress("WNat");
    }
    
    /**
     * Returns a unique hash identifying this provider and its assets.
     */
    function assetType() external pure override returns (bytes32) {
        return ASSET_TYPE_WNAT;
    }
    
    /**
     * @notice Returns the addresses of all Flare Assets
     */
    function allAssets() external view override returns (address[] memory) {
        address[] memory list = new address[](1);
        list[0] = wnat;
        return list;
    }

     /**
     * @notice Returns a generic asset attribute value.
     * @param _token The token's address
     * @param _nameHash attributes name's hash
     * @return _defined true if the attribute is defined for this token
     * @return _value attribute value, may have to be cast into some other type
     */
    function getAttribute(address _token, bytes32 _nameHash) 
        external view override 
        returns (bool _defined, bytes32 _value)
    {
        require(_token == wnat, "invalid token");
        if (_nameHash == StandardAttributes.MAX_DELEGATES_BY_PERCENT) {
            return (true, bytes32(uint256(2)));
        }
        if (_nameHash == StandardAttributes.INCENTIVE_POOL) {
            return (true, bytes32(uint256(address(0))));
        }
        return (false, 0);
    }

    // override AddressUpdatable method
    function _updateContractAddresses(
        bytes32[] memory _contractNameHashes,
        address[] memory _contractAddresses
    ) 
        internal override
    {
        address newWNat = _getContractAddress(_contractNameHashes, _contractAddresses, "WNat");
        if (newWNat != wnat) {
            registry.unregisterAsset(wnat);
            registry.registerAsset(newWNat);
            wnat = newWNat;
        }
    }
}
