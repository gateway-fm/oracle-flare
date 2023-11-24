// SPDX-License-Identifier: MIT
pragma solidity ^0.6.0; // note. don't update version.

import "@gnosis.pm/mock-contract/contracts/MockContract.sol";
import "./FlareDaemonMock.sol";

/**
 * @title FlareDaemon mock contract
 * @notice A contract to simulate flare daemon daemonize and to request minting.
 **/
contract FlareDaemonMock1 is FlareDaemonMock {
    uint256 public a;

    function requestMinting(uint256 _topupRequestWei) public {
        a = _topupRequestWei / (_topupRequestWei - _topupRequestWei);
    }
}
