// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import "@openzeppelin/contracts/math/Math.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "../../utils/implementation/SafePct.sol";


/**
 * @title Inflation time slots library
 * @notice A library to manage a collection of inflation time slots.
 **/
library InflationTimeSlots {
    using SafeMath for uint256;
    using SafePct for uint256;

    /**
     * @dev `InflationTimeSlot` is state structure used by this library to manage
     *   an inflation time slot.
     */
    struct InflationTimeSlot {
        uint256 recognizedInflationWei;
        uint256 startTimeStamp;
        uint256 endTimeStamp;
    }

    /**
     * @dev `InflationTimeSlotsState` is state structure used by this library to manage
     *   a collection of inflation time slots.
     */
    struct InflationTimeSlotsState {
        // Collection of time slots
        InflationTimeSlot[] inflationTimeSlots;
        uint256 currentTimeSlot;
    }

    uint256 internal constant BIPS100 = 1e4;                            // 100% in basis points
    uint256 internal constant MAX_ANNUAL_INFLATION = 5000000000 ether;
    uint256 internal constant SECONDS_PER_DAY = 1 days;

    string internal constant ERR_NO_TIME_SLOT = "no time slot";
    string internal constant ERR_TOO_EARLY = "too early";

    /**
     * @notice Initialize a new time slot, add it to the time slot collection and set current time slot pointer.
     * @param _startTimeStamp                   The timestamp to start the time slot.
     * @param _inflatableBalance                The balance to use when recognizing inflation for the time slot.
     * @param _timeSlotInflationPercentageBips  The inflation percentage in bips to use when recognizing inflation.
     */
    function initializeNewTimeSlot(
        InflationTimeSlotsState storage _self,
        uint256 _startTimeStamp,
        uint256 _inflatableBalance,
        uint256 _timeSlotInflationPercentageBips
    )
        internal
        returns (InflationTimeSlot storage _inflationTimeSlot)
    {
        // Start time cannot be before last time slot ends
        if (getCount(_self) > 0) {
            require(_startTimeStamp > getCurrentTimeSlot(_self).endTimeStamp, ERR_TOO_EARLY);
        }
        // Create an empty timeSlot
        _inflationTimeSlot = _self.inflationTimeSlots.push();
        // Initialize it with newly passed in time slot info
        _inflationTimeSlot.startTimeStamp = _startTimeStamp;
        _inflationTimeSlot.recognizedInflationWei = _computeRecognizedInflationWei(
            _inflatableBalance,
            _timeSlotInflationPercentageBips);
        _inflationTimeSlot.endTimeStamp = _getTimeSlotEndsTs(_startTimeStamp);
        // Reposition index pointing to current timeSlot
        if (_self.inflationTimeSlots.length > 1) {
            _self.currentTimeSlot = _self.currentTimeSlot.add(1);
        }
    }

    /**
     * @notice Get the number of inflation time slots.
     * @return The count.
     */
    function getCount(InflationTimeSlotsState storage _self) internal view returns(uint256) {
        return _self.inflationTimeSlots.length;
    }

    /**
     * @notice Given an index, return a given inflation time slot data.
     * @param _index    The index of the time slot to fetch.
     * @return _inflationTimeSlot  Returns InflationTimeSlot found at _index.
     * @dev Will revert if index not found.
     */
    function getTimeSlot(
        InflationTimeSlotsState storage _self,
        uint256 _index
    )
        internal view
        returns (InflationTimeSlot storage _inflationTimeSlot)
    {
        require(_index < getCount(_self), ERR_NO_TIME_SLOT);
        _inflationTimeSlot = _self.inflationTimeSlots[_index];
    }

    /**
     * @notice Return inflation time slot data for the current time slot.
     * @return _inflationTimeSlot  Returns InflationTimeSlot for the current time slot.
     * @dev Will revert if no current time slot.
     */
    function getCurrentTimeSlot(
        InflationTimeSlotsState storage _self
    )
        internal view
        returns (InflationTimeSlot storage _inflationTimeSlot)
    {
        require(getCount(_self) > 0, ERR_NO_TIME_SLOT);
        _inflationTimeSlot = _self.inflationTimeSlots[_self.currentTimeSlot];
    }

    /**
     * @notice Return inflation time slot id of the current time slot.
     * @return _currentTimeSlotId  Returns id for the current time slot.
     * @dev Will revert if no current time slot.
     */
    function getCurrentTimeSlotId(
        InflationTimeSlotsState storage _self
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
        InflationTimeSlot storage _self,
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
        InflationTimeSlot storage _self,
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
     * @notice Helper function to compute recognized inflation.
     * @param _inflatableBalance                The balance used to recognize inflation.
     * @param _timeSlotInflationPercentageBips  The time slot percentage used to recognize inflation.
     * @return The computed recognized inflation.
     */
    function _computeRecognizedInflationWei(
        uint256 _inflatableBalance,
        uint256 _timeSlotInflationPercentageBips
    )
        private pure
        returns(uint256)
    {
        return Math.min(
            _inflatableBalance.mulDiv(_timeSlotInflationPercentageBips, 12 * BIPS100),
            MAX_ANNUAL_INFLATION.div(12)
        ); // monthly inflation
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
