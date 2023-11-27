// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

/**
 * Internal interface for entities that can have their block history cleaned.
 */
interface IICleanable {
    /**
     * Set the contract that is allowed to call history cleaning methods.
     * @param _cleanerContract Address of the cleanup contract.
     * Usually this will be an instance of `CleanupBlockNumberManager`.
     */
    function setCleanerContract(address _cleanerContract) external;

    /**
     * Set the cleanup block number.
     * Historic data for the blocks before `cleanupBlockNumber` can be erased.
     * History before that block should never be used since it can be inconsistent.
     * In particular, cleanup block number must be lower than the current vote power block.
     * @param _blockNumber The new cleanup block number.
     */
    function setCleanupBlockNumber(uint256 _blockNumber) external;

    /**
     * Get the current cleanup block number set with `setCleanupBlockNumber()`.
     * @return The currently set cleanup block number.
     */
    function cleanupBlockNumber() external view returns (uint256);
}
