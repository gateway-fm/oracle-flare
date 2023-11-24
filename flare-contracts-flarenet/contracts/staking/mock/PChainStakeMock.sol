// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../implementation/PChainStake.sol";


contract PChainStakeMock is PChainStake {

    function increaseVotePower(
        address _owner,
        bytes20 _nodeId,
        uint256 _amountWei
    )
        external
    {
        _increaseVotePower(_owner, _nodeId, _amountWei);
    }

    function decreaseVotePower(
        address _owner,
        bytes20 _nodeId,
        uint256 _amountWei
    )
        external
    {
        _decreaseVotePower(_owner, _nodeId, _amountWei);
    }

    function increaseBalance(
        address _owner,
        uint256 _amountWei
    )
        external
    {
        _mintForAtNow(_owner, _amountWei);
    }

    function decreaseBalance(
        address _owner,
        uint256 _amountWei
    )
        external
    {
        _burnForAtNow(_owner, _amountWei);
    }
}