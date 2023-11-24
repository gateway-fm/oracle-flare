// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

/**
 * @title Gas consumer contract that emulates a bounded array that gets cyclically reused.
 * Function push(n) is used for heavy transaction load tests. 
 **/
contract GasConsumer5 {

    mapping(uint256 => uint256) public array;
    uint256 public maxLen;
    uint256 public index;

    constructor(uint256 n) {
        maxLen = n;
    }

    function push(uint256 n) external {
        for(uint256 i = 0; i < n; i++) {
            array[index % maxLen] = index;            
            index++;
        }
    }
}
