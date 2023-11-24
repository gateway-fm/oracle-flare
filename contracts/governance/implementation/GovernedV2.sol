// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import { GovernedBaseV2 } from "./GovernedBaseV2.sol";


/**
 * @title Governed V2
 * @dev For deployed, governed contracts, enforce a non-zero address at create time.
 **/
contract GovernedV2 is GovernedBaseV2 {
    constructor(address _governance) GovernedBaseV2(_governance) {
        require(_governance != address(0), "_governance zero");
    }
}
