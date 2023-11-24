// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import "../interface/IIIncentivePoolReceiver.sol";

contract IncentivePoolReceiverMock is IIIncentivePoolReceiver {
    function setDailyAuthorizedIncentive(uint256 toAuthorizeWei) external override {}
    function receiveIncentive() external payable override {}
    function getIncentivePoolAddress() external override returns(address) {}

    function getContractName() external pure override returns (string memory) {
        return "IncentivePoolReceiverMock";
    }
}
