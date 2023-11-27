// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

interface IIIncentivePoolReceiver {
    /**
     * Notify the receiver that it is entitled to receive `_toAuthorizeWei` incentive amount.
     * @param _toAuthorizeWei the amount of incentive that can be awarded in the coming day
     */
    function setDailyAuthorizedIncentive(uint256 _toAuthorizeWei) external;

    /**
     * Receive native tokens from incentive pool.
     */
    function receiveIncentive() external payable;

    /**
     * Incentive pool receivers have a reference to the IncentivePool contract.
     */
    function getIncentivePoolAddress() external returns(address);

    /**
     * Incentive pool receivers have a method to get their expected balance
     * (actual balance can be higher due to self-destruct funds)
     */
    function getExpectedBalance() external view returns(uint256);

    /**
     * Implement this function for updating incentive pool receiver contracts through AddressUpdater.
     */
    function getContractName() external view returns (string memory);
}
