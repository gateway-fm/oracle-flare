// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import "../interface/IIInflationAllocation.sol";


contract PercentageProviderMock is IIInflationAllocation {
    uint256 public timeSlotPercentageBips;
    SharingPercentage[] public sharingPercentages;

    constructor(SharingPercentage[] memory _sharingPercentages, uint256 _timeSlotPercentageBips) {
        timeSlotPercentageBips = _timeSlotPercentageBips;
        // Add to storage
        for (uint256 i = 0; i < _sharingPercentages.length; i++) {
            sharingPercentages.push(_sharingPercentages[i]);
        }
    }

    function getSharingPercentages() external view override returns(SharingPercentage[] memory) {
        return sharingPercentages;
    }

    function getTimeSlotPercentageBips() external view override returns(uint256) {
        return timeSlotPercentageBips;
    }
}
