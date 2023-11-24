// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "./CheckPointsByAddress.sol";
import "./CheckPointHistory.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "../../utils/implementation/SafePct.sol";


/**
 * @title ExplicitDelegation library
 * @notice A library to manage a group of delegates for allocating voting power by a delegator.
 **/
library ExplicitDelegation {
    using CheckPointHistory for CheckPointHistory.CheckPointHistoryState;
    using CheckPointsByAddress for CheckPointsByAddress.CheckPointsByAddressState;
    using SafeMath for uint256;
    using SafePct for uint256;

    /**
     * @dev `DelegationState` is the state structure used by this library to contain/manage
     *  a grouing of delegates (a ExplicitDelegation) for a delegator.
     */
    struct DelegationState {
        CheckPointHistory.CheckPointHistoryState delegatedTotal;

        // `delegatedVotePower` is a map of delegators pointing to a map of delegates
        // containing a checkpoint history of delegated vote power balances.
        CheckPointsByAddress.CheckPointsByAddressState delegatedVotePower;
    }

    /**
     * @notice Add or replace an existing _delegate with new vote power (explicit).
     * @param _self A DelegationState instance to manage.
     * @param _delegate The address of the _delegate to add/replace
     * @param _amount Allocation of the delegation as explicit amount
     */
    function addReplaceDelegate(
        DelegationState storage _self, 
        address _delegate, 
        uint256 _amount
    )
        internal
    {
        uint256 prevAmount = _self.delegatedVotePower.valueOfAtNow(_delegate);
        uint256 newTotal = _self.delegatedTotal.valueAtNow().sub(prevAmount, "Total < 0").add(_amount);
        _self.delegatedVotePower.writeValue(_delegate, _amount);
        _self.delegatedTotal.writeValue(newTotal);
    }
    

    /**
     * Delete at most `_count` of the oldest checkpoints.
     * At least one checkpoint at or before `_cleanupBlockNumber` will remain 
     * (unless the history was empty to start with).
     */    
    function cleanupOldCheckpoints(
        DelegationState storage _self, 
        address _owner, 
        uint256 _count,
        uint256 _cleanupBlockNumber
    )
        internal
        returns(uint256 _deleted)
    {
        _deleted = _self.delegatedTotal.cleanupOldCheckpoints(_count, _cleanupBlockNumber);
        // safe: cleanupOldCheckpoints always returns the number of deleted elements which is small, so no owerflow
        _deleted += _self.delegatedVotePower.cleanupOldCheckpoints(_owner, _count, _cleanupBlockNumber);
    }
    
    /**
     * @notice Get the _total of the explicit vote power delegation amount.
     * @param _self A DelegationState instance to manage.
     * @param _blockNumber The block to query.
     * @return _total The _total vote power amount delegated.
     */
    function getDelegatedTotalAt(
        DelegationState storage _self, uint256 _blockNumber
    )
        internal view 
        returns (uint256 _total)
    {
        return _self.delegatedTotal.valueAt(_blockNumber);
    }
    
    /**
     * @notice Get the _total of the explicit vote power delegation amount.
     * @param _self A DelegationState instance to manage.
     * @return _total The total vote power amount delegated.
     */
    function getDelegatedTotal(
        DelegationState storage _self
    )
        internal view 
        returns (uint256 _total)
    {
        return _self.delegatedTotal.valueAtNow();
    }
    
    /**
     * @notice Given a delegate address, return the explicit amount of the vote power delegation.
     * @param _self A DelegationState instance to manage.
     * @param _delegate The _delegate address to find.
     * @param _blockNumber The block to query.
     * @return _value The percent of vote power allocated to the _delegate address.
     */
    function getDelegatedValueAt(
        DelegationState storage _self, 
        address _delegate,
        uint256 _blockNumber
    )
        internal view
        returns (uint256 _value)
    {
        return _self.delegatedVotePower.valueOfAt(_delegate, _blockNumber);
    }

    /**
     * @notice Given a delegate address, return the explicit amount of the vote power delegation.
     * @param _self A DelegationState instance to manage.
     * @param _delegate The _delegate address to find.
     * @return _value The percent of vote power allocated to the _delegate address.
     */
    function getDelegatedValue(
        DelegationState storage _self, 
        address _delegate
    )
        internal view 
        returns (uint256 _value)
    {
        return _self.delegatedVotePower.valueOfAtNow(_delegate);
    }
}
