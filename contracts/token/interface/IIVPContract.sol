// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

import "../../userInterfaces/IVPToken.sol";
import "../../userInterfaces/IVPContractEvents.sol";
import "./IICleanable.sol";

/**
 * Internal interface for helper contracts handling functionality for an associated VPToken.
 */
interface IIVPContract is IICleanable, IVPContractEvents {
    /**
     * Update vote powers when tokens are transferred.
     * Also update delegated vote powers for percentage delegation
     * and check for enough funds for explicit delegations.
     * @param _from Source account of the transfer.
     * @param _to Destination account of the transfer.
     * @param _fromBalance Balance of the source account before the transfer.
     * @param _toBalance Balance of the destination account before the transfer.
     * @param _amount Amount that has been transferred.
     */
    function updateAtTokenTransfer(
        address _from,
        address _to,
        uint256 _fromBalance,
        uint256 _toBalance,
        uint256 _amount
    ) external;

    /**
     * Delegate `_bips` percentage of voting power from a delegator address to a delegatee address.
     * @param _from The address of the delegator.
     * @param _to The address of the delegatee.
     * @param _balance The delegator's current balance
     * @param _bips The percentage of voting power to be delegated expressed in basis points (1/100 of one percent).
     * Not cumulative: every call resets the delegation value (and a value of 0 revokes delegation).
     */
    function delegate(
        address _from,
        address _to,
        uint256 _balance,
        uint256 _bips
    ) external;

    /**
     * Explicitly delegate `_amount` tokens of voting power from a delegator address to a delegatee address.
     * @param _from The address of the delegator.
     * @param _to The address of the delegatee.
     * @param _balance The delegator's current balance.
     * @param _amount An explicit vote power amount to be delegated.
     * Not cumulative: every call resets the delegation value (and a value of 0 undelegates `_to`).
     */
    function delegateExplicit(
        address _from,
        address _to,
        uint256 _balance,
        uint _amount
    ) external;

    /**
     * Revoke all vote power delegation from a delegator address to a delegatee address at a given block.
     * Only affects the reads via `votePowerOfAtCached()` in the block `_blockNumber`.
     * This method should be used only to prevent rogue delegate voting in the current voting block.
     * To stop delegating use `delegate` or `delegateExplicit` with value of 0,
     * or `undelegateAll`/ `undelegateAllExplicit`.
     * @param _from The address of the delegator.
     * @param _to Address of the delegatee.
     * @param _balance The delegator's current balance.
     * @param _blockNumber The block number at which to revoke delegation. Must be in the past.
     */
    function revokeDelegationAt(
        address _from,
        address _to,
        uint256 _balance,
        uint _blockNumber
    ) external;

    /**
     * Undelegate all voting power for a delegator address.
     * Can only be used with percentage delegation.
     * Does not reset delegation mode back to `NOTSET`.
     * @param _from The address of the delegator.
     * @param _balance The delegator's current balance.
     */
    function undelegateAll(
        address _from,
        uint256 _balance
    ) external;

    /**
     * Undelegate all explicit vote power by amount for a delegator address.
     * Can only be used with explicit delegation.
     * Does not reset delegation mode back to `NOTSET`.
     * @param _from The address of the delegator.
     * @param _delegateAddresses Explicit delegation does not store delegatees' addresses,
     * so the caller must supply them.
     * @return The amount still delegated (in case the list of delegates was incomplete).
     */
    function undelegateAllExplicit(
        address _from,
        address[] memory _delegateAddresses
    ) external returns (uint256);

    /**
     * Get the vote power of an address at a given block number.
     * Reads/updates cache and upholds revocations.
     * @param _who The address being queried.
     * @param _blockNumber The block number being queried.
     * @return Vote power of `_who` at `_blockNumber`, including any delegation received.
     */
    function votePowerOfAtCached(address _who, uint256 _blockNumber) external returns(uint256);

    /**
     * Get the current vote power of an address.
     * @param _who The address being queried.
     * @return Current vote power of `_who`, including any delegation received.
     */
    function votePowerOf(address _who) external view returns(uint256);

    /**
     * Get the vote power of an address at a given block number
     * @param _who The address being queried.
     * @param _blockNumber The block number being queried.
     * @return Vote power of `_who` at `_blockNumber`, including any delegation received.
     */
    function votePowerOfAt(address _who, uint256 _blockNumber) external view returns(uint256);

    /**
     * Get the vote power of an address at a given block number, ignoring revocation information and cache.
     * @param _who The address being queried.
     * @param _blockNumber The block number being queried.
     * @return Vote power of `_who` at `_blockNumber`, including any delegation received.
     * Result doesn't change if vote power is revoked.
     */
    function votePowerOfAtIgnoringRevocation(address _who, uint256 _blockNumber) external view returns(uint256);

