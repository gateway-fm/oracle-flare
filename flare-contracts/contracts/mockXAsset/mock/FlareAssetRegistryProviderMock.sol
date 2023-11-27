// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../../assetRegistry/interface/IIFlareAssetRegistryProvider.sol";
import "../../assetRegistry/interface/IIFlareAssetRegistry.sol";
import "../../assetRegistry/lib/StandardAttributes.sol";
import "../../assetRegistry/interface/IIERC20WithMetadata.sol";

contract FlareAssetRegistryProviderMock is IIFlareAssetRegistryProvider {
    
    bytes32 public name;
    address[] public assets;
    IIFlareAssetRegistry public assetRegistry;
    
    constructor(bytes32 _name, address[] memory _assets, IIFlareAssetRegistry _assetRegistry) {
        name = _name;
        assets = _assets;
        assetRegistry = _assetRegistry;
    }

    function assetType() external view override returns (bytes32) {
        return name;
    }

    function allAssets() external view override returns (address[] memory) {
        return assets;
    }

    function getAttribute(
        address /* _token */, bytes32 _nameHash
    ) external pure override returns (bool _defined, bytes32 _value) {
        if (_nameHash == StandardAttributes.MAX_DELEGATES_BY_PERCENT) {
            uint256 delegatesPercent = 10;
            return (true, bytes32(delegatesPercent));
        } else if (_nameHash == StandardAttributes.INCENTIVE_POOL) {
            uint256 incentivePool = 1;
            return (true, bytes32(incentivePool));
        }
        uint256 zero = 0;
        return (false, bytes32(zero));
    }

    function unregisterAsset(address asset) external {
        assetRegistry.unregisterAsset(asset);
    }

    function registerAsset(address asset) external {
        assetRegistry.registerAsset(asset);
    }
}
