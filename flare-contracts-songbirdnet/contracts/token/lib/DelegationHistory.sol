// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "@openzeppelin/contracts/math/Math.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "../../utils/implementation/SafePct.sol";


/**
 * @title DelegationHistory library
 * @notice A contract to manage checkpoints as of a given block.
 * @dev Store value history by block number with detachable state.
 **/
library DelegationHistory {
    using SafeMath for uint256;
    using SafePct for uint256;

    uint256 public constant MAX_DELEGATES_BY_PERCENT = 2;
    string private constant MAX_DELEGATES_MSG = "Max delegates exceeded";
    
    /**
     * @dev `CheckPoint` is the structure that attaches a block number to a
     *  given value; the block number attached is the one that last changed the
     *  value
     **/
    struct CheckPoint {
        // `fromBlock` is the block number that the value was generated from
        uint256 fromBlock;
        // the list of active delegates at this time
        address[] delegates;
        // the values delegated to the corresponding delegate at this time
        uint256[] values;
    }

    struct CheckPointHistoryState {
        // `checkpoints` is an array that tracks delegations at non-contiguous block numbers
        CheckPoint[] checkpoints;
        // `checkpoints` before `startIndex` have been deleted
        // INVARIANT: checkpoints.length == 0 || startIndex < checkpoints.length      (strict!)
        uint256 startIndex;
    }

    /**
     * @notice Queries the value at a specific `_blockNumber`
     * @param _self A CheckPointHistoryState instance to manage.
     * @param _delegate The delegate for which we need value.
     * @param _blockNumber The block number of the value active at that time
     * @return _value The value of the `_delegate` at `_blockNumber`     
     **/
    function valueOfAt(
        CheckPointHistoryState storage _self, 
        address _delegate, 
        uint256 _blockNumber
    )
        internal view 
        returns (uint256 _value)
    {
        (bool found, uint256 index) = _findGreatestBlockLessThan(_self.checkpoints, _self.startIndex, _blockNumber);
        if (!found) return 0;

        // find the delegate and return the corresponding value
        CheckPoint storage cp = _self.checkpoints[index];
        uint256 length = cp.delegates.length;
        for (uint256 i = 0; i < length; i++) {
            if (cp.delegates[i] == _delegate) {
                return cp.values[i];
            }
        }
        return 0;   // _delegate not found
    }

    /**
     * @notice Queries the value at `block.number`
     * @param _self A CheckPointHistoryState instance to manage.
     * @param _delegate The delegate for which we need value.
     * @return _value The value at `block.number`
     **/
    function valueOfAtNow(
        CheckPointHistoryState storage _self, 
        address _delegate
    )
        internal view
        returns (uint256 _value)
    {
        return valueOfAt(_self, _delegate, block.number);
    }

    /**
     * @notice Writes the value at the current block.
     * @param _self A CheckPointHistoryState instance to manage.
     * @param _delegate The delegate tu update.
     * @param _value The new value to set for this delegate (value `0` deletes `_delegate` from the list).
     **/
    function writeValue(
        CheckPointHistoryState storage _self, 
        address _delegate, 
        uint256 _value
    )
        internal
    {
        uint256 historyCount = _self.checkpoints.length;
        if (historyCount == 0) {
            // checkpoints array empty, push new CheckPoint
            if (_value != 0) {
                CheckPoint storage cp = _self.checkpoints.push();
                cp.fromBlock = block.number;
                cp.delegates.push(_delegate);
                cp.values.push(_value);
            }
        } else {
            // historyCount - 1 is safe, since historyCount != 0
            CheckPoint storage lastCheckpoint = _self.checkpoints[historyCount - 1];
            uint256 lastBlock = lastCheckpoint.fromBlock;
            // slither-disable-next-line incorrect-equality
            if (block.number == lastBlock) {
                // If last check point is the current block, just update
                _updateDelegates(lastCheckpoint, _delegate, _value);
            } else {
                // we should never have future blocks in history
                assert(block.number > lastBlock); 
                // last check point block is before
                CheckPoint storage cp = _self.checkpoints.push();
                cp.fromBlock = block.number;
                _copyAndUpdateDelegates(cp, lastCheckpoint, _delegate, _value);
            }
        }
    }
    
    /**
     * Get all percentage delegations active at a time.
     * @param _self A CheckPointHistoryState instance to manage.
     * @param _blockNumber The block number to query. 
     * @return _delegates The active percentage delegates at the time. 
     * @return _values The delegates' values at the time. 
     **/
    function delegationsAt(
        CheckPointHistoryState storage _self,
        uint256 _blockNumber
    )
        internal view
        returns (
            address[] memory _delegates,
            uint256[] memory _values
        )
    {
        (bool found, uint256 index) = _findGreatestBlockLessThan(_self.checkpoints, _self.startIndex, _blockNumber);
        if (!found) {
            return (new address[](0), new uint256[](0));
        }

        // copy delegates and values to memory arrays
        // (to prevent caller updating the stored value)
        CheckPoint storage cp = _self.checkpoints[index];
        uint256 length = cp.delegates.length;
        _delegates = new address[](length);
        _values = new uint256[](length);
        for (uint256 i = 0; i < length; i++) {
            _delegates[i] = cp.delegates[i];
            _values[i] = cp.values[i];
        }
    }
    
    /**
     * Get all percentage delegations active now.
     * @param _self A CheckPointHistoryState instance to manage.
     * @return _delegates The active percentage delegates. 
     * @return _values The delegates' values. 
     **/
    function delegationsAtNow(
        CheckPointHistoryState storage _self
    )
        internal view
        returns (address[] memory _delegates, uint256[] memory _values)
    {
        return delegationsAt(_self, block.number);
    }
    
    /**
     * Get the number of delegations.
     * @param _self A CheckPointHistoryState instance to query.
     * @param _blockNumber The block number to query. 
     * @return _count Count of delegations at the time.
     **/
    function countAt(
        CheckPointHistoryState storage _self,
        uint256 _blockNumber
    )
        internal view
        returns (uint256 _count)
    {
        (bool found, uint256 index) = _findGreatestBlockLessThan(_self.checkpoints, _self.startIndex, _blockNumber);
        if (!found) return 0;
        return _self.checkpoints[index].delegates.length;
    }
    
    /**
     * Get the sum of all delegation values.
     * @param _self A CheckPointHistoryState instance to query.
     * @param _blockNumber The block number to query. 
     * @return _total Total delegation value at the time.
     **/
    function totalValueAt(
        CheckPointHistoryState storage _self, 
        uint256 _blockNumber
    )
        internal view
        returns (uint256 _total)
    {
        (bool found, uint256 index) = _findGreatestBlockLessThan(_self.checkpoints, _self.startIndex, _blockNumber);
        if (!found) return 0;
        
        CheckPoint storage cp = _self.checkpoints[index];
        uint256 length = cp.values.length;
        _total = 0;
        for (uint256 i = 0; i < length; i++) {
            _total = _total.add(cp.values[i]);
        }
    }

    /**
     * Get the sum of all delegation values.
     * @param _self A CheckPointHistoryState instance to query.
     * @return _total Total delegation value at the time.
     **/
    function totalValueAtNow(
        CheckPointHistoryState storage _self
    )
        internal view
        returns (uint256 _total)
    {
        return totalValueAt(_self, block.number);
    }

    /**
     * Get the sum of all delegation values, every one scaled by `_mul/_div`.
     * @param _self A CheckPointHistoryState instance to query.
     * @param _mul The multiplier.
     * @param _div The divisor.
     * @param _blockNumber The block number to query. 
     * @return _total Total scaled delegation value at the time.
     **/
    function scaledTotalValueAt(
        CheckPointHistoryState storage _self, 
        uint256 _mul,
        uint256 _div,
        uint256 _blockNumber
    )
        internal view
        returns (uint256 _total)
    {
        (bool found, uint256 index) = _findGreatestBlockLessThan(_self.checkpoints, _self.startIndex, _blockNumber);
        if (!found) return 0;
        
        CheckPoint storage cp = _self.checkpoints[index];
        uint256 length = cp.values.length;
        _total = 0;
        for (uint256 i = 0; i < length; i++) {
            _total = _total.add(cp.values[i].mulDiv(_mul, _div));
        }
    }

    /**
     * Clear all delegations at this moment.
     * @param _self A CheckPointHistoryState instance to manage.
     */    
    function clear(CheckPointHistoryState storage _self) internal {
        if (_self.checkpoints.length > 0) {
            // add an empty checkpoint
            CheckPoint storage cp = _self.checkpoints.push();
            cp.fromBlock = block.number;
        }
    }

    /**
     * Delete at most `_count` of the oldest checkpoints.
     * At least one checkpoint at or before `_cleanupBlockNumber` will remain 
     * (unless the history was empty to start with).
     */    
    function cleanupOldCheckpoints(
        CheckPointHistoryState storage _self, 
        uint256 _count,
        uint256 _cleanupBlockNumber
    )
        internal
        returns (uint256)
    {
        if (_cleanupBlockNumber == 0) return 0;   // optimization for when cleaning is not enabled
        uint256 length = _self.checkpoints.length;
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
            _self.startIndex = index;
        }
        return index - startIndex;  // safe: index = startIndex at start and increases in loop
    }

    /////////////////////////////////////////////////////////////////////////////////
    // helper functions for writeValueAt
    
    function _copyAndUpdateDelegates(
        CheckPoint storage _cp, 
        CheckPoint storage _orig, 
        address _delegate, 
        uint256 _value
    )
        private
    {
        uint256 length = _orig.delegates.length;
        bool updated = false;
        for (uint256 i = 0; i < length; i++) {
            address origDelegate = _orig.delegates[i];
            if (origDelegate == _delegate) {
                // copy delegate, but with new value
                _appendDelegate(_cp, origDelegate, _value, i);
                updated = true;
            } else {
                // just copy the delegate with original value
                _appendDelegate(_cp, origDelegate, _orig.values[i], i);
            }
        }
        if (!updated) {
            // delegate is not in the original list, so add it
            _appendDelegate(_cp, _delegate, _value, length);
        }
    }

    function _updateDelegates(CheckPoint storage _cp, address _delegate, uint256 _value) private {
        uint256 length = _cp.delegates.length;
        uint256 i = 0;
        while (i < length && _cp.delegates[i] != _delegate) ++i;
        if (i < length) {
            if (_value != 0) {
                _cp.values[i] = _value;
            } else {
                _deleteDelegate(_cp, i, length - 1);  // length - 1 is safe:  0 <= i < length
            }
        } else {
            _appendDelegate(_cp, _delegate, _value, length);
        }
    }
    
    function _appendDelegate(CheckPoint storage _cp, address _delegate, uint256 _value, uint256 _length) private {
        if (_value != 0) {
            require(_length < MAX_DELEGATES_BY_PERCENT, MAX_DELEGATES_MSG);
            _cp.delegates.push(_delegate);
            _cp.values.push(_value);
        }
    }
    
    function _deleteDelegate(CheckPoint storage _cp, uint256 _index, uint256 _last) private {
        if (_index < _last) {
            _cp.delegates[_index] = _cp.delegates[_last];
            _cp.values[_index] = _cp.values[_last];
        }
        _cp.delegates.pop();
        _cp.values.pop();
    }
    
    /////////////////////////////////////////////////////////////////////////////////
    // helper functions for querying
    
    /**
     * @notice Binary search of _checkpoints array.
     * @param _checkpoints An array of CheckPoint to search.
     * @param _startIndex Smallest possible index to be returned.
     * @param _blockNumber The block number to search for.
     */
    function _binarySearchGreatestBlockLessThan(
        CheckPoint[] storage _checkpoints, 
        uint256 _startIndex,
        uint256 _blockNumber
    )
        private view
        returns (uint256 _index)
    {
        // Binary search of the value by given block number in the array
        uint256 min = _startIndex;
        uint256 max = _checkpoints.length.sub(1);
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
     * @notice Binary search of _checkpoints array. Extra optimized for the common case when we are 
     *   searching for the last block.
     * @param _checkpoints An array of CheckPoint to search.
     * @param _startIndex Smallest possible index to be returned.
     * @param _blockNumber The block number to search for.
     * @return _found true if value was found (only `false` if `_blockNumber` is before first 
     *   checkpoint or the checkpoint array is empty)
     * @return _index index of the newest block with number less than or equal `_blockNumber`
     */
    function _findGreatestBlockLessThan(
        CheckPoint[] storage _checkpoints, 
        uint256 _startIndex,
        uint256 _blockNumber
    )
        private view
        returns (
            bool _found,
            uint256 _index
        )
    {
        uint256 historyCount = _checkpoints.length;
        if (historyCount == 0) {
            _found = false;
        } else if (_blockNumber >= block.number || _blockNumber >= _checkpoints[historyCount - 1].fromBlock) {
            // _blockNumber >= block.number saves one storage read for reads at current block
            _found = true;
            _index = historyCount - 1;  // safe, historyCount != 0 in this branch
        } else if (_blockNumber < _checkpoints[_startIndex].fromBlock) {
            // reading data before `_startIndex` is only safe before first cleanup
            require(_startIndex == 0, "DelegationHistory: reading from cleaned-up block");
            _found = false;
        } else {
            _found = true;
            _index = _binarySearchGreatestBlockLessThan(_checkpoints, _startIndex, _blockNumber);
        }
    }
}
