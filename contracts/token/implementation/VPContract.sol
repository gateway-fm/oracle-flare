// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "../../governance/implementation/GovernedBase.sol";
import "./Delegatable.sol";
import "../interface/IIVPContract.sol";
import "../interface/IIVPToken.sol";
import "../../userInterfaces/IVPToken.sol";

contract VPContract is IIVPContract, Delegatable {
    using SafeMath for uint256;
    
    /**
     * The VPToken (or some other contract) that owns this VPContract.
     * All state changing methods may be called only from this address.
     * This is because original msg.sender is sent in `_from` parameter
     * and we must be sure that it cannot be faked by directly calling VPContract.
     * Owner token is also used in case of replacement to recover vote powers from balances.
     */
    IVPToken public immutable override ownerToken;
    
    /**
     * Return true if this IIVPContract is configured to be used as a replacement for other contract.
     * It means that vote powers are not necessarily correct at the initialization, therefore
     * every method that reads vote power must check whether it is initialized for that address and block.
     */
    bool public immutable override isReplacement;

    // The block number when vote power for an address was first set.
    // Reading vote power before this block would return incorrect result and must revert.
    mapping (address => uint256) private votePowerInitializationBlock;

    // Vote power cache for past blocks when vote power was not initialized.
    // Reading vote power at that block would return incorrect result, so cache must be set by some other means.
    // No need for revocation info, since there can be no delegations at such block.
    mapping (bytes32 => uint256) private uninitializedVotePowerCache;
    
    string constant private ALREADY_EXPLICIT_MSG = "Already delegated explicitly";
    string constant private ALREADY_PERCENT_MSG = "Already delegated by percentage";
    
    string constant internal VOTE_POWER_NOT_INITIALIZED = "Vote power not initialized";

    /**
     * All external methods in VPContract can only be executed by the owner token.
     */
    modifier onlyOwnerToken {
        require(msg.sender == address(ownerToken), "only owner token");
        _;
    }

    modifier onlyPercent(address sender) {
        // If a delegate cannot be added by percentage, revert.
        require(_canDelegateByPct(sender), ALREADY_EXPLICIT_MSG);
        _;
    }

    modifier onlyExplicit(address sender) {
        // If a delegate cannot be added by explicit amount, revert.
        require(_canDelegateByAmount(sender), ALREADY_PERCENT_MSG);
        _;
    }

    /**
     * Construct VPContract for given VPToken.
     */
    constructor(IVPToken _ownerToken, bool _isReplacement) {
        require(address(_ownerToken) != address(0), "VPContract must belong to a VPToken");
        ownerToken = _ownerToken;
        isReplacement = _isReplacement;
    }
    
    /**
     * Set the cleanup block number.
     * Historic data for the blocks before `cleanupBlockNumber` can be erased,
     * history before that block should never be used since it can be inconsistent.
     * In particular, cleanup block number must be before current vote power block.
     * The method can be called only by the owner token.
     * @param _blockNumber The new cleanup block number.
     */
    function setCleanupBlockNumber(uint256 _blockNumber) external override onlyOwnerToken {
        _setCleanupBlockNumber(_blockNumber);
    }

    /**
     * Set the contract that is allowed to call history cleaning methods.
     * The method can be called only by the owner token.
     */
    function setCleanerContract(address _cleanerContract) external override onlyOwnerToken {
        _setCleanerContract(_cleanerContract);
    }
    
    /**
     * Update vote powers when tokens are transfered.
     * Also update delegated vote powers for percentage delegation
     * and check for enough funds for explicit delegations.
     **/
    function updateAtTokenTransfer(
        address _from, 
        address _to, 
        uint256 _fromBalance,
        uint256 _toBalance,
        uint256 _amount
    )
        external override 
        onlyOwnerToken 
    {
        if (_from == address(0)) {
            // mint new vote power
            _initializeVotePower(_to, _toBalance);
            _mintVotePower(_to, _toBalance, _amount);
        } else if (_to == address(0)) {
            // burn vote power
            _initializeVotePower(_from, _fromBalance);
            _burnVotePower(_from, _fromBalance, _amount);
        } else {
            // transmit vote power _to receiver
            _initializeVotePower(_from, _fromBalance);
            _initializeVotePower(_to, _toBalance);
            _transmitVotePower(_from, _to, _fromBalance, _toBalance, _amount);
        }
    }

    /**
     * @notice Delegate `_bips` percentage of voting power to `_to` from `_from`
     * @param _from The address of the delegator
     * @param _to The address of the recipient
     * @param _balance The delegator's current balance
     * @param _bips The percentage of voting power to be delegated expressed in basis points (1/100 of one percent).
     *   Not cumulative - every call resets the delegation value (and value of 0 revokes delegation).
     **/
    function delegate(
        address _from, 
        address _to, 
        uint256 _balance, 
        uint256 _bips
    )
        external override 
        onlyOwnerToken 
        onlyPercent(_from)
    {
        _initializeVotePower(_from, _balance);
        if (!_votePowerInitialized(_to)) {
            _initializeVotePower(_to, ownerToken.balanceOf(_to));
        }
        _delegateByPercentage(_from, _to, _balance, _bips);
    }
    
    /**
     * @notice Explicitly delegate `_amount` of voting power to `_to` from `_from`.
     * @param _from The address of the delegator
     * @param _to The address of the recipient
     * @param _balance The delegator's current balance
     * @param _amount An explicit vote power amount to be delegated.
     *   Not cumulative - every call resets the delegation value (and value of 0 undelegates `to`).
     **/    
    function delegateExplicit(
        address _from, 
        address _to, 
        uint256 _balance, 
        uint _amount
    )
        external override 
        onlyOwnerToken
        onlyExplicit(_from)
    {
        _initializeVotePower(_from, _balance);
        if (!_votePowerInitialized(_to)) {
            _initializeVotePower(_to, ownerToken.balanceOf(_to));
        }
        _delegateByAmount(_from, _to, _balance, _amount);
    }

    /**
     * @notice Revoke all delegation from `_from` to `_to` at given block. 
     *    Only affects the reads via `votePowerOfAtCached()` in the block `_blockNumber`.
     *    Block `_blockNumber` must be in the past. 
     *    This method should be used only to prevent rogue delegate voting in the current voting block.
     *    To stop delegating use delegate/delegateExplicit with value of 0 or undelegateAll/undelegateAllExplicit.
     * @param _from The address of the delegator
     * @param _to Address of the delegatee
     * @param _balance The delegator's current balance
     * @param _blockNumber The block number at which to revoke delegation.
     **/
    function revokeDelegationAt(
        address _from, 
        address _to, 
        uint256 _balance,
        uint _blockNumber
    )
        external override 
        onlyOwnerToken
    {
        // ASSERT: if there was a delegation, _from and _to must be initialized
        if (!isReplacement || 
            (_votePowerInitializedAt(_from, _blockNumber) && _votePowerInitializedAt(_to, _blockNumber))) {
            _revokeDelegationAt(_from, _to, _balance, _blockNumber);
        }
    }

    /**
     * @notice Undelegate all voting power for delegates of `_from`
     *    Can only be used with percentage delegation.
     *    Does not reset delegation mode back to NOTSET.
     * @param _from The address of the delegator
     **/
    function undelegateAll(
        address _from,
        uint256 _balance
    )
        external override 
        onlyOwnerToken 
        onlyPercent(_from)
    {
        if (_hasAnyDelegations(_from)) {
            // ASSERT: since there were delegations, _from and its targets must be initialized
            _undelegateAllByPercentage(_from, _balance);
        }
    }

    /**
     * @notice Undelegate all explicit vote power by amount delegates for `_from`.
     *    Can only be used with explicit delegation.
     *    Does not reset delegation mode back to NOTSET.
     * @param _from The address of the delegator
     * @param _delegateAddresses Explicit delegation does not store delegatees' addresses, 
     *   so the caller must supply them.
     * @return The amount still delegated (in case the list of delegates was incomplete).
     */
    function undelegateAllExplicit(
        address _from, 
        address[] memory _delegateAddresses
    )
        external override 
        onlyOwnerToken 
        onlyExplicit(_from) 
        returns (uint256)
    {
        if (_hasAnyDelegations(_from)) {
            // ASSERT: since there were delegations, _from and its targets must be initialized
            return _undelegateAllByAmount(_from, _delegateAddresses);
        }
        return 0;
    }
    
    /**
    * @notice Get the vote power of `_who` at block `_blockNumber`
    *   Reads/updates cache and upholds revocations.
    * @param _who The address to get voting power.
    * @param _blockNumber The block number at which to fetch.
    * @return Vote power of `_who` at `_blockNumber`.
    */
    function votePowerOfAtCached(address _who, uint256 _blockNumber) external override returns(uint256) {
        if (!isReplacement || _votePowerInitializedAt(_who, _blockNumber)) {
            // use standard method
            return _votePowerOfAtCached(_who, _blockNumber);
        } else {
            // use uninitialized vote power cache
            bytes32 key = keccak256(abi.encode(_who, _blockNumber));
            uint256 cached = uninitializedVotePowerCache[key];
            if (cached != 0) {
                return cached - 1;  // safe, cached != 0
            }
            uint256 balance = ownerToken.balanceOfAt(_who, _blockNumber);
            uninitializedVotePowerCache[key] = balance.add(1);
            return balance;
        }
    }
    
    /**
     * Get the current cleanup block number.
     */
    function cleanupBlockNumber() external view override returns (uint256) {
        return _cleanupBlockNumber();
    }
    
    /**
     * @notice Get the current vote power of `_who`.
     * @param _who The address to get voting power.
     * @return Current vote power of `_who`.
     */
    function votePowerOf(address _who) external view override returns(uint256) {
        if (_votePowerInitialized(_who)) {
            return _votePowerOf(_who);
        } else {
            return ownerToken.balanceOf(_who);
        }
    }
    
    /**
    * @notice Get the vote power of `_who` at block `_blockNumber`
    * @param _who The address to get voting power.
    * @param _blockNumber The block number at which to fetch.
    * @return Vote power of `_who` at `_blockNumber`.
    */
    function votePowerOfAt(address _who, uint256 _blockNumber) public view override returns(uint256) {
        if (!isReplacement || _votePowerInitializedAt(_who, _blockNumber)) {
            return _votePowerOfAt(_who, _blockNumber);
        } else {
            return ownerToken.balanceOfAt(_who, _blockNumber);
        }
    }

    /**
    * @notice Get the vote power of `_who` at block `_blockNumber`, ignoring revocation information (and cache).
    * @param _who The address to get voting power.
    * @param _blockNumber The block number at which to fetch.
    * @return Vote power of `_who` at `_blockNumber`. Result doesn't change if vote power is revoked.
    */
    function votePowerOfAtIgnoringRevocation(address _who, uint256 _blockNumber) 
        external view override 
        returns(uint256) 
    {
        if (!isReplacement || _votePowerInitializedAt(_who, _blockNumber)) {
            return _votePowerOfAtIgnoringRevocation(_who, _blockNumber);
        } else {
            return ownerToken.balanceOfAt(_who, _blockNumber);
        }
    }
    
    /**
     * Return vote powers for several addresses in a batch.
     * @param _owners The list of addresses to fetch vote power of.
     * @param _blockNumber The block number at which to fetch.
     * @return _votePowers A list of vote powers corresponding to _owners.
     */    
    function batchVotePowerOfAt(
        address[] memory _owners, 
        uint256 _blockNumber
    )
        external view override 
        returns(uint256[] memory _votePowers)
    {
        _votePowers = _batchVotePowerOfAt(_owners, _blockNumber);
        // zero results might not have been initialized
        if (isReplacement) {
            for (uint256 i = 0; i < _votePowers.length; i++) {
                if (_votePowers[i] == 0 && !_votePowerInitializedAt(_owners[i], _blockNumber)) {
                    _votePowers[i] = ownerToken.balanceOfAt(_owners[i], _blockNumber);
                }
            }
        }
    }
    
    /**
    * @notice Get current delegated vote power `_from` delegator delegated `_to` delegatee.
    * @param _from Address of delegator
    * @param _to Address of delegatee
    * @param _balance The delegator's current balance
    * @return The delegated vote power.
    */
    function votePowerFromTo(
        address _from, 
        address _to, 
        uint256 _balance
    )
        external view override 
        returns (uint256)
    {
        // ASSERT: if the result is nonzero, _from and _to are initialized
        return _votePowerFromTo(_from, _to, _balance);
    }
    
    /**
    * @notice Get delegated the vote power `_from` delegator delegated `_to` delegatee at `_blockNumber`.
    * @param _from Address of delegator
    * @param _to Address of delegatee
    * @param _balance The delegator's current balance
    * @param _blockNumber The block number at which to fetch.
    * @return The delegated vote power.
    */
    function votePowerFromToAt(
        address _from, 
        address _to, 
        uint256 _balance,
        uint _blockNumber
    )
        external view override
        returns (uint256)
    {
        // ASSERT: if the result is nonzero, _from and _to were initialized at _blockNumber
        return _votePowerFromToAt(_from, _to, _balance, _blockNumber);
    }
    
    /**
     * @notice Get the delegation mode for '_who'. This mode determines whether vote power is
     *  allocated by percentage or by explicit value.
     * @param _who The address to get delegation mode.
     * @return Delegation mode (NOTSET=0, PERCENTAGE=1, AMOUNT=2))
     */
    function delegationModeOf(address _who) external view override returns (uint256) {
        return uint256(_delegationModeOf(_who));
    }

    /**
     * @notice Compute the current undelegated vote power of `_owner`
     * @param _owner The address to get undelegated voting power.
     * @param _balance Owner's current balance
     * @return The unallocated vote power of `_owner`
     */
    function undelegatedVotePowerOf(
        address _owner,
        uint256 _balance
    )
        external view override
        returns (uint256)
    {
        if (_votePowerInitialized(_owner)) {
            return _undelegatedVotePowerOf(_owner, _balance);
        } else {
            // ASSERT: there are no delegations
            return _balance;
        }
    }
    
    /**
     * @notice Get the undelegated vote power of `_owner` at given block.
     * @param _owner The address to get undelegated voting power.
     * @param _blockNumber The block number at which to fetch.
     * @return The undelegated vote power of `_owner` (= owner's own balance minus all delegations from owner)
     */
    function undelegatedVotePowerOfAt(
        address _owner, 
        uint256 _balance,
        uint256 _blockNumber
    )
        external view override
        returns (uint256)
    {
        if (_votePowerInitialized(_owner)) {
            return _undelegatedVotePowerOfAt(_owner, _balance, _blockNumber);
        } else {
            // ASSERT: there were no delegations at _blockNumber
            return _balance;
        }
    }

    /**
    * @notice Get the vote power delegation `_delegateAddresses` 
    *  and `pcts` of an `_owner`. Returned in two separate positional arrays.
    *  Also returns the count of delegates and delegation mode.
    * @param _owner The address to get delegations.
    * @return _delegateAddresses Positional array of delegation addresses.
    * @return _bips Positional array of delegation percents specified in basis points (1/100 or 1 percent)
    * @return _count The number of delegates.
    * @return _delegationMode The mode of the delegation (NOTSET=0, PERCENTAGE=1, AMOUNT=2).
    */
    function delegatesOf(address _owner)
        external view override 
        returns (
            address[] memory _delegateAddresses, 
            uint256[] memory _bips,
            uint256 _count,
            uint256 _delegationMode
        )
    {
        // ASSERT: either _owner is initialized or there are no delegations
        return delegatesOfAt(_owner, block.number);
    }
    
    /**
    * @notice Get the vote power delegation `delegationAddresses` 
    *  and `_bips` of an `_owner`. Returned in two separate positional arrays.
    *  Also returns the count of delegates and delegation mode.
    * @param _owner The address to get delegations.
    * @param _blockNumber The block for which we want to know the delegations.
    * @return _delegateAddresses Positional array of delegation addresses.
    * @return _bips Positional array of delegation percents specified in basis points (1/100 or 1 percent)
    * @return _count The number of delegates.
    * @return _delegationMode The mode of the delegation (NOTSET=0, PERCENTAGE=1, AMOUNT=2).
    */
    function delegatesOfAt(
        address _owner,
        uint256 _blockNumber
    )
        public view override 
        returns (
            address[] memory _delegateAddresses, 
            uint256[] memory _bips,
            uint256 _count,
            uint256 _delegationMode
        )
    {
        // ASSERT: either _owner was initialized or there were no delegations
        DelegationMode mode = _delegationModeOf(_owner);
        if (mode == DelegationMode.PERCENTAGE) {
            // Get the vote power delegation for the _owner
            (_delegateAddresses, _bips) = _percentageDelegatesOfAt(_owner, _blockNumber);
        } else if (mode == DelegationMode.NOTSET) {
            _delegateAddresses = new address[](0);
            _bips = new uint256[](0);
        } else {
            revert ("delegatesOf does not work in AMOUNT delegation mode");
        }
        _count = _delegateAddresses.length;
        _delegationMode = uint256(mode);
    }

    /**
     * Initialize vote power to current balance if not initialized already.
     * @param _owner The address to initialize voting power.
     * @param _balance The owner's current balance.
     */
    function _initializeVotePower(address _owner, uint256 _balance) internal {
        if (!isReplacement) return;
        if (_owner == address(0)) return;    // 0 address is special (usually marks no source/dest - no init needed)
        if (votePowerInitializationBlock[_owner] == 0) {
            // consistency check - no delegations should be made from or to owner before vote power is initialized
            // (that would be dangerous, because vote power would have been delegated incorrectly)
            assert(_votePowerOf(_owner) == 0 && !_hasAnyDelegations(_owner));
            _mintVotePower(_owner, 0, _balance);
            votePowerInitializationBlock[_owner] = block.number.add(1);
        }
    }
    
    /**
     * Has the vote power of `_owner` been initialized?
     * @param _owner The address to check.
     * @return true if vote power of _owner is initialized
     */
    function _votePowerInitialized(address _owner) internal view returns (bool) {
        if (!isReplacement) return true;
        return votePowerInitializationBlock[_owner] != 0;
    }

    /**
     * Was vote power of `_owner` initialized at some block?
     * @param _owner The address to check.
     * @param _blockNumber The block for which we want to check.
     * @return true if vote power of _owner was initialized at _blockNumber
     */
    function _votePowerInitializedAt(address _owner, uint256 _blockNumber) internal view returns (bool) {
        if (!isReplacement) return true;
        uint256 initblock = votePowerInitializationBlock[_owner];
        return initblock != 0 && initblock - 1 <= _blockNumber;
    }
}
