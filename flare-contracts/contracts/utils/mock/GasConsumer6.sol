// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

/**
 * @title Gas consumer contract that emulates priority list.
 * Function push(n) is used for heavy transaction load tests. 
 **/
contract GasConsumer6 {

    uint256[] public array;
    uint256 public maxLen;

    constructor(uint256 n) {
        maxLen = n;
    }

    function push(uint256 n) external {
        if (array.length < maxLen) {
            array.push(n);
        }
        else {
            uint256 indexOfMinValue = findMinValueIndex(array);
            if (array[indexOfMinValue] < n) {
                array[indexOfMinValue] = n;
            }
        }
    }

    function findMinValueIndex (uint256[] memory arr)  public pure returns (uint256) {
            uint256 index = 0;
            for(uint256 i = 0; i < arr.length; i++) {
                if (arr[i] < arr[index]) {
                    index = i;
                }
            }
            return index;
    }

}
