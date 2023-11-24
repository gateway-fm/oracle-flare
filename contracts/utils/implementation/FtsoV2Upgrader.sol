// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import "../../governance/implementation/Governed.sol";
import "../../ftso/implementation/FtsoManager.sol";


contract FtsoV2Upgrader is Governed {

    bool public upgraded = false;
    IIFtso[] internal newFtsos;
    uint256[] internal elasticBandRewardWidthsPPM;
    IIFtso internal nativeFtso;
    IIFtso[] internal assetFtsos;

    constructor(address _governance) Governed(_governance) {}

    /**
     * @notice Sets governance parameters for FTSOs
     */
    function setGovernanceParametersOnFtsoManager(
        FtsoManager _ftsoManager,
        uint256 _maxVotePowerNatThresholdFraction,
        uint256 _maxVotePowerAssetThresholdFraction,
        uint256 _lowAssetUSDThreshold,
        uint256 _highAssetUSDThreshold,
        uint256 _highAssetTurnoutThresholdBIPS,
        uint256 _lowNatTurnoutThresholdBIPS,
        uint256 _elasticBandRewardBIPS,
        uint256 _rewardExpiryOffsetSeconds,
        address[] memory _trustedAddresses
    )
        external onlyGovernance
    {
        _ftsoManager.setGovernanceParameters(
            0,
            _maxVotePowerNatThresholdFraction,
            _maxVotePowerAssetThresholdFraction,
            _lowAssetUSDThreshold,
            _highAssetUSDThreshold,
            _highAssetTurnoutThresholdBIPS,
            _lowNatTurnoutThresholdBIPS,
            _elasticBandRewardBIPS,
            _rewardExpiryOffsetSeconds,
            _trustedAddresses
        );
    }

    /**
     * @notice Set ftsos, elastic band widths, native ftso and asset ftsos to be set in upgrade call
     */
    function setUpgradeData(
        IIFtso[] memory _newFtsos,
        uint256[] memory _elasticBandRewardWidthsPPM,
        IIFtso _nativeFtso,
        IIFtso[] memory _assetFtsos
    )
        external onlyGovernance
    {
        require(_newFtsos.length == _elasticBandRewardWidthsPPM.length, "array lengths do not match");
        newFtsos = _newFtsos;
        elasticBandRewardWidthsPPM = _elasticBandRewardWidthsPPM;
        nativeFtso = _nativeFtso;
        assetFtsos = _assetFtsos;
    }

    /**
     * @notice Used to do batch upgrade of ftso manager and all connected contracts - Ftsos V2
     * - updates new ftso manager with current reward states,
     * - activates new ftso manager,
     * - replaces all ftsos,
     * - transfers governance back to multisig governance
     */
    function upgrade(FtsoManager _ftsoManager) external onlyImmediateGovernance {
        require(!upgraded, "already upgraded");

        uint256 firstRewardEpochStartTs = _ftsoManager.rewardEpochsStartTs();
        FtsoManager oldFtsoManager = FtsoManager(address(_ftsoManager.oldFtsoManager()));
        require(oldFtsoManager.rewardEpochsStartTs() == firstRewardEpochStartTs, "reward epoch start does not match");

        // set reward data to new ftso manager
        uint256 nextRewardEpochToExpire = oldFtsoManager.getRewardEpochToExpireNext();
        uint256 rewardEpochsLength = oldFtsoManager.getCurrentRewardEpoch() + 1;
        uint256 currentRewardEpochEnds = firstRewardEpochStartTs +
            rewardEpochsLength * oldFtsoManager.rewardEpochDurationSeconds();

        _ftsoManager.setInitialRewardData(
            nextRewardEpochToExpire,
            rewardEpochsLength,
            currentRewardEpochEnds);

        // activate ftso manager
        _ftsoManager.activate();

        // replace all ftsos
        _ftsoManager.replaceFtsosBulk(newFtsos, true, false); // copy prices
        _ftsoManager.setElasticBandWidthPPMFtsos(0, newFtsos, elasticBandRewardWidthsPPM);
        if (nativeFtso != IIFtso(0)) {
            _ftsoManager.setFtsoAssetFtsos(nativeFtso, assetFtsos);
        }
        delete newFtsos;
        delete elasticBandRewardWidthsPPM;
        delete nativeFtso;
        delete assetFtsos;

        // switch to production mode
        _ftsoManager.switchToProductionMode();

        // mark as upgraded
        upgraded = true;
    }

    /**
     * @notice Returns new ftsos that will be used in upgrade call
     */
    function getNewFtsos() external view returns(IIFtso[] memory _newFtsos) {
        return newFtsos;
    }

    /**
     * @notice Returns elastic band widths that will be used in upgrade call
     */
    function getElasticBandRewardWidthsPPM() external view returns(uint256[] memory _elasticBandRewardWidthsPPM) {
        return elasticBandRewardWidthsPPM;
    }

    /**
     * @notice Returns native ftso that will be used in upgrade call
     */
    function getNativeFtso() external view returns(IIFtso _nativeFtso) {
        return nativeFtso;
    }

    /**
     * @notice Returns ftsos to be set as asset ftsos in upgrade call
     */
    function getAssetFtsos() external view returns(IIFtso[] memory _assetFtsos) {
        return assetFtsos;
    }
}
