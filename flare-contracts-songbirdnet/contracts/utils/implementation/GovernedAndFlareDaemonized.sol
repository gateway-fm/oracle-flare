// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
import { FlareDaemon } from "../../genesis/implementation/FlareDaemon.sol";
import { Governed } from "../../governance/implementation/Governed.sol";


contract GovernedAndFlareDaemonized is Governed {

    FlareDaemon public immutable flareDaemon;

    modifier onlyFlareDaemon () {
        require (msg.sender == address(flareDaemon), "only flare daemon");
        _;
    }

    constructor(address _governance, FlareDaemon _flareDaemon) Governed(_governance) {
        require(address(_flareDaemon) != address(0), "flare daemon zero");
        flareDaemon = _flareDaemon;
    }
}
