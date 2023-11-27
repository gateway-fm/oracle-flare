// SPDX-License-Identifier: MIT
pragma solidity ^0.6.0; // note. don't update version.

import "@gnosis.pm/mock-contract/contracts/MockContract.sol";

/**
 * @title FlareDaemon mock contract
 * @notice A contract to simulate flare daemon daemonize and to request minting.
 **/
contract FlareDaemonMock is MockContract {
    address[] public daemonizeContracts;

    function registerToDaemonize(address _daemonize) public {
        uint256 len = daemonizeContracts.length;
        for (uint256 i = 0; i < len; i++) {
            if (_daemonize == daemonizeContracts[i]) {
                return; // already registered
            }
        }

        daemonizeContracts.push(_daemonize);
    }

    function trigger() public {
        uint256 len = daemonizeContracts.length;
        for (uint256 i = 0; i < len; i++) {
            // This low level call is being done because of mixed Solidity version requirements between
            // this project and the MockContract component.
            bytes memory payload = abi.encodeWithSignature("daemonize()");
            //solhint-disable-next-line avoid-low-level-calls
            (bool success, bytes memory result) = daemonizeContracts[i].call(
                payload
            );
            if (!success) {
                revert(extractRevertReason(result));
            }
        }
    }

    function callReceiveMinting(address _inflation) public payable {
        // This low level call is being done because of mixed Solidity version requirements between
        // this project and the MockContract component.
        bytes memory payload = abi.encodeWithSignature("receiveMinting()");
        //solhint-disable-next-line avoid-low-level-calls
        (bool success, ) = _inflation.call{value: msg.value}(payload);
        require(success);
    }

    function fallbackTest(address _inflation) public returns (bytes memory) {
        // This low level call is being done because of mixed Solidity version requirements between
        // this project and the MockContract component.
        bytes memory payload = abi.encodeWithSignature(
            "switchToFallbackMode()"
        );
        //solhint-disable-next-line avoid-low-level-calls
        (bool success, bytes memory result) = _inflation.call(payload);
        require(success);
        return result;
    }

    // function requestMinting(uint256 _topupRequestWei) public virtual {
    //     revert("minting failed");
    // }

    function extractRevertReason(bytes memory revertData)
        internal
        pure
        returns (string memory reason)
    {
        uint256 len = revertData.length;
        if (len < 68) return "";
        uint256 t;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            revertData := add(revertData, 4)
            t := mload(revertData) // Save the content of the length slot
            mstore(revertData, sub(len, 4)) // Set proper length
        }
        reason = abi.decode(revertData, (string));
        // solhint-disable-next-line no-inline-assembly
        assembly {
            mstore(revertData, t) // Restore the content of the length slot
        }
    }
}
