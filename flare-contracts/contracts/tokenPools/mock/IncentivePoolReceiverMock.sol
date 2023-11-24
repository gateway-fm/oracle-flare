// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../implementation/IncentivePoolReceiver.sol";


contract IncentivePoolReceiverMock is IncentivePoolReceiver {

    constructor(address _addressUpdater) IncentivePoolReceiver(_addressUpdater) {}

    function getContractName() external pure override returns (string memory) {
        return "IncentivePoolReceiverMock";
    }
}
