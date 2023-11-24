// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
import { FlareDaemon } from "../../genesis/implementation/FlareDaemon.sol";
import { GovernedV2 } from "../../governance/implementation/GovernedV2.sol";


contract GovernedAndFlareDaemonizedV2 is GovernedV2 {

    FlareDaemon public immutable flareDaemon;

    modifier onlyFlareDaemon () {
        require (msg.sender == address(flareDaemon), "only flare daemon");
        _;
    }

    constructor(address _governance, FlareDaemon _flareDaemon) GovernedV2(_governance) {
        require(address(_flareDaemon) != address(0), "flare daemon zero");
        flareDaemon = _flareDaemon;
    }
}
