// SPDX-License-Identifier: MIT
pragma solidity ^0.6.0; // note. don't update version.

import "@gnosis.pm/mock-contract/contracts/MockContract.sol";

/**
 * @title Inflation mock contract
 * @notice A contract to call the flare daemon to request minting.
 **/
contract InflationMock is MockContract {
    address private flareDaemon;
    address private inflationReceiver;
    uint256 public doNotReceiveMoreThan;
    uint256 public ticker;

    function setDoNotReceiveNoMoreThan(uint256 _doNotReceiveMoreThan) public {
        doNotReceiveMoreThan = _doNotReceiveMoreThan;
    }

    function tick() public {
        ticker += 1;
    }

    function setFlareDaemon(address _flareDaemon) public {
        flareDaemon = _flareDaemon;
    }

    function setInflationReceiver(address _inflationReceiver) public {
        inflationReceiver = _inflationReceiver;
    }

    function requestMinting(uint256 amount) public {
        // This low level call is being done because of mixed Solidity version requirements between
        // this project and the MockContract component.
        bytes memory payload = abi.encodeWithSignature("requestMinting(uint256)", amount);
        //solhint-disable-next-line avoid-low-level-calls
        (bool success, ) = flareDaemon.call(payload);
        require(success);
    }

    function receiveMinting() public payable {
        require(msg.value <= doNotReceiveMoreThan, "too much");
    }

    function setDailyAuthorizedInflation(uint256 toAuthorizeWei) public {
        // This low level call is being done because of mixed Solidity version requirements between
        // this project and the MockContract component.
        bytes memory payload = abi.encodeWithSignature("setDailyAuthorizedInflation(uint256)", toAuthorizeWei);
        //solhint-disable-next-line avoid-low-level-calls
        (bool success, ) = inflationReceiver.call(payload);
        require(success);
    }

    function receiveInflation() public payable {
        // This low level call is being done because of mixed Solidity version requirements between
        // this project and the MockContract component.
        bytes memory payload = abi.encodeWithSignature("receiveInflation()");
        //solhint-disable-next-line avoid-low-level-calls
        (bool success, ) = inflationReceiver.call{ value: msg.value }(payload);
        require(success);
    }
}