    /**
     * Get the vote power of a set of addresses at a given block number.
     * @param _owners The list of addresses being queried.
     * @param _blockNumber The block number being queried.
     * @return Vote power of each address at `_blockNumber`, including any delegation received.
     */
    function batchVotePowerOfAt(
        address[] memory _owners,
        uint256 _blockNumber
    )
        external view returns(uint256[] memory);

    /**
     * Get current delegated vote power from a delegator to a delegatee.
     * @param _from Address of the delegator.
     * @param _to Address of the delegatee.
     * @param _balance The delegator's current balance.
     * @return The delegated vote power.
     */
    function votePowerFromTo(
        address _from,
        address _to,
        uint256 _balance
    ) external view returns(uint256);

    /**
    * Get delegated the vote power from a delegator to a delegatee at a given block number.
    * @param _from Address of the delegator.
    * @param _to Address of the delegatee.
    * @param _balance The delegator's current balance.
    * @param _blockNumber The block number being queried.
    * @return The delegated vote power.
    */
    function votePowerFromToAt(
        address _from,
        address _to,
        uint256 _balance,
        uint _blockNumber
    ) external view returns(uint256);

    /**
     * Compute the current undelegated vote power of an address.
     * @param _owner The address being queried.
     * @param _balance Current balance of that address.
     * @return The unallocated vote power of `_owner`, this is, the amount of vote power
     * currently not being delegated to other addresses.
     */
    function undelegatedVotePowerOf(
        address _owner,
        uint256 _balance
    ) external view returns(uint256);

    /**
     * Compute the undelegated vote power of an address at a given block.
     * @param _owner The address being queried.
     * @param _blockNumber The block number being queried.
     * @return The unallocated vote power of `_owner`, this is, the amount of vote power
     * that was not being delegated to other addresses at that block number.
     */
    function undelegatedVotePowerOfAt(
        address _owner,
        uint256 _balance,
        uint256 _blockNumber
    ) external view returns(uint256);

    /**
     * Get the delegation mode of an address. This mode determines whether vote power is
     * allocated by percentage or by explicit value and cannot be changed once set with
     * `delegate` or `delegateExplicit`.
     * @param _who The address being queried.
     * @return Delegation mode (NOTSET=0, PERCENTAGE=1, AMOUNT=2). See Delegatable.DelegationMode.
     */
    function delegationModeOf(address _who) external view returns (uint256);

    /**
     * Get the percentages and addresses being delegated to by a vote power delegator.
     * @param _owner The address of the delegator being queried.
     * @return _delegateAddresses Array of delegatee addresses.
     * @return _bips Array of delegation percents specified in basis points (1/100 or 1 percent), for each delegatee.
     * @return _count The number of returned delegatees.
     * @return _delegationMode The mode of the delegation (NOTSET=0, PERCENTAGE=1, AMOUNT=2).
     * See Delegatable.DelegationMode.
     */
    function delegatesOf(
        address _owner
    )
        external view
        returns (
            address[] memory _delegateAddresses,
            uint256[] memory _bips,
            uint256 _count,
            uint256 _delegationMode
        );

    /**
     * Get the percentages and addresses being delegated to by a vote power delegator,
     * at a given block.
     * @param _owner The address of the delegator being queried.
     * @param _blockNumber The block number being queried.
     * @return _delegateAddresses Array of delegatee addresses.
     * @return _bips Array of delegation percents specified in basis points (1/100 or 1 percent), for each delegatee.
     * @return _count The number of returned delegatees.
     * @return _delegationMode The mode of the delegation (NOTSET=0, PERCENTAGE=1, AMOUNT=2).
     * See Delegatable.DelegationMode.
     */
    function delegatesOfAt(
        address _owner,
        uint256 _blockNumber
    )
        external view
        returns (
            address[] memory _delegateAddresses,
            uint256[] memory _bips,
            uint256 _count,
            uint256 _delegationMode
        );

    /**
     * The VPToken (or some other contract) that owns this VPContract.
     * All state changing methods may be called only from this address.
     * This is because original `msg.sender` is typically sent in a parameter
     * and we must make sure that it cannot be faked by directly calling
     * IIVPContract methods.
     * Owner token is also used in case of replacement to recover vote powers from balances.
     */
    function ownerToken() external view returns (IVPToken);

    /**
     * Return true if this IIVPContract is configured to be used as a replacement for other contract.
     * It means that vote powers are not necessarily correct at the initialization, therefore
     * every method that reads vote power must check whether it is initialized for that address and block.
     */
    function isReplacement() external view returns (bool);
}
