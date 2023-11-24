// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import "../../utils/implementation/DateTimeLibrary.sol";
import "../implementation/IncentivePool.sol";
import "../interface/IIIncentivePoolReceiver.sol";
import "./IncentivePoolRewardService.sol";
import "@openzeppelin/contracts/math/Math.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "../../utils/implementation/SafePct.sol";
import "../interface/IIIncentivePoolSharingPercentageProvider.sol";
import "./IncentivePoolRewardService.sol";


/**
 * @title Incentive Pool Reward Services library
 * @notice A library to manage a collection of reward services, their associated totals, and to perform operations
 *  that impact or involve the collection, such as calculating topup amounts across services.
 * @dev There are two concepts that are helpful to understand. A sharing percentage associates an incentivePool
 *  receiver with a sharing percentage used to calculate percentage of authorized incentive a given reward contract
 *  is entitled to receive for distributing rewards. A reward service is associtated to a topup configuration, which
 *  dictates how much native token will be sent for claiming reserves, and it stores totals for a given 
 *  incentivePool receiver, for a given annum.
 **/
library IncentivePoolRewardServices {    
    using BokkyPooBahsDateTimeLibrary for uint256;
    using IncentivePoolRewardService for IncentivePoolRewardService.IncentivePoolRewardServiceState;
    using SafeMath for uint256;
    using SafePct for uint256;

    /**
     * @dev `IncentivePoolRewardServicesState` is state structure used by this library to manage
     *   a collection of reward services and associated totals.
     */
    struct IncentivePoolRewardServicesState {
        // Collection of annums
        IncentivePoolRewardService.IncentivePoolRewardServiceState[] incentivePoolRewardServices;
        // Balances
        uint256 totalAuthorizedIncentiveWei;
        uint256 totalIncentiveTopupRequestedWei;
        uint256 totalIncentiveTopupReceivedWei;
        uint256 totalIncentiveTopupWithdrawnWei;
    }

    uint256 internal constant BIPS100 = 1e4;                            // 100% in basis points

    event IncentivePoolRewardServiceDailyAuthorizedIncentiveComputed(
        IIIncentivePoolReceiver incentivePoolReceiver,
        uint256 amountWei);
    event IncentivePoolRewardServiceTopupRequestReceived(
        IIIncentivePoolReceiver incentivePoolReceiver,
        uint256 amountWei);

    /**
     * @notice For all sharing percentages, compute authorized daily incentive for current cycle
     *  and then allocate it across associated incentivePool receivers according to their sharing percentages, 
     *  updating reward service totals along the way. Finally,
     *  set the daily authorized incentive for the given incentivePool receiver.
     * @param _totalRecognizedIncentiveWei The total recognized incentive across all annums.
     * @param _totalAuthorizedIncentiveWei The total authorized incentive across all annums.
     * @param _periodsRemaining The number of periods remaining in the current annum.
     * @param _maxAuthorizeAmountWei The maximum amount that can be authorized according to treasury pull limits.
     * @param _sharingPercentages An array of incentive sharing percentages.
     * @return _amountAuthorizedWei The incentive authorized for this cycle.
     * @dev This method requires totals across all annums so as to continually calculate
     *   the amount remaining to be authorized regardless of timing slippage between annums should it
     *   occur.
     */
    function authorizeDailyIncentive(
        IncentivePoolRewardServicesState storage _self,
        uint256 _totalRecognizedIncentiveWei,
        uint256 _totalAuthorizedIncentiveWei,
        uint256 _periodsRemaining,
        uint256 _maxAuthorizeAmountWei,
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
        uint256 amountToAuthorizeRemaingWei = Math.min(
            _totalRecognizedIncentiveWei.sub(_totalAuthorizedIncentiveWei).div(_periodsRemaining),
            _maxAuthorizeAmountWei);
        // Set up return value with amount authorized
        _amountAuthorizedWei = amountToAuthorizeRemaingWei;
        // Accumulate authorized total...note that this total is for a given annum, for a given service
        _self.totalAuthorizedIncentiveWei = _self.totalAuthorizedIncentiveWei.add(amountToAuthorizeRemaingWei);
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
            ( bool found, uint256 incentivePoolRewardServiceIndex ) = 
                findIncentivePoolRewardService(_self, _sharingPercentages[i].incentivePoolReceiver);
            if (found) {
                // Get the existing reward service
                IncentivePoolRewardService.IncentivePoolRewardServiceState storage incentivePoolRewardService = 
                    _self.incentivePoolRewardServices[incentivePoolRewardServiceIndex];
                // Accumulate the amount authorized for the service
                incentivePoolRewardService.addAuthorizedIncentive(toAuthorizeWei);
            } else {
                // Initialize a new reward service
                IncentivePoolRewardService.IncentivePoolRewardServiceState storage incentivePoolRewardService = 
                    _self.incentivePoolRewardServices.push();
                incentivePoolRewardService.initialize(_sharingPercentages[i].incentivePoolReceiver);
                // Accumulate the amount authorized for the service
                incentivePoolRewardService.addAuthorizedIncentive(toAuthorizeWei);                
            }                
            // Signal the incentivePool receiver of the reward service (the actual rewarding contract)
            // with amount just authorized.
            _sharingPercentages[i].incentivePoolReceiver.setDailyAuthorizedIncentive(toAuthorizeWei);
            
            emit IncentivePoolRewardServiceDailyAuthorizedIncentiveComputed(
                _sharingPercentages[i].incentivePoolReceiver, 
                toAuthorizeWei);
        }
    }

    /**
     * @notice Given topup configurations as maintained by an instantiated IncentivePool contract, compute
     *   the topup requests needed to topup reward contracts with native token reserves to satisfy claim requests.
     * @param _incentivePool    The IncentivePool contract holding the topup configurations.
     * @return _topupRequestWei The topup request to mint native tokens across reward services for this cycle.
     */
    function computeTopupRequest(
        IncentivePoolRewardServicesState storage _self,
        IncentivePool _incentivePool
    )
        internal
        returns (uint256 _topupRequestWei)
    {
        for (uint256 i; i < _self.incentivePoolRewardServices.length; i++) {
            TopupConfiguration memory topupConfiguration = 
                _incentivePool.getTopupConfiguration(_self.incentivePoolRewardServices[i].incentivePoolReceiver);
            _topupRequestWei = 
                _topupRequestWei.add(_self.incentivePoolRewardServices[i].computeTopupRequest(topupConfiguration));
        }
        _self.totalIncentiveTopupRequestedWei = _self.totalIncentiveTopupRequestedWei.add(_topupRequestWei);
        // Make sure topup requested never exceeds the amount authorized
        assert(_self.totalIncentiveTopupRequestedWei <= _self.totalAuthorizedIncentiveWei);
    }

    /**
     * @notice Given an incentivePool receiver, return the index of the associated reward service.
     * @param _incentivePoolReceiver The incentivePool receiver.
     * @return _found   True if the reward service was found.
     * @return _index   The index on the incentivePoolRewardServices array of the found service. Index is undefined
     *   if the reward service was not found.
     */
    function findIncentivePoolRewardService(
        IncentivePoolRewardServicesState storage _self,
        IIIncentivePoolReceiver _incentivePoolReceiver
    ) 
        internal view
        returns(bool _found, uint256 _index)
    {
        // The number of these is expected to be low.
        _found = false;
        for (uint256 i; i < _self.incentivePoolRewardServices.length; i++) {
            if (_self.incentivePoolRewardServices[i].incentivePoolReceiver == _incentivePoolReceiver) {
                _index = i;
                _found = true;
                break;
            }
        }
    }

    /**
     * @notice Receive a topup request of native tokens and disburse amongst requestors.
     * @return _amountPostedWei The total amount of native tokens funded.
     * @dev Assume value is siting in IncentivePool contract waiting to be posted and transmitted.
     *   This function is atomic, so if for some reason not enough native tokens are available, this
     *   function will fail until all topup requests can be satisfied.
     */
    function distributeTopupRequest(
        IncentivePoolRewardServicesState storage _self
    ) 
        internal 
        returns(uint256 _amountPostedWei)
    {
        // Spin through all reward services
        for (uint256 i; i < _self.incentivePoolRewardServices.length; i++) {
            // Get the pending topup for the service
            uint256 pendingTopupWei = _self.incentivePoolRewardServices[i].getPendingTopup();
            // Accumulate topup received
            _self.incentivePoolRewardServices[i].addTopupReceived(pendingTopupWei);
            _self.totalIncentiveTopupReceivedWei = _self.totalIncentiveTopupReceivedWei.add(pendingTopupWei);
            // Transfer topup to rewarding service contract
            _self.incentivePoolRewardServices[i].incentivePoolReceiver.receiveIncentive{value: pendingTopupWei}();
            // Accumulate topup withdrawn
            _self.incentivePoolRewardServices[i].addTopupWithdrawn(pendingTopupWei);
            _self.totalIncentiveTopupWithdrawnWei = _self.totalIncentiveTopupWithdrawnWei.add(pendingTopupWei);
            // Accumulate amount posted
            _amountPostedWei = _amountPostedWei.add(pendingTopupWei);
            
            emit IncentivePoolRewardServiceTopupRequestReceived(
                _self.incentivePoolRewardServices[i].incentivePoolReceiver,
                pendingTopupWei);
        }
    }
}
