// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import "../../utils/implementation/DateTimeLibrary.sol";
import "./IncentivePoolRewardServices.sol";
import "@openzeppelin/contracts/math/Math.sol";
import "@openzeppelin/contracts/utils/SafeCast.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "../../utils/implementation/SafePct.sol";


/**
 * @title IncentivePool Annum library
 * @notice A library to manage an incentivePool annum. 
 **/
library IncentivePoolAnnum {    
    using BokkyPooBahsDateTimeLibrary for uint256;
    using IncentivePoolAnnum for IncentivePoolAnnum.IncentivePoolAnnumState;
    using SafeCast for uint256;
    using SafeMath for uint256;
    using SafePct for uint256;

    /**
     * @dev `IncentivePoolAnnumState` is state structure used by this library to manage
     *   an incentivePool annum.
     */
    struct IncentivePoolAnnumState {
        uint256 recognizedIncentiveWei;
        uint256 startTimeStamp;
        uint256 endTimeStamp;
        IncentivePoolRewardServices.IncentivePoolRewardServicesState incentivePoolRewardServices;
    }

    uint256 internal constant BIPS100 = 1e4;                                // 100% in basis points
    uint256 internal constant MAX_ANNUAL_FACTOR_BIPS = 1e3;                 // 10% in basis points

    /**
     * @notice Helper function to compute recognized incentive.
     * @param _treasuryBalance                      The treasury balance used to recognize incentive.
     * @param _inflatableBalance                    The inflatable balance used to recognize incentive.
     * @param _annualIncentivePoolPercentageBips    The annual percentage used to recognize incentive.
     * @return The computed recognized incentive.
     */
    function _computeRecognizedIncentiveWei(
        uint256 _treasuryBalance,
        uint256 _inflatableBalance, 
        uint256 _annualIncentivePoolPercentageBips
    ) 
        internal pure
        returns(uint256)
    {
        return Math.min(
            _inflatableBalance.mulDiv(_annualIncentivePoolPercentageBips, 12 * BIPS100),
            _treasuryBalance.mulDiv(MAX_ANNUAL_FACTOR_BIPS, 12 * BIPS100)
        ); // monthly incentive
    }

    /**
     * @notice Helper function to compute the number of days remaining in an annum.
     * @param _atTimeStamp  Compute the number of days for the annum at this time stamp.
     * @return The number of days computed.
     * @dev If _atTimeStamp is after the end of the annum, 0 days will be returned.
     */
    function _computeDaysRemainingInAnnum(
        IncentivePoolAnnumState storage _self, 
        uint256 _atTimeStamp
    )
        internal view
        returns(uint256)
    {
        uint256 endTimeStamp = _self.endTimeStamp;
        if (_atTimeStamp > endTimeStamp) {
            return 0;
        } else {
            return _atTimeStamp.diffDays(endTimeStamp);
        }
    }

    /**
     * @notice Given a start time stamp, compute the end time stamp for an annum.
     * @param _startTimeStamp The start time stamp for an annum.
     * @return The end time stamp for the annum.
     */
    function _getAnnumEndsTs(uint256 _startTimeStamp) internal pure returns (uint256) {
        // This should cover passing through Feb 29
        return _startTimeStamp.addDays(30).subSeconds(1);
    }

    /**
     * @notice Compute the number of periods remaining within an annum.
     * @param _atTimeStamp  Compute periods remaining at this time stamp.
     * @return The number of periods remaining.
     * @dev The number of periods must include the current day.
     */
    function getPeriodsRemaining(
        IncentivePoolAnnumState storage _self, 
        uint256 _atTimeStamp
    )
        internal view 
        returns(uint256)
    {
        assert(_atTimeStamp <= _self.endTimeStamp);
        // Add 1 to the periods remaining because the difference between days does not count the current day.
        return _computeDaysRemainingInAnnum(_self, _atTimeStamp).add(1);
    }

    /**
     * @notice Initialize a new annum data structure.
     * @param _startTimeStamp                       The start time stamp of the new annum.
     * @param _treasuryBalance                      The treasury balance used to calculate recognized 
     *                                              incentive for the new annum.
     * @param _inflatableBalanceWei                 The inflatable balance used to calculate recognized 
     *                                              incentive for the new annum.
     * @param _annualIncentivePoolPercentageBips    The annual incentivePool percentage in bips to calc recognized 
     *                                              incentivePool.
     * @dev A newly created IncentivePoolAnnumState is expected to exist.
     */
    function initialize(
        IncentivePoolAnnumState storage _self,
        uint256 _startTimeStamp, 
        uint256 _treasuryBalance, 
        uint256 _inflatableBalanceWei, 
        uint256 _annualIncentivePoolPercentageBips
    ) 
        internal
    {
        _self.startTimeStamp = _startTimeStamp;
        _self.recognizedIncentiveWei = _computeRecognizedIncentiveWei(
            _treasuryBalance,
            _inflatableBalanceWei, 
            _annualIncentivePoolPercentageBips);
        _self.endTimeStamp = _getAnnumEndsTs(_startTimeStamp);
    }
}
