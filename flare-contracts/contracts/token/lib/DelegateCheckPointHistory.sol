// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "@openzeppelin/contracts/math/Math.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/SafeCast.sol";


/**
 * @title Check Point History library
 * @notice A contract to manage checkpoints as of a given block.
 * @dev Store value history by block number with detachable state.
 **/
library DelegateCheckPointHistory {
    using SafeMath for uint256;
    using SafeCast for uint256;

    /**
     * @dev `DelegateCheckPoint` is the structure that attaches a block number to a
     *  given address; the block number attached is the one that last changed the
     *  value
     **/
    struct DelegateCheckPoint {
        // `to` is the delegate's address
        address to;
        // `fromBlock` is the block number that the value was generated from
        uint64 fromBlock;
    }

    struct DelegateCheckPointHistoryState {
        // `checkpoints` is an array that tracks values at non-contiguous block numbers
        mapping(uint256 => DelegateCheckPoint) checkpoints;
        // `checkpoints` before `startIndex` have been deleted
        // INVARIANT: checkpoints.endIndex == 0 || startIndex < checkpoints.endIndex      (strict!)
        // startIndex and endIndex are both less then fromBlock, so 64 bits is enough
        uint64 startIndex;
        // the index AFTER last
        uint64 endIndex;
    }

    /**
     * @notice Binary search of _checkpoints array.
     * @param _checkpoints An array of CheckPoint to search.
     * @param _startIndex Smallest possible index to be returned.
     * @param _blockNumber The block number to search for.
     */
    function _indexOfGreatestBlockLessThan(
        mapping(uint256 => DelegateCheckPoint) storage _checkpoints, 
        uint256 _startIndex,
        uint256 _endIndex,
        uint256 _blockNumber
    )
        private view 
        returns (uint256 index)
    {
        // Binary search of the value by given block number in the array
        uint256 min = _startIndex;
        uint256 max = _endIndex.sub(1);
        while (max > min) {
            uint256 mid = (max.add(min).add(1)).div(2);
            if (_checkpoints[mid].fromBlock <= _blockNumber) {
                min = mid;
            } else {
                max = mid.sub(1);
            }
        }
        return min;
    }

    /**
     * @notice Queries the value at a specific `_blockNumber`
     * @param _self A CheckPointHistoryState instance to manage
     * @param _blockNumber The block number of the value active at that time
     * @return _to Delegator's address at `_blockNumber`     
     **/
    function delegateAddressAt(
        DelegateCheckPointHistoryState storage _self, 
        uint256 _blockNumber
    )
        internal view 
        returns (address _to)
    {
        uint256 historyCount = _self.endIndex;

        // No _checkpoints, return 0
        if (historyCount == 0) return address(0);

        // Shortcut for the actual address (extra optimized for current block, to save one storage read)
        // historyCount - 1 is safe, since historyCount != 0
        if (_blockNumber >= block.number || _blockNumber >= _self.checkpoints[historyCount - 1].fromBlock) {
            return _self.checkpoints[historyCount - 1].to;
        }
        
        // guard values at start    
        uint256 startIndex = _self.startIndex;
        if (_blockNumber < _self.checkpoints[startIndex].fromBlock) {
            // reading data before `startIndex` is only safe before first cleanup
            require(startIndex == 0, "CheckPointHistory: reading from cleaned-up block");
            return address(0);
        }

        // Find the block with number less than or equal to block given
        uint256 index = _indexOfGreatestBlockLessThan(_self.checkpoints, startIndex, _self.endIndex, _blockNumber);

        return _self.checkpoints[index].to;
    }

    /**
     * @notice Queries the value at `block.number`
     * @param _self A CheckPointHistoryState instance to manage.
     * @return _to Delegator's address at `block.number`
     **/
    function delegateAddressAtNow(DelegateCheckPointHistoryState storage _self) internal view returns (address _to) {
        uint256 historyCount = _self.endIndex;
        // No _checkpoints, return 0
        if (historyCount == 0) return address(0);
        // Return last value
        return _self.checkpoints[historyCount - 1].to;
    }

    /**
     * @notice Writes the address at the current block.
     * @param _self A DelegateCheckPointHistoryState instance to manage.
     * @param _to Delegate's address.
     **/
    function writeAddress(
        DelegateCheckPointHistoryState storage _self, 
        address _to
    )
        internal
    {
        uint256 historyCount = _self.endIndex;
        if (historyCount == 0) {
            // checkpoints array empty, push new CheckPoint
            _self.checkpoints[0] = 
                DelegateCheckPoint({ fromBlock: block.number.toUint64(), to: _to });
            _self.endIndex = 1;
        } else {
            // historyCount - 1 is safe, since historyCount != 0
            DelegateCheckPoint storage lastCheckpoint = _self.checkpoints[historyCount - 1];
            uint256 lastBlock = lastCheckpoint.fromBlock;
            // slither-disable-next-line incorrect-equality
            if (block.number == lastBlock) {
                // If last check point is the current block, just update
                lastCheckpoint.to = _to;
            } else {
                // we should never have future blocks in history
                assert (block.number > lastBlock);
                // push new CheckPoint
                _self.checkpoints[historyCount] = 
                    DelegateCheckPoint({ fromBlock: block.number.toUint64(), to: _to });
                _self.endIndex = uint64(historyCount + 1);  // 64 bit safe, because historyCount <= block.number
            }
        }
    }
    
    /**
     * Delete at most `_count` of the oldest checkpoints.
     * At least one checkpoint at or before `_cleanupBlockNumber` will remain 
     * (unless the history was empty to start with).
     */    
    function cleanupOldCheckpoints(
        DelegateCheckPointHistoryState storage _self, 
        uint256 _count,
        uint256 _cleanupBlockNumber
    )
        internal
        returns (uint256)
    {
        if (_cleanupBlockNumber == 0) return 0;   // optimization for when cleaning is not enabled
        uint256 length = _self.endIndex;
        if (length == 0) return 0;
        uint256 startIndex = _self.startIndex;
        // length - 1 is safe, since length != 0 (check above)
        uint256 endIndex = Math.min(startIndex.add(_count), length - 1);    // last element can never be deleted
        uint256 index = startIndex;
        // we can delete `checkpoint[index]` while the next checkpoint is at `_cleanupBlockNumber` or before
        while (index < endIndex && _self.checkpoints[index + 1].fromBlock <= _cleanupBlockNumber) {
            delete _self.checkpoints[index];
            index++;
        }
        if (index > startIndex) {   // index is the first not deleted index
            _self.startIndex = index.toUint64();
        }
        return index - startIndex;  // safe: index >= startIndex at start and then increases
    }

}
