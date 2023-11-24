// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import "../../utils/implementation/DateTimeLibrary.sol";
import "../implementation/Inflation.sol";
import "../interface/IIInflationReceiver.sol";
import "./RewardService.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "../../utils/implementation/SafePct.sol";
import "../interface/IIInflationSharingPercentageProvider.sol";
import "./RewardService.sol";


/**
 * @title Reward Services library
 * @notice A library to manage a collection of reward services, their associated totals, and to perform operations
 *   that impact or involve the collection, such as calculating topup amounts across services.
 * @dev There are two concepts that are helpful to understand. A sharing percentage associates an inflation receiver
 *   with a sharing percentage used to calculate percentage of authorized inflation a given reward contract
 *   is entitled to receive for distributing rewards. A reward service is associtated to a topup configuration, which
 *   dictates how much native token will be minted and sent for claiming reserves, and it stores totals for a given 
 *   inflation
 *   receiver, for a given annum.
 **/
library RewardServices {    
    using BokkyPooBahsDateTimeLibrary for uint256;
    using RewardService for RewardService.RewardServiceState;
    using SafeMath for uint256;
    using SafePct for uint256;

    /**
     * @dev `RewardServicesState` is state structure used by this library to manage
     *   a collection of reward services and associated totals.
     */
    struct RewardServicesState {
        // Collection of annums
        RewardService.RewardServiceState[] rewardServices;
        // Balances
        uint256 totalAuthorizedInflationWei;
        uint256 totalInflationTopupRequestedWei;
        uint256 totalInflationTopupReceivedWei;
        uint256 totalInflationTopupWithdrawnWei;
    }

    uint256 internal constant BIPS100 = 1e4;                            // 100% in basis points

    event RewardServiceDailyAuthorizedInflationComputed(IIInflationReceiver inflationReceiver, uint256 amountWei);
    event RewardServiceTopupRequestReceived(IIInflationReceiver inflationReceiver, uint256 amountWei);

    /**
     * @notice For all sharing percentages, compute authorized daily inflation for current cycle
     *  and then allocate it across associated inflation receivers according to their sharing percentages, 
     *  updating reward service totals along the way. Finally,
     *  set the daily authorized inflation for the given inflation receiver.
     * @param _totalRecognizedInflationWei The total recognized inflation across all annums.
     * @param _totalAuthorizedInflationWei The total authorized inflation across all annums.
     * @param _periodsRemaining The number of periods remaining in the current annum.
     * @param _sharingPercentages An array of inflation sharing percentages.
     * @return _amountAuthorizedWei The inflation authorized for this cycle.
     * @dev This method requires totals across all annums so as to continually calculate
     *   the amount remaining to be authorized regardless of timing slippage between annums should it
     *   occur.
     */
    function authorizeDailyInflation(
        RewardServicesState storage _self,
        uint256 _totalRecognizedInflationWei,
        uint256 _totalAuthorizedInflationWei,
        uint256 _periodsRemaining,
        SharingPercentage[] memory _sharingPercentages
    )
        internal
        returns(uint256 _amountAuthorizedWei)
    {
        // If there are no sharing percentages, then there is nothing to authorize.
        if (_sharingPercentages.length == 0) {
            _amountAuthorizedWei = 0;
            return _amountAuthorizedWei;
        }
        
        // Compute amount to allocate
        uint256 amountToAuthorizeRemaingWei = _totalRecognizedInflationWei
            .sub(_totalAuthorizedInflationWei)
            .div(_periodsRemaining);
        // Set up return value with amount authorized
        _amountAuthorizedWei = amountToAuthorizeRemaingWei;
        // Accumulate authorized total...note that this total is for a given annum, for a given service
        _self.totalAuthorizedInflationWei = _self.totalAuthorizedInflationWei.add(amountToAuthorizeRemaingWei);
        // Start with total bips in denominator
        uint256 divisorRemaining = BIPS100;
        // Loop over sharing percentages
        for (uint256 i; i < _sharingPercentages.length; i++) {
            // Compute the amount to authorize for a given service
            uint256 toAuthorizeWei = amountToAuthorizeRemaingWei.mulDiv(
                _sharingPercentages[i].percentBips, 
                divisorRemaining
            );
            // Reduce the numerator by amount just computed
            amountToAuthorizeRemaingWei = amountToAuthorizeRemaingWei.sub(toAuthorizeWei);
            // Reduce the divisor by the bips just allocated
            divisorRemaining = divisorRemaining.sub(_sharingPercentages[i].percentBips);
            // Try to find a matching reward service for the given sharing percentage.
            // New sharing percentages can be added at any time. And if one gets removed,  
            // we don't remove that reward service for a given annum, since its total still
            // remains applicable.
            ( bool found, uint256 rewardServiceIndex ) = 
                findRewardService(_self, _sharingPercentages[i].inflationReceiver);
            if (found) {
                // Get the existing reward service
                RewardService.RewardServiceState storage rewardService = _self.rewardServices[rewardServiceIndex];
                // Accumulate the amount authorized for the service
                rewardService.addAuthorizedInflation(toAuthorizeWei);
            } else {
                // Initialize a new reward service
                RewardService.RewardServiceState storage rewardService = _self.rewardServices.push();
                rewardService.initialize(_sharingPercentages[i].inflationReceiver);
                // Accumulate the amount authorized for the service
                rewardService.addAuthorizedInflation(toAuthorizeWei);                
            }                
            // Signal the inflation receiver of the reward service (the actual rewarding contract)
            // with amount just authorized.
            _sharingPercentages[i].inflationReceiver.setDailyAuthorizedInflation(toAuthorizeWei);
            
            emit RewardServiceDailyAuthorizedInflationComputed(
                _sharingPercentages[i].inflationReceiver, 
                toAuthorizeWei);
        }
    }

    /**
     * @notice Given topup configurations as maintained by an instantiated Inflation contract, compute
     *   the topup minting requests needed to topup reward contracts with native token reserves to satisfy claim
     *   requests.
     * @param _inflation    The Inflation contract holding the topup configurations.
     * @return _topupRequestWei The topup request to mint native tokens across reward services for this cycle.
     */
    function computeTopupRequest(
        RewardServicesState storage _self,
        Inflation _inflation
    )
        internal
        returns (uint256 _topupRequestWei)
    {
        for (uint256 i; i < _self.rewardServices.length; i++) {
            TopupConfiguration memory topupConfiguration = 
                _inflation.getTopupConfiguration(_self.rewardServices[i].inflationReceiver);
            _topupRequestWei = _topupRequestWei.add(_self.rewardServices[i].computeTopupRequest(topupConfiguration));
        }
        _self.totalInflationTopupRequestedWei = _self.totalInflationTopupRequestedWei.add(_topupRequestWei);
        // Make sure topup requested never exceeds the amount authorized
        assert(_self.totalInflationTopupRequestedWei <= _self.totalAuthorizedInflationWei);
    }

    /**
     * @notice Given an inflation receiver, return the index of the associated reward service.
     * @param _inflationReceiver The inflation receiver.
     * @return _found   True if the reward service was found.
     * @return _index   The index on the rewardServices array of the found service. Index is undefined
     *   if the reward service was not found.
     */
    function findRewardService(
        RewardServicesState storage _self,
        IIInflationReceiver _inflationReceiver
    ) 
        internal view
        returns(bool _found, uint256 _index)
    {
        // The number of these is expected to be low.
        _found = false;
        for (uint256 i; i < _self.rewardServices.length; i++) {
            if (address(_self.rewardServices[i].inflationReceiver) == address(_inflationReceiver)) {
                _index = i;
                _found = true;
                break;
            }
        }
    }

    /**
     * @notice Receive a topup request of minted native tokens and disburse amongst requestors.
     * @return _amountPostedWei The total amount of native tokens funded.
     * @dev Assume value is siting in Inflation contract waiting to be posted and transmitted.
     *   This function is atomic, so if for some reason not enough native tokens got minted, this
     *   function will fail until all topup requests can be satisfied.
     */
    function receiveTopupRequest(
        RewardServicesState storage _self
    ) 
        internal 
        returns(uint256 _amountPostedWei)
    {
        // Spin through all reward services
        for (uint256 i; i < _self.rewardServices.length; i++) {
            // Get the pending topup for the service
            uint256 pendingTopupWei = _self.rewardServices[i].getPendingTopup();
            // Accumulate topup received
            _self.rewardServices[i].addTopupReceived(pendingTopupWei);
            _self.totalInflationTopupReceivedWei = _self.totalInflationTopupReceivedWei.add(pendingTopupWei);
            // Transfer topup to rewarding service contract
            _self.rewardServices[i].inflationReceiver.receiveInflation{ value: pendingTopupWei }();
            // Accumulate topup withdrawn
            _self.rewardServices[i].addTopupWithdrawn(pendingTopupWei);
            _self.totalInflationTopupWithdrawnWei = _self.totalInflationTopupWithdrawnWei.add(pendingTopupWei);
            // Accumulate amount posted
            _amountPostedWei = _amountPostedWei.add(pendingTopupWei);
            
            emit RewardServiceTopupRequestReceived(_self.rewardServices[i].inflationReceiver, pendingTopupWei);
        }
    }
}
