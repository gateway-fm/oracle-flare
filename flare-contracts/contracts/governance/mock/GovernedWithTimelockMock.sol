// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../implementation/Governed.sol";


contract GovernedWithTimelockMock is Governed {
    uint256 public a;
    uint256 public b;
    
    constructor(address _governance)
        Governed(_governance)
    {
    }

    function changeA(uint256 _value)
        external
        onlyGovernance
    {
        a = _value;
    }

    function increaseA(uint256 _increment)
        external
        onlyGovernance
    {
        a += _increment;
    }

    function changeWithRevert(uint256 _value)
        external
        onlyGovernance
    {
        a = _value;
        revert("this is revert");
    }

    function changeB(uint256 _value)
        external
        onlyImmediateGovernance
    {
        b = _value;
    }
}
