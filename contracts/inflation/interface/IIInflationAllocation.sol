// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;
pragma abicoder v2;

import "./IIInflationPercentageProvider.sol";
import "./IIInflationSharingPercentageProvider.sol";

interface IIInflationAllocation is IIInflationPercentageProvider, IIInflationSharingPercentageProvider {
    
}
