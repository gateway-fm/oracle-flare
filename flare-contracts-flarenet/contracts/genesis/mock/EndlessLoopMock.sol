// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../../genesis/interface/IFlareDaemonize.sol";

contract EndlessLoopMock is IFlareDaemonize {
    uint256 public aNumber;
    bool public fallbackMode;
    bool public immutable allowFallbackMode;
    bool public immutable loopInFallbackMode;
    
    event FallbackMode();
    
    constructor(bool _allowFallbackMode, bool _loopInFallbackMode) {
        allowFallbackMode = _allowFallbackMode;
        loopInFallbackMode = _loopInFallbackMode;
    }
    
    function daemonize() external override returns (bool) {
        if (!fallbackMode || loopInFallbackMode) {
            while (true) {
                aNumber++;
            }
        }
        return true;
    }
    
    function switchToFallbackMode() external override returns (bool) {
        if (!fallbackMode && allowFallbackMode) {
            fallbackMode = true;
            emit FallbackMode();
            return true;
        }
        return false;
    }

    function getContractName() external pure override returns (string memory) {
        return "EndlessLoopMock";
    }
}
