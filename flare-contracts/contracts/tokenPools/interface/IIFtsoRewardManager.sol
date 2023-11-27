// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

import "../../userInterfaces/IFtsoRewardManager.sol";
import "../interface/IITokenPool.sol";
import "../../inflation/interface/IIInflationReceiver.sol";

/**
 * Internal interface for the `FtsoRewardManager`.
 */
interface IIFtsoRewardManager is IFtsoRewardManager, IIInflationReceiver, IITokenPool {

    /**
     * Emitted when the contract's daily authorized inflation has been set.
     * @param authorizedAmountWei Authorized amount of native tokens, in wei.
     */
    event DailyAuthorizedInflationSet(uint256 authorizedAmountWei);

    /**
     * Emitted when the contract has received the daily inflation amount.
     * @param amountReceivedWei Received amount of native tokens, in wei.
     */
    event InflationReceived(uint256 amountReceivedWei);

    /**
     * Emitted when unclaimed rewards are burned.
     * @param amountBurnedWei Burned amount of native tokens, in wei.
     */
    event RewardsBurned(uint256 amountBurnedWei);

    /// Activates reward manager (allows claiming rewards).
    function activate() external;
    /// Enable claiming for current and all future reward epochs.
    function enableClaims() external;
    /// Deactivates reward manager (prevents claiming rewards).
    function deactivate() external;
    /**
     * Collects funds from expired reward epoch and calculates totals.
     *
     * Triggered by ftsoManager on finalization of a reward epoch.
     * Operation is irreversible: when some reward epoch is closed according to current
     * settings, it cannot be reopened even if new parameters would
     * allow it, because `nextRewardEpochToExpire` in ftsoManager never decreases.
     * @param _rewardEpochId ID of the epoch to close.
     */
    function closeExpiredRewardEpoch(uint256 _rewardEpochId) external;

    /**
     * Distributes price epoch rewards to data provider accounts, according to input parameters.
     * Must be called with `totalWeight` > 0 and `addresses.length` > 0.
     *
     * The amount of rewards for a given price epoch ID are calculated in `FtsoRewardManager` from
     * `priceEpochDurationSeconds`, `priceEpochEndTime` and inflation authorization data
     * (see `_getTotalPriceEpochRewardWei` in `FtsoRewardManager`.
     * Then each data provider address is given a portion of this amount according to corresponding weight
     * and total sum of weights.
     *
     * Parameters `epochId` and `ftso` are only needed so they can be passed onto the emitted event.
     * @param addresses Data provider addresses to reward.
     * @param weights Weights corresponding to rewarded addresses.
     * @param totalWeight Sum of all weights.
     * @param epochId Price epoch ID.
     * @param ftso Randomly chosen FTSO contract used to calculate the weights.
     * @param priceEpochDurationSeconds Duration of price epochs (180s).
     * @param currentRewardEpoch ID of the current reward epoch.
     * Rewards for the price epoch are added to this reward epoch.
     * @param priceEpochEndTime Timestamp of the price epoch end time (end of submit period),
     * in seconds since UNIX epoch.
     * @param votePowerBlock Vote power block used in the given reward epoch.
     */
    function distributeRewards(
        address[] memory addresses,
        uint256[] memory weights,
        uint256 totalWeight,
        uint256 epochId,
        address ftso,
        uint256 priceEpochDurationSeconds,
        uint256 currentRewardEpoch,
        uint256 priceEpochEndTime,
        uint256 votePowerBlock
    ) external;

    /**
     * Accrue unearned rewards for a given price epoch.
     * Typically done when the FTSO is in fallback mode or because of insufficient vote power.
     * Simply accrue them so they will not be distributed and will be burned later.
     *
     * The amount of rewards that will be burned is calculated in the same way as in `distributeRewards`.
     * @param epochId Price epoch ID.
     * @param priceEpochDurationSeconds Duration of price epochs (180s).
     * @param priceEpochEndTime Timestamp of the price epoch end time (end of submit period),
     * in seconds since UNIX epoch.
     */
    function accrueUnearnedRewards(
        uint256 epochId,
        uint256 priceEpochDurationSeconds,
        uint256 priceEpochEndTime
    ) external;

    /**
     * Epochs before the token distribution event at Flare launch were not be claimable.
     * Use this method to know the first reward epoch that was claimable.
     * @return uint256 The first reward epoch that can be claimed.
     */
    function firstClaimableRewardEpoch() external view returns (uint256);

    /**
     * Returns information on unclaimed rewards for a given data provider and epoch.
     * @param _rewardEpoch Queried reward epoch ID.
     * @param _dataProvider Address of the queried data provider.
     * @return _amount Amount available to be claimed, in wei.
     * @return _weight Portion of total vote power used in this reward epoch that has not yet claimed
     * its reward, in BIPS. It decreases to 0 when all data providers have claimed their rewards.
     */
    function getUnclaimedReward(
        uint256 _rewardEpoch,
        address _dataProvider
    )
        external view
        returns (
            uint256 _amount,
            uint256 _weight
        );
}
