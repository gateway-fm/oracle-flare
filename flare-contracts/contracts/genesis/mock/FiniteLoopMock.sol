// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../../genesis/interface/IFlareDaemonize.sol";

contract FiniteLoopMock is IFlareDaemonize {
    uint256[] public arr;
    uint256 public numLoop = 1;
    uint256 public whichBlock = 1;

    function daemonize() external override returns (bool) {
        if (block.number % whichBlock == 0) {
            if (numLoop == 0) {
                while (true) {
                    arr.push(6);
                }
            } else {
                for (uint256 i = 0; i < numLoop; i++) {
                    arr.push(6);
                }
            }
        }
        return true;
    }

    function setLoopParameter(uint256 n) external {
        numLoop = n;
    }

    function setWhichBlocks(uint256 n) external {
        whichBlock = n;
    }

    function switchToFallbackMode() external pure override returns (bool) {
        return false;
    }

    function getContractName() external pure override returns (string memory) {
        return "FiniteLoopMock";
    }

    function length() public view returns (uint256) {
        return arr.length;
    }
}
