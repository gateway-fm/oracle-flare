// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

import "../../genesis/interface/IFtsoGenesis.sol";
import "../../userInterfaces/IFtso.sol";
import "../../token/interface/IIVPToken.sol";

/**
 * Internal interface for each of the FTSO contracts that handles an asset.
 * Read the [FTSO documentation page](https://docs.flare.network/tech/ftso/)
 * for general information about the FTSO system.
 */
interface IIFtso is IFtso, IFtsoGenesis {

    /**
     * Computes epoch price based on gathered votes.
     *
     * * If the price reveal window for the epoch has ended, finalize the epoch.
     * * Iterate list of price submissions.
     * * Find weighted median.
     * * Find adjacent 50% of price submissions.
     * * Allocate rewards for price submissions.
     * @param _epochId ID of the epoch to finalize.
     * @param _returnRewardData Parameter that determines if the reward data is returned.
     * @return _eligibleAddresses List of addresses eligible for reward.
     * @return _natWeights List of native token weights corresponding to the eligible addresses.
     * @return _totalNatWeight Sum of weights in `_natWeights`.
     */
    function finalizePriceEpoch(uint256 _epochId, bool _returnRewardData) external
        returns(
            address[] memory _eligibleAddresses,
            uint256[] memory _natWeights,
            uint256 _totalNatWeight
        );

    /**
     * Forces finalization of a price epoch, calculating the median price from trusted addresses only.
     *
     * Used as a fallback method, for example, due to an unexpected error during normal epoch finalization or
     * because the `ftsoManager` enabled the fallback mode.
     * @param _epochId ID of the epoch to finalize.
     */
    function fallbackFinalizePriceEpoch(uint256 _epochId) external;

    /**
     * Forces finalization of a price epoch by copying the price from the previous epoch.
     *
     * Used as a fallback method if `fallbackFinalizePriceEpoch` fails due to an exception.
     * @param _epochId ID of the epoch to finalize.
     */
    function forceFinalizePriceEpoch(uint256 _epochId) external;

    /**
     * Initializes FTSO immutable settings and activates the contract.
     * @param _firstEpochStartTs Timestamp of the first epoch in seconds from UNIX epoch.
     * @param _submitPeriodSeconds Duration of epoch submission window in seconds.
     * @param _revealPeriodSeconds Duration of epoch reveal window in seconds.
     */
    function activateFtso(
        uint256 _firstEpochStartTs,
        uint256 _submitPeriodSeconds,
        uint256 _revealPeriodSeconds
    ) external;

    /**
     * Deactivates the contract.
     */
    function deactivateFtso() external;

    /**
     * Updates initial asset price when the contract is not active yet.
     */
    function updateInitialPrice(uint256 _initialPriceUSD, uint256 _initialPriceTimestamp) external;

    /**
     * Sets configurable settings related to epochs.
     * @param _maxVotePowerNatThresholdFraction High threshold for native token vote power per voter.
     * @param _maxVotePowerAssetThresholdFraction High threshold for asset vote power per voter.
     * @param _lowAssetUSDThreshold Threshold for low asset vote power (in scaled USD).
     * @param _highAssetUSDThreshold Threshold for high asset vote power (in scaled USD).
     * @param _highAssetTurnoutThresholdBIPS Threshold for high asset turnout (in BIPS).
     * @param _lowNatTurnoutThresholdBIPS Threshold for low nat turnout (in BIPS).
     * @param _elasticBandRewardBIPS Percentage of the rewards (in BIPS) that go to the [secondary
     * reward band](https://docs.flare.network/tech/ftso/#rewards). The rest go to the primary reward band.
     * @param _elasticBandWidthPPM Width of the secondary reward band, in parts-per-milion of the median.
     * @param _trustedAddresses Trusted voters that will be used if low voter turnout is detected.
     */
    function configureEpochs(
        uint256 _maxVotePowerNatThresholdFraction,
        uint256 _maxVotePowerAssetThresholdFraction,
        uint256 _lowAssetUSDThreshold,
        uint256 _highAssetUSDThreshold,
        uint256 _highAssetTurnoutThresholdBIPS,
        uint256 _lowNatTurnoutThresholdBIPS,
        uint256 _elasticBandRewardBIPS,
        uint256 _elasticBandWidthPPM,
        address[] memory _trustedAddresses
    ) external;

