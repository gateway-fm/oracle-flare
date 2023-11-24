// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
import { FlareDaemon } from "../../genesis/implementation/FlareDaemon.sol";
import { Governed } from "../../governance/implementation/Governed.sol";


/**
 * Base class for contracts that are governed and triggered from the FlareDaemon.
 *
 * See `Governed` and `IFlareDaemonize`.
 */
contract GovernedAndFlareDaemonized is Governed {

    /// The FlareDaemon contract, set at construction time.
    FlareDaemon public immutable flareDaemon;

    /// Only the `flareDaemon` can call this method.
    modifier onlyFlareDaemon () {
        require (msg.sender == address(flareDaemon), "only flare daemon");
        _;
    }

    constructor(address _governance, FlareDaemon _flareDaemon) Governed(_governance) {
        require(address(_flareDaemon) != address(0), "flare daemon zero");
        flareDaemon = _flareDaemon;
    }
}
