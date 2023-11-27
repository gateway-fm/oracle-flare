// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

import "../ftso/interface/IIFtso.sol";
import "../genesis/interface/IFtsoManagerGenesis.sol";

/**
 * Interface for the `FtsoManager` contract.
 */
interface IFtsoManager is IFtsoManagerGenesis {

    /**
     * Emitted when a new FTSO has been added or an existing one has been removed.
     * @param ftso Contract address of the FTSO.
     * @param add True if added, removed otherwise.
     */
    event FtsoAdded(IIFtso ftso, bool add);

    /**
     * Emitted when the fallback mode of the FTSO manager changes its state.
     * Fallback mode is a recovery mode, where only data from a trusted subset of FTSO
     * data providers is used to calculate the final price.
     *
     * The FTSO Manager enters the fallback mode when ALL FTSOs are in fallback mode.
     * @param fallbackMode New state of the FTSO Manager fallback mode.
     */
    event FallbackMode(bool fallbackMode);

    /**
     * Emitted when the fallback mode of an FTSO changes its state.
     * @param ftso Contract address of the FTSO.
     * @param fallbackMode New state of its fallback mode.
     */
    event FtsoFallbackMode(IIFtso ftso, bool fallbackMode);

    /**
     * Emitted when a [reward epoch](https://docs.flare.network/tech/ftso/#procedure-overview)
     * ends and rewards are available.
     * @param votepowerBlock The [vote power block](https://docs.flare.network/tech/ftso/#vote-power)
     * of the epoch.
     * @param startBlock The first block of the epoch.
     */
    event RewardEpochFinalized(uint256 votepowerBlock, uint256 startBlock);

    /**
     * Emitted when a [price epoch](https://docs.flare.network/tech/ftso/#procedure-overview) ends, this is,
     * after the reveal phase, when final prices are calculated.
     * @param chosenFtso Contract address of the FTSO asset that was randomly chosen to be
     * the basis for reward calculation. On this price epoch, rewards will be calculated based
     * on how close each data provider was to the median of all submitted prices FOR THIS FTSO.
     * @param rewardEpochId Reward epoch ID this price epoch belongs to.
     */
    event PriceEpochFinalized(address chosenFtso, uint256 rewardEpochId);

    /**
     * Unexpected failure while initializing a price epoch.
     * This should be a rare occurrence.
     * @param ftso Contract address of the FTSO where the failure happened.
     * @param epochId Epoch ID that failed initialization.
     */
    event InitializingCurrentEpochStateForRevealFailed(IIFtso ftso, uint256 epochId);

    /**
     * Unexpected failure while finalizing a price epoch.
     * This should be a rare occurrence.
     * @param ftso Contract address of the FTSO where the failure happened.
     * @param epochId Epoch ID of the failure.
     * @param failingType How was the epoch finalized.
     */
    event FinalizingPriceEpochFailed(IIFtso ftso, uint256 epochId, IFtso.PriceFinalizationType failingType);

    /**
     * Unexpected failure while distributing rewards.
     * This should be a rare occurrence.
     * @param ftso Contract address of the FTSO where the failure happened.
     * @param epochId Epoch ID of the failure.
     */
    event DistributingRewardsFailed(address ftso, uint256 epochId);

    /**
     * Unexpected failure while accruing unearned rewards.
     * This should be a rare occurrence.
     * @param epochId Epoch ID of the failure.
     */
    event AccruingUnearnedRewardsFailed(uint256 epochId);

    /**
     * Emitted when the requirement to provide good random numbers has changed.
     *
     * As part of [the FTSO protocol](https://docs.flare.network/tech/ftso/#data-submission-process),
     * data providers must submit a random number along with their price reveals.
     * When good random numbers are enforced, all providers that submit a hash must then
     * submit a reveal with a random number or they will be punished.
     * This is a measure against random number manipulation.
     * @param useGoodRandom Whether good random numbers are now enforced or not.
     * @param maxWaitForGoodRandomSeconds Max number of seconds to wait for a good random
     * number to be submitted.
     */
    event UseGoodRandomSet(bool useGoodRandom, uint256 maxWaitForGoodRandomSeconds);

