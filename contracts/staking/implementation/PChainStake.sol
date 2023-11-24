// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../../userInterfaces/IPChainVotePower.sol";
import "../../token/implementation/CheckPointable.sol";
import "../../token/lib/VotePower.sol";
import "../../token/lib/VotePowerCache.sol";
import "../lib/PChainStakeHistory.sol";
import "../../utils/implementation/SafePct.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";


/**
 * Helper contract handling all the vote power and balance functionality for the PChainStakeMirror.
 */
contract PChainStake is IPChainVotePower, CheckPointable {
    using PChainStakeHistory for PChainStakeHistory.CheckPointHistoryState;
    using SafeMath for uint256;
    using SafePct for uint256;
    using VotePower for VotePower.VotePowerState;
    using VotePowerCache for VotePowerCache.CacheState;

    // The number of history cleanup steps executed for every write operation.
    // It is more than 1 to make as certain as possible that all history gets cleaned eventually.
    uint256 private constant CHECKPOINTS_CLEANUP_COUNT = 2;

    mapping(address => PChainStakeHistory.CheckPointHistoryState) private stakes;

    // `votePower` tracks all vote power balances
    VotePower.VotePowerState private votePower;

    // `votePowerCache` tracks all cached vote power balances
    VotePowerCache.CacheState private votePowerCache;

    // history cleanup methods

    /**
     * Delete vote power checkpoints that expired (i.e. are before `cleanupBlockNumber`).
     * Method can only be called from the `cleanerContract` (which may be a proxy to external cleaners).
     * @param _nodeId vote power node id
     * @param _count maximum number of checkpoints to delete
     * @return the number of checkpoints deleted
     */
    function votePowerHistoryCleanup(bytes20 _nodeId, uint256 _count) external onlyCleaner returns (uint256) {
        return votePower.cleanupOldCheckpoints(address(_nodeId), _count, _cleanupBlockNumber());
    }

    /**
     * Delete vote power cache entry that expired (i.e. is before `cleanupBlockNumber`).
     * Method can only be called from the `cleanerContract` (which may be a proxy to external cleaners).
     * @param _nodeId vote power node id
     * @param _blockNumber the block number for which total supply value was cached
     * @return the number of cache entries deleted (always 0 or 1)
     */
    function votePowerCacheCleanup(bytes20 _nodeId, uint256 _blockNumber) external onlyCleaner returns (uint256) {
        require(_blockNumber < _cleanupBlockNumber(), "No cleanup after cleanup block");
        return votePowerCache.deleteValueAt(address(_nodeId), _blockNumber);
    }

    /**
     * Delete stakes checkpoints that expired (i.e. are before `cleanupBlockNumber`).
     * Method can only be called from the `cleanerContract` (which may be a proxy to external cleaners).
     * @param _owner Balance owner account address.
     * @param _count Maximum number of checkpoints to delete.
     * @return Number of deleted checkpoints.
     */
    function stakesHistoryCleanup(address _owner, uint256 _count) external onlyCleaner returns (uint256) {
        return stakes[_owner].cleanupOldCheckpoints(_count, _cleanupBlockNumber());
    }

    /**
     * @inheritdoc IPChainVotePower
     */
    function totalVotePowerAtCached(uint256 _blockNumber) external override returns(uint256) {
        return _totalSupplyAtCached(_blockNumber);
    }

    /**
     * @inheritdoc IPChainVotePower
     */
    function votePowerOfAtCached(
        bytes20 _nodeId,
        uint256 _blockNumber
    )
        external override
        notBeforeCleanupBlock(_blockNumber)
        returns(uint256)
    {
        require(_blockNumber < block.number, "Can only be used for past blocks");
        (uint256 vp, bool createdCache) = votePowerCache.valueOfAt(votePower, address(_nodeId), _blockNumber);
        if (createdCache) emit VotePowerCacheCreated(_nodeId, _blockNumber);
        return vp;
    }

    /**
     * @inheritdoc IPChainVotePower
     */
    function totalVotePower() external view override returns(uint256) {
        return totalSupplyAt(block.number);
    }

    /**
     * @inheritdoc IPChainVotePower
     */
    function totalVotePowerAt(uint256 _blockNumber) external view override returns(uint256) {
        return totalSupplyAt(_blockNumber);
    }

    /**
     * @inheritdoc IPChainVotePower
     */
    function stakesOf(address _owner)
        external view override
        returns (
            bytes20[] memory _nodeIds,
            uint256[] memory _amounts
        )
    {
        return stakes[_owner].stakesAtNow();
    }

    /**
     * @inheritdoc IPChainVotePower
     */
    function stakesOfAt(
        address _owner,
        uint256 _blockNumber
    )
        external view override
        notBeforeCleanupBlock(_blockNumber)
        returns (
            bytes20[] memory _nodeIds,
            uint256[] memory _amounts
        )
    {
        return stakes[_owner].stakesAt(_blockNumber);
    }

    /**
     * @inheritdoc IPChainVotePower
     */
    function votePowerFromTo(
        address _owner,
        bytes20 _nodeId
    )
        external view override
        returns(uint256 _votePower)
    {
        return stakes[_owner].valueOfAtNow(_nodeId);
    }

    /**
     * @inheritdoc IPChainVotePower
     */
    function votePowerFromToAt(
        address _owner,
        bytes20 _nodeId,
        uint256 _blockNumber
    )
        external view override
        notBeforeCleanupBlock(_blockNumber)
        returns(uint256 _votePower)
    {
        return stakes[_owner].valueOfAt(_nodeId, _blockNumber);
    }

    /**
     * @inheritdoc IPChainVotePower
     */
    function votePowerOf(bytes20 _nodeId) external view override returns(uint256) {
        return votePower.votePowerOfAtNow(address(_nodeId));
    }

    /**
     * @inheritdoc IPChainVotePower
     */
    function votePowerOfAt(
        bytes20 _nodeId,
        uint256 _blockNumber
    )
        external view override
        notBeforeCleanupBlock(_blockNumber)
        returns(uint256)
    {
        // read cached value for past blocks (and possibly get a cache speedup)
        if (_blockNumber < block.number) {
            return votePowerCache.valueOfAtReadonly(votePower, address(_nodeId), _blockNumber);
        } else {
            return votePower.votePowerOfAtNow(address(_nodeId));
        }
    }

    /**
     * @inheritdoc IPChainVotePower
     */
    function batchVotePowerOfAt(
        bytes20[] memory _owners,
        uint256 _blockNumber
    )
        external view override
        notBeforeCleanupBlock(_blockNumber)
        returns(uint256[] memory _votePowers)
    {
        require(_blockNumber < block.number, "Can only be used for past blocks");
        _votePowers = new uint256[](_owners.length);
        for (uint256 i = 0; i < _owners.length; i++) {
            // read through cache, much faster if it has been set
            _votePowers[i] = votePowerCache.valueOfAtReadonly(votePower, address(_owners[i]), _blockNumber);
        }
    }

    /**
     * Increase vote power by `_amount` for `_nodeId` from `_owner`
     * @param _owner The address of the owner
     * @param _nodeId The node id of the recipient
     * @param _amount The increasing amount of vote power
     **/
    function _increaseVotePower(
        address _owner,
        bytes20 _nodeId,
        uint256 _amount
    )
        internal virtual
    {
        require (_nodeId != bytes20(0), "Cannot stake to zero");
        votePower.changeValue(address(_nodeId), _amount, 0);
        votePower.cleanupOldCheckpoints(address(_nodeId), CHECKPOINTS_CLEANUP_COUNT, _cleanupBlockNumber());

        // Get the vote power of the sender
        PChainStakeHistory.CheckPointHistoryState storage ownerStake = stakes[_owner];

        // the amounts
        uint256 priorAmount = ownerStake.valueOfAtNow(_nodeId);
        uint256 newAmount = priorAmount.add(_amount);

        // Add/replace stake
        ownerStake.writeValue(_nodeId, newAmount);
        ownerStake.cleanupOldCheckpoints(CHECKPOINTS_CLEANUP_COUNT, _cleanupBlockNumber());

        // emit event for stake change
        emit VotePowerChanged(_owner, _nodeId, priorAmount, newAmount);
    }

    /**
     * Decrease vote power by `_amount` for `_nodeId` from `_owner`
     * @param _owner The address of the owner
     * @param _nodeId The node id of the recipient
     * @param _amount The decreasing amount of vote power
     **/
    function _decreaseVotePower(
        address _owner,
        bytes20 _nodeId,
        uint256 _amount
    )
        internal virtual
    {
        require (_nodeId != bytes20(0), "Cannot stake to zero");
        votePower.changeValue(address(_nodeId), 0, _amount);
        votePower.cleanupOldCheckpoints(address(_nodeId), CHECKPOINTS_CLEANUP_COUNT, _cleanupBlockNumber());

        // Get the vote power of the sender
        PChainStakeHistory.CheckPointHistoryState storage ownerStake = stakes[_owner];

        // the amounts
        uint256 priorAmount = ownerStake.valueOfAtNow(_nodeId);
        uint256 newAmount = priorAmount.sub(_amount);

        // Add/replace stake
        ownerStake.writeValue(_nodeId, newAmount);
        ownerStake.cleanupOldCheckpoints(CHECKPOINTS_CLEANUP_COUNT, _cleanupBlockNumber());

        // emit event for stake change
        emit VotePowerChanged(_owner, _nodeId, priorAmount, newAmount);
    }
}
