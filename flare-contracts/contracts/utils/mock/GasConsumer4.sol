// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

/**
 * @title Gas consumer contract that just increments a storage value.
 * Function push(n) is used for heavy transaction load tests. 
 **/
contract GasConsumer4 {

    uint256 public a;

    function push(uint256 n) external {
        for(uint256 i = 0; i < n; i++) {
            a += 1;
        }
    }
}
