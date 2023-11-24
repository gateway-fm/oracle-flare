// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

/**
 * Events interface for vote-power related operations.
 */
interface IVPContractEvents {
    /**
     * Emitted when the amount of vote power delegated from one account to another changes.
     *
     * **Note**: This event is always emitted from VPToken's `writeVotePowerContract`.
     * @param from The account that has changed the amount of vote power it is delegating.
     * @param to The account whose received vote power has changed.
     * @param priorVotePower The vote power originally delegated.
     * @param newVotePower The new vote power that triggered this event.
     * It can be 0 if the delegation is completely canceled.
     */
    event Delegate(address indexed from, address indexed to, uint256 priorVotePower, uint256 newVotePower);

    /**
     * Emitted when an account revokes its vote power delegation to another account
     * for a single current or past block (typically the current vote block).
     *
     * **Note**: This event is always emitted from VPToken's `writeVotePowerContract` or `readVotePowerContract`.
     *
     * See `revokeDelegationAt` in `IVPToken`.
     * @param delegator The account that revoked the delegation.
     * @param delegatee The account that has been revoked.
     * @param votePower The revoked vote power.
     * @param blockNumber The block number at which the delegation has been revoked.
     */
    event Revoke(address indexed delegator, address indexed delegatee, uint256 votePower, uint256 blockNumber);
}
