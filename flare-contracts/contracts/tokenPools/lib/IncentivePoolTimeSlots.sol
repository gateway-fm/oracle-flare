// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import "@openzeppelin/contracts/math/Math.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "../../utils/implementation/SafePct.sol";


/**
 * @title IncentivePool time slots library
 * @notice A library to manage a collection of incentive pool time slots.
 **/
library IncentivePoolTimeSlots {
    using SafeMath for uint256;
    using SafePct for uint256;

    /**
     * @dev `IncentivePoolTimeSlot` is state structure used by this library to manage
     *   an incentive pool time slot.
     */
    struct IncentivePoolTimeSlot {
        uint256 recognizedIncentiveWei;
        uint256 startTimeStamp;
        uint256 endTimeStamp;
    }

    /**
     * @dev `IncentivePoolTimeSlotsState` is state structure used by this library to manage
     *   a collection of incentive pool time slots.
     */
    struct IncentivePoolTimeSlotsState {
        // Collection of time slots
        IncentivePoolTimeSlot[] incentivePoolTimeSlots;
        uint256 currentTimeSlot;
    }

    uint256 internal constant BIPS100 = 1e4;                                // 100% in basis points
    uint256 internal constant MAX_ANNUAL_FACTOR_BIPS = 1e3;                 // 10% in basis points
    uint256 internal constant SECONDS_PER_DAY = 1 days;

    string internal constant ERR_NO_TIME_SLOT = "no time slot";
    string internal constant ERR_TOO_EARLY = "too early";

    /**
     * @notice Initialize a new time slot, add it to the time slot collection and set current time slot pointer.
     * @param _startTimeStamp                       The timestamp to start the time slot.
     * @param _treasuryBalance                      The treasury balance used to recognize incentive.
     * @param _inflatableBalance                    The inflatable balance used to recognize incentive.
     * @param _timeSlotIncentivePoolPercentageBips  The incentive pool percentage in bips to use when recognizing
     *                                              incentive.
     */
    function initializeNewTimeSlot(
        IncentivePoolTimeSlotsState storage _self,
        uint256 _startTimeStamp,
        uint256 _treasuryBalance,
        uint256 _inflatableBalance,
        uint256 _timeSlotIncentivePoolPercentageBips
    )
        internal
        returns (IncentivePoolTimeSlot storage _incentivePoolTimeSlot)
    {
        // Start time cannot be before last time slot ends
        if (getCount(_self) > 0) {
            require(_startTimeStamp > getCurrentTimeSlot(_self).endTimeStamp, ERR_TOO_EARLY);
        }
        // Create an empty timeSlot
        _incentivePoolTimeSlot = _self.incentivePoolTimeSlots.push();
        // Initialize it with newly passed in time slot info
        _incentivePoolTimeSlot.startTimeStamp = _startTimeStamp;
        _incentivePoolTimeSlot.recognizedIncentiveWei = _computeRecognizedIncentiveWei(
            _treasuryBalance,
            _inflatableBalance,
            _timeSlotIncentivePoolPercentageBips);
        _incentivePoolTimeSlot.endTimeStamp = _getTimeSlotEndsTs(_startTimeStamp);
        // Reposition index pointing to current timeSlot
        if (_self.incentivePoolTimeSlots.length > 1) {
            _self.currentTimeSlot = _self.currentTimeSlot.add(1);
        }
    }

    /**
     * @notice Get the number of incentive pool time slots.
     * @return The count.
     */
    function getCount(IncentivePoolTimeSlotsState storage _self) internal view returns(uint256) {
        return _self.incentivePoolTimeSlots.length;
    }

    /**
     * @notice Given an index, return a given incentive pool time slot data.
     * @param _index    The index of the time slot to fetch.
     * @return _incentivePoolTimeSlot  Returns IncentivePoolTimeSlot found at _index.
     * @dev Will revert if index not found.
     */
    function getTimeSlot(
        IncentivePoolTimeSlotsState storage _self,
        uint256 _index
    )
        internal view
        returns (IncentivePoolTimeSlot storage _incentivePoolTimeSlot)
    {
        require(_index < getCount(_self), ERR_NO_TIME_SLOT);
        _incentivePoolTimeSlot = _self.incentivePoolTimeSlots[_index];
    }

    /**
     * @notice Return incentivePool time slot data for the current time slot.
     * @return _incentivePoolTimeSlot  Returns IncentivePoolTimeSlot
     *                                 for the current time slot.
     * @dev Will revert if no current time slot.
     */
    function getCurrentTimeSlot(
        IncentivePoolTimeSlotsState storage _self
    )
        internal view
        returns (IncentivePoolTimeSlot storage _incentivePoolTimeSlot)
    {
        require(getCount(_self) > 0, ERR_NO_TIME_SLOT);
        _incentivePoolTimeSlot = _self.incentivePoolTimeSlots[_self.currentTimeSlot];
    }

    /**
     * @notice Return incentivePool time slot id of the current time slot.
     * @return _currentTimeSlotId  Returns id for the current time slot.
     * @dev Will revert if no current time slot.
     */
    function getCurrentTimeSlotId(
        IncentivePoolTimeSlotsState storage _self
    )
        internal view
        returns (uint256 _currentTimeSlotId)
    {
        require(getCount(_self) > 0, ERR_NO_TIME_SLOT);
        _currentTimeSlotId = _self.currentTimeSlot;
    }

    /**
     * @notice Compute the number of periods remaining within a time slot.
     * @param _atTimeStamp  Compute periods remaining at this time stamp.
     * @return The number of periods remaining.
     * @dev The number of periods must include the current day.
     */
    function getPeriodsRemaining(
        IncentivePoolTimeSlot storage _self,
        uint256 _atTimeStamp
    )
        internal view
        returns(uint256)
    {
        assert(_atTimeStamp <= _self.endTimeStamp);
        // Add 1 to the periods remaining because the difference between days does not count the current day.
        return _computeDaysRemainingInTimeSlot(_self, _atTimeStamp).add(1);
    }

    /**
     * @notice Helper function to compute the number of days remaining in a time slot.
     * @param _atTimeStamp  Compute the number of days for the time slot at this time stamp.
     * @return The number of days computed.
     * @dev If _atTimeStamp is after the end of the time slot, 0 days will be returned.
     */
    function _computeDaysRemainingInTimeSlot(
        IncentivePoolTimeSlot storage _self,
        uint256 _atTimeStamp
    )
        private view
        returns(uint256)
    {
        uint256 endTimeStamp = _self.endTimeStamp;
        if (_atTimeStamp > endTimeStamp) {
            return 0;
        } else {
            return (endTimeStamp - _atTimeStamp) / SECONDS_PER_DAY;
        }
    }

    /**
     * @notice Helper function to compute recognized incentive.
     * @param _treasuryBalance                      The treasury balance used to recognize incentive.
     * @param _inflatableBalance                    The inflatable balance used to recognize incentive.
     * @param _timeSlotIncentivePoolPercentageBips  The time slot percentage used to recognize incentive.
     * @return The computed recognized incentive.
     */
    function _computeRecognizedIncentiveWei(
        uint256 _treasuryBalance,
        uint256 _inflatableBalance,
        uint256 _timeSlotIncentivePoolPercentageBips
    )
        private pure
        returns(uint256)
    {
        return Math.min(
            _inflatableBalance.mulDiv(_timeSlotIncentivePoolPercentageBips, 12 * BIPS100),
            _treasuryBalance.mulDiv(MAX_ANNUAL_FACTOR_BIPS, 12 * BIPS100)
        ); // monthly incentive
    }

    /**
     * @notice Given a start time stamp, compute the end time stamp for a time slot.
     * @param _startTimeStamp The start time stamp for a time slot.
     * @return The end time stamp for the time slot.
     */
    function _getTimeSlotEndsTs(uint256 _startTimeStamp) private pure returns (uint256) {
        // This should cover passing through Feb 29
        return _startTimeStamp.add(SECONDS_PER_DAY * 30).sub(1);
    }


}
