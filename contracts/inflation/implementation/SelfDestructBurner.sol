// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import "../interface/IIPreInflationCalculation.sol";
import "../../userInterfaces/IFtsoRewardManager.sol";
import "../../userInterfaces/IGenericRewardManager.sol";

/**
 * @notice A contract that burns all self destruct funds by claiming on old inflation receiver contracts
 */

contract SelfDestructBurner is IIPreInflationCalculation {

    IFtsoRewardManager public immutable ftsoRewardManager;
    IGenericRewardManager public immutable validatorRewardManager;

    event ClaimFailed(address rewardManager);

    constructor(IFtsoRewardManager _ftsoRewardManager, IGenericRewardManager _validatorRewardManager) {
        require(_ftsoRewardManager != IFtsoRewardManager(0), "address zero");
        ftsoRewardManager = _ftsoRewardManager;
        validatorRewardManager = _validatorRewardManager;
    }

    function trigger() external override { // anyone can call this method
        address payable addressThis = payable(address(this));
        if (ftsoRewardManager.active()) {
            try ftsoRewardManager.claim(addressThis, addressThis, uint256(-1), true) {
                // do nothing
            } catch {
                emit ClaimFailed(address(ftsoRewardManager));
            }
        }
        if (validatorRewardManager != IGenericRewardManager(0) && validatorRewardManager.active()) {
            try validatorRewardManager.claim(addressThis, addressThis, 0, true) {
                // do nothing
            } catch {
                emit ClaimFailed(address(validatorRewardManager));
            }
        }
    }
}
