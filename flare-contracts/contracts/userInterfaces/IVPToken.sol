// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IGovernanceVotePower} from "./IGovernanceVotePower.sol";
import {IVPContractEvents} from "./IVPContractEvents.sol";

/**
 * Vote power token interface.
 */
interface IVPToken is IERC20 {
    /**
     * Delegate voting power to account `_to` from `msg.sender`, by percentage.
     * @param _to The address of the recipient.
     * @param _bips The percentage of voting power to be delegated expressed in basis points (1/100 of one percent).
     *   Not cumulative: every call resets the delegation value (and a value of 0 revokes all previous delegations).
     */
    function delegate(address _to, uint256 _bips) external;

    /**
     * Undelegate all percentage delegations from the sender and then delegate corresponding
     *   `_bips` percentage of voting power from the sender to each member of the `_delegatees` array.
     * @param _delegatees The addresses of the new recipients.
     * @param _bips The percentages of voting power to be delegated expressed in basis points (1/100 of one percent).
     *   The sum of all `_bips` values must be at most 10000 (100%).
     */
    function batchDelegate(address[] memory _delegatees, uint256[] memory _bips) external;

    /**
     * Explicitly delegate `_amount` voting power to account `_to` from `msg.sender`.
     * Compare with `delegate` which delegates by percentage.
     * @param _to The address of the recipient.
     * @param _amount An explicit vote power amount to be delegated.
     *   Not cumulative: every call resets the delegation value (and a value of 0 revokes all previous delegations).
     */
    function delegateExplicit(address _to, uint _amount) external;

    /**
    * Revoke all delegation from sender to `_who` at given block.
    * Only affects the reads via `votePowerOfAtCached()` in the block `_blockNumber`.
    * Block `_blockNumber` must be in the past.
    * This method should be used only to prevent rogue delegate voting in the current voting block.
    * To stop delegating use delegate / delegateExplicit with value of 0 or undelegateAll / undelegateAllExplicit.
    * @param _who Address of the delegatee.
    * @param _blockNumber The block number at which to revoke delegation..
    */
    function revokeDelegationAt(address _who, uint _blockNumber) external;

    /**
     * Undelegate all voting power of `msg.sender`. This effectively revokes all previous delegations.
     * Can only be used with percentage delegation.
     * Does not reset delegation mode back to NOT SET.
     */
    function undelegateAll() external;

    /**
     * Undelegate all explicit vote power by amount of `msg.sender`.
     * Can only be used with explicit delegation.
     * Does not reset delegation mode back to NOT SET.
     * @param _delegateAddresses Explicit delegation does not store delegatees' addresses,
     *   so the caller must supply them.
     * @return The amount still delegated (in case the list of delegates was incomplete).
     */
    function undelegateAllExplicit(address[] memory _delegateAddresses) external returns (uint256);


    /**
     * Returns the name of the token.
     * @dev Should be compatible with ERC20 method.
     */
    function name() external view returns (string memory);

    /**
     * Returns the symbol of the token, usually a shorter version of the name.
     * @dev Should be compatible with ERC20 method.
     */
    function symbol() external view returns (string memory);

    /**
     * Returns the number of decimals used to get its user representation.
     * For example, if `decimals` equals 2, a balance of 505 tokens should
     * be displayed to a user as 5.05 (505 / 10<sup>2</sup>).
     *
     * Tokens usually opt for a value of 18, imitating the relationship between
     * Ether and wei. This is the default value returned by this function, unless
     * it's overridden.
     *
     * NOTE: This information is only used for _display_ purposes: it in
     * no way affects any of the arithmetic of the contract, including
     * balanceOf and transfer.
     * @dev Should be compatible with ERC20 method.
     */
    function decimals() external view returns (uint8);


    /**
     * Total amount of tokens held by all accounts at a specific block number.
     * @param _blockNumber The block number to query.
     * @return The total amount of tokens at `_blockNumber`.
     */
    function totalSupplyAt(uint _blockNumber) external view returns(uint256);

    /**
     * Queries the token balance of `_owner` at a specific `_blockNumber`.
     * @param _owner The address from which the balance will be retrieved.
     * @param _blockNumber The block number to query.
     * @return The balance at `_blockNumber`.
     */
    function balanceOfAt(address _owner, uint _blockNumber) external view returns (uint256);


    /**
     * Get the current total vote power.
     * @return The current total vote power (sum of all accounts' vote power).
     */
    function totalVotePower() external view returns(uint256);

    /**
     * Get the total vote power at block `_blockNumber`.
     * @param _blockNumber The block number to query.
     * @return The total vote power at the queried block (sum of all accounts' vote powers).
     */
    function totalVotePowerAt(uint _blockNumber) external view returns(uint256);

    /**
     * Get the current vote power of `_owner`.
     * @param _owner The address to query.
     * @return Current vote power of `_owner`.
     */
    function votePowerOf(address _owner) external view returns(uint256);

    /**
     * Get the vote power of `_owner` at block `_blockNumber`
     * @param _owner The address to query.
     * @param _blockNumber The block number to query.
     * @return Vote power of `_owner` at block number `_blockNumber`.
     */
    function votePowerOfAt(address _owner, uint256 _blockNumber) external view returns(uint256);

