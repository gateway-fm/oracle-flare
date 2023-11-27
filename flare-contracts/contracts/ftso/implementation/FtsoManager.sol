// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import "../interface/IIFtsoManager.sol";
import "../interface/IIFtsoManagerV1.sol";
import "../interface/IIFtso.sol";
import "../lib/FtsoManagerSettings.sol";
import "../lib/FtsoManagement.sol";
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
import "../../utils/interface/IIRandomProvider.sol";


/**
 * FTSO Manager contract.
 *
 * It is in charge of:
 *
 * - Defining reward epochs (few days).
 * - Choosing a single block each reward epoch that represents vote power of this epoch.
 * - Keeping track of all FTSO contracts.
 * - Every price epoch (few minutes):
 *     - Randomly choose one FTSO for rewarding calculations.
 *     - Trigger finalize price reveal epoch.
 *     - Determine addresses and reward weights and triggers reward distribution.
 */
//solhint-disable-next-line max-states-count
contract FtsoManager is IIFtsoManager, GovernedAndFlareDaemonized, AddressUpdatable, RevertErrorTracking {
    using FtsoManagerSettings for FtsoManagerSettings.State;
    using FtsoManagement for FtsoManagement.State;

    /// Maximum number of trusted addresses allowed.
    uint256 public constant MAX_TRUSTED_ADDRESSES_LENGTH = 5;

    string internal constant ERR_FIRST_EPOCH_START_TS_IN_FUTURE = "First epoch start ts in future";
    string internal constant ERR_REWARD_EPOCH_DURATION_ZERO = "Reward epoch 0";
    string internal constant ERR_REWARD_EPOCH_START_TOO_SOON = "Reward epoch start too soon";
    string internal constant ERR_REWARD_EPOCH_NOT_INITIALIZED = "Reward epoch not initialized yet";
    string internal constant ERR_REWARD_EPOCH_START_CONDITION_INVALID = "Reward epoch start condition invalid";
    string internal constant ERR_REWARD_EPOCH_DURATION_CONDITION_INVALID = "Reward epoch duration condition invalid";
    string internal constant ERR_PRICE_EPOCH_DURATION_ZERO = "Price epoch 0";
    string internal constant ERR_VOTE_POWER_INTERVAL_FRACTION_ZERO = "Vote power interval fraction 0";
    string internal constant ERR_REVEAL_PRICE_EPOCH_DURATION_ZERO = "Reveal price epoch 0";
    string internal constant ERR_REVEAL_PRICE_EPOCH_TOO_LONG = "Reveal price epoch too long";
    string internal constant ERR_GOV_PARAMS_INVALID = "Gov. params invalid";
    string internal constant ERR_NOT_FOUND = "Not found";
    string internal constant ERR_ALREADY_ACTIVATED = "Already activated";
    string internal constant ERR_CLOSING_EXPIRED_REWARD_EPOCH_FAIL = "err close expired";
    string internal constant ERR_SET_CLEANUP_BLOCK_FAIL = "err set cleanup block";
    string internal constant ERR_PRICE_EPOCH_FINALIZE_FAIL = "err finalize price epoch";
    string internal constant ERR_DISTRIBUTE_REWARD_FAIL = "err distribute rewards";
    string internal constant ERR_ACCRUE_UNEARNED_REWARD_FAIL = "err accrue unearned rewards";
    string internal constant ERR_FALLBACK_FINALIZE_FAIL = "err fallback finalize price epoch";
    string internal constant ERR_INIT_EPOCH_REVEAL_FAIL = "err init epoch for reveal";
    string internal constant ERR_FALLBACK_INIT_EPOCH_REVEAL_FAIL = "err fallback init epoch for reveal";
    string internal constant ERR_UPDATE_REWARD_EPOCH_SWITCHOVER_CALL = "err calling updateActiveValidators";
    string internal constant ERR_CHILL_NONREVEALING_DATA_PROVIDERS = "err calling chillNonrevealingDataProviders";
    string internal constant ERR_ARRAY_LENGTHS = "array lengths do not match";
    string internal constant ERR_BAND_INVALID = "elastic band width invalid";
    string internal constant ERR_INVALID_PARAMS = "invalid parameters";

    /// Whether the FTSO Manager is active or not.
    bool public override active;
    mapping(uint256 => RewardEpochData) internal rewardEpochsMapping;
    /// Address of the FTSO contract that was last chosen for reward calculations.
    address public lastRewardedFtsoAddress;
    uint256 internal rewardEpochsLength;
    /// Timestamp when the current reward epoch finishes, in seconds since UNIX epoch.
    uint256 public override currentRewardEpochEnds;

    FtsoManagerSettings.State private settings;
    FtsoManagement.State private ftsoManagement;

    // price epoch data
    uint256 internal immutable firstPriceEpochStartTs;
    uint256 internal immutable priceEpochDurationSeconds;
    uint256 internal immutable revealEpochDurationSeconds;
    uint256 internal lastUnprocessedPriceEpoch;
    uint256 internal lastUnprocessedPriceEpochRevealEnds;
    // indicates if lastUnprocessedPriceEpoch is initialized for reveal
    // it has to be finalized before new reward epoch can start
    bool internal lastUnprocessedPriceEpochInitialized;
    /// Whether use of good random numbers is enforced. See IFtsoManager.UseGoodRandomSet.
    bool public useGoodRandom;
    /// Used only when useGoodRandom flag is set.
    uint256 public maxWaitForGoodRandomSeconds;
    /// Used only when useGoodRandom flag is set.
    uint256 public waitingForGoodRandomSinceTs;

    /// Timestamp when the first reward epoch started, in seconds since UNIX epoch.
    uint256 public immutable override rewardEpochsStartTs;
    /// Duration of reward epochs, in seconds.
    uint256 public override rewardEpochDurationSeconds;
    uint256 internal votePowerIntervalFraction;
    uint256 internal nextRewardEpochToExpire;

    /// Address of the `PriceSubmitter` contract.
    IIPriceSubmitter public priceSubmitter;
    /// Address of the `RewardManager` contract.
    IIFtsoRewardManager public rewardManager;
    // Address of the `Supply` contract.
    IISupply public supply;
    /// Address of the `CleanupBlockNumberManager` contract.
    CleanupBlockNumberManager public cleanupBlockNumberManager;
    /// Unused.
    IUpdateValidators public updateOnRewardEpochSwitchover;

    // fallback mode
    bool internal fallbackMode; // all ftsos in fallback mode

    /// Previous FTSO Manager, in case of a redeployment.
    IIFtsoManagerV1 public immutable oldFtsoManager;

    constructor(
        address _governance,
        FlareDaemon _flareDaemon,
        address _addressUpdater,
        IIFtsoManagerV1 _oldFtsoManager,
        uint256 _firstPriceEpochStartTs,
        uint256 _priceEpochDurationSeconds,
        uint256 _revealEpochDurationSeconds,
        uint256 _firstRewardEpochStartTs,
        uint256 _rewardEpochDurationSeconds,
        uint256 _votePowerIntervalFraction
    )
        GovernedAndFlareDaemonized(_governance, _flareDaemon) AddressUpdatable(_addressUpdater)
    {
        require(block.timestamp >= _firstPriceEpochStartTs, ERR_FIRST_EPOCH_START_TS_IN_FUTURE);
        require(_rewardEpochDurationSeconds > 0, ERR_REWARD_EPOCH_DURATION_ZERO);
        require(_priceEpochDurationSeconds > 0, ERR_PRICE_EPOCH_DURATION_ZERO);
        require(_revealEpochDurationSeconds > 0, ERR_REVEAL_PRICE_EPOCH_DURATION_ZERO);
        require(_votePowerIntervalFraction > 0, ERR_VOTE_POWER_INTERVAL_FRACTION_ZERO);

        require(_revealEpochDurationSeconds < _priceEpochDurationSeconds, ERR_REVEAL_PRICE_EPOCH_TOO_LONG);
        require(_firstPriceEpochStartTs + _revealEpochDurationSeconds <= _firstRewardEpochStartTs,
            ERR_REWARD_EPOCH_START_TOO_SOON);
        require((_firstRewardEpochStartTs - _revealEpochDurationSeconds - _firstPriceEpochStartTs) %
            _priceEpochDurationSeconds == 0, ERR_REWARD_EPOCH_START_CONDITION_INVALID);
        require(_rewardEpochDurationSeconds % _priceEpochDurationSeconds == 0,
            ERR_REWARD_EPOCH_DURATION_CONDITION_INVALID);

        // reward epoch
        rewardEpochsStartTs = _firstRewardEpochStartTs;
        rewardEpochDurationSeconds = _rewardEpochDurationSeconds;
        votePowerIntervalFraction = _votePowerIntervalFraction;

        // price epoch
        firstPriceEpochStartTs = _firstPriceEpochStartTs;
        priceEpochDurationSeconds = _priceEpochDurationSeconds;
        revealEpochDurationSeconds = _revealEpochDurationSeconds;
        lastUnprocessedPriceEpochRevealEnds = _firstRewardEpochStartTs;
        lastUnprocessedPriceEpoch = (_firstRewardEpochStartTs - _firstPriceEpochStartTs) / _priceEpochDurationSeconds;

        oldFtsoManager = _oldFtsoManager;
    }

    /**
     * @inheritdoc IIFtsoManager
     * @dev Only governance can call this method.
     */
    function setInitialRewardData(
        uint256 _nextRewardEpochToExpire,
        uint256 _rewardEpochsLength,
        uint256 _currentRewardEpochEnds
    )
        external override
        onlyGovernance
    {
        require(!active, ERR_ALREADY_ACTIVATED);
        nextRewardEpochToExpire = _nextRewardEpochToExpire;
        rewardEpochsLength = _rewardEpochsLength;
        currentRewardEpochEnds = _currentRewardEpochEnds;
    }

    /**
     * @inheritdoc IIFtsoManager
     * @dev Only governance can call this method.
     */
    function activate() external override onlyGovernance {
        active = true;
    }

    /**
     * @inheritdoc IFlareDaemonize
     * @dev Only `flareDaemon` can call this method.
     */
    function daemonize() external override onlyFlareDaemon returns (bool) {
        // flare daemon trigger. once every block
        if (!active) return false;

        if (rewardEpochsLength == 0) {
            _initializeFirstRewardEpoch();
        } else {
            uint256 random;
            bool finalizePriceEpoch;
            bool finalizeRewardEpoch;
            if (lastUnprocessedPriceEpochInitialized && lastUnprocessedPriceEpochRevealEnds <= block.timestamp) {
                finalizePriceEpoch = true;
            } else if (!lastUnprocessedPriceEpochInitialized && currentRewardEpochEnds <= block.timestamp) {
                finalizeRewardEpoch = true;
            }
            if (finalizePriceEpoch || finalizeRewardEpoch) { // only one may be true
                if (useGoodRandom) {
                    bool goodRandom;
                    (random, goodRandom) = IIRandomProvider(address(priceSubmitter)).getCurrentRandomWithQuality();
                    if (!goodRandom && finalizePriceEpoch) { // chill only at price epoch finalization
                        try IIRandomProvider(address(priceSubmitter)).chillNonrevealingDataProviders(
                            lastUnprocessedPriceEpoch, _getCurrentPriceEpochId()) {
                        } catch Error(string memory message) {
                            emit ChillingNonrevealingDataProvidersFailed();
                            addRevertError(address(priceSubmitter), message);
                        } catch {
                            emit ChillingNonrevealingDataProvidersFailed();
                            addRevertError(address(priceSubmitter), ERR_CHILL_NONREVEALING_DATA_PROVIDERS);
                        }
                    } else if (finalizeRewardEpoch) { // finalizePriceEpoch = false
                        if (!goodRandom) {
                            if (waitingForGoodRandomSinceTs == 0) {
                                // random is not good for the first time - set start waiting timestamp
                                waitingForGoodRandomSinceTs = block.timestamp;
                                finalizeRewardEpoch = false; // wait
                            } else if (waitingForGoodRandomSinceTs + maxWaitForGoodRandomSeconds <= block.timestamp) {
                                // we have waited long enough - reset start waiting timestamp and proceed
                                waitingForGoodRandomSinceTs = 0;
                            } else {
                                finalizeRewardEpoch = false; // wait
                            }
                        } else {
                            waitingForGoodRandomSinceTs = 0; // we got a good random - reset start waiting timestamp
                        }
                    }
                } else {
                    random = uint256(keccak256(abi.encode(block.timestamp + priceSubmitter.getCurrentRandom())));
                }
            }

            // all three conditions can be executed in the same block,
            // but are split into three `if else if` groups to reduce gas usage per one block
            if (finalizePriceEpoch) {
                // finalizes initialized price epoch if reveal period is over
                // sets lastUnprocessedPriceEpochInitialized = false
                _finalizePriceEpoch(random);
            } else if (finalizeRewardEpoch) {
                // initialized price epoch must be finalized before new reward epoch can start
                // advance currentRewardEpochEnds
                _finalizeRewardEpoch(random);
                _closeExpiredRewardEpochs();
                _cleanupOnRewardEpochFinalization();
                _rewardEpochSwitchoverTrigger();
            } else if (lastUnprocessedPriceEpochRevealEnds <= block.timestamp) {
                // new price epoch can be initialized after previous was finalized 
                // and after new reward epoch was started (if needed)
                // initializes price epoch and sets governance parameters on ftsos and price submitter
                // advance lastUnprocessedPriceEpochRevealEnds, sets lastUnprocessedPriceEpochInitialized = true
                _initializeCurrentEpochFTSOStatesForReveal(); 
            }
        }
        return true;
    }

    /**
     * @inheritdoc IFlareDaemonize
     * @dev Only `flareDaemon` can call this method.
     */
    function switchToFallbackMode() external override onlyFlareDaemon returns (bool) {
        if (!fallbackMode) {
            fallbackMode = true;
            emit FallbackMode(true);
            return true;
        }
        return false;
    }

    /**
     * Allow governance to switch to good random numbers only.
     * Only governance can call this method.
     *
     * See `IFtsoManager.UseGoodRandomSet`.
     * @param _useGoodRandom Whether good random numbers should be used or not.
     * @param _maxWaitForGoodRandomSeconds Max time in seconds to wait for the good random.
     * If there is none after given time, reward epoch finalization should proceed anyway.
     */
    function setUseGoodRandom(bool _useGoodRandom, uint256 _maxWaitForGoodRandomSeconds) external onlyGovernance {
        if (_useGoodRandom) {
            require(_maxWaitForGoodRandomSeconds > 0 && _maxWaitForGoodRandomSeconds <= 3 days, ERR_INVALID_PARAMS);
        } else {
            require(_maxWaitForGoodRandomSeconds == 0, ERR_INVALID_PARAMS);
            // reset start waiting timestamp
            waitingForGoodRandomSinceTs = 0;
        }
        useGoodRandom = _useGoodRandom;
        maxWaitForGoodRandomSeconds = _maxWaitForGoodRandomSeconds;
        emit UseGoodRandomSet(_useGoodRandom, _maxWaitForGoodRandomSeconds);
    }

    /**
     * @inheritdoc IIFtsoManager
     * @dev Only governance can call this method.
     */
    function addFtso(IIFtso _ftso) external override onlyGovernance {
        _addFtso(_ftso, true);
    }

    /**
     * @inheritdoc IIFtsoManager
     * @dev Only governance can call this method.
     */
    function addFtsosBulk(IIFtso[] memory _ftsos) external override onlyGovernance {
        for (uint256 i = 0; i < _ftsos.length; i++) {
            _addFtso(_ftsos[i], true);
        }
    }

    /**
     * @inheritdoc IIFtsoManager
     * @dev Only governance can call this method.
     */
    function removeFtso(IIFtso _ftso) external override onlyGovernance {
        ftsoManagement.removeFtso(settings, _ftso);
    }

    /**
     * @inheritdoc IIFtsoManager
     * @dev Only governance can call this method.
     */
    function replaceFtso(
        IIFtso _ftsoToAdd,
        bool _copyCurrentPrice,
        bool _copyAssetOrAssetFtsos
    )
        external override
        onlyGovernance
    {
        _replaceFtso(_ftsoToAdd, _copyCurrentPrice, _copyAssetOrAssetFtsos);
    }

    /**
     * @inheritdoc IIFtsoManager
     * @dev Only governance can call this method.
     */
    function replaceFtsosBulk(
        IIFtso[] memory _ftsosToAdd,
        bool _copyCurrentPrice,
        bool _copyAssetOrAssetFtsos
    )
        external override
        onlyGovernance
    {
        for (uint256 i = 0; i < _ftsosToAdd.length; i++) {
            _replaceFtso(_ftsosToAdd[i], _copyCurrentPrice, _copyAssetOrAssetFtsos);
        }
    }

    /**
     * Deactivates FTSOs that are no longer used on FTSO registry.
     * Only governance can call this method.
     * @param _ftsos Array of FTSO contract addresses to deactivate.
     */
    function deactivateFtsos(IIFtso[] memory _ftsos) external onlyGovernance {
        ftsoManagement.deactivateFtsos(_ftsos);
    }

    /**
     * @inheritdoc IIFtsoManager
     * @dev Only governance can call this method.
     */
    function setFtsoAsset(IIFtso _ftso, IIVPToken _asset) external override onlyGovernance {
        _ftso.setAsset(_asset);
    }

    /**
     * @inheritdoc IIFtsoManager
     * @dev Only governance can call this method.
     */
    function setFtsoAssetFtsos(IIFtso _ftso, IIFtso[] memory _assetFtsos) external override onlyGovernance {
        ftsoManagement.setFtsoAssetFtsos(_ftso, _assetFtsos);
    }

    /**
     * @inheritdoc IIFtsoManager
     * @dev Only governance can call this method.
     */
    function setFallbackMode(bool _fallbackMode) external override onlyImmediateGovernance {
        fallbackMode = _fallbackMode;
        emit FallbackMode(_fallbackMode);
    }

    /**
     * @inheritdoc IIFtsoManager
     * @dev Only governance can call this method.
     */
    function setFtsoFallbackMode(IIFtso _ftso, bool _fallbackMode) external override onlyImmediateGovernance {
        require(ftsoManagement.managedFtsos[_ftso], ERR_NOT_FOUND);
        ftsoManagement.ftsoInFallbackMode[_ftso] = _fallbackMode;
        emit FtsoFallbackMode(_ftso, _fallbackMode);
    }

    /**
     * @inheritdoc IIFtsoManager
     * @dev Only governance can call this method.
     */
    function setGovernanceParameters(
        uint256 _updateTs,
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
        external override onlyGovernance
    {
        require(
            _maxVotePowerNatThresholdFraction > 0 &&
            _maxVotePowerAssetThresholdFraction > 0 &&
            _highAssetUSDThreshold >= _lowAssetUSDThreshold &&
            _highAssetTurnoutThresholdBIPS <= 1e4 &&
            _lowNatTurnoutThresholdBIPS <= 1e4 &&
            _elasticBandRewardBIPS <= 1e4 &&
            _rewardExpiryOffsetSeconds > 0 &&
            _trustedAddresses.length <= MAX_TRUSTED_ADDRESSES_LENGTH,
            ERR_GOV_PARAMS_INVALID
        );
        settings._setUpdateTs(_updateTs);
        settings._setState(
            _maxVotePowerNatThresholdFraction,
            _maxVotePowerAssetThresholdFraction,
            _lowAssetUSDThreshold,
            _highAssetUSDThreshold,
            _highAssetTurnoutThresholdBIPS,
            _lowNatTurnoutThresholdBIPS,
            _rewardExpiryOffsetSeconds,
            _elasticBandRewardBIPS,
            _trustedAddresses
        );
    }

    /**
     * Sets the reward epoch duration.
     * Only governance can call this method.
     *
     * If the reward epoch is very short and the expiry offset is very long, the list of reward epochs
     * to be checked becomes very long. Therefore reward epoch time has to be capped to expiry offset.
     */
    function setRewardEpochDurationSeconds(uint256 _rewardEpochDurationSeconds) external onlyGovernance {
        require(_rewardEpochDurationSeconds > 0, ERR_REWARD_EPOCH_DURATION_ZERO);
        require(_rewardEpochDurationSeconds % priceEpochDurationSeconds == 0,
            ERR_REWARD_EPOCH_DURATION_CONDITION_INVALID);
        rewardEpochDurationSeconds = _rewardEpochDurationSeconds;
    }

    /// Unused.
    function setUpdateOnRewardEpochSwitchover(IUpdateValidators _updateValidators) external onlyGovernance {
        updateOnRewardEpochSwitchover = _updateValidators;
    }

    /**
     * Sets elastic band widths in PPM (parts-per-million) for given FTSOs.
     * Only governance can call this method.
     * @param _updateTs Timestamp when the changes will take effect, in seconds from UNIX epoch.
     * @param _ftsos Array of FTSO contract addresses to update.
     * @param _widths Array of secondary band widths in PPM. To obtain the actual band width,
     * this number is divided by 10^6 and multiplied by the price median value.
     */
    function setElasticBandWidthPPMFtsos(
        uint256 _updateTs,
        IIFtso[] memory _ftsos,
        uint256[] memory _widths
    )
        external onlyGovernance
    {
        require(_ftsos.length == _widths.length, ERR_ARRAY_LENGTHS);
        settings._setUpdateTs(_updateTs);
        for (uint256 i = 0; i < _ftsos.length; i++) {
            require(_widths[i] <= 1e6, ERR_BAND_INVALID);
            if (settings.elasticBandWidthPPMFtso[_ftsos[i]] != _widths[i]) {
                settings.changed = true;
                settings.elasticBandWidthPPMFtso[_ftsos[i]] = _widths[i];
            }
        }
    }

    function setVotePowerIntervalFraction(uint256 _votePowerIntervalFraction) external onlyGovernance {
        require(_votePowerIntervalFraction > 0, ERR_VOTE_POWER_INTERVAL_FRACTION_ZERO);
        votePowerIntervalFraction = _votePowerIntervalFraction;
    }

    function getVotePowerIntervalFraction() external view returns (uint256) {
        return votePowerIntervalFraction;
    }

    /// Returns the `PriceSubmitter` contract.
    function getPriceSubmitter() external view returns (IIPriceSubmitter) {
        return priceSubmitter;
    }

    /**
     * @inheritdoc IFtsoManagerGenesis
     */
    function getCurrentPriceEpochId() external view override returns (uint256 _priceEpochId) {
        return _getCurrentPriceEpochId();
    }

    /**
     * @inheritdoc IFtsoManager
     */
    function getCurrentPriceEpochData() external view override
        returns (
            uint256 _priceEpochId,
            uint256 _priceEpochStartTimestamp,
            uint256 _priceEpochEndTimestamp,
            uint256 _priceEpochRevealEndTimestamp,
            uint256 _currentTimestamp
        )
    {
        uint256 epochId = _getCurrentPriceEpochId();
        return (
            epochId,
            firstPriceEpochStartTs + epochId * priceEpochDurationSeconds,
            firstPriceEpochStartTs + (epochId + 1) * priceEpochDurationSeconds,
            firstPriceEpochStartTs + (epochId + 1) * priceEpochDurationSeconds + revealEpochDurationSeconds,
            block.timestamp
        );
    }

    /**
     * @inheritdoc IFtsoManager
     */
    function getRewardEpochVotePowerBlock(uint256 _rewardEpoch) external view override 
        returns (
            uint256 _votepowerBlock
        )
    {
        return getRewardEpochData(_rewardEpoch).votepowerBlock;
    }

    /**
     * @inheritdoc IFtsoManager
     */
    function getRewardEpochToExpireNext() external view override returns (uint256) {
        return nextRewardEpochToExpire;
    }

    /**
     * @inheritdoc IFtsoManager
     */
    function getFtsos() external view override returns (IIFtso[] memory _ftsos) {
        return _getFtsos();
    }

    /**
     * @inheritdoc IFtsoManager
     */
    function getPriceEpochConfiguration() external view override
        returns (
            uint256 _firstPriceEpochStartTs,
            uint256 _priceEpochDurationSeconds,
            uint256 _revealEpochDurationSeconds
        )
    {
        return (firstPriceEpochStartTs, priceEpochDurationSeconds, revealEpochDurationSeconds);
    }

    /**
     * @inheritdoc IFtsoManager
     */
    function getRewardEpochConfiguration() external view override
        returns (
            uint256 _firstRewardEpochStartTs,
            uint256 _rewardEpochDurationSeconds
        )
    {
        return (rewardEpochsStartTs, rewardEpochDurationSeconds);
    }

    /**
     * @inheritdoc IFtsoManager
     */
    function getFallbackMode() external view override
        returns (
            bool _fallbackMode,
            IIFtso[] memory _ftsos,
            bool[] memory _ftsoInFallbackMode
        )
    {
        _fallbackMode = fallbackMode;
        _ftsos = _getFtsos();
        uint256 len = _ftsos.length;
        _ftsoInFallbackMode = new bool[](len);

        for (uint256 i = 0; i < len; i++) {
            _ftsoInFallbackMode[i] = ftsoManagement.ftsoInFallbackMode[_ftsos[i]];
        }
    }

    /**
     * Returns governance parameters for FTSOs.
     * @return _maxVotePowerNatThresholdFraction High threshold for native token vote power per voter.
     * @return _maxVotePowerAssetThresholdFraction High threshold for asset vote power per voter
     * @return _lowAssetUSDThreshold Threshold for low asset vote power (in scaled USD).
     * @return _highAssetUSDThreshold Threshold for high asset vote power (in scaled USD).
     * @return _highAssetTurnoutThresholdBIPS Threshold for high asset turnout (in BIPS).
     * @return _lowNatTurnoutThresholdBIPS Threshold for low nat turnout (in BIPS).
     * @return _elasticBandRewardBIPS Secondary reward band, where _elasticBandRewardBIPS goes to the
     * secondary band and 10000 - _elasticBandRewardBIPS to the primary (IQR) band.
     * @return _rewardExpiryOffsetSeconds Reward epochs closed earlier than
     * block.timestamp - _rewardExpiryOffsetSeconds expire.
     * @return _trustedAddresses Trusted addresses will be used as a fallback mechanism for setting the price.
     */
    function getGovernanceParameters() external view
        returns (
            uint256 _maxVotePowerNatThresholdFraction,
            uint256 _maxVotePowerAssetThresholdFraction,
            uint256 _lowAssetUSDThreshold,
            uint256 _highAssetUSDThreshold,
            uint256 _highAssetTurnoutThresholdBIPS,
            uint256 _lowNatTurnoutThresholdBIPS,
            uint256 _elasticBandRewardBIPS,
            uint256 _rewardExpiryOffsetSeconds,
            address[] memory _trustedAddresses,
            bool _initialized,
            bool _changed
        )
    {
        return (
            settings.maxVotePowerNatThresholdFraction,
            settings.maxVotePowerAssetThresholdFraction,
            settings.lowAssetUSDThreshold,
            settings.highAssetUSDThreshold,
            settings.highAssetTurnoutThresholdBIPS,
            settings.lowNatTurnoutThresholdBIPS,
            settings.elasticBandRewardBIPS,
            settings.rewardExpiryOffsetSeconds,
            settings.trustedAddresses,
            settings.initialized,
            settings.changed
        );
    }

    /// Returns the timestamp, in seconds since UNIX epoch, when the scheduled new settings
    /// will take effect.
    function getUpdateGovernanceParametersTs() external view returns (uint256) {
        return settings.updateTs;
    }

    /**
     * @inheritdoc IIFtsoManager
     */
    function getElasticBandWidthPPMFtso(IIFtso _ftso) external view override returns (uint256)
    {
        return settings.elasticBandWidthPPMFtso[_ftso];
    }

    /**
     * @inheritdoc IIFtsoManager
     */
    function getRewardExpiryOffsetSeconds() external view override returns (uint256)
    {
        return settings.rewardExpiryOffsetSeconds;
    }

    /**
     * @inheritdoc IIFtsoManager
     */
    function getLastUnprocessedPriceEpochData() external view override
        returns (
            uint256 _lastUnprocessedPriceEpoch,
            uint256 _lastUnprocessedPriceEpochRevealEnds,
            bool _lastUnprocessedPriceEpochInitialized
        )
    {
        return (lastUnprocessedPriceEpoch, lastUnprocessedPriceEpochRevealEnds, lastUnprocessedPriceEpochInitialized);
    }

    /**
     * @inheritdoc IFtsoManager
     */
    function getCurrentRewardEpoch() external view override returns (uint256) {
        require(rewardEpochsLength != 0, ERR_REWARD_EPOCH_NOT_INITIALIZED);
        return _getCurrentRewardEpochId();
    }

    /**
     * @inheritdoc IIFtsoManager
     */
    function rewardEpochs(uint256 _rewardEpochId) external view override
        returns (
            uint256 _votepowerBlock,
            uint256 _startBlock,
            uint256 _startTimestamp
        )
    {
        RewardEpochData memory rewardEpochData = getRewardEpochData(_rewardEpochId);
        _votepowerBlock = rewardEpochData.votepowerBlock;
        _startBlock = rewardEpochData.startBlock;
        _startTimestamp = rewardEpochData.startTimestamp;
    }

    /**
     * @inheritdoc IIFtsoManager
     */
    function notInitializedFtsos(IIFtso _ftso) external view override returns (bool) {
        return ftsoManagement.notInitializedFtsos[_ftso];
    }

    /// Returns the `FtsoRegistry` contract address.
    function ftsoRegistry() external view returns (IIFtsoRegistry) {
        return ftsoManagement.ftsoRegistry;
    }

    /// Returns the `VoterWhitelister` contract address.
    function voterWhitelister() external view returns (IIVoterWhitelister) {
        return ftsoManagement.voterWhitelister;
    }

    /**
     * @inheritdoc IFlareDaemonize
     */
    function getContractName() external pure override returns (string memory) {
        return "FtsoManager";
    }

    /**
     * @inheritdoc IIFtsoManager
     */
    function getRewardEpochData(uint256 _rewardEpochId) public view override returns (RewardEpochData memory) {
        require(_rewardEpochId < rewardEpochsLength, ERR_REWARD_EPOCH_NOT_INITIALIZED);
        return _getRewardEpoch(_rewardEpochId);
    }

    function _rewardEpochSwitchoverTrigger() internal {
        if (address(updateOnRewardEpochSwitchover) != address(0)) {
            uint256 currentRewardEpoch = _getCurrentRewardEpochId();
            try updateOnRewardEpochSwitchover.updateActiveValidators() {
            } catch Error(string memory message) {
                emit UpdatingActiveValidatorsTriggerFailed(currentRewardEpoch);
                addRevertError(address(updateOnRewardEpochSwitchover), message);
            } catch {
                emit UpdatingActiveValidatorsTriggerFailed(currentRewardEpoch);
                addRevertError(address(updateOnRewardEpochSwitchover), ERR_UPDATE_REWARD_EPOCH_SWITCHOVER_CALL);
            }
        }
    }

    function _addFtso(IIFtso _ftso, bool _addNewFtso) internal {
        ftsoManagement.addFtso(settings, _ftso, _addNewFtso, lastUnprocessedPriceEpochInitialized);
        _initialActivateFtso(_ftso);
    }

    function _replaceFtso(IIFtso _ftsoToAdd, bool _copyCurrentPrice, bool _copyAssetOrAssetFtsos) internal {
        ftsoManagement.replaceFtso(settings, _ftsoToAdd, _copyCurrentPrice, _copyAssetOrAssetFtsos,
            lastUnprocessedPriceEpochInitialized);
        _initialActivateFtso(_ftsoToAdd);
    }

    function _initialActivateFtso(IIFtso _ftso) internal {
        _ftso.activateFtso(firstPriceEpochStartTs, priceEpochDurationSeconds, revealEpochDurationSeconds);

        // Set the vote power block
        if (rewardEpochsLength != 0) {
            _ftso.setVotePowerBlock(_getRewardEpoch(_getCurrentRewardEpochId()).votepowerBlock);
        }
    }

    /**
     * @notice Initializes first reward epoch. Also sets vote power block to FTSOs
     */
    function _initializeFirstRewardEpoch() internal {

        if (block.timestamp >= rewardEpochsStartTs) {
            IIFtso[] memory ftsos = _getFtsos();
            uint256 numFtsos = ftsos.length;
            // Prime the reward epoch array with a new reward epoch
            RewardEpochData memory epochData = RewardEpochData({
                votepowerBlock: block.number - 1,
                startBlock: block.number,
                startTimestamp: block.timestamp
            });

            rewardEpochsMapping[rewardEpochsLength] = epochData;
            rewardEpochsLength++;

            for (uint256 i = 0; i < numFtsos; ++i) {
                ftsos[i].setVotePowerBlock(epochData.votepowerBlock);
            }

            currentRewardEpochEnds = rewardEpochsStartTs + rewardEpochDurationSeconds;
        }
    }

    /**
     * @notice Finalizes reward epoch
     */
    function _finalizeRewardEpoch(uint256 _currentRandom) internal {
        IIFtso[] memory ftsos = _getFtsos();
        uint256 numFtsos = ftsos.length;

        // @dev when considering block boundary for vote power block:
        // - if far from now, it doesn't reflect last vote power changes
        // - if too small, possible loan attacks.
        // IMPORTANT: currentRewardEpoch is actually the one just getting finalized!
        uint256 votepowerBlockBoundary =
            (block.number - _getRewardEpoch(_getCurrentRewardEpochId()).startBlock) / votePowerIntervalFraction;
        // note: votePowerIntervalFraction > 0

        if (votepowerBlockBoundary == 0) {
            votepowerBlockBoundary = 1;
        }

        //slither-disable-next-line weak-prng           // _currentRandom calculated from ftso inputs
        uint256 votepowerBlocksAgo = _currentRandom % votepowerBlockBoundary;
        // prevent block.number becoming votePowerBlock
        // if _currentRandom % votepowerBlockBoundary == 0
        if (votepowerBlocksAgo == 0) {
            votepowerBlocksAgo = 1;
        }

        RewardEpochData memory epochData = RewardEpochData({
            votepowerBlock: block.number - votepowerBlocksAgo,
            startBlock: block.number,
            startTimestamp: block.timestamp
        });
        rewardEpochsMapping[rewardEpochsLength] = epochData;
        rewardEpochsLength++;
        for (uint256 i = 0; i < numFtsos; i++) {
            ftsos[i].setVotePowerBlock(epochData.votepowerBlock);
        }

        emit RewardEpochFinalized(epochData.votepowerBlock, epochData.startBlock);

        // Advance reward epoch end-time
        currentRewardEpochEnds += rewardEpochDurationSeconds;
    }

    /**
     * @notice Closes expired reward epochs
     */
    function _closeExpiredRewardEpochs() internal {
        uint256 currentRewardEpoch = _getCurrentRewardEpochId();
        uint256 expiryThreshold = block.timestamp - settings.rewardExpiryOffsetSeconds;
        // NOTE: start time of (i+1)th reward epoch is the end time of i-th
        // This loop is clearly bounded by the value currentRewardEpoch, which is
        // always kept to the value of rewardEpochs.length - 1 in code and this value
        // does not change in the loop.
        while (
            nextRewardEpochToExpire < currentRewardEpoch &&
            _getRewardEpoch(nextRewardEpochToExpire + 1).startTimestamp <= expiryThreshold)
        {   // Note: Since nextRewardEpochToExpire + 1 starts at that time
            // nextRewardEpochToExpire ends strictly before expiryThreshold,
            try rewardManager.closeExpiredRewardEpoch(nextRewardEpochToExpire) {
                nextRewardEpochToExpire++;
            } catch Error(string memory message) {
                // closing of expired failed, which is not critical
                // just emit event for diagnostics
                emit ClosingExpiredRewardEpochFailed(nextRewardEpochToExpire);
                addRevertError(address(rewardManager), message);
                // Do not proceed with the loop.
                break;
            } catch {
                emit ClosingExpiredRewardEpochFailed(nextRewardEpochToExpire);
                addRevertError(address(rewardManager), ERR_CLOSING_EXPIRED_REWARD_EPOCH_FAIL);
                // Do not proceed with the loop.
                break;
            }
        }
    }

    /**
     * @notice Performs any cleanup needed immediately after a reward epoch is finalized
     */
    function _cleanupOnRewardEpochFinalization() internal {

        uint256 cleanupBlock = _getRewardEpoch(nextRewardEpochToExpire).votepowerBlock;

        try cleanupBlockNumberManager.setCleanUpBlockNumber(cleanupBlock) {
        } catch Error(string memory message) {
            // cleanup block number manager call failed, which is not critical
            // just emit event for diagnostics
            emit CleanupBlockNumberManagerFailedForBlock(cleanupBlock);
            addRevertError(address(cleanupBlockNumberManager), message);
        } catch {
            emit CleanupBlockNumberManagerFailedForBlock(cleanupBlock);
            addRevertError(address(cleanupBlockNumberManager), ERR_SET_CLEANUP_BLOCK_FAIL);
        }
    }

    function _finalizePriceEpochFailed(IIFtso ftso, string memory message) internal {
        emit FinalizingPriceEpochFailed(
            ftso,
            lastUnprocessedPriceEpoch,
            IFtso.PriceFinalizationType.WEIGHTED_MEDIAN
        );

        addRevertError(address(ftso), message);

        _fallbackFinalizePriceEpoch(ftso);
    }

    /**
     * @notice Finalizes price epoch
     */
    function _finalizePriceEpoch(uint256 _currentRandom) internal {
        IIFtso[] memory ftsos = _getFtsos();
        uint256 numFtsos = ftsos.length;

        // Are there any FTSOs to process?
        if (numFtsos > 0 && !fallbackMode) {
            // choose winning ftso
            //slither-disable-next-line weak-prng
            uint256 chosenFtsoId = _currentRandom % numFtsos;

            address[] memory addresses;
            uint256[] memory weights;
            uint256 totalWeight;

            // On the off chance that the winning FTSO does not have any
            // recipient within the truncated price distribution to
            // receive rewards, find the next FTSO that does have reward
            // recipients and declare it the winner. Start with the next ftso.
            bool wasDistributed = false;
            address rewardedFtsoAddress = address(0);
            for (uint256 i = 0; i < numFtsos; i++) {
                //slither-disable-next-line weak-prng           // not a random, just choosing next
                uint256 id = (chosenFtsoId + i) % numFtsos;
                IIFtso ftso = ftsos[id];

                // skip finalizing ftso, as it is not initialized for reveal and tx would revert
                if (ftsoManagement.notInitializedFtsos[ftso]) {
                    delete ftsoManagement.notInitializedFtsos[ftso];
                    continue;
                }

                try ftso.finalizePriceEpoch(lastUnprocessedPriceEpoch, !wasDistributed) returns (
                    address[] memory _addresses,
                    uint256[] memory _weights,
                    uint256 _totalWeight
                ) {
                    if (!wasDistributed && _addresses.length > 0) { // change also in FTSO if condition changes
                        (addresses, weights, totalWeight) = (_addresses, _weights, _totalWeight);
                        wasDistributed = true;
                        rewardedFtsoAddress = address(ftso);
                    }
                } catch Error(string memory message) {
                    _finalizePriceEpochFailed(ftso, message);
                } catch {
                    _finalizePriceEpochFailed(ftso, ERR_PRICE_EPOCH_FINALIZE_FAIL);
                }
            }

            uint256 currentRewardEpoch = _getCurrentRewardEpochId();

            if (wasDistributed) {
                try rewardManager.distributeRewards(
                    addresses,
                    weights,
                    totalWeight,
                    lastUnprocessedPriceEpoch,
                    rewardedFtsoAddress,
                    priceEpochDurationSeconds,
                    currentRewardEpoch,
                    _getPriceEpochEndTime(lastUnprocessedPriceEpoch) - 1, // actual end time (included)
                    _getRewardEpoch(currentRewardEpoch).votepowerBlock) {
                } catch Error(string memory message) {
                    emit DistributingRewardsFailed(rewardedFtsoAddress, lastUnprocessedPriceEpoch);
                    addRevertError(address(rewardManager), message);
                } catch {
                    emit DistributingRewardsFailed(rewardedFtsoAddress, lastUnprocessedPriceEpoch);
                    addRevertError(address(rewardManager), ERR_DISTRIBUTE_REWARD_FAIL);
                }
            } else {
                // If here, it means that no FTSO was initialized, or no FTSO had a recipient
                // eligible to receive rewards. And if so, burn rewards for this price epoch.
                _accrueUnearnedRewards();
            }

            lastRewardedFtsoAddress = rewardedFtsoAddress;
            emit PriceEpochFinalized(rewardedFtsoAddress, currentRewardEpoch);
        } else {
            // only for fallback mode
            for (uint256 i = 0; i < numFtsos; i++) {
                IIFtso ftso = ftsos[i];
                // skip finalizing ftso, as it is not initialized for reveal and tx would revert
                if (ftsoManagement.notInitializedFtsos[ftso]) {
                    delete ftsoManagement.notInitializedFtsos[ftso];
                    continue;
                }
                _fallbackFinalizePriceEpoch(ftso);
            }

            // Because FTSO manager in fallback, burn rewards for this price epoch.
            _accrueUnearnedRewards();

            lastRewardedFtsoAddress = address(0);
            emit PriceEpochFinalized(address(0), _getCurrentRewardEpochId());
        }

        lastUnprocessedPriceEpochInitialized = false;
    }

    function _accrueUnearnedRewards() internal {
        try rewardManager.accrueUnearnedRewards(
            lastUnprocessedPriceEpoch,
            priceEpochDurationSeconds,
            _getPriceEpochEndTime(lastUnprocessedPriceEpoch) - 1) { // actual end time (included)
        } catch Error(string memory message) {
            emit AccruingUnearnedRewardsFailed(lastUnprocessedPriceEpoch);
            addRevertError(address(rewardManager), message);
        } catch {
            emit AccruingUnearnedRewardsFailed(lastUnprocessedPriceEpoch);
            addRevertError(address(rewardManager), ERR_ACCRUE_UNEARNED_REWARD_FAIL);
        }
    }

    function _fallbackFinalizePriceEpochFailed(IIFtso _ftso, string memory message) internal {
        emit FinalizingPriceEpochFailed(
            _ftso,
            lastUnprocessedPriceEpoch,
            IFtso.PriceFinalizationType.TRUSTED_ADDRESSES
        );
        addRevertError(address(_ftso), message);

        // if reverts we want to propagate up to daemon
        _ftso.forceFinalizePriceEpoch(lastUnprocessedPriceEpoch);
    }

    function _fallbackFinalizePriceEpoch(IIFtso _ftso) internal {
        try _ftso.fallbackFinalizePriceEpoch(lastUnprocessedPriceEpoch) {
        } catch Error(string memory message) {
            _fallbackFinalizePriceEpochFailed(_ftso, message);
        } catch {
            _fallbackFinalizePriceEpochFailed(_ftso, ERR_FALLBACK_FINALIZE_FAIL);
        }
    }

    /**
     * @notice Initializes epoch states in FTSOs for reveal.
     * Prior to initialization it sets governance parameters, if
     * governance has changed them. It also sets price submitter trusted addresses.
     */
    function _initializeCurrentEpochFTSOStatesForReveal() internal {
        if (settings.changed && settings.updateTs <= block.timestamp) {
            priceSubmitter.setTrustedAddresses(settings.trustedAddresses);
        }

        IIFtso[] memory ftsos = _getFtsos();
        uint256 numFtsos = ftsos.length;

        // circulating supply is used only when ftso is not in fallback mode
        uint256 circulatingSupplyNat;
        if (numFtsos > 0 && !fallbackMode) {
            uint256 votePowerBlock = _getRewardEpoch(_getCurrentRewardEpochId()).votepowerBlock;
            circulatingSupplyNat = supply.getCirculatingSupplyAtCached(votePowerBlock);
        }

        for (uint256 i = 0; i < numFtsos; i++) {
            IIFtso ftso = ftsos[i];
            if (settings.changed && settings.updateTs <= block.timestamp) {
                ftso.configureEpochs(
                    settings.maxVotePowerNatThresholdFraction,
                    settings.maxVotePowerAssetThresholdFraction,
                    settings.lowAssetUSDThreshold,
                    settings.highAssetUSDThreshold,
                    settings.highAssetTurnoutThresholdBIPS,
                    settings.lowNatTurnoutThresholdBIPS,
                    settings.elasticBandRewardBIPS,
                    settings.elasticBandWidthPPMFtso[ftso],
                    settings.trustedAddresses
                );
            }

            try ftso.initializeCurrentEpochStateForReveal(
                circulatingSupplyNat,
                fallbackMode || ftsoManagement.ftsoInFallbackMode[ftso]) {
            } catch Error(string memory message) {
                _initializeCurrentEpochStateForRevealFailed(ftso, message);
            } catch {
                _initializeCurrentEpochStateForRevealFailed(ftso, ERR_INIT_EPOCH_REVEAL_FAIL);
            }

        }
        if (settings.changed && settings.updateTs <= block.timestamp) {
            settings.changed = false;
        }

        // Advance price epoch id and end-time
        uint256 currentPriceEpochId = _getCurrentPriceEpochId();
        lastUnprocessedPriceEpoch = currentPriceEpochId;
        lastUnprocessedPriceEpochRevealEnds = _getPriceEpochRevealEndTime(currentPriceEpochId);

        lastUnprocessedPriceEpochInitialized = true;
    }

    function _initializeCurrentEpochStateForRevealFailed(IIFtso ftso, string memory message) internal {
        emit InitializingCurrentEpochStateForRevealFailed(ftso, _getCurrentPriceEpochId());
        addRevertError(address(ftso), message);

        // if it was already called with fallback = true, just mark as not initialized, else retry
        if (fallbackMode || ftsoManagement.ftsoInFallbackMode[ftso]) {
            ftsoManagement.notInitializedFtsos[ftso] = true;
        } else {
            try ftso.initializeCurrentEpochStateForReveal(0, true) {
            } catch Error(string memory message1) {
                ftsoManagement.notInitializedFtsos[ftso] = true;
                emit InitializingCurrentEpochStateForRevealFailed(ftso, _getCurrentPriceEpochId());
                addRevertError(address(ftso), message1);
            } catch {
                ftsoManagement.notInitializedFtsos[ftso] = true;
                emit InitializingCurrentEpochStateForRevealFailed(ftso, _getCurrentPriceEpochId());
                addRevertError(address(ftso), ERR_FALLBACK_INIT_EPOCH_REVEAL_FAIL);
            }
        }
    }

    /**
     * @notice Implementation of the AddressUpdatable abstract method.
     */
    function _updateContractAddresses(
        bytes32[] memory _contractNameHashes,
        address[] memory _contractAddresses
    )
        internal override
    {
        priceSubmitter = IIPriceSubmitter(
            _getContractAddress(_contractNameHashes, _contractAddresses, "PriceSubmitter"));
        rewardManager = IIFtsoRewardManager(
            _getContractAddress(_contractNameHashes, _contractAddresses, "FtsoRewardManager"));
        supply = IISupply(
            _getContractAddress(_contractNameHashes, _contractAddresses, "Supply"));
        cleanupBlockNumberManager = CleanupBlockNumberManager(
            _getContractAddress(_contractNameHashes, _contractAddresses, "CleanupBlockNumberManager"));
        ftsoManagement.ftsoRegistry = IIFtsoRegistry(
            _getContractAddress(_contractNameHashes, _contractAddresses, "FtsoRegistry"));
        ftsoManagement.voterWhitelister = IIVoterWhitelister(
            _getContractAddress(_contractNameHashes, _contractAddresses, "VoterWhitelister"));
    }

    /**
     * @notice Returns current reward epoch id without additional checks
     */
    function _getCurrentRewardEpochId() internal view returns (uint256) {
        return rewardEpochsLength - 1;
    }

    /**
     * Get reward epoch from current ftso manager or from old one if no data in current
     */
    function _getRewardEpoch(uint256 _rewardEpochId) internal view returns (RewardEpochData memory _rewardEpoch) {
        _rewardEpoch = rewardEpochsMapping[_rewardEpochId];
        if (_rewardEpoch.startTimestamp == 0) {
            (uint256 vpBlock, uint256 sBlock, uint256 sTimestamp) = oldFtsoManager.rewardEpochs(_rewardEpochId);
            _rewardEpoch = RewardEpochData({
                votepowerBlock: vpBlock,
                startBlock: sBlock,
                startTimestamp: sTimestamp
            });
        }
    }

    /**
     * @notice Returns price epoch reveal end time.
     * @param _priceEpochId The price epoch id.
     * @dev half-closed interval - end time not included
     */
    function _getPriceEpochRevealEndTime(uint256 _priceEpochId) internal view returns (uint256) {
        return firstPriceEpochStartTs + (_priceEpochId + 1) * priceEpochDurationSeconds + revealEpochDurationSeconds;
    }

    /**
     * @notice Returns price epoch end time.
     * @param _forPriceEpochId The price epoch id of the end time to fetch.
     * @dev half-closed interval - end time not included
     */
    function _getPriceEpochEndTime(uint256 _forPriceEpochId) internal view returns (uint256) {
        return firstPriceEpochStartTs + ((_forPriceEpochId + 1) * priceEpochDurationSeconds);
    }

    /**
     * @notice Returns current price epoch id. The calculation in this function
     * should fully match to definition of current epoch id in FTSO contracts.
     */
    function _getCurrentPriceEpochId() internal view returns (uint256) {
        return (block.timestamp - firstPriceEpochStartTs) / priceEpochDurationSeconds;
    }

    function _getFtsos() internal view returns (IIFtso[] memory) {
        return ftsoManagement.ftsoRegistry.getSupportedFtsos();
    }
}
