// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../lib/PercentageDelegation.sol";
import "../lib/ExplicitDelegation.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "../../utils/implementation/SafePct.sol";
import "../lib/VotePower.sol";
import "../lib/VotePowerCache.sol";
import "../../userInterfaces/IVPContractEvents.sol";

/**
 * Delegatable ERC20 behavior.
 *
 * Adds delegation capabilities to tokens. This contract orchestrates interaction between
 * managing a delegation and the vote power allocations that result.
 */
contract Delegatable is IVPContractEvents {
    using PercentageDelegation for PercentageDelegation.DelegationState;
    using ExplicitDelegation for ExplicitDelegation.DelegationState;
    using SafeMath for uint256;
    using SafePct for uint256;
    using VotePower for VotePower.VotePowerState;
    using VotePowerCache for VotePowerCache.CacheState;

    /**
     * Delegation mode of an account. Once set, it cannot be changed.
     *
     * * `NOTSET`: Delegation mode not set yet.
     * * `PERCENTAGE`: Delegation by percentage.
     * * `AMOUNT`: Delegation by amount (explicit).
     */
    enum DelegationMode {
        NOTSET,
        PERCENTAGE,
        AMOUNT
    }

    // The number of history cleanup steps executed for every write operation.
    // It is more than 1 to make as certain as possible that all history gets cleaned eventually.
    uint256 private constant CLEANUP_COUNT = 2;

    string constant private UNDELEGATED_VP_TOO_SMALL_MSG =
        "Undelegated vote power too small";

    // Map that tracks delegation mode of each address.
    mapping(address => DelegationMode) private delegationModes;

    // `percentageDelegations` is the map that tracks the percentage voting power delegation of each address.
    // Explicit delegations are tracked directly through votePower.
    mapping(address => PercentageDelegation.DelegationState) private percentageDelegations;

    mapping(address => ExplicitDelegation.DelegationState) private explicitDelegations;

    // `votePower` tracks all voting power balances
    VotePower.VotePowerState private votePower;

    // `votePower` tracks all voting power balances
    VotePowerCache.CacheState private votePowerCache;

    // Historic data for the blocks before `cleanupBlockNumber` can be erased,
    // history before that block should never be used since it can be inconsistent.
    uint256 private cleanupBlockNumber;

    /// Address of the contract that is allowed to call methods for history cleaning.
    address public cleanerContract;

    /**
     * Emitted when a vote power cache entry is created.
     * Allows history cleaners to track vote power cache cleanup opportunities off-chain.
     * @param _owner The address whose vote power has just been cached.
     * @param _blockNumber The block number at which the vote power has been cached.
     */
    event CreatedVotePowerCache(address _owner, uint256 _blockNumber);

    // Most history cleanup opportunities can be deduced from standard events:
    // Transfer(from, to, amount):
    //  - vote power checkpoints for `from` (if nonzero) and `to` (if nonzero)
    //  - vote power checkpoints for percentage delegatees of `from` and `to` are also created,
    //    but they don't have to be checked since Delegate events are also emitted in case of
    //    percentage delegation vote power change due to delegators balance change
    //  - Note: Transfer event is emitted from VPToken but vote power checkpoint delegationModes
    //    must be called on its writeVotePowerContract
    // Delegate(from, to, priorVP, newVP):
    //  - vote power checkpoints for `from` and `to`
    //  - percentage delegation checkpoint for `from` (if `from` uses percentage delegation mode)
    //  - explicit delegation checkpoint from `from` to `to` (if `from` uses explicit delegation mode)
    // Revoke(from, to, vp, block):
    //  - vote power cache for `from` and `to` at `block`
    //  - revocation cache block from `from` to `to` at `block`

    /**
     * Reading from history is not allowed before `cleanupBlockNumber`, since data before that
     * might have been deleted and is thus unreliable.
     * @param _blockNumber The block number being checked for validity.
     */
    modifier notBeforeCleanupBlock(uint256 _blockNumber) {
        require(_blockNumber >= cleanupBlockNumber, "Delegatable: reading from cleaned-up block");
        _;
    }

    /**
     * History cleaning methods can be called only from `cleanerContract`.
     */
    modifier onlyCleaner {
        require(msg.sender == cleanerContract, "Only cleaner contract");
        _;
    }

    /**
     * (Un)Allocate `_owner` vote power of `_amount` across owner delegate
     *  vote power percentages.
     * @param _owner The address of the vote power owner.
     * @param _priorBalance The owner's balance before change.
     * @param _newBalance The owner's balance after change.
     * @dev precondition: delegationModes[_owner] == DelegationMode.PERCENTAGE
     */
    function _allocateVotePower(address _owner, uint256 _priorBalance, uint256 _newBalance) private {
        // Get the voting delegation for the _owner
        PercentageDelegation.DelegationState storage delegation = percentageDelegations[_owner];
        // Track total owner vp change
        uint256 ownerVpAdd = _newBalance;
        uint256 ownerVpSub = _priorBalance;
        // Iterate over the delegates
        (uint256 length, mapping(uint256 => DelegationHistory.Delegation) storage delegations) =
            delegation.getDelegationsRaw();
        for (uint256 i = 0; i < length; i++) {
            DelegationHistory.Delegation storage dlg = delegations[i];
            address delegatee = dlg.delegate;
            uint256 value = dlg.value;
            // Compute the delegated vote power for the delegatee
            uint256 priorValue = _priorBalance.mulDiv(value, PercentageDelegation.MAX_BIPS);
            uint256 newValue = _newBalance.mulDiv(value, PercentageDelegation.MAX_BIPS);
            ownerVpAdd = ownerVpAdd.add(priorValue);
            ownerVpSub = ownerVpSub.add(newValue);
            // could optimize next lines by checking that priorValue != newValue, but that can only happen
            // for the transfer of 0 amount, which is prevented by the calling function
            votePower.changeValue(delegatee, newValue, priorValue);
            votePower.cleanupOldCheckpoints(delegatee, CLEANUP_COUNT, cleanupBlockNumber);
            emit Delegate(_owner, delegatee, priorValue, newValue);
        }
        // (ownerVpAdd - ownerVpSub) is how much the owner vp changes - will be 0 if delegation is 100%
        if (ownerVpAdd != ownerVpSub) {
            votePower.changeValue(_owner, ownerVpAdd, ownerVpSub);
            votePower.cleanupOldCheckpoints(_owner, CLEANUP_COUNT, cleanupBlockNumber);
        }
    }

    /**
     * Burn `_amount` of vote power for `_owner`.
     * @param _owner The address of the _owner vote power to burn.
     * @param _ownerCurrentBalance The current token balance of the owner (which is their allocatable vote power).
     * @param _amount The amount of vote power to burn.
     */
    function _burnVotePower(address _owner, uint256 _ownerCurrentBalance, uint256 _amount) internal {
        // revert with the same error as ERC20 in case transfer exceeds balance
        uint256 newOwnerBalance = _ownerCurrentBalance.sub(_amount, "ERC20: transfer amount exceeds balance");
        if (delegationModes[_owner] == DelegationMode.PERCENTAGE) {
            // for PERCENTAGE delegation: reduce owner vote power allocations
            _allocateVotePower(_owner, _ownerCurrentBalance, newOwnerBalance);
        } else {
            // for AMOUNT delegation: is there enough unallocated VP _to burn if explicitly delegated?
            require(_isTransmittable(_owner, _ownerCurrentBalance, _amount), UNDELEGATED_VP_TOO_SMALL_MSG);
            // burn vote power
            votePower.changeValue(_owner, 0, _amount);
            votePower.cleanupOldCheckpoints(_owner, CLEANUP_COUNT, cleanupBlockNumber);
        }
    }

    /**
     * Get whether `_owner` current delegation can be delegated by percentage.
     * @param _owner Address of delegation to check.
     * @return True if delegation can be delegated by percentage.
     */
    function _canDelegateByPct(address _owner) internal view returns(bool) {
        // Get the delegation mode.
        DelegationMode delegationMode = delegationModes[_owner];
        // Return true if delegation is safe _to store percents, which can also
        // apply if there is not delegation mode set.
        return delegationMode == DelegationMode.NOTSET || delegationMode == DelegationMode.PERCENTAGE;
    }

    /**
     * Get whether `_owner` current delegation can be delegated by amount.
     * @param _owner Address of delegation to check.
     * @return True if delegation can be delegated by amount.
     */
    function _canDelegateByAmount(address _owner) internal view returns(bool) {
        // Get the delegation mode.
        DelegationMode delegationMode = delegationModes[_owner];
        // Return true if delegation is safe to store explicit amounts, which can also
        // apply if there is not delegation mode set.
        return delegationMode == DelegationMode.NOTSET || delegationMode == DelegationMode.AMOUNT;
    }

    /**
     * Delegate `_amount` of voting power to `_to` from `_from`
     * @param _from The address of the delegator
     * @param _to The address of the recipient
     * @param _senderCurrentBalance The senders current balance (not their voting power)
     * @param _amount The amount of voting power to be delegated
     */
    function _delegateByAmount(
        address _from,
        address _to,
        uint256 _senderCurrentBalance,
        uint256 _amount
    )
        internal virtual
    {
        require (_to != address(0), "Cannot delegate to zero");
        require (_to != _from, "Cannot delegate to self");
        require (_canDelegateByAmount(_from), "Cannot delegate by amount");

        // Get the vote power delegation for the sender
        ExplicitDelegation.DelegationState storage delegation = explicitDelegations[_from];

        // the prior value
        uint256 priorAmount = delegation.getDelegatedValue(_to);

        // Delegate new power
        if (_amount < priorAmount) {
            // Prior amount is greater, just reduce the delegated amount.
            // subtraction is safe since _amount < priorAmount
            votePower.undelegate(_from, _to, priorAmount - _amount);
        } else {
            // Is there enough undelegated vote power?
            uint256 availableAmount = _undelegatedVotePowerOf(_from, _senderCurrentBalance).add(priorAmount);
            require(availableAmount >= _amount, UNDELEGATED_VP_TOO_SMALL_MSG);
            // Increase the delegated amount of vote power.
            // subtraction is safe since _amount >= priorAmount
            votePower.delegate(_from, _to, _amount - priorAmount);
        }
        votePower.cleanupOldCheckpoints(_from, CLEANUP_COUNT, cleanupBlockNumber);
        votePower.cleanupOldCheckpoints(_to, CLEANUP_COUNT, cleanupBlockNumber);

        // Add/replace delegate
        delegation.addReplaceDelegate(_to, _amount);
        delegation.cleanupOldCheckpoints(_to, CLEANUP_COUNT, cleanupBlockNumber);

        // update mode if needed
        if (delegationModes[_from] != DelegationMode.AMOUNT) {
            delegationModes[_from] = DelegationMode.AMOUNT;
        }

        // emit event for delegation change
        emit Delegate(_from, _to, priorAmount, _amount);
    }

    /**
     * Delegate `_bips` of voting power to `_to` from `_from`
     * @param _from The address of the delegator
     * @param _to The address of the recipient
     * @param _senderCurrentBalance The senders current balance (not their voting power)
     * @param _bips The percentage of voting power in basis points (1/100 of 1 percent) to be delegated
     */
    function _delegateByPercentage(
        address _from,
        address _to,
        uint256 _senderCurrentBalance,
        uint256 _bips
    )
        internal virtual
    {
        require (_to != address(0), "Cannot delegate to zero");
        require (_to != _from, "Cannot delegate to self");
        require (_canDelegateByPct(_from), "Cannot delegate by percentage");

        // Get the vote power delegation for the sender
        PercentageDelegation.DelegationState storage delegation = percentageDelegations[_from];

        // Get prior percent for delegate if exists
        uint256 priorBips = delegation.getDelegatedValue(_to);
        uint256 reverseVotePower = 0;
        uint256 newVotePower = 0;

        // Add/replace delegate
        delegation.addReplaceDelegate(_to, _bips);
        delegation.cleanupOldCheckpoints(CLEANUP_COUNT, cleanupBlockNumber);

        // First, back out old voting power percentage, if not zero
        if (priorBips != 0) {
            reverseVotePower = _senderCurrentBalance.mulDiv(priorBips, PercentageDelegation.MAX_BIPS);
        }

        // Calculate the new vote power
        if (_bips != 0) {
            newVotePower = _senderCurrentBalance.mulDiv(_bips, PercentageDelegation.MAX_BIPS);
        }

        // Delegate new power
        if (newVotePower < reverseVotePower) {
            // subtraction is safe since newVotePower < reverseVotePower
            votePower.undelegate(_from, _to, reverseVotePower - newVotePower);
        } else {
            // subtraction is safe since newVotePower >= reverseVotePower
            votePower.delegate(_from, _to, newVotePower - reverseVotePower);
        }
        votePower.cleanupOldCheckpoints(_from, CLEANUP_COUNT, cleanupBlockNumber);
        votePower.cleanupOldCheckpoints(_to, CLEANUP_COUNT, cleanupBlockNumber);

        // update mode if needed
        if (delegationModes[_from] != DelegationMode.PERCENTAGE) {
            delegationModes[_from] = DelegationMode.PERCENTAGE;
        }

        // emit event for delegation change
        emit Delegate(_from, _to, reverseVotePower, newVotePower);
    }

    /**
     * @notice Get the delegation mode for '_who'. This mode determines whether vote power is
     *  allocated by percentage or by explicit value.
     * @param _who The address to get delegation mode.
     * @return Delegation mode
     */
    function _delegationModeOf(address _who) internal view returns (DelegationMode) {
        return delegationModes[_who];
    }

    /**
     * Get the vote power delegation `delegationAddresses`
     *  and `_bips` of an `_owner`. Returned in two separate positional arrays.
     * @param _owner The address to get delegations.
     * @param _blockNumber The block for which we want to know the delegations.
     * @return _delegateAddresses Positional array of delegation addresses.
     * @return _bips Positional array of delegation percents specified in basis points (1/100 or 1 percent)
     */
    function _percentageDelegatesOfAt(
        address _owner,
        uint256 _blockNumber
    )
        internal view
        notBeforeCleanupBlock(_blockNumber)
        returns (
            address[] memory _delegateAddresses, 
            uint256[] memory _bips
        )
    {
        PercentageDelegation.DelegationState storage delegation = percentageDelegations[_owner];
        address[] memory allDelegateAddresses;
        uint256[] memory allBips;
        (allDelegateAddresses, allBips) = delegation.getDelegationsAt(_blockNumber);
        // delete revoked addresses
        for (uint256 i = 0; i < allDelegateAddresses.length; i++) {
            if (votePowerCache.revokedFromToAt(_owner, allDelegateAddresses[i], _blockNumber)) {
                allBips[i] = 0;
            }
        }
        uint256 length = 0;
        for (uint256 i = 0; i < allDelegateAddresses.length; i++) {
            if (allBips[i] != 0) length++;
        }
        _delegateAddresses = new address[](length);
        _bips = new uint256[](length);
        uint256 destIndex = 0;
        for (uint256 i = 0; i < allDelegateAddresses.length; i++) {
            if (allBips[i] != 0) {
                _delegateAddresses[destIndex] = allDelegateAddresses[i];
                _bips[destIndex] = allBips[i];
                destIndex++;
            }
        }
    }

    /**
     * Checks if enough undelegated vote power exists to allow a token
     *  transfer to occur if vote power is explicitly delegated.
     * @param _owner The address of transmittable vote power to check.
     * @param _ownerCurrentBalance The current balance of `_owner`.
     * @param _amount The amount to check.
     * @return True is `_amount` is transmittable.
     */
    function _isTransmittable(
        address _owner,
        uint256 _ownerCurrentBalance,
        uint256 _amount
    )
        private view returns(bool)
    {
        // Only proceed if we have a delegation by _amount
        if (delegationModes[_owner] == DelegationMode.AMOUNT) {
            // Return true if there is enough vote power _to cover the transfer
            return _undelegatedVotePowerOf(_owner, _ownerCurrentBalance) >= _amount;
        } else {
            // Not delegated by _amount, so transfer always allowed
            return true;
        }
    }

    /**
     * Mint `_amount` of vote power for `_owner`.
     * @param _owner The address of the owner to receive new vote power.
     * @param _amount The amount of vote power to mint.
     */
    function _mintVotePower(address _owner, uint256 _ownerCurrentBalance, uint256 _amount) internal {
        if (delegationModes[_owner] == DelegationMode.PERCENTAGE) {
            // Allocate newly minted vote power over delegates
            _allocateVotePower(_owner, _ownerCurrentBalance, _ownerCurrentBalance.add(_amount));
        } else {
            votePower.changeValue(_owner, _amount, 0);
            votePower.cleanupOldCheckpoints(_owner, CLEANUP_COUNT, cleanupBlockNumber);
        }
    }

    /**
     * Revoke the vote power of `_to` at block `_blockNumber`
     * @param _from The address of the delegator
     * @param _to The delegatee address of vote power to revoke.
     * @param _senderBalanceAt The sender's balance at the block to be revoked.
     * @param _blockNumber The block number at which to revoke.
     */
    function _revokeDelegationAt(
        address _from,
        address _to,
        uint256 _senderBalanceAt,
        uint256 _blockNumber
    )
        internal
        notBeforeCleanupBlock(_blockNumber)
    {
        require(_blockNumber < block.number, "Revoke is only for the past, use undelegate for the present");

        // Get amount revoked
        uint256 votePowerRevoked = _votePowerFromToAtNoRevokeCheck(_from, _to, _senderBalanceAt, _blockNumber);

        // Revoke vote power
        votePowerCache.revokeAt(votePower, _from, _to, votePowerRevoked, _blockNumber);

        // Emit revoke event
        emit Revoke(_from, _to, votePowerRevoked, _blockNumber);
    }

    /**
     * Transmit `_amount` of vote power `_from` address `_to` address.
     * @param _from The address of the sender.
     * @param _to The address of the receiver.
     * @param _fromCurrentBalance The current token balance of the transmitter.
     * @param _toCurrentBalance The current token balance of the receiver.
     * @param _amount The amount of vote power to transmit.
     */
    function _transmitVotePower(
        address _from,
        address _to,
        uint256 _fromCurrentBalance,
        uint256 _toCurrentBalance,
        uint256 _amount
    )
        internal
    {
        _burnVotePower(_from, _fromCurrentBalance, _amount);
        _mintVotePower(_to, _toCurrentBalance, _amount);
    }

    /**
     * Undelegate all vote power by percentage for `delegation` of `_who`.
     * @param _from The address of the delegator
     * @param _senderCurrentBalance The current balance of message sender.
     * precondition: delegationModes[_who] == DelegationMode.PERCENTAGE
     */
    function _undelegateAllByPercentage(address _from, uint256 _senderCurrentBalance) internal {
        DelegationMode delegationMode = delegationModes[_from];
        if (delegationMode == DelegationMode.NOTSET) return;
        require(delegationMode == DelegationMode.PERCENTAGE,
            "undelegateAll can only be used in percentage delegation mode");

        PercentageDelegation.DelegationState storage delegation = percentageDelegations[_from];

        // Iterate over the delegates
        (address[] memory delegates, uint256[] memory _bips) = delegation.getDelegations();
        for (uint256 i = 0; i < delegates.length; i++) {
            address to = delegates[i];
            // Compute vote power to be reversed for the delegate
            uint256 reverseVotePower = _senderCurrentBalance.mulDiv(_bips[i], PercentageDelegation.MAX_BIPS);
            // Transmit vote power back to _owner
            votePower.undelegate(_from, to, reverseVotePower);
            votePower.cleanupOldCheckpoints(_from, CLEANUP_COUNT, cleanupBlockNumber);
            votePower.cleanupOldCheckpoints(to, CLEANUP_COUNT, cleanupBlockNumber);
            // Emit vote power reversal event
            emit Delegate(_from, to, reverseVotePower, 0);
        }

        // Clear delegates
        delegation.clear();
        delegation.cleanupOldCheckpoints(CLEANUP_COUNT, cleanupBlockNumber);
    }

    /**
     * Undelegate all vote power by amount delegates for `_from`.
     * @param _from The address of the delegator
     * @param _delegateAddresses Explicit delegation does not store delegatees' addresses,
     * so the caller must supply them.
     */
    function _undelegateAllByAmount(
        address _from,
        address[] memory _delegateAddresses
    )
        internal
        returns (uint256 _remainingDelegation)
    {
        DelegationMode delegationMode = delegationModes[_from];
        if (delegationMode == DelegationMode.NOTSET) return 0;
        require(delegationMode == DelegationMode.AMOUNT,
            "undelegateAllExplicit can only be used in explicit delegation mode");

        ExplicitDelegation.DelegationState storage delegation = explicitDelegations[_from];

        // Iterate over the delegates
        for (uint256 i = 0; i < _delegateAddresses.length; i++) {
            address to = _delegateAddresses[i];
            // Compute vote power _to be reversed for the delegate
            uint256 reverseVotePower = delegation.getDelegatedValue(to);
            if (reverseVotePower == 0) continue;
            // Transmit vote power back _to _owner
            votePower.undelegate(_from, to, reverseVotePower);
            votePower.cleanupOldCheckpoints(_from, CLEANUP_COUNT, cleanupBlockNumber);
            votePower.cleanupOldCheckpoints(to, CLEANUP_COUNT, cleanupBlockNumber);
            // change delagation
            delegation.addReplaceDelegate(to, 0);
            delegation.cleanupOldCheckpoints(to, CLEANUP_COUNT, cleanupBlockNumber);
            // Emit vote power reversal event
            emit Delegate(_from, to, reverseVotePower, 0);
        }

        return delegation.getDelegatedTotal();
    }

    /**
     * @notice Check if the `_owner` has made any delegations.
     * @param _owner The address of owner to get delegated vote power.
     * @return The total delegated vote power at block.
     */
    function _hasAnyDelegations(address _owner) internal view returns(bool) {
        DelegationMode delegationMode = delegationModes[_owner];
        if (delegationMode == DelegationMode.NOTSET) {
            return false;
        } else if (delegationMode == DelegationMode.AMOUNT) {
            return explicitDelegations[_owner].getDelegatedTotal() > 0;
        } else { // delegationMode == DelegationMode.PERCENTAGE
            return percentageDelegations[_owner].getCount() > 0;
        }
    }

    /**
     * Get the total delegated vote power of `_owner` at some block.
     * @param _owner The address of owner to get delegated vote power.
     * @param _ownerBalanceAt The balance of the owner at that block (not their vote power).
     * @param _blockNumber The block number at which to fetch.
     * @return _votePower The total delegated vote power at block.
     */
    function _delegatedVotePowerOfAt(
        address _owner,
        uint256 _ownerBalanceAt,
        uint256 _blockNumber
    )
        internal view
        notBeforeCleanupBlock(_blockNumber)
        returns(uint256 _votePower)
    {
        // Get the vote power delegation for the _owner
        DelegationMode delegationMode = delegationModes[_owner];
        if (delegationMode == DelegationMode.NOTSET) {
            return 0;
        } else if (delegationMode == DelegationMode.AMOUNT) {
            return explicitDelegations[_owner].getDelegatedTotalAt(_blockNumber);
        } else { // delegationMode == DelegationMode.PERCENTAGE
            return percentageDelegations[_owner].getDelegatedTotalAmountAt(_ownerBalanceAt, _blockNumber);
        }
    }

    /**
     * Get the undelegated vote power of `_owner` at some block.
     * @param _owner The address of owner to get undelegated vote power.
     * @param _ownerBalanceAt The balance of the owner at that block (not their vote power).
     * @param _blockNumber The block number at which to fetch.
     * @return _votePower The undelegated vote power at block.
     */
    function _undelegatedVotePowerOfAt(
        address _owner,
        uint256 _ownerBalanceAt,
        uint256 _blockNumber
    )
        internal view
        notBeforeCleanupBlock(_blockNumber)
        returns(uint256 _votePower)
    {
        // Return the current balance less delegations or zero if negative
        uint256 delegated = _delegatedVotePowerOfAt(_owner, _ownerBalanceAt, _blockNumber);
        bool overflow;
        uint256 result;
        (overflow, result) = _ownerBalanceAt.trySub(delegated);
        return result;
    }

    /**
     * Get the undelegated vote power of `_owner`.
     * @param _owner The address of owner to get undelegated vote power.
     * @param _ownerCurrentBalance The current balance of the owner (not their vote power).
     * @return _votePower The undelegated vote power.
     */
    function _undelegatedVotePowerOf(
        address _owner,
        uint256 _ownerCurrentBalance
    )
        internal view
        returns(uint256 _votePower)
    {
        return _undelegatedVotePowerOfAt(_owner, _ownerCurrentBalance, block.number);
    }

    /**
    * Get current delegated vote power `_from` delegator delegated `_to` delegatee.
    * @param _from Address of delegator
    * @param _to Address of delegatee
    * @return _votePower The delegated vote power.
    */
    function _votePowerFromTo(
        address _from,
        address _to,
        uint256 _currentFromBalance
    )
        internal view
        returns(uint256 _votePower)
    {
        DelegationMode delegationMode = delegationModes[_from];
        if (delegationMode == DelegationMode.NOTSET) {
            return 0;
        } else if (delegationMode == DelegationMode.PERCENTAGE) {
            uint256 _bips = percentageDelegations[_from].getDelegatedValue(_to);
            return _currentFromBalance.mulDiv(_bips, PercentageDelegation.MAX_BIPS);
        } else { // delegationMode == DelegationMode.AMOUNT
            return explicitDelegations[_from].getDelegatedValue(_to);
        }
    }

    /**
    * Get delegated the vote power `_from` delegator delegated `_to` delegatee at `_blockNumber`.
    * @param _from Address of delegator
    * @param _to Address of delegatee
    * @param _fromBalanceAt From's balance at the block `_blockNumber`.
    * @param _blockNumber The block number at which to fetch.
    * @return _votePower The delegated vote power.
    */
    function _votePowerFromToAt(
        address _from,
        address _to,
        uint256 _fromBalanceAt,
        uint256 _blockNumber
    )
        internal view
        notBeforeCleanupBlock(_blockNumber)
        returns(uint256 _votePower)
    {
        // if revoked, return 0
        if (votePowerCache.revokedFromToAt(_from, _to, _blockNumber)) return 0;
        return _votePowerFromToAtNoRevokeCheck(_from, _to, _fromBalanceAt, _blockNumber);
    }

    /**
     * Get delegated the vote power `_from` delegator delegated `_to` delegatee at `_blockNumber`.
     * Private use only - ignores revocations.
     * @param _from Address of delegator
     * @param _to Address of delegatee
     * @param _fromBalanceAt From's balance at the block `_blockNumber`.
     * @param _blockNumber The block number at which to fetch.
     * @return _votePower The delegated vote power.
     */
    function _votePowerFromToAtNoRevokeCheck(
        address _from,
        address _to,
        uint256 _fromBalanceAt,
        uint256 _blockNumber
    )
        private view
        returns(uint256 _votePower)
    {
        // assumed: notBeforeCleanupBlock(_blockNumber)
        DelegationMode delegationMode = delegationModes[_from];
        if (delegationMode == DelegationMode.NOTSET) {
            return 0;
        } else if (delegationMode == DelegationMode.PERCENTAGE) {
            uint256 _bips = percentageDelegations[_from].getDelegatedValueAt(_to, _blockNumber);
            return _fromBalanceAt.mulDiv(_bips, PercentageDelegation.MAX_BIPS);
        } else { // delegationMode == DelegationMode.AMOUNT
            return explicitDelegations[_from].getDelegatedValueAt(_to, _blockNumber);
        }
    }

    /**
     * Get the current vote power of `_who`.
     * @param _who The address to get voting power.
     * @return Current vote power of `_who`.
     */
    function _votePowerOf(address _who) internal view returns(uint256) {
        return votePower.votePowerOfAtNow(_who);
    }

    /**
     * Get the vote power of `_who` at block `_blockNumber`
     * @param _who The address to get voting power.
     * @param _blockNumber The block number at which to fetch.
     * @return Vote power of `_who` at `_blockNumber`.
     */
    function _votePowerOfAt(
        address _who,
        uint256 _blockNumber
    )
        internal view
        notBeforeCleanupBlock(_blockNumber)
        returns(uint256)
    {
        // read cached value for past blocks to respect revocations (and possibly get a cache speedup)
        if (_blockNumber < block.number) {
            return votePowerCache.valueOfAtReadonly(votePower, _who, _blockNumber);
        } else {
            return votePower.votePowerOfAtNow(_who);
        }
    }

    /**
     * Get the vote power of `_who` at block `_blockNumber`, ignoring revocation information (and cache).
     * @param _who The address to get voting power.
     * @param _blockNumber The block number at which to fetch.
     * @return Vote power of `_who` at `_blockNumber`. Result doesn't change if vote power is revoked.
     */
    function _votePowerOfAtIgnoringRevocation(
        address _who,
        uint256 _blockNumber
    )
        internal view
        notBeforeCleanupBlock(_blockNumber)
        returns(uint256)
    {
        return votePower.votePowerOfAt(_who, _blockNumber);
    }

    /**
     * Return vote powers for several addresses in a batch.
     * Only works for past blocks.
     * @param _owners The list of addresses to fetch vote power of.
     * @param _blockNumber The block number at which to fetch.
     * @return _votePowers A list of vote powers corresponding to _owners.
     */
    function _batchVotePowerOfAt(
        address[] memory _owners,
        uint256 _blockNumber
    )
        internal view
        notBeforeCleanupBlock(_blockNumber)
        returns(uint256[] memory _votePowers)
    {
        require(_blockNumber < block.number, "Can only be used for past blocks");
        _votePowers = new uint256[](_owners.length);
        for (uint256 i = 0; i < _owners.length; i++) {
            // read through cache, much faster if it has been set
            _votePowers[i] = votePowerCache.valueOfAtReadonly(votePower, _owners[i], _blockNumber);
        }
    }

    /**
     * Get the vote power of `_who` at block `_blockNumber`
     *   Reads/updates cache and upholds revocations.
     * @param _who The address to get voting power.
     * @param _blockNumber The block number at which to fetch.
     * @return Vote power of `_who` at `_blockNumber`.
     */
    function _votePowerOfAtCached(
        address _who,
        uint256 _blockNumber
    )
        internal
        notBeforeCleanupBlock(_blockNumber)
        returns(uint256)
    {
        require(_blockNumber < block.number, "Can only be used for past blocks");
        (uint256 vp, bool createdCache) = votePowerCache.valueOfAt(votePower, _who, _blockNumber);
        if (createdCache) emit CreatedVotePowerCache(_who, _blockNumber);
        return vp;
    }

    /**
     * Set the cleanup block number.
     */
    function _setCleanupBlockNumber(uint256 _blockNumber) internal {
        require(_blockNumber >= cleanupBlockNumber, "Cleanup block number must never decrease");
        require(_blockNumber < block.number, "Cleanup block must be in the past");
        cleanupBlockNumber = _blockNumber;
    }

    /**
     * Get the cleanup block number.
     */
    function _cleanupBlockNumber() internal view returns (uint256) {
        return cleanupBlockNumber;
    }

    /**
     * Set the contract that is allowed to call history cleaning methods.
     */
    function _setCleanerContract(address _cleanerContract) internal {
        cleanerContract = _cleanerContract;
    }

    // history cleanup methods

    /**
     * Delete vote power checkpoints that expired (i.e. are before `cleanupBlockNumber`).
     * Method can only be called from the `cleanerContract` (which may be a proxy to external cleaners).
     * @param _owner Vote power owner account address.
     * @param _count Maximum number of checkpoints to delete.
     * @return Number of deleted checkpoints.
     */
    function votePowerHistoryCleanup(address _owner, uint256 _count) external onlyCleaner returns (uint256) {
        return votePower.cleanupOldCheckpoints(_owner, _count, cleanupBlockNumber);
    }

    /**
     * Delete vote power cache entry that expired (i.e. is before `cleanupBlockNumber`).
     * Method can only be called from the `cleanerContract` (which may be a proxy to external cleaners).
     * @param _owner Vote power owner account address.
     * @param _blockNumber Block number for which total supply value was cached.
     * @return Number of deleted cache entries (always 0 or 1).
     */
    function votePowerCacheCleanup(address _owner, uint256 _blockNumber) external onlyCleaner returns (uint256) {
        require(_blockNumber < cleanupBlockNumber, "No cleanup after cleanup block");
        return votePowerCache.deleteValueAt(_owner, _blockNumber);
    }

    /**
     * Delete revocation entry that expired (i.e. is before `cleanupBlockNumber`).
     * Method can only be called from the `cleanerContract` (which may be a proxy to external cleaners).
     * @param _from Delegator address.
     * @param _to Delegatee address.
     * @param _blockNumber Block number for which total supply value was cached.
     * @return Number of revocation entries deleted (always 0 or 1).
     */
    function revocationCleanup(
        address _from,
        address _to,
        uint256 _blockNumber
    )
        external onlyCleaner
        returns (uint256)
    {
        require(_blockNumber < cleanupBlockNumber, "No cleanup after cleanup block");
        return votePowerCache.deleteRevocationAt(_from, _to, _blockNumber);
    }

    /**
     * Delete percentage delegation checkpoints that expired (i.e. are before `cleanupBlockNumber`).
     * Method can only be called from the `cleanerContract` (which may be a proxy to external cleaners).
     * @param _owner Balance owner account address.
     * @param _count Maximum number of checkpoints to delete.
     * @return Number of deleted checkpoints.
     */
    function percentageDelegationHistoryCleanup(address _owner, uint256 _count)
        external onlyCleaner
        returns (uint256)
    {
        return percentageDelegations[_owner].cleanupOldCheckpoints(_count, cleanupBlockNumber);
    }

    /**
     * Delete explicit delegation checkpoints that expired (i.e. are before `cleanupBlockNumber`).
     * Method can only be called from the `cleanerContract` (which may be a proxy to external cleaners).
     * @param _from Delegator address.
     * @param _to Delegatee address.
     * @param _count Maximum number of checkpoints to delete.
     * @return Number of checkpoints deleted.
     */
    function explicitDelegationHistoryCleanup(address _from, address _to, uint256 _count)
        external
        onlyCleaner
        returns (uint256)
    {
        return explicitDelegations[_from].cleanupOldCheckpoints(_to, _count, cleanupBlockNumber);
    }
}
