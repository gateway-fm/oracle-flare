// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../interface/IIFtso.sol";

/**
 * @title A library used for Ftso Manager settings management
 */
library FtsoManagerSettings {
    struct State {
        uint256 updateTs; // time when updated settings should be pushed to ftsos
        // struct holding settings related to FTSOs
        // configurable settings
        uint256 maxVotePowerNatThresholdFraction; // high threshold for native token vote power per voter
        uint256 maxVotePowerAssetThresholdFraction; // high threshold for asset vote power per voter
        uint256 lowAssetUSDThreshold; // threshold for low asset vote power (in scaled USD)
        uint256 highAssetUSDThreshold; // threshold for high asset vote power (in scaled USD)
        uint256 highAssetTurnoutThresholdBIPS; // threshold for high asset turnout (in BIPS)
        // actual vote power in (W)NATs / total native token circulating supply (in BIPS)
        uint256 lowNatTurnoutThresholdBIPS;
        uint256 rewardExpiryOffsetSeconds; // Reward epoch closed earlier than 
                                           //block.timestamp - rewardExpiryOffsetSeconds expire
        uint256 elasticBandRewardBIPS; // hybrid reward band, where elasticBandRewardBIPS goes to the 
        // elastic band and 10000 - elasticBandRewardBIPS to the IQR          
        address[] trustedAddresses; // trusted addresses will be used as a fallback mechanism for setting the price
        bool changed;
        bool initialized;
        mapping(IIFtso => uint256) elasticBandWidthPPMFtso; // prices within elasticBandWidthPPMFtso 
        // of median price are rewarded
    }

    function _setUpdateTs(State storage _state, uint256 _updateTs) internal {
        require (_updateTs == 0 || _updateTs > block.timestamp, "invalid update ts");
        _state.updateTs = _updateTs;
    }

    function _setState (
        State storage _state,
        uint256 _maxVotePowerNatThresholdFraction,
        uint256 _maxVotePowerAssetThresholdFraction,
        uint256 _lowAssetUSDThreshold,
        uint256 _highAssetUSDThreshold,
        uint256 _highAssetTurnoutThresholdBIPS,
        uint256 _lowNatTurnoutThresholdBIPS,
        uint256 _rewardExpiryOffsetSeconds,
        uint256 _elasticBandRewardBIPS,
        address[] memory _trustedAddresses
    ) 
        internal
    {
        if (_state.maxVotePowerNatThresholdFraction != _maxVotePowerNatThresholdFraction) {
            _state.changed = true;
            _state.maxVotePowerNatThresholdFraction = _maxVotePowerNatThresholdFraction;
        }
        if (_state.maxVotePowerAssetThresholdFraction != _maxVotePowerAssetThresholdFraction) {
            _state.changed = true;
            _state.maxVotePowerAssetThresholdFraction = _maxVotePowerAssetThresholdFraction;
        }
        if (_state.lowAssetUSDThreshold != _lowAssetUSDThreshold) {
            _state.changed = true;
            _state.lowAssetUSDThreshold = _lowAssetUSDThreshold;
        }
        if (_state.highAssetUSDThreshold != _highAssetUSDThreshold) {
            _state.changed = true;
            _state.highAssetUSDThreshold = _highAssetUSDThreshold;
        }
        if (_state.highAssetTurnoutThresholdBIPS != _highAssetTurnoutThresholdBIPS) {
            _state.changed = true;
            _state.highAssetTurnoutThresholdBIPS = _highAssetTurnoutThresholdBIPS;
        }
        if (_state.lowNatTurnoutThresholdBIPS != _lowNatTurnoutThresholdBIPS) {
            _state.changed = true;
            _state.lowNatTurnoutThresholdBIPS = _lowNatTurnoutThresholdBIPS;
        }
        if (_state.rewardExpiryOffsetSeconds != _rewardExpiryOffsetSeconds) {
            _state.changed = true;
            _state.rewardExpiryOffsetSeconds = _rewardExpiryOffsetSeconds;
        }
        if (_state.elasticBandRewardBIPS != _elasticBandRewardBIPS) {
            _state.changed = true;
            _state.elasticBandRewardBIPS = _elasticBandRewardBIPS;
        }
        if (_state.trustedAddresses.length != _trustedAddresses.length) {
            _state.trustedAddresses = _trustedAddresses;
            _state.changed = true;
        } else {
            for (uint i = 0; i < _trustedAddresses.length; i++) {
                if (_state.trustedAddresses[i] != _trustedAddresses[i]) {
                    _state.changed = true;
                    _state.trustedAddresses[i] = _trustedAddresses[i];
                }
            }
        }
        _state.initialized = true;
    }
}
