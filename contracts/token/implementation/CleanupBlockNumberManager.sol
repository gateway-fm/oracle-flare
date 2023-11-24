// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../../governance/implementation/Governed.sol";
import "../../addressUpdater/implementation/AddressUpdatable.sol";
import "../../token/interface/IICleanable.sol";


/**
 * Token history cleanup manager.
 *
 * Maintains the list of cleanable tokens for which history cleanup can be collectively executed.
 */
contract CleanupBlockNumberManager is Governed, AddressUpdatable {

    string internal constant ERR_CONTRACT_NOT_FOUND = "contract not found";
    string internal constant ERR_TRIGGER_CONTRACT_ONLY = "trigger contract only";

    /// Current list of token contracts being managed.
    IICleanable[] public registeredTokens;
    /// Address of the contract that can trigger a cleanup.
    address public triggerContract;
    /// Name of the contract that can trigger a cleanup.
    /// Needed to update the trigger contract address through the `AddressUpdater`.
    string public triggerContractName;

    /**
     * Emitted when a new token has been registered to have its history managed by us, or
     * an old one unregistered.
     * @param theContract The token contract address.
     * @param add **true** is the token has been registered, **false** if unregistered.
     */
    event RegistrationUpdated (IICleanable theContract, bool add);

    /**
     * Emitted when an attempt has been made to set the cleanup block number.
     * @param theContract The token contract address.
     * @param blockNumber The block number being set.
     * @param success Whether it succeeded or not.
     */
    event CleanupBlockNumberSet (IICleanable theContract, uint256 blockNumber, bool success);

    /// Only the trigger contract can call this method.
    /// This contract is set at construction time and updated through `AddressUpdatable`.
    modifier onlyTrigger {
        require(msg.sender == triggerContract, ERR_TRIGGER_CONTRACT_ONLY);
        _;
    }

    /**
     * Build a new instance.
     * @param   _governance Contract address that can make governance calls. See `Governed`.
     * @param   _addressUpdater Contract address that can update redeployable addresses. See `AdressUpdatable`.
     * @param   _triggerContractName Contract name that can trigger history cleanups.
     */
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
     * Register a token contract whose history cleanup index is to be managed.
     * The registered contracts must allow calling `setCleanupBlockNumber`.
     * @param _cleanableToken The address of the contract to be managed.
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
     * Unregister a token contract from history cleanup index management.
     * @param _cleanableToken The address of the contract to unregister.
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
     * Sets clean up block number on managed cleanable tokens.
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
     * Implementation of the AddressUpdatable abstract method.
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
