// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

/**
 * Interface for each of the FTSO contracts that handles an asset.
 * Read the [FTSO documentation page](https://docs.flare.network/tech/ftso/)
 * for general information about the FTSO system.
 */
interface IFtso {
    /**
     * How did a price epoch finalize.
     *
     * * `NOT_FINALIZED`: The epoch has not been finalized yet. This is the initial state.
     * * `WEIGHTED_MEDIAN`: The median was used to calculate the final price.
     *     This is the most common state in normal operation.
     * * `TRUSTED_ADDRESSES`: Due to low turnout, the final price was calculated using only
     *     the median of trusted addresses.
     * * `PREVIOUS_PRICE_COPIED`: Due to low turnout and absence of votes from trusted addresses,
     *     the final price was copied from the previous epoch.
     * * `TRUSTED_ADDRESSES_EXCEPTION`: Due to an exception, the final price was calculated
     *     using only the median of trusted addresses.
     * * `PREVIOUS_PRICE_COPIED_EXCEPTION`: Due to an exception, the final price was copied
     *     from the previous epoch.
     */
    enum PriceFinalizationType {
        NOT_FINALIZED,
        WEIGHTED_MEDIAN,
        TRUSTED_ADDRESSES,
        PREVIOUS_PRICE_COPIED,
        TRUSTED_ADDRESSES_EXCEPTION,
        PREVIOUS_PRICE_COPIED_EXCEPTION
    }

    /**
     * A voter has revealed its price.
     * @param voter The voter.
     * @param epochId The ID of the epoch for which the price has been revealed.
     * @param price The revealed price.
     * @param timestamp Timestamp of the block where the reveal happened.
     * @param votePowerNat Vote power of the voter in this epoch. This includes the
     * vote power derived from its WNat holdings and the delegations.
     * @param votePowerAsset _Unused_.
     */
    event PriceRevealed(
        address indexed voter, uint256 indexed epochId, uint256 price, uint256 timestamp,
        uint256 votePowerNat, uint256 votePowerAsset
    );

    /**
     * An epoch has ended and the asset price is available.
     * @param epochId The ID of the epoch that has just ended.
     * @param price The asset's price for that epoch.
     * @param rewardedFtso Whether the next 4 parameters contain data.
     * @param lowIQRRewardPrice Lowest price in the primary (inter-quartile) reward band.
     * @param highIQRRewardPrice Highest price in the primary (inter-quartile) reward band.
     * @param lowElasticBandRewardPrice Lowest price in the secondary (elastic) reward band.
     * @param highElasticBandRewardPrice Highest price in the secondary (elastic) reward band.
     * @param finalizationType Reason for the finalization of the epoch.
     * @param timestamp Timestamp of the block where the price has been finalized.
     */
    event PriceFinalized(
        uint256 indexed epochId, uint256 price, bool rewardedFtso,
        uint256 lowIQRRewardPrice, uint256 highIQRRewardPrice,
        uint256 lowElasticBandRewardPrice, uint256 highElasticBandRewardPrice,
        PriceFinalizationType finalizationType, uint256 timestamp
    );

    /**
     * All necessary parameters have been set for an epoch and prices can start being _revealed_.
     * Note that prices can already be _submitted_ immediately after the previous price epoch submit end time is over.
     *
     * This event is not emitted in fallback mode (see `getPriceEpochData`).
     * @param epochId The ID of the epoch that has just started.
     * @param endTime Deadline to submit prices, in seconds since UNIX epoch.
     * @param timestamp Current on-chain timestamp.
     */
    event PriceEpochInitializedOnFtso(
        uint256 indexed epochId, uint256 endTime, uint256 timestamp
    );

    /**
     * Not enough votes were received for this asset during a price epoch that has just ended.
     * @param epochId The ID of the epoch.
     * @param natTurnout Total received vote power, as a percentage of the circulating supply in BIPS.
     * @param lowNatTurnoutThresholdBIPS Minimum required vote power, as a percentage
     * of the circulating supply in BIPS.
     * The fact that this number is higher than `natTurnout` is what triggered this event.
     * @param timestamp Timestamp of the block where the price epoch ended.
     */
    event LowTurnout(
        uint256 indexed epochId,
        uint256 natTurnout,
        uint256 lowNatTurnoutThresholdBIPS,
        uint256 timestamp
    );

    /**
     * Returns whether FTSO is active or not.
     */
    function active() external view returns (bool);

    /**
     * Returns the FTSO symbol.
     */
    function symbol() external view returns (string memory);

    /**
     * Returns the current epoch ID.
     * @return Currently running epoch ID. IDs are consecutive numbers starting from zero.
     */
    function getCurrentEpochId() external view returns (uint256);

    /**
     * Returns the ID of the epoch that was opened for price submission at the specified timestamp.
     * @param _timestamp Queried timestamp in seconds from UNIX epoch.
     * @return Epoch ID corresponding to that timestamp. IDs are consecutive numbers starting from zero.
     */
    function getEpochId(uint256 _timestamp) external view returns (uint256);

