// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import "./ProxyGoverned.sol";

/**
 * @title A ftso registry governed proxy contract
 */
contract FtsoRegistryProxy is ProxyGoverned {

    constructor(
        address _governance,
        address _initialImplementation
    )
        ProxyGoverned(
            _governance,
            _initialImplementation
        )
    {}
}
