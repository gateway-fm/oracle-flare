// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;
pragma abicoder v2;

import "../../ftso/interface/IIFtso.sol";
import "../../userInterfaces/IFtsoManager.sol";
import "../../genesis/interface/IFlareDaemonize.sol";
import "../../token/interface/IIVPToken.sol";


/**
 * Internal interface for the `FtsoManager` contract.
 */
interface IIFtsoManager is IFtsoManager, IFlareDaemonize {

    /**
     * Information about a reward epoch.
     */
    struct RewardEpochData {
        uint256 votepowerBlock;
        uint256 startBlock;
        uint256 startTimestamp;
    }

    /// Unexpected failure. This should be a rare occurrence.
    event ClosingExpiredRewardEpochFailed(uint256 rewardEpoch);

    /// Unexpected failure. This should be a rare occurrence.
    event CleanupBlockNumberManagerFailedForBlock(uint256 blockNumber);

    /// Unexpected failure. This should be a rare occurrence.
    event UpdatingActiveValidatorsTriggerFailed(uint256 rewardEpoch);

    /// Unexpected failure. This should be a rare occurrence.
    event FtsoDeactivationFailed(IIFtso ftso);

    /// Unexpected failure. This should be a rare occurrence.
    event ChillingNonrevealingDataProvidersFailed();

    /**
     * Activates FTSO manager (daemonize() will run jobs).
     */
    function activate() external;

    /**
     * Set reward data to values from old ftso manager.
     * Can only be called before activation.
     * @param _nextRewardEpochToExpire See `getRewardEpochToExpireNext`.
     * @param _rewardEpochsLength See `getRewardEpochConfiguration`.
     * @param _currentRewardEpochEnds See `getCurrentRewardEpoch`.
     */
    function setInitialRewardData(
        uint256 _nextRewardEpochToExpire,
        uint256 _rewardEpochsLength,
        uint256 _currentRewardEpochEnds
    ) external;

    /**
     * Sets governance parameters for FTSOs
     * @param _updateTs Time, in seconds since UNIX epoch, when updated settings should be pushed to FTSOs.
     * @param _maxVotePowerNatThresholdFraction High threshold for native token vote power per voter.
     * @param _maxVotePowerAssetThresholdFraction High threshold for asset vote power per voter
     * @param _lowAssetUSDThreshold Threshold for low asset vote power (in scaled USD).
     * @param _highAssetUSDThreshold Threshold for high asset vote power (in scaled USD).
     * @param _highAssetTurnoutThresholdBIPS Threshold for high asset turnout (in BIPS).
     * @param _lowNatTurnoutThresholdBIPS Threshold for low nat turnout (in BIPS).
     * @param _elasticBandRewardBIPS Secondary reward band, where _elasticBandRewardBIPS goes to the
     * secondary band and 10000 - _elasticBandRewardBIPS to the primary (IQR) band.
     * @param _rewardExpiryOffsetSeconds Reward epochs closed earlier than
     * block.timestamp - _rewardExpiryOffsetSeconds expire.
     * @param _trustedAddresses Trusted addresses will be used as a fallback mechanism for setting the price.
     */
    function setGovernanceParameters(
        uint256 _updateTs,
        uint256 _maxVotePowerNatThresholdFraction,
        uint256 _maxVotePowerAssetThresholdFraction,
        uint256 _lowAssetUSDThreshold,
        uint256 _highAssetUSDThreshold,
        uint256 _highAssetTurnoutThresholdBIPS,
        uint256 _lowNatTurnoutThresholdBIPS,
        uint256 _elasticBandRewardBIPS,
        uint256 _rewardExpiryOffsetSeconds,
        address[] memory _trustedAddresses
    ) external;

    /**
     * Adds FTSO to the list of managed FTSOs, to support a new price pair.
     * All FTSOs in a multi-asset FTSO must be managed by the same FTSO manager.
     * @param _ftso FTSO contract address to add.
     */
    function addFtso(IIFtso _ftso) external;

    /**
     * Adds a list of FTSOs to the list of managed FTSOs, to support new price pairs.
     * All FTSOs in a multi-asset FTSO must be managed by the same FTSO manager.
     * @param _ftsos Array of FTSO contract addresses to add.
     */
    function addFtsosBulk(IIFtso[] memory _ftsos) external;

    /**
     * Removes an FTSO from the list of managed FTSOs.
     * Reverts if FTSO is used in a multi-asset FTSO.
     * Deactivates the `_ftso`.
     * @param _ftso FTSO contract address to remove.
     */
    function removeFtso(IIFtso _ftso) external;

    /**
     * Replaces one FTSO with another with the same symbol.
     * All FTSOs in a multi-asset FTSO must be managed by the same FTSO manager.
     * Deactivates the old FTSO.
     * @param _ftsoToAdd FTSO contract address to add.
     * An existing FTSO with the same symbol will be removed.
     * @param copyCurrentPrice When true, initializes the new FTSO with the
     * current price of the previous FTSO.
     * @param copyAssetOrAssetFtsos When true, initializes the new FTSO with the
     * current asset or asset FTSOs of the previous FTSO.
     */
    function replaceFtso(
        IIFtso _ftsoToAdd,
        bool copyCurrentPrice,
        bool copyAssetOrAssetFtsos
    ) external;

