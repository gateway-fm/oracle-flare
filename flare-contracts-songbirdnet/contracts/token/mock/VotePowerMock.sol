// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import {VotePower} from "../lib/VotePower.sol";

/**
 * @title Vote Power mock contract
 * @notice A contract to expose the VotePower library for unit testing.
 **/
contract VotePowerMock {
    using VotePower for VotePower.VotePowerState;

    VotePower.VotePowerState private self;

    function _burn(
        address _owner, 
        uint256 _amount) public {
        self._burn(_owner, _amount);
    }

    function delegate(
        address _delegator, 
        address _delegatee,
        uint256 _amount) public {
        self.delegate(_delegator, _delegatee, _amount);
    }

    function _mint(
        address _owner, 
        uint256 _amount) public {
        self._mint(_owner, _amount);
    }

    function transmit(
        address _from, 
        address _to,
        uint256 _amount
    )
        public
    {
        self.transmit(_from, _to, _amount);
    }

    function undelegate(
        address _delegator, 
        address _delegatee,
        uint256 _amount) public {
        self.undelegate(_delegator, _delegatee, _amount);
    }

    function cleanupOldCheckpoints(address _owner, uint256 _count, uint256 _cleanupBlockNumber) public {
        self.cleanupOldCheckpoints(_owner, _count, _cleanupBlockNumber);
    }
    
    function votePowerOfAt(
        address _who, 
        uint256 _blockNumber)
        public view returns(uint256 _votePower) {
        return self.votePowerOfAt(_who, _blockNumber);
    }

    function votePowerOfAtNow(
        address _who)
        public view returns(uint256 _votePower) {
        return self.votePowerOfAtNow(_who);
    }
}
