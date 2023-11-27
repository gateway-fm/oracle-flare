// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import "../lib/FtsoEpoch.sol";
import "../../token/interface/IIVPToken.sol";


/**
 * @title Ftso Epoch mock contract
 * @notice A contract to expose the FtsoEpoch library for unit testing.
 **/
contract FtsoEpochMock {
    using FtsoEpoch for FtsoEpoch.State;

    struct Instance {                           // struct holding epoch votes and results
        uint256 votePowerBlock;                 // block used to obtain vote weights in epoch
        uint256 highAssetTurnoutThresholdBIPS;  // threshold for high asset turnout (in BIPS)
        uint256 lowNatTurnoutThresholdBIPS;     // threshold for low nat turnout (in BIPS)
        uint256 circulatingSupplyNat;           // total native token circulating supply at votePowerBlock
        uint256 votePowerNat;                   // total native token vote power at votePowerBlock
        uint256 votePowerAsset;                 // total asset vote power at votePowerBlock
        uint256 maxVotePowerNat;                // max native token vote power required for voting
        uint256 maxVotePowerAsset;              // max asset vote power required for voting
        uint256 accumulatedVotePowerNat;        // total native token vote power accumulated from votes in epoch
        // base weight ratio between asset and native token used to combine weights
        uint256 baseWeightRatio;
        uint256[] trustedVotes;                 // array of all votes from trusted providers in epoch
        uint256 price;                          // consented epoch asset price
        IFtso.PriceFinalizationType finalizationType; // finalization type
        uint256 voteCount;                      // number of votes in epoch
        IIVPToken[] assets;                     // list of assets
        uint256[] assetWeightedPrices;          // prices that determine the contributions of assets to vote power
        bool initializedForReveal;              // whether epoch instance is initialized for reveal
        bool fallbackMode;                      // current epoch in fallback mode
    }

    FtsoEpoch.State private state;

    function setAssetNorm(IIVPToken _asset, uint256 _decimals) public {
        state.assetNorm[_asset] = 10**_decimals;
    }

    function initializeInstanceForReveal(
        uint256 _epochId,
        uint256 _circulatingSupplyNat,
        uint256 _votePowerNat,
        IIVPToken[] memory _assets,
        uint256[] memory _assetVotePowers,
        uint256[] memory _assetPrices
    ) 
        public
    {
        FtsoEpoch.Instance storage epoch = state.instance[_epochId];
        state._initializeInstanceForReveal(
            epoch,
            _circulatingSupplyNat,
            _votePowerNat, 
            _assets,
            _assetVotePowers,
            _assetPrices);
    }

    function addVote(
        uint256 _epochId,
        address _voter,
        uint256 _votePowerNat,
        uint256 _votePowerAsset,
        uint256 _price
    )
        public
    {
        FtsoEpoch.Instance storage epoch = state.instance[_epochId];
        state._addVote(epoch, _voter, _votePowerNat, _votePowerAsset, _price);
    }

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
    ) 
        public
    {
        state.maxVotePowerNatThresholdFraction = _maxVotePowerNatThresholdFraction;
        state.maxVotePowerAssetThresholdFraction = _maxVotePowerAssetThresholdFraction;
        state.lowAssetUSDThreshold = _lowAssetUSDThreshold;
        state.highAssetUSDThreshold = _highAssetUSDThreshold;
        state.highAssetTurnoutThresholdBIPS = _highAssetTurnoutThresholdBIPS;
        state.lowNatTurnoutThresholdBIPS = _lowNatTurnoutThresholdBIPS;
        state.elasticBandRewardBIPS = _elasticBandRewardBIPS;
        state.elasticBandWidthPPM = _elasticBandWidthPPM;
        
        // remove old addresses mapping
        uint256 len = state.trustedAddresses.length;
        for (uint256 i = 0; i < len; i++) {
            state.trustedAddressesMapping[state.trustedAddresses[i]] = false;
        }
        // set new addresses mapping
        len = _trustedAddresses.length;
        for (uint256 i = 0; i < len; i++) {
            state.trustedAddressesMapping[_trustedAddresses[i]] = true;
        }
        state.trustedAddresses = _trustedAddresses;
    }
    
    function setAssets(
        uint256 _epochId, 
        IIVPToken[] memory _assets,
        uint256[] memory _assetVotePowers,
        uint256[] memory _assetPrices
    ) 
        public
    {
        FtsoEpoch.Instance storage epoch = state.instance[_epochId];
        state._setAssets(epoch, _assets, _assetVotePowers, _assetPrices);
    }
    
    function getEpochInstance(uint256 _epochId) public view returns(Instance memory) {
        FtsoEpoch.Instance storage epoch = state.instance[_epochId];
        Instance memory result;

        result.votePowerBlock = epoch.votePowerBlock;
        result.highAssetTurnoutThresholdBIPS = epoch.highAssetTurnoutThresholdBIPS;
        result.lowNatTurnoutThresholdBIPS = epoch.lowNatTurnoutThresholdBIPS;
        result.circulatingSupplyNat = epoch.circulatingSupplyNat;
        result.votePowerNat = epoch.votePowerNat;
        result.votePowerAsset = epoch.votePowerAsset;
        result.maxVotePowerNat = epoch.maxVotePowerNat;
        result.maxVotePowerAsset = epoch.maxVotePowerAsset;
        result.accumulatedVotePowerNat = epoch.accumulatedVotePowerNat;
        result.baseWeightRatio = epoch.baseWeightRatio;
        result.trustedVotes = epoch.trustedVotes;
        result.price = epoch.price;
        result.finalizationType = epoch.finalizationType;
        result.voteCount = epoch.nextVoteIndex;
        result.initializedForReveal = epoch.initializedForReveal;
        result.assets = epoch.assets;
        result.assetWeightedPrices = epoch.assetWeightedPrices;
        result.initializedForReveal = epoch.initializedForReveal;
        result.fallbackMode = epoch.fallbackMode;

        return result;
    }

    function getVoterVoteId(uint256 _epochId) public view returns (uint256) {
        FtsoEpoch.Instance storage epoch = state.instance[_epochId];
        return FtsoEpoch._findVoteOf(epoch, msg.sender);
    }

    function getAssetBaseWeightRatio(uint256 _assetVotePowerUSD) public view returns (uint256) {
        return state._getAssetBaseWeightRatio(_assetVotePowerUSD);
    }

    function getWeightRatio(
        uint256 _epochId, 
        uint256 _weightNatSum, 
        uint256 _weightAssetSum
    ) 
        public view 
        returns (uint256)
    {
        FtsoEpoch.Instance storage epoch = state.instance[_epochId];
        return FtsoEpoch._getWeightRatio(epoch, _weightNatSum, _weightAssetSum);
    }

    function computeWeights(
        uint256 _epochId,
        uint256[] memory _weightsNat,
        uint256[] memory _weightsAsset
    ) 
        public view 
        returns (uint256[] memory)
    {
        FtsoEpoch.Instance storage epoch = state.instance[_epochId];
        return FtsoEpoch._computeWeights(epoch, _weightsNat, _weightsAsset);
    }
}
