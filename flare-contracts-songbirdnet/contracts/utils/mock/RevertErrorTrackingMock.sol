// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import "../implementation/RevertErrorTracking.sol";


/**
 * @title RevertErrorTracking mock contract that exposes addRevertError method
 **/
contract RevertErrorTrackingMock is RevertErrorTracking {

    /**
     * @notice Adds caught error to reverted errors mapping
     * @param revertedContract         Address of the reverting contract
     * @param message                  Reverte message
     */
    function addRevertErrorMock(address revertedContract, string memory message) external {
        addRevertError(revertedContract, message);
    }
}