    /**
     * Get the vote power of `_owner` at block `_blockNumber`, ignoring revocation information (and cache).
     * @param _owner The address to query.
     * @param _blockNumber The block number to query.
     * @return Vote power of `_owner` at block number `_blockNumber`. Result doesn't change if vote power is revoked.
     */
    function votePowerOfAtIgnoringRevocation(address _owner, uint256 _blockNumber) external view returns(uint256);

    /**
     * Get the delegation mode for account '_who'. This mode determines whether vote power is
     * allocated by percentage or by explicit amount. Once the delegation mode is set,
     * it can never be changed, even if all delegations are removed.
     * @param _who The address to get delegation mode.
     * @return Delegation mode: 0 = NOT SET, 1 = PERCENTAGE, 2 = AMOUNT (i.e. explicit).
     */
    function delegationModeOf(address _who) external view returns(uint256);

    /**
     * Get current delegated vote power from delegator `_from` to delegatee `_to`.
     * @param _from Address of delegator.
     * @param _to Address of delegatee.
     * @return votePower The delegated vote power.
     */
    function votePowerFromTo(address _from, address _to) external view returns(uint256);

    /**
     * Get delegated vote power from delegator `_from` to delegatee `_to` at `_blockNumber`.
     * @param _from Address of delegator.
     * @param _to Address of delegatee.
     * @param _blockNumber The block number to query.
     * @return The delegated vote power.
     */
    function votePowerFromToAt(address _from, address _to, uint _blockNumber) external view returns(uint256);

    /**
     * Compute the current undelegated vote power of the `_owner` account.
     * @param _owner The address to query.
     * @return The unallocated vote power of `_owner`.
     */
    function undelegatedVotePowerOf(address _owner) external view returns(uint256);

    /**
     * Get the undelegated vote power of the `_owner` account at a given block number.
     * @param _owner The address to query.
     * @param _blockNumber The block number to query.
     * @return The unallocated vote power of `_owner`.
     */
    function undelegatedVotePowerOfAt(address _owner, uint256 _blockNumber) external view returns(uint256);

    /**
     * Get the list of addresses to which `_who` is delegating, and their percentages.
     * @param _who The address to query.
     * @return _delegateAddresses Positional array of addresses being delegated to.
     * @return _bips Positional array of delegation percents specified in basis points (1/100 of 1 percent).
     *    Each one matches the address in the same position in the `_delegateAddresses` array.
     * @return _count The number of delegates.
     * @return _delegationMode Delegation mode: 0 = NOT SET, 1 = PERCENTAGE, 2 = AMOUNT (i.e. explicit).
     */
    function delegatesOf(address _who)
        external view
        returns (
            address[] memory _delegateAddresses,
            uint256[] memory _bips,
            uint256 _count,
            uint256 _delegationMode
        );

    /**
     * Get the list of addresses to which `_who` is delegating, and their percentages, at the given block.
     * @param _who The address to query.
     * @param _blockNumber The block number to query.
     * @return _delegateAddresses Positional array of addresses being delegated to.
     * @return _bips Positional array of delegation percents specified in basis points (1/100 of 1 percent).
     *    Each one matches the address in the same position in the `_delegateAddresses` array.
     * @return _count The number of delegates.
     * @return _delegationMode Delegation mode: 0 = NOT SET, 1 = PERCENTAGE, 2 = AMOUNT (i.e. explicit).
     */
    function delegatesOfAt(address _who, uint256 _blockNumber)
        external view
        returns (
            address[] memory _delegateAddresses,
            uint256[] memory _bips,
            uint256 _count,
            uint256 _delegationMode
        );

    /**
     * Returns VPContract event interface used for read-only operations (view methods).
     * The only non-view method that might be called on it is `revokeDelegationAt`.
     *
     * `readVotePowerContract` is almost always equal to `writeVotePowerContract`
     * except during an upgrade from one `VPContract` to a new version (which should happen
     * rarely or never and will be announced beforehand).
     *
     * Do not call any methods on `VPContract` directly.
     * State changing methods are forbidden from direct calls.
     * All methods are exposed via `VPToken`.
     * This is the reason that this method returns `IVPContractEvents`.
     * Use it only for listening to events and revoking.
     */
    function readVotePowerContract() external view returns (IVPContractEvents);

    /**
     * Returns VPContract event interface used for state-changing operations (non-view methods).
     * The only non-view method that might be called on it is `revokeDelegationAt`.
     *
     * `writeVotePowerContract` is almost always equal to `readVotePowerContract`,
     * except during upgrade from one `VPContract` to a new version (which should happen
     * rarely or never and will be announced beforehand).
     * In the case of an upgrade, `writeVotePowerContract` is replaced first to establish delegations.
     * After some period (e.g., after a reward epoch ends), `readVotePowerContract` is set equal to it.
     *
     * Do not call any methods on `VPContract` directly.
     * State changing methods are forbidden from direct calls.
     * All are exposed via `VPToken`.
     * This is the reason that this method returns `IVPContractEvents`
     * Use it only for listening to events, delegating, and revoking.
     */
    function writeVotePowerContract() external view returns (IVPContractEvents);

    /**
     * When set, allows token owners to participate in governance voting
     * and delegating governance vote power.
     */
    function governanceVotePower() external view returns (IGovernanceVotePower);
}
