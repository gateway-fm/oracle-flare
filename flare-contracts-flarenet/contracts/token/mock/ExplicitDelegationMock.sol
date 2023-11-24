// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import {ExplicitDelegation} from "../lib/ExplicitDelegation.sol";

/**
 * @title ExplicitDelegation mock contract
 * @notice A contract to expose the ExplicitDelegation library for unit testing.
 **/
contract ExplicitDelegationMock {
    using ExplicitDelegation for ExplicitDelegation.DelegationState;

    ExplicitDelegation.DelegationState private self;

    function addReplaceDelegate(address _delegate, uint256 _bips) public {
        self.addReplaceDelegate(_delegate, _bips);
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
    function cleanupOldCheckpoints(address _delegate, uint256 _count, uint256 _cleanupBlockNumber) public {
        self.cleanupOldCheckpoints(_delegate, _count, _cleanupBlockNumber);
    }
}
