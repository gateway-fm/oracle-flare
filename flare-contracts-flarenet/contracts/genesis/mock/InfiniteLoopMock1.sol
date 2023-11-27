// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../../genesis/interface/IFlareDaemonize.sol";

contract InfiniteLoopMock1 is IFlareDaemonize {
    uint256[] public arr;
    uint256 public savedBlock;
    uint256 public count = 0;
    bool public goInLoop = false;

    function daemonize() external override returns (bool) {
        if (count == 0) {
            savedBlock = block.number;
        }
        if (goInLoop) {
            if (savedBlock % 2 == 0) {
                if (block.number % 2 == 1) {
                    while (true) {
                        arr.push(6);
                    }
                }
            } else if (savedBlock % 2 == 1) {
                if (block.number % 2 == 0) {
                    while (true) {
                        arr.push(6);
                    }
                }
            }
        }
        count += 1;
        return true;
    }

    function setGoInLoopParameter(bool loop) external {
        goInLoop = loop;
    }

    function switchToFallbackMode() external pure override returns (bool) {
        return false;
    }

    function getContractName() external pure override returns (string memory) {
        return "InfiniteLoopMock1";
    }
}
