// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "@openzeppelin/contracts/math/Math.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/SafeCast.sol";
import "../../utils/implementation/SafePct.sol";

/**
 * @title DelegationHistory library
 * @notice A contract to manage checkpoints as of a given block.
 * @dev Store value history by block number with detachable state.
 **/
library DelegationHistory {
    using SafeMath for uint256;
    using SafePct for uint256;
    using SafeCast for uint256;

    uint256 public constant MAX_DELEGATES_BY_PERCENT = 2;
    string private constant MAX_DELEGATES_MSG = "Max delegates exceeded";
    
    struct Delegation {
        address delegate;
        uint16 value;
        
        // delegations[0] will also hold length and blockNumber to save 1 slot of storage per checkpoint
        // for all other indexes these fields will be 0
        // also, when checkpoint is empty, `length` will automatically be 0, which is ok
        uint64 fromBlock;
        uint8 length;       // length is limited to MAX_DELEGATES_BY_PERCENT which fits in 8 bits
    }
    
    /**
     * @dev `CheckPoint` is the structure that attaches a block number to a
     *  given value; the block number attached is the one that last changed the
     *  value
     **/
    struct CheckPoint {
        // the list of delegations at the time
        mapping(uint256 => Delegation) delegations;
    }

    struct CheckPointHistoryState {
        // `checkpoints` is an array that tracks delegations at non-contiguous block numbers
        mapping(uint256 => CheckPoint) checkpoints;
        // `checkpoints` before `startIndex` have been deleted
        // INVARIANT: checkpoints.length == 0 || startIndex < checkpoints.length      (strict!)
        uint64 startIndex;
        uint64 length;
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
        (bool found, uint256 index) = _findGreatestBlockLessThan(_self, _blockNumber);
        if (!found) return 0;
        return _getValueForDelegate(_self.checkpoints[index], _delegate);
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
        uint256 length = _self.length;
        if (length == 0) return 0;
        return _getValueForDelegate(_self.checkpoints[length - 1], _delegate);
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
        uint256 historyCount = _self.length;
        if (historyCount == 0) {
            // checkpoints array empty, push new CheckPoint
            if (_value != 0) {
                CheckPoint storage cp = _self.checkpoints[historyCount];
                _self.length = SafeCast.toUint64(historyCount + 1);
                cp.delegations[0] = Delegation({ 
                    delegate: _delegate,
                    value: _value.toUint16(),
                    fromBlock:  block.number.toUint64(),
                    length: 1 
                });
            }
        } else {
            // historyCount - 1 is safe, since historyCount != 0
            CheckPoint storage lastCheckpoint = _self.checkpoints[historyCount - 1];
            uint256 lastBlock = lastCheckpoint.delegations[0].fromBlock;
            // slither-disable-next-line incorrect-equality
            if (block.number == lastBlock) {
                // If last check point is the current block, just update
                _updateDelegates(lastCheckpoint, _delegate, _value);
            } else {
                // we should never have future blocks in history
                assert(block.number > lastBlock); 
                // last check point block is before
                CheckPoint storage cp = _self.checkpoints[historyCount];
                _self.length = SafeCast.toUint64(historyCount + 1);
                _copyAndUpdateDelegates(cp, lastCheckpoint, _delegate, _value);
                cp.delegations[0].fromBlock = block.number.toUint64();
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
        (bool found, uint256 index) = _findGreatestBlockLessThan(_self, _blockNumber);
        if (!found) {
            return (new address[](0), new uint256[](0));
        }

        // copy delegates and values to memory arrays
        // (to prevent caller updating the stored value)
        CheckPoint storage cp = _self.checkpoints[index];
        uint256 length = cp.delegations[0].length;
        _delegates = new address[](length);
        _values = new uint256[](length);
        for (uint256 i = 0; i < length; i++) {
            Delegation storage dlg = cp.delegations[i];
            _delegates[i] = dlg.delegate;
            _values[i] = dlg.value;
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
     * Get all percentage delegations active now.
     * @param _self A CheckPointHistoryState instance to manage.
     * @return _length The number of delegations. 
     * @return _delegations . 
     **/
    function delegationsAtNowRaw(
        CheckPointHistoryState storage _self
    )
        internal view
        returns (
            uint256 _length, 
            mapping(uint256 => Delegation) storage _delegations
        )
    {
        uint256 length = _self.length;
        if (length == 0) {
            return (0, _self.checkpoints[0].delegations);
        }
        CheckPoint storage cp = _self.checkpoints[length - 1];
        return (cp.delegations[0].length, cp.delegations);
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
        (bool found, uint256 index) = _findGreatestBlockLessThan(_self, _blockNumber);
        if (!found) return 0;
        return _self.checkpoints[index].delegations[0].length;
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
        (bool found, uint256 index) = _findGreatestBlockLessThan(_self, _blockNumber);
        if (!found) return 0;
        
        CheckPoint storage cp = _self.checkpoints[index];
        uint256 length = cp.delegations[0].length;
        _total = 0;
        for (uint256 i = 0; i < length; i++) {
            _total = _total.add(cp.delegations[i].value);
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
        (bool found, uint256 index) = _findGreatestBlockLessThan(_self, _blockNumber);
        if (!found) return 0;
        
        CheckPoint storage cp = _self.checkpoints[index];
        uint256 length = cp.delegations[0].length;
        _total = 0;
        for (uint256 i = 0; i < length; i++) {
            _total = _total.add(uint256(cp.delegations[i].value).mulDiv(_mul, _div));
        }
    }

    /**
     * Clear all delegations at this moment.
     * @param _self A CheckPointHistoryState instance to manage.
     */    
    function clear(CheckPointHistoryState storage _self) internal {
        uint256 historyCount = _self.length;
        if (historyCount > 0) {
            // add an empty checkpoint
            CheckPoint storage cp = _self.checkpoints[historyCount];
            _self.length = SafeCast.toUint64(historyCount + 1);
            // create empty checkpoint = only set fromBlock
            cp.delegations[0] = Delegation({ 
                delegate: address(0),
                value: 0,
                fromBlock: block.number.toUint64(),
                length: 0
            });
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
        uint256 length = _self.length;
        if (length == 0) return 0;
        uint256 startIndex = _self.startIndex;
        // length - 1 is safe, since length != 0 (check above)
        uint256 endIndex = Math.min(startIndex.add(_count), length - 1);    // last element can never be deleted
        uint256 index = startIndex;
        // we can delete `checkpoint[index]` while the next checkpoint is at `_cleanupBlockNumber` or before
        while (index < endIndex && _self.checkpoints[index + 1].delegations[0].fromBlock <= _cleanupBlockNumber) {
            CheckPoint storage cp = _self.checkpoints[index];
            uint256 cplength = cp.delegations[0].length;
            for (uint256 i = 0; i < cplength; i++) {
                delete cp.delegations[i];
            }
            index++;
        }
        if (index > startIndex) {   // index is the first not deleted index
            _self.startIndex = SafeCast.toUint64(index);
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
        uint256 length = _orig.delegations[0].length;
        bool updated = false;
        uint256 newlength = 0;
        for (uint256 i = 0; i < length; i++) {
            Delegation memory origDlg = _orig.delegations[i];
            if (origDlg.delegate == _delegate) {
                // copy delegate, but with new value
                newlength = _appendDelegate(_cp, origDlg.delegate, _value, newlength);
                updated = true;
            } else {
                // just copy the delegate with original value
                newlength = _appendDelegate(_cp, origDlg.delegate, origDlg.value, newlength);
            }
        }
        if (!updated) {
            // delegate is not in the original list, so add it
            newlength = _appendDelegate(_cp, _delegate, _value, newlength);
        }
        // safe - newlength <= length + 1 <= MAX_DELEGATES_BY_PERCENT
        _cp.delegations[0].length = uint8(newlength);
    }

    function _updateDelegates(CheckPoint storage _cp, address _delegate, uint256 _value) private {
        uint256 length = _cp.delegations[0].length;
        uint256 i = 0;
        while (i < length && _cp.delegations[i].delegate != _delegate) ++i;
        if (i < length) {
            if (_value != 0) {
                _cp.delegations[i].value = _value.toUint16();
            } else {
                _deleteDelegate(_cp, i, length - 1);  // length - 1 is safe:  0 <= i < length
                _cp.delegations[0].length = uint8(length - 1);
            }
        } else {
            uint256 newlength = _appendDelegate(_cp, _delegate, _value, length);
            _cp.delegations[0].length = uint8(newlength);  // safe - length <= MAX_DELEGATES_BY_PERCENT
        }
    }
    
    function _appendDelegate(CheckPoint storage _cp, address _delegate, uint256 _value, uint256 _length) 
        private 
        returns (uint256)
    {
        if (_value != 0) {
            require(_length < MAX_DELEGATES_BY_PERCENT, MAX_DELEGATES_MSG);
            Delegation storage dlg = _cp.delegations[_length];
            dlg.delegate = _delegate;
            dlg.value = _value.toUint16();
            // for delegations[0], fromBlock and length are assigned outside
            return _length + 1;
        }
        return _length;
    }
    
    function _deleteDelegate(CheckPoint storage _cp, uint256 _index, uint256 _last) private {
        Delegation storage dlg = _cp.delegations[_index];
        Delegation storage lastDlg = _cp.delegations[_last];
        if (_index < _last) {
            dlg.delegate = lastDlg.delegate;
            dlg.value = lastDlg.value;
        }
        lastDlg.delegate = address(0);
        lastDlg.value = 0;
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
        mapping(uint256 => CheckPoint) storage _checkpoints, 
        uint256 _startIndex,
        uint256 _endIndex,
        uint256 _blockNumber
    )
        private view
        returns (uint256 _index)
    {
        // Binary search of the value by given block number in the array
        uint256 min = _startIndex;
        uint256 max = _endIndex.sub(1);
        while (max > min) {
            uint256 mid = (max.add(min).add(1)).div(2);
            if (_checkpoints[mid].delegations[0].fromBlock <= _blockNumber) {
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
     * @param _self The state to query.
     * @param _blockNumber The block number to search for.
     * @return _found true if value was found (only `false` if `_blockNumber` is before first 
     *   checkpoint or the checkpoint array is empty)
     * @return _index index of the newest block with number less than or equal `_blockNumber`
     */
    function _findGreatestBlockLessThan(
        CheckPointHistoryState storage _self, 
        uint256 _blockNumber
    )
        private view
        returns (
            bool _found,
            uint256 _index
        )
    {
        uint256 startIndex = _self.startIndex;
        uint256 historyCount = _self.length;
        if (historyCount == 0) {
            _found = false;
        } else if (_blockNumber >= _self.checkpoints[historyCount - 1].delegations[0].fromBlock) {
            _found = true;
            _index = historyCount - 1;  // safe, historyCount != 0 in this branch
        } else if (_blockNumber < _self.checkpoints[startIndex].delegations[0].fromBlock) {
            // reading data before `_startIndex` is only safe before first cleanup
            require(startIndex == 0, "DelegationHistory: reading from cleaned-up block");
            _found = false;
        } else {
            _found = true;
            _index = _binarySearchGreatestBlockLessThan(_self.checkpoints, startIndex, historyCount, _blockNumber);
        }
    }
    
    /**
     * Find delegate and return its value or 0 if not found.
     */
    function _getValueForDelegate(CheckPoint storage _cp, address _delegate) internal view returns (uint256) {
        uint256 length = _cp.delegations[0].length;
        for (uint256 i = 0; i < length; i++) {
            Delegation storage dlg = _cp.delegations[i];
            if (dlg.delegate == _delegate) {
                return dlg.value;
            }
        }
        return 0;   // _delegate not found
    }
}
