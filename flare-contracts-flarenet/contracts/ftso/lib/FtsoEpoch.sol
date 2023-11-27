// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../../token/interface/IIVPToken.sol";
import "../../userInterfaces/IFtso.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "../../utils/implementation/SafePct.sol";
import "@openzeppelin/contracts/utils/SafeCast.sol";
import "./FtsoVote.sol";


/**
 * @title A library used for FTSO epoch management
 */
library FtsoEpoch {
    using SafeMath for uint256;
    using SafePct for uint256;
    using SafeCast for uint256;

    struct State {                              // struct holding storage and settings related to epochs
        // storage        
        mapping(uint256 => Instance) instance;  // mapping from epoch id to instance
        mapping(IIVPToken => uint256) assetNorm;  // mapping from asset address to its normalization
        
        // configurable settings
        uint240 votePowerBlock;                 // current block at which the vote power is checked
        uint256 maxVotePowerNatThresholdFraction;       // high threshold for native token vote power per voter
        uint256 maxVotePowerAssetThresholdFraction;     // high threshold for asset vote power per voter
        uint256 lowAssetUSDThreshold;           // threshold for low asset vote power (in scaled USD)
        uint256 highAssetUSDThreshold;          // threshold for high asset vote power (in scaled USD)
        uint256 highAssetTurnoutThresholdBIPS;  // threshold for high asset turnout (in BIPS)
        uint256 lowNatTurnoutThresholdBIPS;     // threshold for low nat turnout (in BIPS)
        address[] trustedAddresses;             // trusted addresses - use their prices if low turnout is not achieved
        mapping(address => bool) trustedAddressesMapping; // for checking addresses in fallback mode
        uint256 elasticBandRewardBIPS;          // hybrid reward band, where elasticBandRewardBIPS goes to the IQR
                    // and 10000 - elasticBandRewardBIPS goes to all prices within elasticBandWidthPPM of the median
        uint256 elasticBandWidthPPM;            // prices within elasticBandWidthPPM of median are rewarded
    }

    struct Instance {                           // struct holding epoch votes and results
        uint128 maxVotePowerNat;                // max native token vote power required for voting
        uint128 maxVotePowerAsset;              // max asset vote power required for voting
        uint240 votePowerBlock;                 // block used to obtain vote weights in epoch
        bool initializedForReveal;              // whether epoch instance is initialized for reveal
        bool fallbackMode;                      // current epoch in fallback mode
        uint256 epochId;                        // current epoch id
        uint256 highAssetTurnoutThresholdBIPS;  // threshold for high asset turnout (in BIPS)
        uint256 lowNatTurnoutThresholdBIPS;     // threshold for low nat turnout (in BIPS)
        uint256 circulatingSupplyNat;           // total native token circulating supply at votePowerBlock
        uint256 votePowerNat;                   // total native token vote power at votePowerBlock
        uint256 votePowerAsset;                 // total asset vote power at votePowerBlock
        uint256 accumulatedVotePowerNat;        // total native token vote power accumulated from votes in epoch
        // base weight ratio between asset and native token used to combine weights
        uint256 baseWeightRatio;
        IIVPToken[] assets;                     // list of assets
        uint256[] assetWeightedPrices;          // prices that determine the contributions of assets to vote power
        uint256 nextVoteIndex;
        mapping(uint256 => FtsoVote.Instance) votes; // array of all votes in epoch
        uint256[] trustedVotes;                 // array of all votes from trusted providers in epoch
        uint256 price;                          // consented epoch asset price
        IFtso.PriceFinalizationType finalizationType; // finalization type
        uint256 elasticBandRewardBIPS;          // hybrid reward band, where elasticBandRewardBIPS goes
        // to all prices within elasticBandWidthPPM of the median
        // and 10000 - elasticBandRewardBIPS to the IQR
        uint256 elasticBandWidthPPM;            // prices within elasticBandWidthPPM of median are rewarded
    }

    uint256 internal constant BIPS100 = 1e4;                    // 100% in basis points
    uint256 internal constant BIPS50 = BIPS100 / 2;             // 50% in basis points
    uint256 internal constant BIPS45 = (45 * BIPS100) / 100;    // 45% in basis points
    uint256 internal constant BIPS5 = (5 * BIPS100) / 100;      // 5% in basis points
    uint256 internal constant TERA = 10**12;                    // 10^12

    /**
     * @notice Initializes a new epoch instance for reveal with instance specific settings
     * @param _state                    Epoch state
     * @param _instance                 Epoch instance
     * @param _circulatingSupplyNat     Epoch native token circulating supply
     * @param _votePowerNat             Epoch native token vote power
     * @param _assets                   List of assets
     * @param _assetVotePowers          List of asset vote powers
     * @param _assetPrices              List of asset prices
     * @dev _votePowerNat is assumed to be smaller than 2**128 to avoid overflows in computations
     * @dev computed votePowerAsset is assumed to be smaller than 2**128 to avoid overflows in computations
     */
    function _initializeInstanceForReveal(
        State storage _state,
        Instance storage _instance,
        uint256 _circulatingSupplyNat,
        uint256 _votePowerNat,
        IIVPToken[] memory _assets,
        uint256[] memory _assetVotePowers,
        uint256[] memory _assetPrices
    ) 
        internal
    {
        // all divisions guaranteed not to divide with 0 - checked in ftso manager setGovernanceParameters(...)
        _setAssets(_state, _instance, _assets, _assetVotePowers, _assetPrices);

        _instance.highAssetTurnoutThresholdBIPS = _state.highAssetTurnoutThresholdBIPS;
        _instance.lowNatTurnoutThresholdBIPS = _state.lowNatTurnoutThresholdBIPS;
        _instance.circulatingSupplyNat = _circulatingSupplyNat;
        _instance.votePowerNat = _votePowerNat;
        _instance.maxVotePowerNat = (_votePowerNat / _state.maxVotePowerNatThresholdFraction).toUint128();
        _instance.maxVotePowerAsset = 
            (_instance.votePowerAsset / _state.maxVotePowerAssetThresholdFraction).toUint128();
        _instance.initializedForReveal = true;
        _instance.elasticBandRewardBIPS = _state.elasticBandRewardBIPS;
        _instance.elasticBandWidthPPM = _state.elasticBandWidthPPM;
    }

    /**
     * @notice Adds a vote to the vote array of an epoch instance
     * @param _state                Epoch state
     * @param _instance             Epoch instance
     * @param _voter                Voter address
     * @param _votePowerNat         Vote power for native token
     * @param _votePowerAsset       Vote power for asset
     * @param _price                Price in USD submitted in a vote
     */
    function _addVote(
        State storage _state,
        Instance storage _instance,
        address _voter,
        uint256 _votePowerNat,
        uint256 _votePowerAsset,
        uint256 _price
    )
        internal
    {
        uint256 index = _instance.nextVoteIndex;
        FtsoVote.Instance memory vote = FtsoVote._createInstance(
            _voter,
            _votePowerNat, 
            _votePowerAsset, 
            _instance.votePowerNat, 
            _instance.votePowerAsset,
            _price);

        // cast legal current max voters are ~100 extreme max can be 2000
        vote.index = uint32(index);
        _instance.votes[index] = vote;
        _instance.nextVoteIndex = index + 1;
        _instance.accumulatedVotePowerNat = _instance.accumulatedVotePowerNat.add(_votePowerNat);
        if (_state.trustedAddressesMapping[_voter]) {
            _instance.trustedVotes.push(_price);
        }
    }
    
    /**
     * @notice Sets epoch instance data related to assets
     * @param _state                Epoch state
     * @param _instance             Epoch instance
     * @param _assets               List of assets
     * @param _assetVotePowers      List of asset vote powers
     * @param _assetPrices          List of asset prices
     */
    function _setAssets(
        State storage _state,
        Instance storage _instance,
        IIVPToken[] memory _assets,
        uint256[] memory _assetVotePowers,
        uint256[] memory _assetPrices
    )
        internal
    {
        _instance.assets = _assets;

        _instance.assetWeightedPrices = _getAssetWeightedPrices(_state, _assets, _assetVotePowers, _assetPrices);

        // compute vote power
        uint256 votePower = _getAssetVotePower(_state, _instance, _assetVotePowers);
        _instance.votePowerAsset = votePower;

        // compute base weight ratio between asset and native token
        _instance.baseWeightRatio = _getAssetBaseWeightRatio(_state, votePower);
    }
    
    function _getAssetWeightedPrices(
        State storage _state,
        IIVPToken[] memory _assets,
        uint256[] memory _assetVotePowers,
        uint256[] memory _assetPrices
    )
        internal view
        returns (uint256[] memory)
    {
        uint256 count = _assets.length;
        uint256[] memory values = new uint256[](count); // array of values which eventually contains weighted prices

        // compute sum of vote powers in USD
        uint256 votePowerSumUSD = 0;
        for (uint256 i = 0; i < count; i++) {
            if (address(_assets[i]) == address(0)) {
                continue;
            }
            uint256 votePowerUSD = _assetVotePowers[i].mulDiv(_assetPrices[i], _state.assetNorm[_assets[i]]);
            values[i] = votePowerUSD;
            votePowerSumUSD = votePowerSumUSD.add(votePowerUSD);
        }

        // determine asset weighted prices
        if (votePowerSumUSD > 0) {
            // determine shares based on asset vote powers in USD
            for (uint256 i = 0; i < count; i++) {
                // overriding/reusing array slots
                values[i] = values[i].mulDiv(_assetPrices[i].mul(BIPS100), votePowerSumUSD);
            }
        }
        
        return values;
    }

    /**
     * @notice Returns combined asset vote power
     * @param _state                Epoch state
     * @param _instance             Epoch instance
     * @param _votePowers           Array of asset vote powers
     * @dev Asset vote power is specified in USD and weighted among assets
     */
    function _getAssetVotePower(
        FtsoEpoch.State storage _state,
        FtsoEpoch.Instance storage _instance,
        uint256[] memory _votePowers
    )
        internal view
        returns (uint256)
    {
        uint256 votePower = 0;
        for (uint256 i = 0; i < _instance.assets.length; i++) {
            if (address(_instance.assets[i]) == address(0)) {
                continue;
            }
            votePower = votePower.add(
                _instance.assetWeightedPrices[i].mulDiv(
                    _votePowers[i],
                    _state.assetNorm[_instance.assets[i]]
                ) / BIPS100
            );
        }
        return votePower;
    }

    /**
     * @notice Returns combined asset vote power, same as _getAssetVotePower(...), but doesn't need _instance
     * @param _state                Epoch state
     * @param _assets               The list of assets, some may be address(0)
     * @param _votePowers           Array of asset vote powers
     * @param _assetWeightedPrices  Asset weighted prices as calculated by _getAssetWeightedPrices
     * @dev Asset vote power is specified in USD and weighted among assets
     */
    function _calculateAssetVotePower(
        FtsoEpoch.State storage _state,
        IIVPToken[] memory _assets,
        uint256[] memory _votePowers,
        uint256[] memory _assetWeightedPrices
    )
        internal view
        returns (uint256)
    {
        uint256 votePower = 0;
        for (uint256 i = 0; i < _assets.length; i++) {
            if (address(_assets[i]) != address(0)) {
                uint256 vp = _assetWeightedPrices[i].mulDiv(_votePowers[i], _state.assetNorm[_assets[i]]) / BIPS100;
                votePower = votePower.add(vp);
            }
        }
        return votePower;
    }

    /**
     * Get multipliers for converting asset vote powers to asset vote power weights as in
     * FTSO price calculation. Weights are multiplied by (TERA / BIPS100 * 1e18).
     * Used in VoterWhitelister to emulate ftso weight calculation.
     */
    function _getAssetVoteMultipliers(
        FtsoEpoch.State storage _state,
        IIVPToken[] memory _assets,
        uint256[] memory _assetWeightedPrices
    )
        internal view 
        returns (uint256[] memory _assetMultipliers)
    {
        uint256 numAssets = _assets.length;
        _assetMultipliers = new uint256[](numAssets);
        for (uint256 i = 0; i < numAssets; i++) {
            if (address(_assets[i]) != address(0)) {
                uint256 divisor = _state.assetNorm[_assets[i]];
                // Since we divide by `_state.assetNorm[_instance.assets[i]]` we multiply by 1e18 to prevent underflow
                // (we assume that assetNorm is never much bigger than that)
                // The value is only used in VoterWhitelister._getAssetVotePowerWeights, where we divide by 1e18
                _assetMultipliers[i] = _assetWeightedPrices[i].mulDiv(TERA / BIPS100 * 1e18, divisor);
            } else {
                _assetMultipliers[i] = 0;
            }
        }
    }

    /**
     * @notice Computes the base asset weight ratio
     * @param _state                Epoch state
     * @param _assetVotePowerUSD    Price of the asset in USD
     * @return Base weight ratio for asset in BIPS (a number between 0 and BIPS)
     */
    function _getAssetBaseWeightRatio(
        State storage _state,
        uint256 _assetVotePowerUSD
    )
        internal view
        returns (uint256)
    {
        // highAssetUSDThreshold >= lowAssetUSDThreshold - checked in ftso manager
        uint256 ratio;
        if (_assetVotePowerUSD < _state.lowAssetUSDThreshold) {
            // 0 %
            ratio = 0;
        } else if (_assetVotePowerUSD >= _state.highAssetUSDThreshold) {
            // 50 %
            ratio = BIPS50;
        } else {
            // between 5% and 50% (linear function)
            ratio = (BIPS45 * (_assetVotePowerUSD - _state.lowAssetUSDThreshold)) /
                (_state.highAssetUSDThreshold - _state.lowAssetUSDThreshold) + BIPS5;
        }
        return ratio;
    }

    /**
     * @notice Computes the weight ratio between native token and asset weight that specifies a unified vote weight
     * @param _instance             Epoch instance
     * @return Weight ratio for asset in BIPS (a number between 0 and BIPS)
     * @dev Weight ratio for native token is supposed to be (BIPS - weight ratio for asset)
     */
    function _getWeightRatio(
        Instance storage _instance,
        uint256 _weightNatSum,
        uint256 _weightAssetSum
    )
        internal view
        returns (uint256)
    {
        if (_weightAssetSum == 0) {
            return 0;
        } else if (_weightNatSum == 0) {
            return BIPS100;
        }
        
        uint256 turnout = _weightAssetSum.mulDiv(BIPS100, TERA);
        if (turnout >= _instance.highAssetTurnoutThresholdBIPS) {
            return _instance.baseWeightRatio;
        } else {
            return _instance.baseWeightRatio.mulDiv(turnout, _instance.highAssetTurnoutThresholdBIPS);
        }
    }

    /**
     * @notice Computes vote weights in epoch
     * @param _instance             Epoch instance
     * @param _weightsNat           Array of native token weights
     * @param _weightsAsset         Array of asset weights
     * @return _weights             Array of combined weights
     * @dev All weight parameters and variables are in BIPS
     */
    function _computeWeights(
        FtsoEpoch.Instance storage _instance,
        uint256[] memory _weightsNat,
        uint256[] memory _weightsAsset
    )
        internal view
        returns (uint256[] memory _weights)
    {
        uint256 length = _instance.nextVoteIndex;
        _weights = new uint256[](length);

        uint256 weightNatSum = _arraySum(_weightsNat);
        uint256 weightAssetSum = _arraySum(_weightsAsset);

        // set weight distribution according to weight sums and weight ratio
        uint256 weightNatShare = 0;
        uint256 weightAssetShare = _getWeightRatio(_instance, weightNatSum, weightAssetSum);
        if (weightNatSum > 0) {
            weightNatShare = BIPS100 - weightAssetShare;
        }

        for (uint256 i = 0; i < length; i++) {
            uint256 weightNat = 0;
            if (weightNatShare > 0) {
                weightNat = weightNatShare.mulDiv(TERA * _weightsNat[i], weightNatSum * BIPS100);
            }
            uint256 weightAsset = 0;
            if (weightAssetShare > 0) {
                weightAsset = weightAssetShare.mulDiv(TERA * _weightsAsset[i], weightAssetSum * BIPS100);
            }
            _weights[i] = weightNat + weightAsset;
        }
    }
    
    /**
     * @notice Computes price deviation from the previous epoch in BIPS
     * @param _state                Epoch state
     * @param _epochId              Epoch id
     * @param _epochPrice           Epoch price
     */
    function _getPriceDeviation(
        State storage _state,
        uint256 _epochId,
        uint256 _epochPrice,
        uint256 _priceEpochCyclicBufferSize
    )
        internal view
        returns (uint256)
    {
        if (_epochId == 0) {
            return 0;
        }
        uint256 previousEpochPrice = 
            _state.instance[(_epochId - 1) % _priceEpochCyclicBufferSize].price;
        if (_epochPrice == previousEpochPrice) {
            return 0;
        }
        if (_epochPrice == 0) {
            return TERA; // "infinity"
        }        
        uint256 priceEpochDiff;
        if (previousEpochPrice > _epochPrice) {
            priceEpochDiff = previousEpochPrice - _epochPrice;
        } else {
            priceEpochDiff = _epochPrice - previousEpochPrice;
        }
        return priceEpochDiff.mulDiv(BIPS100, _epochPrice);
    }

    function _findVoteOf(Instance storage _epoch, address _voter) internal view returns (uint256) {
        uint256 length = _epoch.nextVoteIndex;
        for (uint256 i = 0; i < length; i++) {
            if (_epoch.votes[i].voter == _voter) {
                return i + 1;
            }
        }
        return 0;
    }

    /**
     * Calculate sum of all values in an array.
     */
    function _arraySum(uint256[] memory array) private pure returns (uint256) {
        uint256 result = 0;
        for (uint256 i = 0; i < array.length; i++) {
            result = result.add(array[i]);
        }
        return result;
    }
}
