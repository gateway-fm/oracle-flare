// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import "../../addressUpdater/implementation/AddressUpdater.sol";
import "../../governance/implementation/GovernedV2.sol";
import "../../ftso/implementation/FtsoManager.sol";
import "../../ftso/interface/IIFtsoManagerV1.sol";
import "../../tokenPools/implementation/FtsoRewardManager.sol";


contract FtsoV2Upgrader is GovernedV2 {

    AddressUpdater public addressUpdater;
    IIFtsoManagerV1 public immutable oldFtsoManager;

    bool public upgraded = false;
    IIFtso[] internal newFtsos;
    uint256[] internal elasticBandRewardWidthsPPM;
    IIFtso internal nativeFtso;
    IIFtso[] internal assetFtsos;

    constructor(
        address _governance,
        IIFtsoManagerV1 _oldFtsoManager
    )
        GovernedV2(_governance)
    {
        oldFtsoManager = _oldFtsoManager;
    }

    /**
     * @notice Set address updater contract
     */
    function setAddressUpdater(AddressUpdater _addressUpdater) external onlyGovernance {
        addressUpdater = _addressUpdater;
    }

    /**
     * @notice set/update contract names/addresses on address udpater and then apply changes to other contracts
     * @param _contractNames                contracts names
     * @param _contractAddresses            addresses of corresponding contracts names
     * @param _contractsToUpdate            contracts to be updated
     */
    function updateContractsUsingAddressUpdater(
        string[] memory _contractNames,
        address[] memory _contractAddresses,
        IIAddressUpdatable[] memory _contractsToUpdate
    )
        external onlyGovernance
    {
        addressUpdater.update(_contractNames, _contractAddresses, _contractsToUpdate);
    }

    /**
     * @notice Sets governance parameters for FTSOs
     */
    function setGovernanceParametersOnFtsoManager(
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
        FtsoManager ftsoManager = FtsoManager(addressUpdater.getContractAddress("FtsoManager"));
        ftsoManager.setGovernanceParameters(
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
    function upgrade() external onlyImmediateGovernance {
        require(!upgraded, "already upgraded");

        FtsoManager ftsoManager = FtsoManager(addressUpdater.getContractAddress("FtsoManager"));
        (uint256 firstRewardEpochStartTs,) = ftsoManager.getRewardEpochConfiguration();
        require(oldFtsoManager.rewardEpochsStartTs() == firstRewardEpochStartTs, "reward epoch start does not match");
        FtsoRewardManager rewardManager = FtsoRewardManager(addressUpdater.getContractAddress("FtsoRewardManager"));

        // set reward data to new ftso manager
        uint256 nextRewardEpochToExpire = rewardManager.getRewardEpochToExpireNext();
        uint256 rewardEpochsLength = oldFtsoManager.getCurrentRewardEpoch() + 1;
        uint256 currentRewardEpochEnds = oldFtsoManager.rewardEpochsStartTs() +
            rewardEpochsLength * oldFtsoManager.rewardEpochDurationSeconds();

        ftsoManager.setInitialRewardData(
            nextRewardEpochToExpire,
            rewardEpochsLength,
            currentRewardEpochEnds);

        // activate ftso manager
        ftsoManager.activate();

        // replace all ftsos
        ftsoManager.replaceFtsosBulk(newFtsos, true, false); // copy prices
        IIAddressUpdatable[] memory contractsToUpdate = new IIAddressUpdatable[](1);
        contractsToUpdate[0] = ftsoManager;
        addressUpdater.updateContractAddresses(contractsToUpdate); // update addresses
        ftsoManager.deactivateFtsos(newFtsos);
        ftsoManager.addFtsosBulk(newFtsos);
        ftsoManager.setElasticBandWidthPPMFtsos(0, newFtsos, elasticBandRewardWidthsPPM);
        if (nativeFtso != IIFtso(0)) {
            ftsoManager.setFtsoAssetFtsos(nativeFtso, assetFtsos);
        }
        delete newFtsos;
        delete elasticBandRewardWidthsPPM;
        delete nativeFtso;
        delete assetFtsos;

        // switch to production mode
        ftsoManager.switchToProductionMode();
        addressUpdater.switchToProductionMode();

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
