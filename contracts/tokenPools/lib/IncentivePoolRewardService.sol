// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import "../interface/IIIncentivePoolReceiver.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "../../utils/implementation/SafePct.sol";


enum TopupType{ FACTOROFDAILYAUTHORIZED, ALLAUTHORIZED }

/**
* @notice A struct that defines how mint request topups will be computed for a reward service.
* @param topupType             The type to signal how the topup amounts are to be calculated.
*                              FACTOROFDAILYAUTHORIZED = Use a factor of last daily authorized to set a
*                              target balance for a reward service to maintain as a reserve for claiming.
*                              ALLAUTHORIZED = Mint enough native tokens to topup reward service contract to hold
*                              all authorized but unrequested rewards.
* @param topupFactorX100       If _topupType == FACTOROFDAILYAUTHORIZED, then this factor (times 100)
*                              is multipled by last daily authorized incentive to obtain the
*                              maximum balance that a reward service can hold at any given time. If it holds less,
*                              then this max amount is used to compute the mint request topup required to 
*                              bring the reward service contract native token balance up to that amount.
*/
struct TopupConfiguration {
    TopupType topupType;                            // Topup algo type
    uint256 topupFactorX100;                        // Topup factor, times 100, if applicable for type
    bool configured;                                // Flag to indicate whether initially configured
}

/**
 * @title Reward Service library
 * @notice A library representing a reward service. A reward service consists of a reward contract and
 *   associated incentivePool-related totals. When a topup configuration is applied, a reward service can
 *   also make requests to topup native tokens within a reward contract.
 * @dev A reward service exists within the context of a given incentivePool annum.
 **/
library IncentivePoolRewardService {    
    using SafeMath for uint256;
    using SafePct for uint256;

    /**
     * @dev `IncentivePoolRewardServiceState` is state structure used by this library to manage
     *   an a reward service tracking authorize incentivePool.
     */
    struct IncentivePoolRewardServiceState {
        IIIncentivePoolReceiver incentivePoolReceiver;  // The target rewarding contract
        uint256 authorizedIncentiveWei;                 // Total authorized incentive for this reward service
        uint256 lastDailyAuthorizedIncentiveWei;        // Last daily authorized incentive amount
        uint256 incentivePoolTopupRequestedWei;         // Total incentive topup requested
        uint256 incentivePoolTopupReceivedWei;          // Total incentive topup received
        uint256 incentivePoolTopupWithdrawnWei;         // Total incentive sent to rewarding service contract
    }

    event IncentivePoolRewardServiceTopupComputed(IIIncentivePoolReceiver incentivePoolReceiver, uint256 amountWei);

    /**
     * @notice Maintain authorized incentive total for service.
     * @param _amountWei Amount to add.
     */
    function addAuthorizedIncentive(IncentivePoolRewardServiceState storage _self, uint256 _amountWei) internal {
        _self.authorizedIncentiveWei = _self.authorizedIncentiveWei.add(_amountWei);
        _self.lastDailyAuthorizedIncentiveWei = _amountWei;
    }

    /**
     * @notice Maintain topup native tokens received total for service. 
     * @param _amountWei Amount to add.
     */
    function addTopupReceived(IncentivePoolRewardServiceState storage _self, uint256 _amountWei) internal {
        _self.incentivePoolTopupReceivedWei = _self.incentivePoolTopupReceivedWei.add(_amountWei);
    }

    /**
     * @notice Maintain topup native tokens withdrawn (funded) total for service. 
     * @param _amountWei Amount to add.
     */
    function addTopupWithdrawn(IncentivePoolRewardServiceState storage _self, uint256 _amountWei) internal {
        _self.incentivePoolTopupWithdrawnWei = _self.incentivePoolTopupWithdrawnWei.add(_amountWei);
    }

    /**
     * @notice Given a topup configuration, compute the topup request for the reward contract associated
     *   to the service.
     * @param _topupConfiguration   The topup configuration defining the algo used to compute the topup amount.
     * @return _topupRequestWei     The topup request amount computed.
     */
    function computeTopupRequest(
        IncentivePoolRewardServiceState storage _self,
        TopupConfiguration memory _topupConfiguration
    )
        internal 
        returns (uint256 _topupRequestWei)
    {
        // Get the balance of the incentivePool receiver
        uint256 incentivePoolReceiverBalanceWei = address(_self.incentivePoolReceiver).balance;
        if (_topupConfiguration.topupType == TopupType.FACTOROFDAILYAUTHORIZED) {
            // Compute a topup request based purely on the given factor, the last daily authorization, and
            // the balance that is sitting in the reward service contract.
            uint256 requestedBalanceWei = _self.lastDailyAuthorizedIncentiveWei
                .mulDiv(_topupConfiguration.topupFactorX100, 100);
            uint256 rawTopupRequestWei = 0;
            // If current balance is less then requested, request some more.
            if (requestedBalanceWei > incentivePoolReceiverBalanceWei) {
                rawTopupRequestWei = requestedBalanceWei.sub(incentivePoolReceiverBalanceWei);
            }
            // Compute what is already pending to be topped up
            uint256 topupPendingWei = getPendingTopup(_self);
            // If what is pending to topup is greater than the raw request, request no more.
            if (topupPendingWei > rawTopupRequestWei) {
                _topupRequestWei = 0;
            } else {
                // Back out any request that is already pending
                _topupRequestWei = rawTopupRequestWei.sub(topupPendingWei);
            }
            // And finally, in any case, topup requested cannot be more than the net of 
            // authorized, pending, and received
            uint256 maxTopupRequestWei = _self.authorizedIncentiveWei
                .sub(topupPendingWei)
                .sub(_self.incentivePoolTopupReceivedWei);
            if (_topupRequestWei > maxTopupRequestWei) {
                _topupRequestWei = maxTopupRequestWei;
            }
        } else if (_topupConfiguration.topupType == TopupType.ALLAUTHORIZED) {
            _topupRequestWei = _self.authorizedIncentiveWei
                .sub(_self.incentivePoolTopupRequestedWei);
        } else { // This code is unreachable since TopupType currently has only 2 constructors
            _topupRequestWei = 0;
            assert(false);
        }
        _self.incentivePoolTopupRequestedWei = _self.incentivePoolTopupRequestedWei.add(_topupRequestWei);
        
        emit IncentivePoolRewardServiceTopupComputed(_self.incentivePoolReceiver, _topupRequestWei);
    }

    /**
     * @notice Compute a pending topup request.
     * @return _pendingTopupWei The amount pending to be sent.
     */
    function getPendingTopup(
        IncentivePoolRewardServiceState storage _self
    )
        internal view
        returns(uint256 _pendingTopupWei)
    {
        return _self.incentivePoolTopupRequestedWei.sub(_self.incentivePoolTopupReceivedWei);        
    }

    /**
     * @notice Initial a new reward service.
     * @dev Assume service is already instantiated.
     */
    function initialize(
        IncentivePoolRewardServiceState storage _self,
        IIIncentivePoolReceiver _incentivePoolReceiver
    ) 
        internal
    {
        _self.incentivePoolReceiver = _incentivePoolReceiver;
        _self.authorizedIncentiveWei = 0;
        _self.lastDailyAuthorizedIncentiveWei = 0;
        _self.incentivePoolTopupRequestedWei = 0;
        _self.incentivePoolTopupReceivedWei = 0;
        _self.incentivePoolTopupWithdrawnWei = 0;
    }
}
