// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import "../implementation/IncentivePool.sol";
import "./IncentivePoolAnnum.sol";
import "./IncentivePoolRewardServices.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "../../utils/implementation/SafePct.sol";
import "../interface/IIIncentivePoolSharingPercentageProvider.sol";


/**
 * @title IncentivePool Annums library
 * @notice A library to manage a collection of incentivePool annum and associated totals.
 * @dev Operations such as authorizing daily incentive are dispatched from this collection
 *  library because the result of the authorization is added to the total authorized across
 *  all annums, which is a concern of this library and not the concern of a given annum, nor the caller.
 **/
library IncentivePoolAnnums {    
    using IncentivePoolAnnum for IncentivePoolAnnum.IncentivePoolAnnumState;
    using IncentivePoolRewardServices for IncentivePoolRewardServices.IncentivePoolRewardServicesState;
    using SafeMath for uint256;
    using SafePct for uint256;

    /**
     * @dev `IncentivePoolAnnumsState` is state structure used by this library to manage
     *   a collection of incentivePool annums and associated totals.
     */
    struct IncentivePoolAnnumsState {
        // Collection of annums
        IncentivePoolAnnum.IncentivePoolAnnumState[] incentivePoolAnnums;
        uint256 currentAnnum;
        // Balances
        uint256 totalRecognizedIncentiveWei;
        uint256 totalAuthorizedIncentiveWei;
        uint256 totalIncentiveTopupRequestedWei;
        uint256 totalIncentiveTopupReceivedWei;
        uint256 totalIncentiveTopupWithdrawnWei;
    }

    string internal constant ERR_NO_ANNUM = "no annum";
    string internal constant ERR_TOO_EARLY = "too early";

    /**
     * @notice Dispatch incentivePool authorization to be performed across all reward services according to their
     *   sharing percentage for the current annum, and then maintain sum total of incentive
     *   authorized across all annums.
     * @param _atTimeStamp  The timestamp at which the number of daily periods remaining in the current
     *   annum will be calculated.
     * @param _maxAuthorizeAmountWei The maximum amount that can be authorized according to treasury pull limits.
     * @param _sharingPercentages   An array of the sharing percentages by incentivePool receiver used to
     *   allocate authorized incentive.
     * @return _amountAuthorizedWei The amount of incentive authorized for this authorization cycle.
     * @dev Invariant: total incentive authorized cannot be greater than total incentive recognized. 
     */
    function authorizeDailyIncentive(
        IncentivePoolAnnumsState storage _self,
        uint256 _atTimeStamp, 
        uint256 _maxAuthorizeAmountWei,
        SharingPercentage[] memory _sharingPercentages
    ) 
        internal
        returns(uint256 _amountAuthorizedWei)
    {
        // Get the current annum
        IncentivePoolAnnum.IncentivePoolAnnumState storage currentAnnum = getCurrentAnnum(_self);

        // Authorize daily incentive for the current annum, across reward services, given
        // sharing percentages.
        _amountAuthorizedWei = currentAnnum.incentivePoolRewardServices.authorizeDailyIncentive(
            _self.totalRecognizedIncentiveWei,
            _self.totalAuthorizedIncentiveWei, 
            currentAnnum.getPeriodsRemaining(_atTimeStamp), 
            _maxAuthorizeAmountWei,
            _sharingPercentages);
        // Accumulate total authorized incentive across all annums
        _self.totalAuthorizedIncentiveWei = _self.totalAuthorizedIncentiveWei.add(_amountAuthorizedWei);
        // Make sure that total authorized never exceeds total recognized
        assert(_self.totalAuthorizedIncentiveWei <= _self.totalRecognizedIncentiveWei);
    }

    /**
     * @notice Dispatch topup request calculations across reward services and sum up total mint request made
     *   to fund topup of reward services.
     * @param _incentivePool    The IncentivePool contract containing the topup confguration of each reward service.
     * @return _topupRequestWei The amount of native token requested across reward services for this cycle.
     * @dev Invariant: total incentive topup requested cannot exceed total incentive authorized
     */
    function computeTopupRequest(
        IncentivePoolAnnumsState storage _self,
        IncentivePool _incentivePool
    )
        internal
        returns(uint256 _topupRequestWei)
    {
        // Get the current annum
        IncentivePoolAnnum.IncentivePoolAnnumState storage currentAnnum = getCurrentAnnum(_self);
        // Compute the topup
        _topupRequestWei = currentAnnum.incentivePoolRewardServices.computeTopupRequest(_incentivePool);
        // Sum the topup request total across annums
        _self.totalIncentiveTopupRequestedWei = _self.totalIncentiveTopupRequestedWei.add(_topupRequestWei);
        // Make sure that total topup requested can never exceed incentive authorized
        assert(_self.totalIncentiveTopupRequestedWei <= _self.totalAuthorizedIncentiveWei);
    }

    /**
     * @notice Distribute native tokens to satisfy reward services topup requests.
     * @return _amountPostedWei The native tokens posted (funded) to reward service contracts.
     * @dev Invariants:
     *   1) Native tokens topup received cannot exceed native tokens topup requested
     *   2) Native tokens topup withdrawn for funding cannot exceed native tokens topup received
     */
    function distributeTopupRequest(
        IncentivePoolAnnumsState storage _self
    )
        internal
        returns(uint256 _amountPostedWei)
    {
        // Get the current annum
        IncentivePoolAnnum.IncentivePoolAnnumState storage currentAnnum = getCurrentAnnum(_self);

        // Distribute topup request. Post to received and withdrawn buckets for each reward service.
        _amountPostedWei = currentAnnum.incentivePoolRewardServices.distributeTopupRequest();
        // Post the amount of native tokens received into the IncentivePool contract
        _self.totalIncentiveTopupReceivedWei = _self.totalIncentiveTopupReceivedWei.add(_amountPostedWei);
        // Received should never be more than requested
        assert(_self.totalIncentiveTopupReceivedWei <= _self.totalIncentiveTopupRequestedWei);
        // Post amount withdrawn and transferred to reward service contracts
        _self.totalIncentiveTopupWithdrawnWei = _self.totalIncentiveTopupWithdrawnWei.add(_amountPostedWei);
        // Withdrawn should never be more than received
        assert(_self.totalIncentiveTopupWithdrawnWei <= _self.totalIncentiveTopupReceivedWei);
    }

    /**
     * @notice Get the number of incentivePool annums.
     * @return The count.
     */
    function getCount(IncentivePoolAnnumsState storage _self) internal view returns(uint256) {
        return _self.incentivePoolAnnums.length;
    }

    /**
     * @notice Given an index, return a given incentivePool annum data.
     * @param _index    The index of the annum to fetch.
     * @return _incentivePoolAnnum  Returns IncentivePoolAnnum.IncentivePoolAnnumState found at _index.
     * @dev Will revert if index not found.
     */
    function getAnnum(
        IncentivePoolAnnumsState storage _self,
        uint256 _index
    )
        internal view
        returns (IncentivePoolAnnum.IncentivePoolAnnumState storage _incentivePoolAnnum)
    {
        require(_index < getCount(_self), ERR_NO_ANNUM);
        _incentivePoolAnnum = _self.incentivePoolAnnums[_index];
    }

    /**
     * @notice Return incentivePool annum data for the current annum.
     * @return _incentivePoolAnnum  Returns IncentivePoolAnnum.IncentivePoolAnnumState for the current annum.
     * @dev Will revert if no current annum.
     */
    function getCurrentAnnum(
        IncentivePoolAnnumsState storage _self
    )
        internal view 
        returns (IncentivePoolAnnum.IncentivePoolAnnumState storage _incentivePoolAnnum)
    {
        require(getCount(_self) > 0, ERR_NO_ANNUM);
        _incentivePoolAnnum = _self.incentivePoolAnnums[_self.currentAnnum];
    }

    /**
     * @notice Initialize a new annum, add it to the annum collection, maintian running total
     *   of recognized incentive resulting from new annum, and set current annum pointer.
     * @param _startTimeStamp                       The timestamp to start the annum.
     * @param _treasuryBalance                      The treasury balance used to recognize incentive.
     * @param _inflatableBalance                    The inflatable balance used to recognize incentive.
     * @param _annualIncentivePoolPercentageBips    The incentivePool percentage in bips to use when recognizing 
     *                                              incentive.
     */
    function initializeNewAnnum(
        IncentivePoolAnnumsState storage _self,
        uint256 _startTimeStamp, 
        uint256 _treasuryBalance, 
        uint256 _inflatableBalance, 
        uint256 _annualIncentivePoolPercentageBips
    ) 
        internal
    {
        // Start time cannot be before last annum ends
        if (getCount(_self) > 0) {
            require(_startTimeStamp > getCurrentAnnum(_self).endTimeStamp, ERR_TOO_EARLY);
        }
        // Create an empty annum
        IncentivePoolAnnum.IncentivePoolAnnumState storage incentivePoolAnnum = _self.incentivePoolAnnums.push();
        // Initialize it with newly passed in annum info
        incentivePoolAnnum.initialize(
            _startTimeStamp, 
            _treasuryBalance, 
            _inflatableBalance, 
            _annualIncentivePoolPercentageBips
        );
        // Accumulate total recognized incentive across annums 
        _self.totalRecognizedIncentiveWei = 
            _self.totalRecognizedIncentiveWei.add(incentivePoolAnnum.recognizedIncentiveWei);
        // Reposition index pointing to current annum
        if (_self.incentivePoolAnnums.length > 1) {
            _self.currentAnnum = _self.currentAnnum.add(1);
        }
    }
}
