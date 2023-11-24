// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;


library DataProviderFee {
    struct FeePercentage {          // used for storing data provider fee percentage settings
        uint16 value;               // fee percentage value (value between 0 and 1e4)
        uint240 validFromEpoch;     // id of the reward epoch from which the value is valid
    }

    struct State {
        uint256 feePercentageUpdateOffset; // fee percentage update timelock measured in reward epochs
        uint256 defaultFeePercentage; // default value for fee percentage
        
        mapping(address => FeePercentage[]) dataProviderFeePercentages;
    }

    uint256 constant internal MAX_BIPS = 1e4;
    
    string internal constant ERR_FEE_PERCENTAGE_INVALID = "invalid fee percentage value";
    string internal constant ERR_FEE_PERCENTAGE_UPDATE_FAILED = "fee percentage can not be updated";
    
    /**
     * @notice Allows data provider to set (or update last) fee percentage.
     * @param _feePercentageBIPS    number representing fee percentage in BIPS
     * @return Returns the reward epoch number when the setting becomes effective.
     */
    function setDataProviderFeePercentage(
        State storage _state,
        uint256 _feePercentageBIPS,
        uint256 _currentRewardEpoch
    ) 
        external
        returns (uint256)
    {
        require(_feePercentageBIPS <= MAX_BIPS, ERR_FEE_PERCENTAGE_INVALID);

        uint256 rewardEpoch = _currentRewardEpoch + _state.feePercentageUpdateOffset;
        FeePercentage[] storage fps = _state.dataProviderFeePercentages[msg.sender];

        // determine whether to update the last setting or add a new one
        uint256 position = fps.length;
        if (position > 0) {
            // do not allow updating the settings in the past
            // (this can only happen if the sharing percentage epoch offset is updated)
            require(rewardEpoch >= fps[position - 1].validFromEpoch, ERR_FEE_PERCENTAGE_UPDATE_FAILED);
            
            if (rewardEpoch == fps[position - 1].validFromEpoch) {
                // update
                position = position - 1;
            }
        }
        if (position == fps.length) {
            // add
            fps.push();
        }

        // apply setting
        fps[position].value = uint16(_feePercentageBIPS);
        assert(rewardEpoch < 2**240);
        fps[position].validFromEpoch = uint240(rewardEpoch);

        return rewardEpoch;
    }

    /**
     * @notice Returns the scheduled fee percentage changes of `_dataProvider`
     * @param _dataProvider         address representing data provider
     * @return _feePercentageBIPS   positional array of fee percentages in BIPS
     * @return _validFromEpoch      positional array of block numbers the fee settings are effective from
     * @return _fixed               positional array of boolean values indicating if settings are subjected to change
     */
    function getDataProviderScheduledFeePercentageChanges(
        State storage _state,
        address _dataProvider,
        uint256 _currentRewardEpoch
    )
        external view
        returns (
            uint256[] memory _feePercentageBIPS,
            uint256[] memory _validFromEpoch,
            bool[] memory _fixed
        ) 
    {
        FeePercentage[] storage fps = _state.dataProviderFeePercentages[_dataProvider];
        if (fps.length > 0) {
            uint256 currentEpoch = _currentRewardEpoch;
            uint256 position = fps.length;
            while (position > 0 && fps[position - 1].validFromEpoch > currentEpoch) {
                position--;
            }
            uint256 count = fps.length - position;
            if (count > 0) {
                _feePercentageBIPS = new uint256[](count);
                _validFromEpoch = new uint256[](count);
                _fixed = new bool[](count);
                for (uint256 i = 0; i < count; i++) {
                    _feePercentageBIPS[i] = fps[i + position].value;
                    _validFromEpoch[i] = fps[i + position].validFromEpoch;
                    _fixed[i] = (_validFromEpoch[i] - currentEpoch) != _state.feePercentageUpdateOffset;
                }
            }
        }        
    }

    /**
     * @notice Returns fee percentage setting for `_dataProvider` at `_rewardEpoch`.
     * @param _dataProvider         address representing a data provider
     * @param _rewardEpoch          reward epoch number
     */
    function _getDataProviderFeePercentage(
        State storage _state,
        address _dataProvider,
        uint256 _rewardEpoch
    )
        internal view
        returns (uint256)
    {
        FeePercentage[] storage fps = _state.dataProviderFeePercentages[_dataProvider];
        uint256 index = fps.length;
        while (index > 0) {
            index--;
            if (_rewardEpoch >= fps[index].validFromEpoch) {
                return fps[index].value;
            }
        }
        return _state.defaultFeePercentage;
    }
   
}
