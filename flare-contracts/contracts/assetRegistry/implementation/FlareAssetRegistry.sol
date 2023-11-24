// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import "../../utils/implementation/AddressSet.sol";
import "../../governance/implementation/Governed.sol";
import "../interface/IIFlareAssetRegistry.sol";
import "../interface/IIFlareAssetRegistryProvider.sol";
import "../interface/IIERC20WithMetadata.sol";
import "../lib/StandardAttributes.sol";


contract FlareAssetRegistry is Governed, IIFlareAssetRegistry {
    using AddressSet for AddressSet.State;
    
    struct ProviderInfo {
        uint128 assetCount;
        bool registered;
    }
    
    AddressSet.State private registeredAssets;
    mapping(address => ProviderInfo) private providers;
    mapping(string => address) private symbolToAsset;
    mapping(address => address) private assetToProvider;
    bytes32[] private assetTypeList;
    mapping(bytes32 => address) private typeToProvider;
    
    modifier onlyProvider {
        require(providers[msg.sender].registered, "only provider");
        _;
    }

    constructor(address _governance)
        Governed(_governance)
    {
    }

    /**
     * Allows a provider contract to register assets.
     * @param _provider address of the provider (a contract implementing IIFlareAssetRegistryProvider)
     * @param _registerAssets if true, all the assets held by the provider are immediately registered;
     *   should usually be true, but can be false to avoid unbounded work in some cases
     */
    function registerProvider(address _provider, bool _registerAssets) external override onlyGovernance {
        if (providers[_provider].registered) return;    // already registered
        providers[_provider] = ProviderInfo(0, true);
        _registerAssetType(_provider);
        if (_registerAssets) {
            _registerProviderAssets(_provider);
        }
    }
    
    /**
     * Remove the provider contract from known providers (e.g. when a new version of the provider is deployed, the
     * old one will be removed).
     * @param _provider address of the provider (a contract implementing IIFlareAssetRegistryProvider)
     * @param _unregisterAssets if true, all the assets belonging to the provider are automatically unregistered;
     *   should usually be true, but can be false to avoid unbounded work in some cases - in this case,
     *   all the assets must be unregistered before calling this method
     */
    function unregisterProvider(address _provider, bool _unregisterAssets) external override onlyGovernance {
        if (!providers[_provider].registered) return;   // not registered
        if (_unregisterAssets) {
            _unregisterProviderAssets(_provider);
        } else {
            // must unregister all assets in some other way before unregistering provider
            // this may be necessary to avoid unbounded work in this method
            require(providers[_provider].assetCount == 0,
                "has registered assets");
        }
        delete providers[_provider];
        _unregisterAssetType(_provider);
    }
    
    /**
     * Unregisters and re-registers all the assets belonging to the given provider.
     * @param _provider address of the provider (a contract implementing IIFlareAssetRegistryProvider)
     */
    function refreshProviderAssets(address _provider) external override onlyImmediateGovernance {
        require(providers[_provider].registered,
            "unknown provider");
        _unregisterProviderAssets(_provider);
        providers[_provider].assetCount = 0;
        _registerProviderAssets(_provider);
    }
    
    /**
     * Register a new asset.
     * @param _token address of the asset (a contract implementing IERC20 interface with implemented symbol())
     * @dev Can only be called by a registered provider.
     */
    function registerAsset(address _token) external override onlyProvider {
        _registerAsset(msg.sender, _token);
    }
    
    /**
     * Unregister an asset.
     * @param _token address of the asset (a contract implementing IERC20 interface with implemented symbol())
     * @dev Can only be called by the provider which registered the token.
     */
    function unregisterAsset(address _token) external override { // implied "onlyProvider"
        if (assetToProvider[_token] == address(0)) return;  // not registered
        // implies "onlyProvider" because we check that _token was registered by msg.sender
        require(assetToProvider[_token] == msg.sender,
            "registered by other provider");
        _unregisterAsset(msg.sender, _token);
    }
    
    /**
     * @notice Returns if the token is a Flare Asset
     * @dev All other methods that accept token address will fail if this method returns false
     * @param _token The token to be checked
     */
    function isFlareAsset(address _token) external view override returns (bool) {
        return assetToProvider[_token] != address(0);
    }
    
    /**
     * Return the asset type of the token. Asset type is a hash uniquely identifying the asset type.
     * For example, for wrapped native token, the type is `keccak256("wrapped native")`,
     * and for all f-assets the type will be `keccak256("f-asset")`.
     */
    function assetType(address _token) external view override returns (bytes32) {
        address provider = assetToProvider[_token];
        if (provider == address(0)) return 0;
        return IIFlareAssetRegistryProvider(provider).assetType();
    }

     /**
     * @notice Returns the address of the Flare Asset with the selected symbol
     * @param _symbol The token's symbol
     */
    function assetBySymbol(string calldata _symbol) external view override returns (address) {
        return symbolToAsset[_symbol];
    }

    /**
     * @notice Returns if the Flare Asset supports delegation via IVPToken interface
     * @param _token The token to be checked
     */
    function supportsFtsoDelegation(address _token) external view override returns (bool) {
        (bool support,) = getAttribute(_token, StandardAttributes.MAX_DELEGATES_BY_PERCENT);
        return support;
    }

    /**
     * @notice Returns the maximum allowed number of delegates by percent for the selected token
     * @param _token The token to be checked
     */
    function maxDelegatesByPercent(address _token) external view override returns (uint256) {
        (bool support, bytes32 value) = getAttribute(_token, StandardAttributes.MAX_DELEGATES_BY_PERCENT);
        return support ? uint256(value) : 0;
    }

    /**
     * @notice Returns the incentive pool address for the selected token
     * @param _token The token to be checked
     */
    function incentivePoolFor(address _token) external view override returns (address) {
        (bool support, bytes32 value) = getAttribute(_token, StandardAttributes.INCENTIVE_POOL);
        return support ? address(uint160(uint256(value))) : address(0);
    }

    /**
     * @notice Returns the addresses of all Flare Assets
     */
    function allAssets() external view override returns (address[] memory) {
        return registeredAssets.list;
    }

    /**
     * @notice Returns the addresses and associated symbols of all Flare Assets
     */
    function allAssetsWithSymbols() external view override returns (address[] memory, string[] memory) {
        address[] memory addresses = registeredAssets.list;
        return (addresses, _assetSymbols(addresses));
    }

    /**
     * @notice Returns all asset types.
     */
    function allAssetTypes() external view override returns (bytes32[] memory) {
        return assetTypeList;
    }
    
    /**
     * @notice Returns the addresses of all Flare Assets of given type.
     * @param _assetType a type hash, all returned assets will have this assetType
     */
    function allAssetsOfType(bytes32 _assetType) external view override returns (address[] memory) {
        return _allAssetsOfType(_assetType);
    }
    
    /**
     * @notice Returns the addresses and associated symbols of all Flare Assets of given type.
     * @param _assetType a type hash, all returned assets will have this assetType
     */
    function allAssetsOfTypeWithSymbols(bytes32 _assetType) 
        external view override 
        returns (address[] memory, string[] memory)
    {
        address[] memory addresses = _allAssetsOfType(_assetType);
        return (addresses, _assetSymbols(addresses));
    }
    
     /**
     * @notice Returns a generic asset attribute value.
     * @param _token The token's address
     * @param _nameHash attributes name's hash
     * @return _defined true if the attribute is defined for this token
     * @return _value attribute value, may have to be cast into some other type
     */
    function getAttribute(address _token, bytes32 _nameHash) 
        public view override 
        returns (bool _defined, bytes32 _value)
    {
        IIFlareAssetRegistryProvider provider = IIFlareAssetRegistryProvider(assetToProvider[_token]);
        require(address(provider) != address(0), "invalid token address");
        return provider.getAttribute(_token, _nameHash);
    }

    function _registerAssetType(address _provider) private {
        bytes32 providerAssetType = IIFlareAssetRegistryProvider(_provider).assetType();
        require(typeToProvider[providerAssetType] == address(0),
            "asset type already registered");
        typeToProvider[providerAssetType] = _provider;
        assetTypeList.push(providerAssetType);
    }

    function _unregisterAssetType(address _provider) private {
        bytes32 providerAssetType = IIFlareAssetRegistryProvider(_provider).assetType();
        delete typeToProvider[providerAssetType];
        uint256 length = assetTypeList.length;
        for (uint i = 0; i < length; i++) {
            if (assetTypeList[i] == providerAssetType) {
                if (i < length - 1) {   // length must be > 0, otherwise this loop does nothing
                    assetTypeList[i] = assetTypeList[length - 1];
                }
                assetTypeList.pop();
                break;
            }
        }
    }
    
    function _registerProviderAssets(address _provider) private {
        address[] memory assets = IIFlareAssetRegistryProvider(_provider).allAssets();
        for (uint256 i = 0; i < assets.length; i++) {
            _registerAsset(_provider, assets[i]);
        }
    }
    
    function _unregisterProviderAssets(address _provider) private {
        uint256 length = registeredAssets.list.length;
        for (uint256 i = length; i > 0; i--) {
            address token = registeredAssets.list[i-1];
            if (assetToProvider[token] == _provider) {
                _unregisterAsset(_provider, token);
            }
        }
    }
    
    function _registerAsset(address _provider, address _token) private {
        if (assetToProvider[_token] == _provider) return;  // already added
        require(assetToProvider[_token] == address(0), 
            "registered by other provider");
        string memory symbol = IIERC20WithMetadata(_token).symbol();
        require(symbolToAsset[symbol] == address(0),
            "symbol already used");
        registeredAssets.add(_token);
        symbolToAsset[symbol] = _token;
        assetToProvider[_token] = _provider;
        providers[_provider].assetCount += 1;   // safe - cannot overflow uint128 just by increasing by 1
    }
    
    function _unregisterAsset(address _provider, address _token) private {
        string memory symbol = IIERC20WithMetadata(_token).symbol();
        registeredAssets.remove(_token);
        delete symbolToAsset[symbol];
        delete assetToProvider[_token];
        providers[_provider].assetCount -= 1;  // safe - must be > 0 if there are still assets
    }

    function _allAssetsOfType(bytes32 _assetType) private view returns (address[] memory) {
        address provider = typeToProvider[_assetType];
        require(provider != address(0), "invalid asset type");
        return IIFlareAssetRegistryProvider(provider).allAssets();
    }

    function _assetSymbols(address[] memory _addresses) private view returns (string[] memory) {
        string[] memory symbols = new string[](_addresses.length);
        for (uint256 i = 0; i < _addresses.length; i++) {
            symbols[i] = IIERC20WithMetadata(_addresses[i]).symbol();
        }
        return symbols;
    }
}
