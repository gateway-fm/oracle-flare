// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

import "../../userInterfaces/IVPToken.sol";
import "../../userInterfaces/IGovernanceVotePower.sol";
import "./IIVPContract.sol";
import "./IIGovernanceVotePower.sol";
import "./IICleanable.sol";

/**
 * Vote power token internal interface.
 */
interface IIVPToken is IVPToken, IICleanable {
    /**
     * Set the contract that is allowed to set cleanupBlockNumber.
     * Usually this will be an instance of CleanupBlockNumberManager.
     */
    function setCleanupBlockNumberManager(address _cleanupBlockNumberManager) external;

    /**
     * Sets new governance vote power contract that allows token owners to participate in governance voting
     * and delegate governance vote power.
     */
    function setGovernanceVotePower(IIGovernanceVotePower _governanceVotePower) external;

    /**
     * Get the total vote power at block `_blockNumber` using cache.
     *   It tries to read the cached value and if it is not found, reads the actual value and stores it in the cache.
     *   Can only be used if `_blockNumber` is in the past, otherwise reverts.
     * @param _blockNumber The block number to query.
     * @return The total vote power at the queried block (sum of all accounts' vote powers).
     */
    function totalVotePowerAtCached(uint256 _blockNumber) external returns(uint256);

    /**
     * Get the vote power of `_owner` at block `_blockNumber` using cache.
     *   It tries to read the cached value and if it is not found, reads the actual value and stores it in the cache.
     *   Can only be used if `_blockNumber` is in the past, otherwise reverts.
     * @param _owner The address to query.
     * @param _blockNumber The block number to query.
     * @return Vote power of `_owner` at `_blockNumber`.
     */
    function votePowerOfAtCached(address _owner, uint256 _blockNumber) external returns(uint256);

    /**
     * Return the vote power for several addresses.
     * @param _owners The list of addresses to query.
     * @param _blockNumber The block number to query.
     * @return Array of vote power for each queried address.
     */
    function batchVotePowerOfAt(
        address[] memory _owners,
        uint256 _blockNumber
    ) external view returns(uint256[] memory);
}
