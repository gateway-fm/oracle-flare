// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import "../interface/IIInflationReceiver.sol";

contract InflationReceiverMock is IIInflationReceiver {
    function setDailyAuthorizedInflation(uint256 toAuthorizeWei) external override {}
    function receiveInflation() external payable override {}
    function getInflationAddress() external override returns(address) {}

    function getContractName() external pure override returns (string memory) {
        return "InflationReceiverMock";
    }
}
