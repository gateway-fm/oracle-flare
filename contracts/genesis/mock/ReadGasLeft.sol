// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../../genesis/interface/IFlareDaemonize.sol";

contract ReadGasLeft is IFlareDaemonize {
    uint256 public gasLeft;
    uint256 public count = 0;

    function daemonize() external override returns (bool) {
        if (count == 0) {
            gasLeft = gasleft();
        }
        count += 1;
        return true;
    }

    function switchToFallbackMode() external pure override returns (bool) {
        return false;
    }

    function getContractName() external pure override returns (string memory) {
        return "ReadGasLeft";
    }
}
