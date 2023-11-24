// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "./CheckPointHistory.sol";
import "./CheckPointsByAddress.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";


/**
 * @title Vote power library
 * @notice A library to record delegate vote power balances by delegator 
 *  and delegatee.
 **/
library VotePower {
    using CheckPointHistory for CheckPointHistory.CheckPointHistoryState;
    using CheckPointsByAddress for CheckPointsByAddress.CheckPointsByAddressState;
    using SafeMath for uint256;

    /**
     * @dev `VotePowerState` is state structure used by this library to manage vote
     *  power amounts by delegator and it's delegates.
     */
    struct VotePowerState {
        // `votePowerByAddress` is the map that tracks the voting power balance
        //  of each address, by block.
        CheckPointsByAddress.CheckPointsByAddressState votePowerByAddress;
    }

    /**
     * @notice This modifier checks that both addresses are non-zero.
     * @param _delegator A delegator address.
     * @param _delegatee A delegatee address.
     */
    modifier addressesNotZero(address _delegator, address _delegatee) {
        // Both addresses cannot be zero
        assert(!(_delegator == address(0) && _delegatee == address(0)));
        _;
    }


    /**
     * @notice Delegate vote power `_amount` to `_delegatee` address from `_delegator` address.
     * @param _delegator Delegator address 
     * @param _delegatee Delegatee address
     * @param _amount The _amount of vote power to send from _delegator to _delegatee
     * @dev Amount recorded at the current block.
     **/
    function delegate(
        VotePowerState storage _self, 
        address _delegator, 
        address _delegatee,
        uint256 _amount
    )
        internal 
        addressesNotZero(_delegator, _delegatee)
    {
        // Shortcut
        if (_amount == 0) {
            return;
        }

        // Transmit vote power
        _self.votePowerByAddress.transmit(_delegator, _delegatee, _amount);
    }

    /**
     * @notice Change the current vote power value.
     * @param _owner Address of vote power owner.
     * @param _add The amount to add to the vote power.
     * @param _sub The amount to subtract from the vote power.
     */
    function changeValue(
        VotePowerState storage _self, 
        address _owner,
        uint256 _add,
        uint256 _sub
    )
        internal
    {
        assert(_owner != address(0));
        if (_add == _sub) return;
        uint256 value = _self.votePowerByAddress.valueOfAtNow(_owner);
        value = value.add(_add).sub(_sub);
        _self.votePowerByAddress.writeValue(_owner, value);
    }
    
    /**
     * @notice Undelegate vote power `_amount` from `_delegatee` address 
     *  to `_delegator` address
     * @param _delegator Delegator address 
     * @param _delegatee Delegatee address
     * @param _amount The amount of vote power recovered by delegator from delegatee
     **/
    function undelegate(
        VotePowerState storage _self, 
        address _delegator, 
        address _delegatee,
        uint256 _amount
    )
        internal
        addressesNotZero(_delegator, _delegatee)
    {
        // Shortcut
        if (_amount == 0) {
            return;
        }

        // Recover vote power
        _self.votePowerByAddress.transmit(_delegatee, _delegator, _amount);
    }

    /**
     * Delete at most `_count` of the oldest checkpoints.
     * At least one checkpoint at or before `_cleanupBlockNumber` will remain 
     * (unless the history was empty to start with).
     */    
    function cleanupOldCheckpoints(
        VotePowerState storage _self, 
        address _owner, 
        uint256 _count,
        uint256 _cleanupBlockNumber
    )
        internal
        returns (uint256)
    {
        return _self.votePowerByAddress.cleanupOldCheckpoints(_owner, _count, _cleanupBlockNumber);
    }

    /**
     * @notice Get the vote power of `_who` at `_blockNumber`.
     * @param _self A VotePowerState instance to manage.
     * @param _who Address to get vote power.
     * @param _blockNumber Block number of the block to fetch vote power.
     * @return _votePower The fetched vote power.
     */
    function votePowerOfAt(
        VotePowerState storage _self, 
        address _who, 
        uint256 _blockNumber
    )
        internal view 
        returns(uint256 _votePower)
    {
        return _self.votePowerByAddress.valueOfAt(_who, _blockNumber);
    }

    /**
     * @notice Get the current vote power of `_who`.
     * @param _self A VotePowerState instance to manage.
     * @param _who Address to get vote power.
     * @return _votePower The fetched vote power.
     */
    function votePowerOfAtNow(
        VotePowerState storage _self, 
        address _who
    )
        internal view
        returns(uint256 _votePower)
    {
        return _self.votePowerByAddress.valueOfAtNow(_who);
    }
}