    /**
     * Returns whether the FTSO Manager is active or not.
     * @return bool Active status.
     */
    function active() external view returns (bool);

    /**
     * Returns current reward epoch ID (the one currently running).
     * @return Reward epoch ID. A monotonically increasing integer.
     */
    function getCurrentRewardEpoch() external view returns (uint256);

    /**
     * Returns the [vote power block](https://docs.flare.network/tech/ftso/#vote-power)
     * that was used for a past reward epoch.
     * @param _rewardEpoch The queried reward epoch ID.
     * @return uint256 The block number of that reward epoch's vote power block.
     */
    function getRewardEpochVotePowerBlock(uint256 _rewardEpoch) external view returns (uint256);

    /**
     * Return reward epoch that will expire next, when a new reward epoch is initialized.
     *
     * Reward epochs older than 90 days expire, and any unclaimed rewards in them become
     * inaccessible.
     * @return uint256 Reward epoch ID.
     */
    function getRewardEpochToExpireNext() external view returns (uint256);

    /**
     * Returns timing information for the current price epoch.
     * All intervals are half-closed: end time is not included.
     * All timestamps are in seconds since UNIX epoch.
     *
     * See the [FTSO page](https://docs.flare.network/tech/ftso/#data-submission-process)
     * for information about the different submission phases.
     * @return _priceEpochId Price epoch ID.
     * @return _priceEpochStartTimestamp Beginning of the commit phase.
     * @return _priceEpochEndTimestamp End of the commit phase.
     * @return _priceEpochRevealEndTimestamp End of the reveal phase.
     * @return _currentTimestamp Current time.
     */
    function getCurrentPriceEpochData() external view
        returns (
            uint256 _priceEpochId,
            uint256 _priceEpochStartTimestamp,
            uint256 _priceEpochEndTimestamp,
            uint256 _priceEpochRevealEndTimestamp,
            uint256 _currentTimestamp
        );

    /**
     * Returns the list of currently active FTSOs.
     * @return _ftsos Array of contract addresses for the FTSOs.
     */
    function getFtsos() external view returns (IIFtso[] memory _ftsos);

    /**
     * Returns the current values for price epoch timing configuration.
     *
     * See the [FTSO page](https://docs.flare.network/tech/ftso/#data-submission-process)
     * for information about the different submission phases.
     * @return _firstPriceEpochStartTs Timestamp, in seconds since UNIX epoch, of the
     * first price epoch.
     * @return _priceEpochDurationSeconds Duration in seconds of the commit phase.
     * @return _revealEpochDurationSeconds Duration in seconds of the reveal phase.
     */
    function getPriceEpochConfiguration() external view
        returns (
            uint256 _firstPriceEpochStartTs,
            uint256 _priceEpochDurationSeconds,
            uint256 _revealEpochDurationSeconds
        );

    /**
     * Returns the current values for reward epoch timing configuration.
     *
     * See the [Reward epochs](https://docs.flare.network/tech/ftso/#vote-power) box.
     * @return _firstRewardEpochStartTs Timestamp, in seconds since UNIX epoch, of the
     * first reward epoch.
     * @return _rewardEpochDurationSeconds Duration in seconds of the reward epochs.
     */
    function getRewardEpochConfiguration() external view
        returns (
            uint256 _firstRewardEpochStartTs,
            uint256 _rewardEpochDurationSeconds
        );

    /**
     * Returns whether the FTSO Manager is currently in fallback mode.
     *
     * In this mode only submissions from trusted providers are used.
     * @return _fallbackMode True if fallback mode is enabled for the manager.
     * @return _ftsos Array of all currently active FTSO assets.
     * @return _ftsoInFallbackMode Boolean array indicating which FTSO assets are in
     * fallback mode.
     * If the FTSO Manager is in fallback mode then ALL FTSOs are in fallback mode.
     */
    function getFallbackMode() external view
        returns (
            bool _fallbackMode,
            IIFtso[] memory _ftsos,
            bool[] memory _ftsoInFallbackMode
        );
}
