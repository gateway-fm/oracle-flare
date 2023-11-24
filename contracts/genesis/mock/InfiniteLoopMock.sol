// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../../genesis/interface/IFlareDaemonize.sol";

contract InfiniteLoopMock is IFlareDaemonize {
    uint256[] public arr;
    uint256 public savedBlock;
    uint256 public count = 0;
    
    function daemonize() external override returns (bool) {
        if (count == 0) {
            savedBlock = block.number;
        }
        if (block.number == savedBlock + 1) {
            while (true) {
                arr.push(6);
            }
        }
        count += 1;
        return true;
    }

    function switchToFallbackMode() external pure override returns (bool) {
        return false;
    }

    function getContractName() external pure override returns (string memory) {
        return "InfiniteLoopMock";
    }
}
