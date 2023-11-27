// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../implementation/VoterWhitelister.sol";

contract VoterWhitelisterMock is VoterWhitelister {
    constructor(
        address _governance,
        address _addressUpdater,
        IIPriceSubmitter _priceSubmitter, 
        uint256 _defaultMaxVotersForFtso
    )
        VoterWhitelister(_governance, _addressUpdater, _priceSubmitter, _defaultMaxVotersForFtso, IVoterWhitelister(0))
    {
    }
    
    function minVotePowerIndex(address[] memory _addresses,uint256 _ftsoIndex) public
        returns (uint256)
    {
        return _minVotePowerIndex(_addresses, _ftsoIndex);
    }
    
    function getVotePowers(IIVPToken _token, address[] memory _addresses, uint256 _blockNumber) public
        returns (uint256[] memory)
    {
        return _getVotePowers(_token, _addresses, _blockNumber);
    }
    
    function getVotePowerWeights(IIFtso ftso, address[] memory _addresses) public
        returns (uint256[] memory _votePowers) 
    {
        return _getVotePowerWeights(ftso, _addresses);
    }
    
    function getNativeVotePowerWeights(
        IIVPToken _wNat,
        uint256 _totalVotePowerNat,
        address[] memory _addresses, 
        uint256 _blockNumber
    )
        public
        returns (uint256[] memory _wNatVP)
    {
        return _getNativeVotePowerWeights(_wNat, _totalVotePowerNat, _addresses, _blockNumber);
    }
    
    function getAssetVotePowerWeights(
        IIVPToken[] memory _assets,
        uint256[] memory _assetMultipliers,
        uint256 _totalVotePowerAsset,
        address[] memory _addresses, 
        uint256 _blockNumber
    )
        public
        returns (uint256[] memory _combinedAssetVP)
    {
        return _getAssetVotePowerWeights(_assets, _assetMultipliers, _totalVotePowerAsset, _addresses, _blockNumber);
    }
}
