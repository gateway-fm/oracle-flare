// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

/**
 * @title Gas consumer contract that stores n numbers into a structure that is combination 
 * of maps and arrays. Function push(n) used to for testing heavy traffic transactions.
 **/
contract GasConsumer {

    mapping(address => mapping(uint256 => uint256[])) public addressAndBlockToNumber;

    function push(uint256 n) external {
        for(uint256 i = 0; i < n; i++) {
            addressAndBlockToNumber[msg.sender][block.number].push(5);
        }
    }

}
