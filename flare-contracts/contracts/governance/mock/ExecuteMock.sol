// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

contract ExecuteMock {
    uint256 internal num;

    function setNum(uint256 n) public {
        num = n;
    }

    function setNum1(uint256 n) public {
        require(n == 100);
        num = n;
    }

        function setNum2(uint256 n) public {
        require(n == 100, "wrong number");
        num = n;
    }

    function getNum() public view returns (uint256) {
        return num;
    }
}
