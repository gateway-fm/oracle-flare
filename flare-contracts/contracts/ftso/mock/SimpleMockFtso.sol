// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../implementation/Ftso.sol";


contract SimpleMockFtso is Ftso {
    using FtsoEpoch for FtsoEpoch.State;

    mapping(uint256 => mapping(address => bytes32)) internal epochVoterHash;
    mapping(uint256 => uint256) internal randoms;
    
    // events
    event PriceHashSubmitted(
        address indexed submitter, uint256 indexed epochId, bytes32 hash, uint256 timestamp
    );
    
    constructor(
        string memory _symbol,
        uint256 _decimals,
        IPriceSubmitter _priceSubmitter,
        IIVPToken _wNat,
        address _ftsoManager,
        uint256 _firstEpochStartTs,
        uint256 _submitPeriodSeconds,
        uint256 _revealPeriodSeconds,
        uint128 _initialPrice,
        uint256 _priceDeviationThresholdBIPS,
        uint256 _cyclicBufferSize
    ) 
        Ftso(
            _symbol,
            _decimals,
            _priceSubmitter,
            _wNat,
            _ftsoManager,
            _firstEpochStartTs,
            _submitPeriodSeconds,
            _revealPeriodSeconds,
            _initialPrice,
            _priceDeviationThresholdBIPS,
            _cyclicBufferSize
        )
    {}

    /**
     * @notice Submits price hash for current epoch
     * @param _epochId              Target epoch id to which hashes are submitted
     * @param _hash                 Hashed price and random number
     * @notice Emits PriceHashSubmitted event
     */
    function submitPriceHash(uint256 _epochId, bytes32 _hash) external whenActive {
        require(_epochId == getCurrentEpochId(), "Wrong epoch id");
        require(epochVoterHash[_epochId][msg.sender] == 0, "Duplicate submit in epoch");
        epochVoterHash[_epochId][msg.sender] = _hash;
        emit PriceHashSubmitted(msg.sender, _epochId, _hash, block.timestamp);
    }

    /**
     * @notice Reveals submitted price during epoch reveal period
     * @param _epochId              Id of the epoch in which the price hash was submitted
     * @param _price                Submitted price in USD
     * @param _random               Submitted random number
     * @notice The hash of _price and _random must be equal to the submitted hash
     * @notice Emits PriceRevealed event
     */
    function revealPrice(uint256 _epochId, uint256 _price, uint256 _random) external whenActive {
        require(epochVoterHash[_epochId][msg.sender] == keccak256(abi.encode(_price, _random, msg.sender)), 
            "Price already revealed or not valid");
        _revealPrice(msg.sender, _epochId, _price, wNatVotePowerCached(msg.sender, _epochId));
        
        randoms[_epochId] += uint256(keccak256(abi.encode(_random, [_price])));

        // prevent price submission from being revealed twice
        delete epochVoterHash[_epochId][msg.sender];
    }
    
    function readVotes(uint256 _epochId) external view 
        returns (
            uint256[] memory _price,
            uint256[] memory _weight,
            uint256[] memory _weightNat
        )
    {
        FtsoEpoch.Instance storage epoch = _getEpochInstance(_epochId);
        return _readVotes(epoch);
    }

    function getWeightRatio(
        uint256 _epochId, 
        uint256 _weightNatSum, 
        uint256 _weightAssetSum
    )
        external view
        returns (uint256) 
    {
        return FtsoEpoch._getWeightRatio(_getEpochInstance(_epochId), _weightNatSum, _weightAssetSum);
    }
    
    function getVotePowerOf(address _owner) public returns (uint256 _votePowerNat, uint256 _votePowerAsset) {
        FtsoEpoch.Instance storage epoch = _getEpochInstance(_getLastRevealEpochId());

        return _getVotePowerOf(
            epoch,
            _owner,
            wNatVotePowerCached(_owner, _getLastRevealEpochId()),
            epoch.fallbackMode,
            uint256(epoch.votePowerBlock)
        );
    }

    // Simplified version of vote power weight calculation (no vote commit/reveal, but result should be equal)
    function getVotePowerWeights(address[] memory _owners) public virtual returns (uint256[] memory _weights) {
        FtsoEpoch.Instance storage epoch = _getEpochInstance(_getLastRevealEpochId());
        uint256[] memory weightsNat = new uint256[](_owners.length);
        uint256[] memory weightsAsset = new uint256[](_owners.length);
        for (uint256 i = 0; i < _owners.length; i++) {
            (uint256 votePowerNat, uint256 votePowerAsset) = _getVotePowerOf(
                epoch,
                _owners[i],
                wNatVotePowerCached(_owners[i], _getLastRevealEpochId()),
                epoch.fallbackMode,
                uint256(epoch.votePowerBlock)
            );
            epochs._addVote(epoch, _owners[i], votePowerNat, votePowerAsset, 0);
            FtsoVote.Instance memory vote = epoch.votes[epoch.nextVoteIndex - 1];
            weightsNat[i] = vote.weightNat;
            weightsAsset[i] = vote.weightAsset;
        }
        return FtsoEpoch._computeWeights(epoch, weightsNat, weightsAsset);
    }
    
    function getEpochTimes(uint256 _epochId) public view 
        returns (uint256 _epochSubmitStartTime, uint256 _epochSubmitEndTime, uint256 _epochRevealEndTime) {
        _epochSubmitStartTime = _getEpochSubmitStartTime(_epochId);
        _epochSubmitEndTime = _getEpochSubmitEndTime(_epochId);
        _epochRevealEndTime = _getEpochRevealEndTime(_epochId);
    }

    function epochRevealInProcess(uint256 _epochId) public view returns (bool) {
        return _isEpochRevealInProcess(_epochId);
    }

    function _getLastRevealEpochId() internal view returns (uint256) {
        uint256 currentEpochId = getCurrentEpochId();
        //slither-disable-next-line weak-prng // not used for random
        if (epochs.instance[currentEpochId % priceEpochCyclicBufferSize].epochId == currentEpochId) {
            return currentEpochId;
        }
        return currentEpochId - 1;
    }

        /**
     * @notice Returns random for given epoch id
     */
    function _getRandom(uint256 _epochId) internal view override returns (uint256) {
        return randoms[_epochId];
    }
}
