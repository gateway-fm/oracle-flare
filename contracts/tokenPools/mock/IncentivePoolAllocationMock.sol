// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import "../interface/IIIncentivePoolAllocation.sol";


contract IncentivePoolAllocationMock is IIIncentivePoolAllocation {
    uint256 public annualPercentageBips;
    SharingPercentage[] public sharingPercentages;

    constructor(SharingPercentage[] memory _sharingPercentages, uint256 _annualPercentageBips) {
        annualPercentageBips = _annualPercentageBips;
        // Add to storage
        for (uint256 i; i < _sharingPercentages.length; i++) {
            sharingPercentages.push(_sharingPercentages[i]);            
        }
    }

    function getSharingPercentages() external view override returns(SharingPercentage[] memory) {
        return sharingPercentages;
    }

    function getAnnualPercentageBips() external view override returns(uint256) {
        return annualPercentageBips;
    }
}
