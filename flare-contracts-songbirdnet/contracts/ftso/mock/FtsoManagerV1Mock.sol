// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import "../interface/IIFtsoManagerV1.sol";
import "../interface/IIFtso.sol";
import "../../genesis/interface/IFlareDaemonize.sol";
import "../../utils/implementation/GovernedAndFlareDaemonized.sol";
import "../../utils/interface/IIFtsoRegistry.sol";
import "../../utils/interface/IIVoterWhitelister.sol";


contract FtsoManagerV1Mock is IIFtsoManagerV1, GovernedAndFlareDaemonized, IFlareDaemonize {

    struct RewardEpochData {
        uint256 votepowerBlock;
        uint256 startBlock;
        uint256 startTimestamp;
    }

    string internal constant ERR_FTSO_ASSET_FTSO_ZERO = "Asset ftsos list empty";
    string internal constant ERR_FTSO_EQUALS_ASSET_FTSO = "ftso equals asset ftso";

    RewardEpochData[] public override rewardEpochs;

    IIFtsoRegistry internal ftsoRegistry;
    IIVoterWhitelister internal voterWhitelister;

    // price epoch data
    uint256 internal immutable firstPriceEpochStartTs;
    uint256 internal immutable priceEpochDurationSeconds;
    uint256 internal immutable revealEpochDurationSeconds;

    // reward epoch data
    uint256 public immutable override rewardEpochsStartTs;
    uint256 public immutable override rewardEpochDurationSeconds;

    uint256 internal currentRewardEpochEnds;

    constructor(
        address _governance,
        FlareDaemon _flareDaemon,
        IIFtsoRegistry _ftsoRegistry,
        IIVoterWhitelister _voterWhitelister,
        uint256 _firstPriceEpochStartTs,
        uint256 _priceEpochDurationSeconds,
        uint256 _revealEpochDurationSeconds,
        uint256 _rewardEpochsStartTs,
        uint256 _rewardEpochDurationSeconds
    ) GovernedAndFlareDaemonized(_governance, _flareDaemon) {
        ftsoRegistry = _ftsoRegistry;
        voterWhitelister = _voterWhitelister;

        // price epoch
        firstPriceEpochStartTs = _firstPriceEpochStartTs;
        priceEpochDurationSeconds = _priceEpochDurationSeconds;
        revealEpochDurationSeconds = _revealEpochDurationSeconds;

        // reward epoch
        rewardEpochsStartTs = _rewardEpochsStartTs;
        rewardEpochDurationSeconds = _rewardEpochDurationSeconds;
        currentRewardEpochEnds = _rewardEpochsStartTs;
    }

    function daemonize() external override onlyFlareDaemon returns (bool) {
        if (currentRewardEpochEnds <= block.timestamp) {
            RewardEpochData memory epochData = RewardEpochData({
                votepowerBlock: block.number - 1, 
                startBlock: block.number,
                startTimestamp: block.timestamp
            });
            rewardEpochs.push(epochData);
            currentRewardEpochEnds += rewardEpochDurationSeconds;
        }

        return true;
    }

    function addFtso(IIFtso _ftso) external onlyGovernance {

        // Check if symbol already exists in registry
        bytes32 symbol = keccak256(abi.encode(_ftso.symbol()));
        string[] memory supportedSymbols = ftsoRegistry.getSupportedSymbols();
        uint256 len = supportedSymbols.length;
        while (len > 0) {
            --len;
            if (keccak256(abi.encode(supportedSymbols[len])) == symbol) {
                revert("Already added");
            }
        }
        

        _ftso.activateFtso(firstPriceEpochStartTs, priceEpochDurationSeconds, revealEpochDurationSeconds);

        // Set the vote power block
        if (rewardEpochs.length != 0) {
            _ftso.setVotePowerBlock(rewardEpochs[rewardEpochs.length - 1].votepowerBlock);
        }

        uint256 ftsoIndex = ftsoRegistry.addFtso(_ftso);
        voterWhitelister.addFtso(ftsoIndex);
    }

    /**
     * @notice Set asset FTSOs for FTSO - all ftsos should already be managed by this ftso manager
     */
    function setFtsoAssetFtsos(IIFtso _ftso, IIFtso[] memory _assetFtsos) external onlyGovernance {
        uint256 len = _assetFtsos.length;
        require(len > 0, ERR_FTSO_ASSET_FTSO_ZERO);
        for (uint256 i = 0; i < len; i++) {
            if (_ftso == _assetFtsos[i]) {
                revert(ERR_FTSO_EQUALS_ASSET_FTSO);
            }
        }

        _ftso.setAssetFtsos(_assetFtsos);
    }

    function getPriceEpochConfiguration() external view override
        returns (
            uint256 _firstPriceEpochStartTs,
            uint256 _priceEpochDurationSeconds,
            uint256 _revealEpochDurationSeconds
        )
    {
        return (firstPriceEpochStartTs, priceEpochDurationSeconds, revealEpochDurationSeconds);
    }

    function getCurrentRewardEpoch() external view override returns(uint256) {
        require(rewardEpochs.length > 0, "Reward epoch not initialized yet");
        return rewardEpochs.length - 1;
    }
        
    function switchToFallbackMode() external view override onlyFlareDaemon returns (bool) {
        return false;
    }
}
