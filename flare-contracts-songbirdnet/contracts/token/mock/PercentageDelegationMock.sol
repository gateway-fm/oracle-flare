// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import {PercentageDelegation} from "../lib/PercentageDelegation.sol";
import {DelegationHistory} from "../lib/DelegationHistory.sol";

/**
 * @title PercentageDelegation mock contract
 * @notice A contract to expose the PercentageDelegation library for unit testing.
 **/
contract PercentageDelegationMock {
    using PercentageDelegation for PercentageDelegation.DelegationState;

    PercentageDelegation.DelegationState private self;

    uint256 public maxDelegateCount = DelegationHistory.MAX_DELEGATES_BY_PERCENT;

    function addReplaceDelegate(address _delegate, uint256 _bips) public {
        self.addReplaceDelegate(_delegate, _bips);
    }
    
    // for testing multiple delegations in a block
    function addReplaceMultipleDelegates(address[] memory _delegates, uint256[] memory _bipss) public {
        require (_delegates.length == _bipss.length);
        for (uint256 i = 0; i < _delegates.length; i++) {
            self.addReplaceDelegate(_delegates[i], _bipss[i]);
        }
    }

    function getDelegatedTotalAt(uint256 _blockNumber) public view returns (uint256 _totalBips) {
        return self.getDelegatedTotalAt(_blockNumber);
    }

    function getDelegatedTotal() public view returns (uint256 _totalBips) {
        return self.getDelegatedTotal();
    }
    
    function getDelegatedValueAt(address _delegate, uint256 _blockNumber) public view returns (uint256 _bips) {
        return self.getDelegatedValueAt(_delegate, _blockNumber);
    }
    
    function getDelegatedValue(address _delegate) public view returns (uint256 _bips) {
        return self.getDelegatedValue(_delegate);
    }
    
    function getDelegationsAt(uint256 _blockNumber) 
        public view
        returns (address[] memory _delegates, uint256[] memory _values)
    {
        return self.getDelegationsAt(_blockNumber);
    }
    
    function getDelegations() public view returns (address[] memory _delegates, uint256[] memory _values) {
        return self.getDelegations();
    }
    
    function getCountAt(uint256 _blockNumber) public view returns (uint256) {
        return self.getCountAt(_blockNumber);
    }

    function getCount() public view returns (uint256) {
        return self.getCount();
    }
    
    function clear() public {
        self.clear();
    }
    
    function cleanupOldCheckpoints(uint256 _count, uint256 _cleanupBlockNumber) public {
        self.cleanupOldCheckpoints(_count, _cleanupBlockNumber);
    }
}
