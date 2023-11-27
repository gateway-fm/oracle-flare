// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import "../implementation/Inflation.sol";
import "./InflationAnnum.sol";
import "./RewardServices.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "../../utils/implementation/SafePct.sol";
import "../interface/IIInflationSharingPercentageProvider.sol";


/**
 * @title Inflation Annums library
 * @notice A library to manage a collection of inflation annum and associated totals.
 * @dev Operations such as authorizing daily inflation are dispatched from this collection
 *  library because the result of the authorization is added to the total authorized across
 *  all annums, which is a concern of this library and not the concern of a given annum, nor the caller.
 **/
library InflationAnnums {    
    using InflationAnnum for InflationAnnum.InflationAnnumState;
    using RewardServices for RewardServices.RewardServicesState;
    using SafeMath for uint256;
    using SafePct for uint256;

    /**
     * @dev `InflationAnnumsState` is state structure used by this library to manage
     *   a collection of inflation annums and associated totals.
     */
    struct InflationAnnumsState {
        // Collection of annums
        InflationAnnum.InflationAnnumState[] inflationAnnums;
        uint256 currentAnnum;
        // Balances
        uint256 totalRecognizedInflationWei;
        uint256 totalAuthorizedInflationWei;
        uint256 totalInflationTopupRequestedWei;
        uint256 totalInflationTopupReceivedWei;
        uint256 totalInflationTopupWithdrawnWei;
    }

    string internal constant ERR_NO_ANNUM = "no annum";
    string internal constant ERR_TOO_EARLY = "too early";

    /**
     * @notice Dispatch inflation authorization to be performed across all reward services according to their
     *   sharing percentage for the current annum, and then maintain sum total of inflation
     *   authorized across all annums.
     * @param _atTimeStamp  The timestamp at which the number of daily periods remaining in the current
     *   annum will be calculated.
     * @param _sharingPercentages   An array of the sharing percentages by inflation receiver used to
     *   allocate authorized inflation.
     * @return _amountAuthorizedWei The amount of inflation authorized for this authorization cycle.
     * @dev Invariant: total inflation authorized cannot be greater than total inflation recognized. 
     */
    function authorizeDailyInflation(
        InflationAnnumsState storage _self,
        uint256 _atTimeStamp, 
        SharingPercentage[] memory _sharingPercentages
    ) 
        internal
        returns(uint256 _amountAuthorizedWei)
    {
        // Get the current annum
        InflationAnnum.InflationAnnumState storage currentAnnum = getCurrentAnnum(_self);

        // Authorize daily inflation for the current annum, across reward services, given
        // sharing percentages.
        _amountAuthorizedWei = currentAnnum.rewardServices.authorizeDailyInflation(
            _self.totalRecognizedInflationWei,
            _self.totalAuthorizedInflationWei, 
            currentAnnum.getPeriodsRemaining(_atTimeStamp), 
            _sharingPercentages);
        // Accumulate total authorized inflation across all annums
        _self.totalAuthorizedInflationWei = _self.totalAuthorizedInflationWei.add(_amountAuthorizedWei);
        // Make sure that total authorized never exceeds total recognized
        assert(_self.totalAuthorizedInflationWei <= _self.totalRecognizedInflationWei);
    }

    /**
     * @notice Dispatch topup request calculations across reward services and sum up total mint request made
     *   to fund topup of reward services.
     * @param _inflation    The Inflation contract containing the topup confguration of each reward service.
     * @return _topupRequestWei The amount of native token requested to be minted across reward services for 
     *   this cycle.
     * @dev Invariant: total inflation topup requested cannot exceed total inflation authorized
     */
    function computeTopupRequest(
        InflationAnnumsState storage _self,
        Inflation _inflation
    )
        internal
        returns(uint256 _topupRequestWei)
    {
        // Get the current annum
        InflationAnnum.InflationAnnumState storage currentAnnum = getCurrentAnnum(_self);
        // Compute the topup
        _topupRequestWei = currentAnnum.rewardServices.computeTopupRequest(_inflation);
        // Sum the topup request total across annums
        _self.totalInflationTopupRequestedWei = _self.totalInflationTopupRequestedWei.add(_topupRequestWei);
        // Make sure that total topup requested can never exceed inflation authorized
        assert(_self.totalInflationTopupRequestedWei <= _self.totalAuthorizedInflationWei);
    }

    /**
     * @notice Receive minted native tokens (and fund) to satisfy reward services topup requests.
     * @return _amountPostedWei The native tokens posted (funded) to reward service contracts.
     * @dev Invariants:
     *   1) Native tokens topup received cannot exceed native tokens topup requested
     *   2) Native tokens topup withdrawn for funding cannot exceed native tokens topup received
     */
    function receiveTopupRequest(
        InflationAnnumsState storage _self
    )
        internal
        returns(uint256 _amountPostedWei)
    {
        // Get the current annum
        InflationAnnum.InflationAnnumState storage currentAnnum = getCurrentAnnum(_self);

        // Receive minting of topup request. Post to received and withdrawn buckets for each reward service.
        _amountPostedWei = currentAnnum.rewardServices.receiveTopupRequest();
        // Post the amount of native tokens received into the Inflation contract
        _self.totalInflationTopupReceivedWei = _self.totalInflationTopupReceivedWei.add(_amountPostedWei);
        // Received should never be more than requested
        assert(_self.totalInflationTopupReceivedWei <= _self.totalInflationTopupRequestedWei);
        // Post amount withdrawn and transferred to reward service contracts
        _self.totalInflationTopupWithdrawnWei = _self.totalInflationTopupWithdrawnWei.add(_amountPostedWei);
        // Withdrawn should never be more than received
        assert(_self.totalInflationTopupWithdrawnWei <= _self.totalInflationTopupReceivedWei);
    }

    /**
     * @notice Get the number of inflation annums.
     * @return The count.
     */
    function getCount(InflationAnnumsState storage _self) internal view returns(uint256) {
        return _self.inflationAnnums.length;
    }

    /**
     * @notice Given an index, return a given inflation annum data.
     * @param _index    The index of the annum to fetch.
     * @return _inflationAnnum  Returns InflationAnnum.InflationAnnumState found at _index.
     * @dev Will revert if index not found.
     */
    function getAnnum(
        InflationAnnumsState storage _self,
        uint256 _index
    )
        internal view
        returns (InflationAnnum.InflationAnnumState storage _inflationAnnum)
    {
        require(_index < getCount(_self), ERR_NO_ANNUM);
        _inflationAnnum = _self.inflationAnnums[_index];
    }

    /**
     * @notice Return inflation annum data for the current annum.
     * @return _inflationAnnum  Returns InflationAnnum.InflationAnnumState for the current annum.
     * @dev Will revert if no current annum.
     */
    function getCurrentAnnum(
        InflationAnnumsState storage _self
    )
        internal view 
        returns (InflationAnnum.InflationAnnumState storage _inflationAnnum)
    {
        require(getCount(_self) > 0, ERR_NO_ANNUM);
        _inflationAnnum = _self.inflationAnnums[_self.currentAnnum];
    }

    /**
     * @notice Initialize a new annum, add it to the annum collection, maintian running total
     *   of recognized inflation resulting from new annum, and set current annum pointer.
     * @param _startTimeStamp                   The timestamp to start the annum.
     * @param _inflatableBalance                The balance to use when recognizing inflation for the annum.
     * @param _annualInflationPercentageBips    The inflation percentage in bips to use when recognizing inflation.
     */
    function initializeNewAnnum(
        InflationAnnumsState storage _self,
        uint256 _startTimeStamp, 
        uint256 _inflatableBalance, 
        uint256 _annualInflationPercentageBips
    ) 
        internal
    {
        // Start time cannot be before last annum ends
        if (getCount(_self) > 0) {
            require(_startTimeStamp > getCurrentAnnum(_self).endTimeStamp, ERR_TOO_EARLY);
        }
        // Create an empty annum
        InflationAnnum.InflationAnnumState storage inflationAnnum = _self.inflationAnnums.push();
        // Initialize it with newly passed in annum info
        inflationAnnum.initialize(_startTimeStamp, _inflatableBalance, _annualInflationPercentageBips);
        // Accumulate total recognized inflation across annums 
        _self.totalRecognizedInflationWei = 
            _self.totalRecognizedInflationWei.add(inflationAnnum.recognizedInflationWei);
        // Reposition index pointing to current annum
        if (_self.inflationAnnums.length > 1) {
            _self.currentAnnum = _self.currentAnnum.add(1);
        }
    }
}