    /**
     * Returns the random number used in a specific past epoch, obtained from the random numbers
     * provided by all data providers along with their data submissions.
     * @param _epochId ID of the queried epoch.
     * Current epoch cannot be queried, and the previous epoch is constantly updated
     * as data providers reveal their prices and random numbers.
     * Only the last 50 epochs can be queried and there is no bounds checking
     * for this parameter. Out-of-bounds queries return undefined values.

     * @return The random number used in that epoch.
     */
    function getRandom(uint256 _epochId) external view returns (uint256);

    /**
     * Returns agreed asset price in the specified epoch.
     * @param _epochId ID of the epoch.
     * Only the last 200 epochs can be queried. Out-of-bounds queries revert.
     * @return Price in USD multiplied by 10^`ASSET_PRICE_USD_DECIMALS`.
     */
    function getEpochPrice(uint256 _epochId) external view returns (uint256);

    /**
     * Returns current epoch data.
     * Intervals are open on the right: End times are not included.
     * @return _epochId Current epoch ID.
     * @return _epochSubmitEndTime End time of the price submission window in seconds from UNIX epoch.
     * @return _epochRevealEndTime End time of the price reveal window in seconds from UNIX epoch.
     * @return _votePowerBlock Vote power block for the current epoch.
     * @return _fallbackMode Whether the current epoch is in fallback mode.
     * Only votes from trusted addresses are used in this mode.
     */
    function getPriceEpochData() external view returns (
        uint256 _epochId,
        uint256 _epochSubmitEndTime,
        uint256 _epochRevealEndTime,
        uint256 _votePowerBlock,
        bool _fallbackMode
    );

    /**
     * Returns current epoch's configuration.
     * @return _firstEpochStartTs First epoch start timestamp in seconds from UNIX epoch.
     * @return _submitPeriodSeconds Submit period in seconds.
     * @return _revealPeriodSeconds Reveal period in seconds.
     */
    function getPriceEpochConfiguration() external view returns (
        uint256 _firstEpochStartTs,
        uint256 _submitPeriodSeconds,
        uint256 _revealPeriodSeconds
    );

    /**
     * Returns asset price submitted by a voter in the specified epoch.
     * @param _epochId ID of the epoch being queried.
     * Only the last 200 epochs can be queried. Out-of-bounds queries revert.
     * @param _voter Address of the voter being queried.
     * @return Price in USD multiplied by 10^`ASSET_PRICE_USD_DECIMALS`.
     */
    function getEpochPriceForVoter(uint256 _epochId, address _voter) external view returns (uint256);

    /**
     * Returns the current asset price.
     * @return _price Price in USD multiplied by 10^`ASSET_PRICE_USD_DECIMALS`.
     * @return _timestamp Time when price was updated for the last time,
     * in seconds from UNIX epoch.
     */
    function getCurrentPrice() external view returns (uint256 _price, uint256 _timestamp);

    /**
     * Returns current asset price and number of decimals.
     * @return _price Price in USD multiplied by 10^`_assetPriceUsdDecimals`.
     * @return _timestamp Time when price was updated for the last time,
     * in seconds from UNIX epoch.
     * @return _assetPriceUsdDecimals Number of decimals used to return the USD price.
     */
    function getCurrentPriceWithDecimals() external view returns (
        uint256 _price,
        uint256 _timestamp,
        uint256 _assetPriceUsdDecimals
    );

    /**
     * Returns current asset price calculated only using input from trusted providers.
     * @return _price Price in USD multiplied by 10^`ASSET_PRICE_USD_DECIMALS`.
     * @return _timestamp Time when price was updated for the last time,
     * in seconds from UNIX epoch.
     */
    function getCurrentPriceFromTrustedProviders() external view returns (uint256 _price, uint256 _timestamp);

    /**
     * Returns current asset price calculated only using input from trusted providers and number of decimals.
     * @return _price Price in USD multiplied by 10^`ASSET_PRICE_USD_DECIMALS`.
     * @return _timestamp Time when price was updated for the last time,
     * in seconds from UNIX epoch.
     * @return _assetPriceUsdDecimals Number of decimals used to return the USD price.
     */
    function getCurrentPriceWithDecimalsFromTrustedProviders() external view returns (
        uint256 _price,
        uint256 _timestamp,
        uint256 _assetPriceUsdDecimals
    );

    /**
     * Returns asset's current price details.
     * All timestamps are in seconds from UNIX epoch.
     * @return _price Price in USD multiplied by 10^`ASSET_PRICE_USD_DECIMALS`.
     * @return _priceTimestamp Time when price was updated for the last time.
     * @return _priceFinalizationType Finalization type when price was updated for the last time.
     * @return _lastPriceEpochFinalizationTimestamp Time when last price epoch was finalized.
     * @return _lastPriceEpochFinalizationType Finalization type of last finalized price epoch.
     */
    function getCurrentPriceDetails() external view returns (
        uint256 _price,
        uint256 _priceTimestamp,
        PriceFinalizationType _priceFinalizationType,
        uint256 _lastPriceEpochFinalizationTimestamp,
        PriceFinalizationType _lastPriceEpochFinalizationType
    );

    /**
     * Returns the random number for the previous price epoch, obtained from the random numbers
     * provided by all data providers along with their data submissions.
     */
    function getCurrentRandom() external view returns (uint256);
}
