// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "./DelegateCheckPointHistory.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

/**
 * @title Check Points By Address library
 * @notice A contract to manage checkpoint history for a collection of addresses.
 * @dev Store value history by address, and then by block number.
 **/
library DelegateCheckPointsByAddress {
    using SafeMath for uint256;
    using DelegateCheckPointHistory for DelegateCheckPointHistory.DelegateCheckPointHistoryState;

    struct DelegateCheckPointsByAddressState {
        // `historyByAddress` is the map that stores the delegate check point history of each address
        mapping(address => DelegateCheckPointHistory.DelegateCheckPointHistoryState) historyByAddress;
    }

    /**
     * @notice Queries the address of `_owner` at a specific `_blockNumber`.
     * @param _self A DelegateCheckPointsByAddressState instance to manage.
     * @param _owner The address from which the value will be retrieved.
     * @param _blockNumber The block number to query for the then current value.
     * @return The value at `_blockNumber` for `_owner`.
     **/
    function delegateAddressOfAt(
        DelegateCheckPointsByAddressState storage _self,
        address _owner,
        uint256 _blockNumber
    ) internal view returns (address) {
        // Get history for _owner
        DelegateCheckPointHistory.DelegateCheckPointHistoryState
            storage history = _self.historyByAddress[_owner];
        // Return value at given block
        return history.delegateAddressAt(_blockNumber);
    }

    /**
     * @notice Get the value of the `_owner` at the current `block.number`.
     * @param _self A DelegateCheckPointsByAddressState instance to manage.
     * @param _owner The address of the value is being requested.
     * @return The value of `_owner` at the current block.
     **/
    function delegateAddressOfAtNow(
        DelegateCheckPointsByAddressState storage _self,
        address _owner
    ) internal view returns (address) {
        // Get history for _owner
        DelegateCheckPointHistory.DelegateCheckPointHistoryState storage history = _self
            .historyByAddress[_owner];
        // Return value at now
        return history.delegateAddressAtNow();
    }

    /**
     * @notice Writes the `to` at the current block number for `_owner`.
     * @param _self A DelegateCheckPointsByAddressState instance to manage.
     * @param _owner The address of `_owner` to write.
     * @param _to The value to write.
     * @dev Sender must be the owner of the contract.
     **/
    function writeAddress(
        DelegateCheckPointsByAddressState storage _self,
        address _owner,
        address _to
    ) internal {
        // Get history for _owner
        DelegateCheckPointHistory.DelegateCheckPointHistoryState storage history = _self
            .historyByAddress[_owner];
        // Write the value
        history.writeAddress(_to);
    }

    /**
     * Delete at most `_count` of the oldest checkpoints.
     * At least one checkpoint at or before `_cleanupBlockNumber` will remain
     * (unless the history was empty to start with).
     */
    function cleanupOldCheckpoints(
        DelegateCheckPointsByAddressState storage _self,
        address _owner,
        uint256 _count,
        uint256 _cleanupBlockNumber
    ) internal returns (uint256) {
        if (_owner != address(0)) {
            return
                _self.historyByAddress[_owner].cleanupOldCheckpoints(
                    _count,
                    _cleanupBlockNumber
                );
        }
        return 0;
    }
}
