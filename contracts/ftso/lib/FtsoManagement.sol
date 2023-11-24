// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import "../interface/IIFtsoManager.sol";
import "../interface/IIFtsoManagerV1.sol";
import "../interface/IIFtso.sol";
import "../lib/FtsoManagerSettings.sol";
import "../../genesis/implementation/FlareDaemon.sol";
import "../../genesis/interface/IIPriceSubmitter.sol";
import "../../governance/implementation/Governed.sol";
import "../../inflation/interface/IISupply.sol";
import "../../tokenPools/interface/IIFtsoRewardManager.sol";
import "../../token/implementation/CleanupBlockNumberManager.sol";
import "../../addressUpdater/implementation/AddressUpdatable.sol";
import "../../utils/implementation/GovernedAndFlareDaemonized.sol";
import "../../utils/implementation/RevertErrorTracking.sol";
import "../../utils/interface/IIFtsoRegistry.sol";
import "../../utils/interface/IIVoterWhitelister.sol";
import "../../utils/interface/IUpdateValidators.sol";

library FtsoManagement {
    using FtsoManagerSettings for FtsoManagerSettings.State;
    
    struct State {
        mapping(IIFtso => bool) managedFtsos;
        mapping(IIFtso => bool) notInitializedFtsos;
        mapping(IIFtso => bool) ftsoInFallbackMode;
        
        IIFtsoRegistry ftsoRegistry;
        IIVoterWhitelister voterWhitelister;
    }
    
    string internal constant ERR_GOV_PARAMS_NOT_INIT_FOR_FTSOS = "Gov. params not initialized";
    string internal constant ERR_ASSET_FTSO_NOT_MANAGED = "Asset FTSO not managed";
    string internal constant ERR_ALREADY_ADDED = "Already added";
    string internal constant ERR_FTSO_ASSET_FTSO_ZERO = "Asset ftsos list empty";
    string internal constant ERR_FTSO_EQUALS_ASSET_FTSO = "ftso equals asset ftso";
    string internal constant ERR_GOV_PARAMS_UPDATED = "Gov. params updated";
    
    // libraries cannot emit event from interfaces, so we have to copy events here
    event FtsoAdded(IIFtso ftso, bool add);     // copied from IFtsoManager.sol
    event FtsoDeactivationFailed(IIFtso ftso);  // copied from IIFtsoManager.sol
    
    function addFtso(
        State storage _state, 
        FtsoManagerSettings.State storage _settings, 
        IIFtso _ftso, 
        bool _addNewFtso,
        bool _lastUnprocessedPriceEpochInitialized
    ) 
        public
    {
        require(_settings.initialized, ERR_GOV_PARAMS_NOT_INIT_FOR_FTSOS);
        require(!_settings.changed || _settings.updateTs <= block.timestamp, ERR_GOV_PARAMS_UPDATED);

        _checkAssetFtsosAreManaged(_state, _ftso.getAssetFtsos());

        if (_addNewFtso) {
            // Check if symbol already exists in registry
            bytes32 symbol = keccak256(abi.encode(_ftso.symbol()));
            string[] memory supportedSymbols = _state.ftsoRegistry.getSupportedSymbols();
            uint256 len = supportedSymbols.length;
            while (len > 0) {
                --len;
                if (keccak256(abi.encode(supportedSymbols[len])) == symbol) {
                    revert(ERR_ALREADY_ADDED);
                }
            }
            // default value for elasticBandWidthPPM is 0
            delete _settings.elasticBandWidthPPMFtso[_ftso]; 
        }

        // Configure 
        _ftso.configureEpochs(
            _settings.maxVotePowerNatThresholdFraction,
            _settings.maxVotePowerAssetThresholdFraction,
            _settings.lowAssetUSDThreshold,
            _settings.highAssetUSDThreshold,
            _settings.highAssetTurnoutThresholdBIPS,
            _settings.lowNatTurnoutThresholdBIPS,
            _settings.elasticBandRewardBIPS,
            _settings.elasticBandWidthPPMFtso[_ftso],
            _settings.trustedAddresses
        );
        
        // skip first round of price finalization if price epoch was already initialized for reveal
        _state.notInitializedFtsos[_ftso] = _lastUnprocessedPriceEpochInitialized;
        _state.managedFtsos[_ftso] = true;
        uint256 ftsoIndex = _state.ftsoRegistry.addFtso(_ftso);

        // When a new ftso is added we also add it to the voter whitelister contract
        if (_state.voterWhitelister.maxVotersForFtso(ftsoIndex) == 0) {
            _state.voterWhitelister.addFtso(ftsoIndex);
        }

        emit FtsoAdded(_ftso, true);
    }
    
    /**
     * @notice Replaces one ftso with another - symbols must match
     * All ftsos in multi asset ftso must be managed by this ftso manager
     * @dev Deactivates old ftso
     */
    function replaceFtso(
        State storage _state, 
        FtsoManagerSettings.State storage _settings, 
        IIFtso _ftsoToAdd,
        bool _copyCurrentPrice,
        bool _copyAssetOrAssetFtsos,
        bool _lastUnprocessedPriceEpochInitialized
    )
        public
    {
        IIFtso ftsoToRemove = _state.ftsoRegistry.getFtsoBySymbol(_ftsoToAdd.symbol());

        if (_copyCurrentPrice) {
            (uint256 currentPrice, uint256 timestamp) = ftsoToRemove.getCurrentPrice();
            _ftsoToAdd.updateInitialPrice(currentPrice, timestamp);
        }

        if (_copyAssetOrAssetFtsos) {
            IIVPToken asset = ftsoToRemove.getAsset();
            if (address(asset) != address(0)) { // copy asset if exists
                _ftsoToAdd.setAsset(asset);
            } else { // copy assetFtsos list if not empty
                IIFtso[] memory assetFtsos = ftsoToRemove.getAssetFtsos();
                if (assetFtsos.length > 0) {
                    _ftsoToAdd.setAssetFtsos(assetFtsos);
                }
            }
        }

        // Add without duplicate check
        _settings.elasticBandWidthPPMFtso[_ftsoToAdd] = _settings.elasticBandWidthPPMFtso[ftsoToRemove];
        delete _settings.elasticBandWidthPPMFtso[ftsoToRemove];
        addFtso(_state, _settings, _ftsoToAdd, false, _lastUnprocessedPriceEpochInitialized);

        // replace old contract with the new one in multi asset ftsos
        IIFtso[] memory contracts = _state.ftsoRegistry.getSupportedFtsos();

        uint256 ftsosLen = contracts.length;
        for (uint256 i = 0; i < ftsosLen; i++) {
            IIFtso ftso = contracts[i];
            if (ftso.ftsoManager() != address(this)) { // it cannot be updated and will be replaced
                continue;
            }
            IIFtso[] memory assetFtsos = ftso.getAssetFtsos();
            uint256 assetFtsosLen = assetFtsos.length;
            if (assetFtsosLen > 0) {
                bool changed = false;
                for (uint256 j = 0; j < assetFtsosLen; j++) {
                    if (assetFtsos[j] == ftsoToRemove) {
                        assetFtsos[j] = _ftsoToAdd;
                        changed = true;
                    }
                }
                if (changed) {
                    ftso.setAssetFtsos(assetFtsos);
                }
            }
        }

        // cleanup old contract
        cleanFtso(_state, ftsoToRemove);
    }
    
    function deactivateFtsos(
        State storage _state, 
        IIFtso[] memory _ftsos
    ) 
        public
    {
        uint256 len = _ftsos.length;
        while(len > 0) {
            len--;
            IIFtso ftso = _ftsos[len];
            try _state.ftsoRegistry.getFtsoBySymbol(ftso.symbol()) returns (IIFtso _ftso) {
                if (_ftso != ftso) {
                    // deactivate ftso if it was already replaced on ftso registry
                    ftso.deactivateFtso();
                    delete _state.ftsoInFallbackMode[ftso];
                    delete _state.notInitializedFtsos[ftso];
                    delete _state.managedFtsos[ftso];
                } else {
                    // ftso still in use on ftso registy - it could be removed using removeFtso call
                    emit FtsoDeactivationFailed(ftso);
                }
            } catch {
                // deactivate ftso if ftso symbol is not used anymore on ftso registry
                ftso.deactivateFtso();
                delete _state.ftsoInFallbackMode[ftso];
                delete _state.notInitializedFtsos[ftso];
                delete _state.managedFtsos[ftso];
            }
        }
    }
    
    /**
     * @notice Removes FTSO from the list of the rewarded FTSOs - revert if ftso is used in multi asset ftso
     * @dev Deactivates _ftso
     */
    function removeFtso(
        State storage _state,
        FtsoManagerSettings.State storage _settings,
        IIFtso _ftso
    ) 
        public
    {
        uint256 ftsoIndex = _state.ftsoRegistry.getFtsoIndex(_ftso.symbol());
        _state.voterWhitelister.removeFtso(ftsoIndex);
        _state.ftsoRegistry.removeFtso(_ftso);
        cleanFtso(_state, _ftso);
        delete _settings.elasticBandWidthPPMFtso[_ftso];
    }

    function cleanFtso(
        State storage _state, 
        IIFtso _ftso
    ) 
        public
    {
        // Since this is as mapping, we can also just delete it, as false is default value for non-existing keys
        delete _state.ftsoInFallbackMode[_ftso];
        delete _state.notInitializedFtsos[_ftso];
        delete _state.managedFtsos[_ftso];

        // may fail if not managed by current ftso manager (can happen in redeploy)
        if (_ftso.ftsoManager() == address(this)) {
            _ftso.deactivateFtso();
            _checkMultiAssetFtsosAreManaged(_state, _state.ftsoRegistry.getSupportedFtsos());
        } else {
            // do nothing, old ftso not deactivated, but actually it is not a problem, just emit an event
            emit FtsoDeactivationFailed(_ftso);
        }
        emit FtsoAdded(_ftso, false);
    }


    /**
     * @notice Set asset FTSOs for FTSO - all ftsos should already be managed by this ftso manager
     */
    function setFtsoAssetFtsos(
        State storage _state, 
        IIFtso _ftso, 
        IIFtso[] memory _assetFtsos
    ) 
        public
    {
        uint256 len = _assetFtsos.length;
        require(len > 0, ERR_FTSO_ASSET_FTSO_ZERO);
        for (uint256 i = 0; i < len; i++) {
            if (_ftso == _assetFtsos[i]) {
                revert(ERR_FTSO_EQUALS_ASSET_FTSO);
            }
        }

        if (_state.managedFtsos[_ftso]) {
            _checkAssetFtsosAreManaged(_state, _assetFtsos);
        }
        _ftso.setAssetFtsos(_assetFtsos);
    }
    
    /**
     * @notice Check if asset ftsos are managed by this ftso manager, revert otherwise
     */
    function _checkAssetFtsosAreManaged(
        State storage _state, 
        IIFtso[] memory _assetFtsos
    ) internal view {
        uint256 len = _assetFtsos.length;
        for (uint256 i = 0; i < len; i++) {
            if (!_state.managedFtsos[_assetFtsos[i]]) {
                revert(ERR_ASSET_FTSO_NOT_MANAGED);
            }
        }
    }

    /**
     * @notice Check if all multi asset ftsos are managed by this ftso manager, revert otherwise
     */
    function _checkMultiAssetFtsosAreManaged(
        State storage _state, 
        IIFtso[] memory _ftsos
    ) internal view {
        uint256 len = _ftsos.length;
        for (uint256 i = 0; i < len; i++) {
            _checkAssetFtsosAreManaged(_state, _ftsos[i].getAssetFtsos());
        }
    }
}
