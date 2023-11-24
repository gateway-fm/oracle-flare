// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../../genesis/interface/IIPriceSubmitter.sol";
import "../../userInterfaces/IVoterWhitelister.sol";

/**
 * @title Fund distributor contract 
 * @notice A contract for distributing funds to given or 
 *  whitelisted addresses. Mainly it is used to top up
 *  the whitelisted addresses from VoterWhitelister contract.
 */
contract FundDistributor {

    IIPriceSubmitter public immutable priceSubmitter;

    constructor (IIPriceSubmitter _priceSubmitter) {
        priceSubmitter = _priceSubmitter;
    }

    function sendInitialFunds(
        address[] calldata addresses, 
        uint256[] calldata amounts, 
        uint256 defaultAmount
    ) external payable {
        for (uint256 i = 0; i < addresses.length; i++) {
            if (amounts.length > i) { // could also be amounts.length > 0
                //slither-disable-next-line arbitrary-send-eth
                payable(addresses[i]).transfer(amounts[i]);
            }
            else {
                //slither-disable-next-line arbitrary-send-eth
                payable(addresses[i]).transfer(defaultAmount);
            }
        }
        //slither-disable-next-line arbitrary-send-eth
        payable(msg.sender).transfer(address(this).balance); // send remaining funds to sender
    }

    function topupAllWhitelistedAddresses(uint256 topupAmount) external payable {
        IVoterWhitelister whitelister = IVoterWhitelister(priceSubmitter.getVoterWhitelister());
        address[] memory whitelisted = whitelister.getFtsoWhitelistedPriceProviders(0);
        for (uint256 i = 0; i < whitelisted.length; i++) {
            address payable addr = payable(whitelisted[i]);
            uint256 balance = addr.balance;
            if (balance < topupAmount) {
                //slither-disable-next-line arbitrary-send-eth
                addr.transfer(topupAmount - balance);
            }
        }
        //slither-disable-next-line arbitrary-send-eth
        payable(msg.sender).transfer(address(this).balance); // send remaining funds to sender
    }
}