    /**
     * Replaces a list of FTSOs with other FTSOs with the same symbol.
     * All FTSOs in a multi-asset FTSO must be managed by the same FTSO manager.
     * Deactivates the old FTSOs.
     * @param _ftsosToAdd Array of FTSO contract addresses to add.
     * Every existing FTSO with the same symbols will be removed.
     * @param copyCurrentPrice When true, initializes the new FTSOs with the
     * current price of the previous FTSOs.
     * @param copyAssetOrAssetFtsos When true, initializes the new FTSOs with the
     * current asset or asset FTSOs of the previous FTSOs.
     */
    function replaceFtsosBulk(
        IIFtso[] memory _ftsosToAdd,
        bool copyCurrentPrice,
        bool copyAssetOrAssetFtsos
    ) external;

    /**
     * Sets the asset tracked by an FTSO.
     * @param _ftso The FTSO contract address.
     * @param _asset The `VPToken` contract address of the asset to track.
     */
    function setFtsoAsset(IIFtso _ftso, IIVPToken _asset) external;

    /**
     * Sets an array of FTSOs to be tracked by a multi-asset FTSO.
     * FTSOs implicitly determine the FTSO assets.
     * @param _ftso The multi-asset FTSO contract address.
     * @param _assetFtsos Array of FTSOs to be tracked.
     */
    function setFtsoAssetFtsos(IIFtso _ftso, IIFtso[] memory _assetFtsos) external;

    /**
     * Sets whether the FTSO Manager is currently in fallback mode.
     * In this mode only submissions from trusted providers are used.
     * @param _fallbackMode True if fallback mode is enabled.
     */
    function setFallbackMode(bool _fallbackMode) external;

    /**
     * Sets whether an FTSO is currently in fallback mode.
     * In this mode only submissions from trusted providers are used.
     * @param _ftso The FTSO contract address.
     * @param _fallbackMode Fallback mode.
     */
    function setFtsoFallbackMode(IIFtso _ftso, bool _fallbackMode) external;

    /**
     * Returns whether an FTSO has been initialized.
     * @return bool Initialization state.
     */
    function notInitializedFtsos(IIFtso) external view returns (bool);

    /**
     * Returns data regarding a specific reward epoch ID.
     * @param _rewardEpochId Epoch ID.
     * @return RewardEpochData Its associated data.
     */
    function getRewardEpochData(uint256 _rewardEpochId) external view returns (RewardEpochData memory);

    /**
     * Returns when the current reward epoch finishes.
     * @return uint256 Time in seconds since the UNIX epoch when the current reward
     * epoch will finish.
     */
    function currentRewardEpochEnds() external view returns (uint256);

    /**
     * Returns information regarding the currently unprocessed price epoch.
     * This epoch is not necessarily the last one, in case the network halts for some
     * time due to validator node problems, for example.
     * @return _lastUnprocessedPriceEpoch ID of the price epoch that is currently waiting
     * finalization.
     * @return _lastUnprocessedPriceEpochRevealEnds When that price epoch can be finalized,
     * in seconds since UNIX epoch.
     * @return _lastUnprocessedPriceEpochInitialized Whether this price epoch has been
     * already initialized and therefore it must be finalized before the corresponding
     * reward epoch can be finalized.
     */
    function getLastUnprocessedPriceEpochData() external view
        returns (
            uint256 _lastUnprocessedPriceEpoch,
            uint256 _lastUnprocessedPriceEpochRevealEnds,
            bool _lastUnprocessedPriceEpochInitialized
        );

    /**
     * Time when the current reward epoch started.
     * @return uint256 Timestamp, in seconds since UNIX epoch.
     */
    function rewardEpochsStartTs() external view returns (uint256);

    /**
     * Currently configured reward epoch duration.
     * @return uint256 Reward epoch duration, in seconds.
     */
    function rewardEpochDurationSeconds() external view returns (uint256);

    /**
     * Returns information about a reward epoch.
     * @param _rewardEpochId The epoch ID to query.
     * @return _votepowerBlock The [vote power block](https://docs.flare.network/tech/ftso/#vote-power)
     * of the epoch.
     * @return _startBlock The first block of the epoch.
     * @return _startTimestamp Timestamp of the epoch start, in seconds since UNIX epoch.
     */
    function rewardEpochs(uint256 _rewardEpochId) external view
        returns (
            uint256 _votepowerBlock,
            uint256 _startBlock,
            uint256 _startTimestamp
        );

    /**
     * Returns the currently configured reward expiration time.
     * @return uint256 Unclaimed rewards accrued in reward epochs more than this
     * amount of seconds in the past expire and become inaccessible.
     */
    function getRewardExpiryOffsetSeconds() external view returns (uint256);

    /**
     * Returns the secondary band's width in PPM (parts-per-million) of the median value,
     * for a given FTSO.
     * @param _ftso The queried FTSO contract address.
     * @return uint256 Secondary band width in PPM. To obtain the actual band width,
     * divide this number by 10^6 and multiply by the price median value.
     */
    function getElasticBandWidthPPMFtso(IIFtso _ftso) external view returns (uint256);
}
