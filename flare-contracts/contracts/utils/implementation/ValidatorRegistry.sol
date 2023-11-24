// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import "../../userInterfaces/IPriceSubmitter.sol";
import "../../userInterfaces/IValidatorRegistry.sol";
import "../../governance/implementation/Governed.sol";
import "../../addressUpdater/implementation/AddressUpdatable.sol";


/**
 * @title Validator registry contract
 * @notice This contract is used as a mapping from data provider's address to {node id, P-Chain public key}
 * @notice In order to get the ability to become a validator, data provider must register using this contract
 * @dev Only whitelisted data provider can register
 */
contract ValidatorRegistry is IValidatorRegistry, Governed, AddressUpdatable {

    struct DataProviderInfo {
        address dataProvider;
        string nodeId;
        string pChainPublicKey;
    }

    IPriceSubmitter public priceSubmitter;

    mapping(address => string) internal dataProviderToNodeId;
    mapping(address => string) internal dataProviderToPChainPublicKey;

    mapping(bytes32 => address) internal nodeIdToDataProvider;
    mapping(bytes32 => address) internal pChainPublicKeyToDataProvider;

    constructor(
        address _governance,
        address _addressUpdater
    )
        Governed(_governance) AddressUpdatable(_addressUpdater)
    {}

    /**
     * @notice Register data provider's address as a validator - emits DataProviderRegistered event
     * @param _nodeId Data provider's node id
     * @param _pChainPublicKey Data provider's P-Chain public key
     * @dev Data provider must be whitelisted
     * @dev `_nodeId` and `_pChainPublicKey` should not be already in use by some other data provider
     */
    function registerDataProvider(string memory _nodeId, string memory _pChainPublicKey) external override {
        _registerDataProvider(msg.sender, _nodeId, _pChainPublicKey);
    }

    /**
     * @notice Unregister data provider's address as a validator - emits DataProviderUnregistered event
     */
    function unregisterDataProvider() external override {
        _unregisterDataProvider(msg.sender);
    }

    /**
     * @notice Used to change data providers
     * @param _dataProvidersToUnregister Addresses of data providers to unregister
     * @param _dataProvidersToRegister List of data providers (address, nodeId, pChainPublicKey) to register
     * @dev Only governance can call this method.
     */
    function changeDataProviders(
        address[] memory _dataProvidersToUnregister,
        DataProviderInfo[] memory _dataProvidersToRegister
    )
        external
        onlyGovernance
    {
        for (uint256 i = 0; i < _dataProvidersToUnregister.length; i++) {
            _unregisterDataProvider(_dataProvidersToUnregister[i]);
        }

        for (uint256 i = 0; i < _dataProvidersToRegister.length; i++) {
            DataProviderInfo memory info = _dataProvidersToRegister[i];
            _registerDataProvider(info.dataProvider, info.nodeId, info.pChainPublicKey);
        }
    }

    /**
     * @notice Returns data provider's node id and P-Chain public key
     * @param _dataProvider Data provider's address
     * @return _nodeId Data provider's node id
     * @return _pChainPublicKey Data provider's P-Chain public key
     */
    function getDataProviderInfo(address _dataProvider)
        external view override returns (string memory _nodeId, string memory _pChainPublicKey) {
        return (dataProviderToNodeId[_dataProvider], dataProviderToPChainPublicKey[_dataProvider]);
    }

    /**
     * @notice Returns data provider's address that was registered with given node id
     * @param _nodeId Data provider's node id hash
     * @return _dataProvider Data provider's address
     */
    function getDataProviderForNodeId(bytes32 _nodeId) 
        external view override returns (address _dataProvider) {
        return nodeIdToDataProvider[_nodeId];
    }

    /**
     * @notice Returns data provider's address that was registered with given P-Chain public key
     * @param _pChainPublicKey Data provider's P-Chain public key hash
     * @return _dataProvider Data provider's address
     */
    function getDataProviderForPChainPublicKey(bytes32 _pChainPublicKey) 
        external view override returns (address _dataProvider) {
        return pChainPublicKeyToDataProvider[_pChainPublicKey];
    }

    
    /**
     * @notice Register data provider's address as a validator - emits DataProviderRegistered event
     * @param _dataProvider Data provider's address
     * @param _nodeId Data provider's node id
     * @param _pChainPublicKey Data provider's P-Chain public key
     * @dev Data provider must be whitelisted
     * @dev `_nodeId` and `_pChainPublicKey` should not be already in use by some other data provider
     */
    function _registerDataProvider(
        address _dataProvider,
        string memory _nodeId,
        string memory _pChainPublicKey
    )
        internal
    {
        // check that data provider is whitelisted
        require(priceSubmitter.voterWhitelistBitmap(_dataProvider) > 0, "not whitelisted");

        bytes32 nodeIdHash = keccak256(abi.encode(_nodeId));
        address currentAddress = nodeIdToDataProvider[nodeIdHash];
        if (currentAddress == address(0)) {
            // delete old value, could be 0
            delete nodeIdToDataProvider[keccak256(abi.encode(dataProviderToNodeId[_dataProvider]))];
            // set new values
            dataProviderToNodeId[_dataProvider] = _nodeId;
            nodeIdToDataProvider[nodeIdHash] = _dataProvider;
        } else {
            // make sure data provider sent the same nodeId again
            require(currentAddress == _dataProvider, "nodeId already in use");
        }

        bytes32 pChainPublicKeyHash = keccak256(abi.encode(_pChainPublicKey));
        currentAddress = pChainPublicKeyToDataProvider[pChainPublicKeyHash];
        if (currentAddress == address(0)) {
            // delete old value, could be 0
            delete pChainPublicKeyToDataProvider[keccak256(abi.encode(dataProviderToPChainPublicKey[_dataProvider]))];
            // set new values
            dataProviderToPChainPublicKey[_dataProvider] = _pChainPublicKey;
            pChainPublicKeyToDataProvider[pChainPublicKeyHash] = _dataProvider;
        } else {
            // make sure data provider sent the same pChainPublicKey again
            require(currentAddress == _dataProvider, "pChainPublicKey already in use");
        }

        emit DataProviderRegistered(_dataProvider, _nodeId, _pChainPublicKey);
    }

    /**
     * @notice Unregister data provider's address as a validator - emits DataProviderUnregistered event
     * @param _dataProvider Data provider's address
     */
    function _unregisterDataProvider(address _dataProvider) internal {
        delete nodeIdToDataProvider[keccak256(abi.encode(dataProviderToNodeId[_dataProvider]))];
        delete dataProviderToNodeId[_dataProvider];
        delete pChainPublicKeyToDataProvider[keccak256(abi.encode(dataProviderToPChainPublicKey[_dataProvider]))];
        delete dataProviderToPChainPublicKey[_dataProvider];

        emit DataProviderUnregistered(_dataProvider);
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
        priceSubmitter = IPriceSubmitter(
            _getContractAddress(_contractNameHashes, _contractAddresses, "PriceSubmitter"));
    }
}
