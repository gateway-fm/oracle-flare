// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../implementation/ClaimSetupManager.sol";

contract SetClaimExecutorsMock {

    ClaimSetupManager public claimSetupManager;

    constructor(ClaimSetupManager _claimSetupManager) {
        claimSetupManager = _claimSetupManager;
    }

    function setClaimExecutors(address[] memory _executors) external payable {
        //slither-disable-next-line arbitrary-send-eth
        claimSetupManager.setClaimExecutors{value: msg.value}(_executors);
    }
}
