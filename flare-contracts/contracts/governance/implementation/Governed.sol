// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import { GovernedBase } from "./GovernedBase.sol";


/**
 * Defines behaviors for governed contracts that must have a governor set at construction-time.
 */
contract Governed is GovernedBase {
    /**
     * @param _governance Governance contract. Must not be zero.
     */
    constructor(address _governance) GovernedBase(_governance) {
        require(_governance != address(0), "_governance zero");
    }
}
