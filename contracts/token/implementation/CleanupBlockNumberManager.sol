// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../../governance/implementation/Governed.sol";
import "../../addressUpdater/implementation/AddressUpdatable.sol";
import "../../token/interface/IICleanable.sol";


/**
 * @title Token history cleanup manager
 * @notice Maintains the list of cleanable tokens for which history cleanup can be collectively cleaned u 
 */
contract CleanupBlockNumberManager is Governed, AddressUpdatable {

    string internal constant ERR_CONTRACT_NOT_FOUND = "contract not found";
    string internal constant ERR_TRIGGER_CONTRACT_ONLY = "trigger contract only";

    IICleanable[] public registeredTokens;
    address public triggerContract;
    string public triggerContractName; // needed for updating trigger contract through AddressUpdater call

    event RegistrationUpdated (IICleanable theContract, bool add);
    event CleanupBlockNumberSet (IICleanable theContract, uint256 blockNumber, bool success);
        
    modifier onlyTrigger {
        require(msg.sender == triggerContract, ERR_TRIGGER_CONTRACT_ONLY);
        _;
    }

    constructor(
        address _governance,
        address _addressUpdater,
        string memory _triggerContractName
    )
        Governed(_governance) AddressUpdatable(_addressUpdater)
    {
        triggerContractName = _triggerContractName;
    }

    /**
     * @notice Register a contract of which history cleanup index is to be managed
     * @param _cleanableToken     The address of the contract to be managed.
     * @dev when using this function take care that call of setCleanupBlockNumber
     * is permitted by this object
     */
    function registerToken(IICleanable _cleanableToken) external onlyGovernance {
        uint256 len = registeredTokens.length;

        for (uint256 i = 0; i < len; i++) {
            if (_cleanableToken == registeredTokens[i]) {
                return; // already registered
            }
        }

        registeredTokens.push(_cleanableToken);
        emit RegistrationUpdated (_cleanableToken, true);
    }

    /**
     * @notice Unregiseter a contract from history cleanup index management
     * @param _cleanableToken     The address of the contract to unregister.
     */
    function unregisterToken(IICleanable _cleanableToken) external onlyGovernance {        
        uint256 len = registeredTokens.length;

        for (uint256 i = 0; i < len; i++) {
            if (_cleanableToken == registeredTokens[i]) {
                registeredTokens[i] = registeredTokens[len -1];
                registeredTokens.pop();
                emit RegistrationUpdated (_cleanableToken, false);
                return;
            }
        }

        revert(ERR_CONTRACT_NOT_FOUND);
    }

    /**
     * @notice Sets clean up block number on managed cleanable tokens
     * @param _blockNumber cleanup block number
     */
    function setCleanUpBlockNumber(uint256 _blockNumber) external onlyTrigger {
        uint256 len = registeredTokens.length;
        for (uint256 i = 0; i < len; i++) {
            try registeredTokens[i].setCleanupBlockNumber(_blockNumber) {
                emit CleanupBlockNumberSet(registeredTokens[i], _blockNumber, true);
            } catch {
                emit CleanupBlockNumberSet(registeredTokens[i], _blockNumber, false);
            }
        }
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
        triggerContract = _getContractAddress(_contractNameHashes, _contractAddresses, triggerContractName);
    }
}