    /**
     * Sets asset for FTSO to operate as single-asset oracle.
     * @param _asset Address of the `IIVPToken` contract that will be the asset tracked by this FTSO.
     */
    function setAsset(IIVPToken _asset) external;

    /**
     * Sets an array of FTSOs for FTSO to operate as multi-asset oracle.
     * FTSOs implicitly determine the FTSO assets.
     * @param _assetFtsos Array of FTSOs.
     */
    function setAssetFtsos(IIFtso[] memory _assetFtsos) external;

    /**
     * Sets the current vote power block.
     * Current vote power block will update per reward epoch.
     * The FTSO doesn't have notion of reward epochs.
     * @param _blockNumber Vote power block.
     */
    function setVotePowerBlock(uint256 _blockNumber) external;

    /**
     * Initializes current epoch instance for reveal.
     * @param _circulatingSupplyNat Epoch native token circulating supply.
     * @param _fallbackMode Whether the current epoch is in fallback mode.
     */
    function initializeCurrentEpochStateForReveal(uint256 _circulatingSupplyNat, bool _fallbackMode) external;

    /**
     * Returns the FTSO manager's address.
     * @return Address of the FTSO manager contract.
     */
    function ftsoManager() external view returns (address);

    /**
     * Returns the FTSO asset.
     * @return Address of the `IIVPToken` tracked by this FTSO.
     * `null` in case of multi-asset FTSO.
     */
    function getAsset() external view returns (IIVPToken);

    /**
     * Returns the asset FTSOs.
     * @return Array of `IIFtso` contract addresses.
     * `null` in case of single-asset FTSO.
     */
    function getAssetFtsos() external view returns (IIFtso[] memory);

    /**
     * Returns current configuration of epoch state.
     * @return _maxVotePowerNatThresholdFraction High threshold for native token vote power per voter.
     * @return _maxVotePowerAssetThresholdFraction High threshold for asset vote power per voter.
     * @return _lowAssetUSDThreshold Threshold for low asset vote power (in scaled USD).
     * @return _highAssetUSDThreshold Threshold for high asset vote power (in scaled USD).
     * @return _highAssetTurnoutThresholdBIPS Threshold for high asset turnout (in BIPS).
     * @return _lowNatTurnoutThresholdBIPS Threshold for low nat turnout (in BIPS).
     * @return _elasticBandRewardBIPS Percentage of the rewards (in BIPS) that go to the [secondary
     * reward band](https://docs.flare.network/tech/ftso/#rewards). The rest go to the primary reward band.
     * @return _elasticBandWidthPPM Width of the secondary reward band, in parts-per-milion of the median.
     * @return _trustedAddresses Trusted voters that will be used if low voter turnout is detected.
     */
    function epochsConfiguration() external view
        returns (
            uint256 _maxVotePowerNatThresholdFraction,
            uint256 _maxVotePowerAssetThresholdFraction,
            uint256 _lowAssetUSDThreshold,
            uint256 _highAssetUSDThreshold,
            uint256 _highAssetTurnoutThresholdBIPS,
            uint256 _lowNatTurnoutThresholdBIPS,
            uint256 _elasticBandRewardBIPS,
            uint256 _elasticBandWidthPPM,
            address[] memory _trustedAddresses
        );

    /**
     * Returns parameters necessary for replicating vote weighting (used in VoterWhitelister).
     * @return _assets The list of assets that are accounted in vote.
     * @return _assetMultipliers Weight multiplier of each asset in (multiasset) FTSO.
     * @return _totalVotePowerNat Total native token vote power at block.
     * @return _totalVotePowerAsset Total combined asset vote power at block.
     * @return _assetWeightRatio Ratio of combined asset vote power vs. native token vp (in BIPS).
     * @return _votePowerBlock Vote power block for the epoch.
     */
    function getVoteWeightingParameters() external view
        returns (
            IIVPToken[] memory _assets,
            uint256[] memory _assetMultipliers,
            uint256 _totalVotePowerNat,
            uint256 _totalVotePowerAsset,
            uint256 _assetWeightRatio,
            uint256 _votePowerBlock
        );

    /**
     * Address of the WNat contract.
     * @return Address of the WNat contract.
     */
    function wNat() external view returns (IIVPToken);
}
