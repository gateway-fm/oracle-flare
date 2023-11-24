// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import "../lib/FtsoVote.sol";


/**
 * @title Ftso Vote mock contract
 * @notice A contract to expose the FtsoVote library for unit testing.
 **/
contract FtsoVoteMock {
    function createInstance(
        address _voter,
        uint256 _votePowerNat,
        uint256 _votePowerAsset,
        uint256 _totalVotePowerNat,
        uint256 _totalVotePowerAsset,
        uint256 _price
    )
        public pure 
        returns(FtsoVote.Instance memory)
    {
        return FtsoVote._createInstance(
            _voter,
            _votePowerNat,
            _votePowerAsset,
            _totalVotePowerNat,
            _totalVotePowerAsset,
            _price);
    }
}
