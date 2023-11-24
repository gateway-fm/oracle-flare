// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../interface/IIFtsoRewardManager.sol";
import "../lib/DataProviderFee.sol";
import "../../utils/implementation/AddressSet.sol";
import "../../addressUpdater/implementation/AddressUpdatable.sol";
import "../../ftso/interface/IIFtsoManager.sol";
import "../../governance/implementation/Governed.sol";
import "../../claiming/interface/IIClaimSetupManager.sol";
import "../../token/implementation/WNat.sol";
import "../../utils/implementation/SafePct.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/SafeCast.sol";


/**
 * Handles reward distribution and claiming related to the FTSO system.
 *
 * More specifically, this contract:
 *
 * * Distributes rewards according to instructions from the `FtsoManager`.
 * * Allows data providers, delegators and executors to claim rewards.
 */

//solhint-disable-next-line max-states-count
contract FtsoRewardManager is IIFtsoRewardManager, Governed, ReentrancyGuard, AddressUpdatable {
    using SafePct for uint256;
    using SafeMath for uint256;
    using SafeCast for uint256;
    using DataProviderFee for DataProviderFee.State;
    using AddressSet for AddressSet.State;

    struct RewardClaim {            // Used for storing reward claim info.
        bool claimed;               // Indicates if reward has been claimed.
        uint128 amount;             // Amount claimed.
    }

    struct UnclaimedRewardState {   // Used for storing unclaimed reward info.
        uint128 amount;             // Total unclaimed amount.
        uint128 weight;             // Total unclaimed weight.
    }

    struct RewardState {            // Used for local storage of reward state.
        address[] dataProviders;    // Positional array of addresses representing data providers.
        uint256[] weights;          // Positional array of numbers representing reward weights.
        uint256[] amounts;          // Positional array of numbers representing reward amounts.
        bool[] claimed;             // Positional array of booleans indicating if reward has already been claimed.
    }

    uint256 constant internal MAX_BIPS = 1e4;
    uint256 constant internal ALMOST_FULL_DAY_SEC = 1 days - 1;
    uint256 constant internal MAX_BURNABLE_PCT = 20;
    uint256 constant internal FIRST_CLAIMABLE_EPOCH = uint(-1);
    address payable constant internal BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    bool public override active;

    /// Epochs before the token distribution event at Flare launch were not be claimable.
    /// This variable holds the first reward epoch that was claimable.
    uint256 public override firstClaimableRewardEpoch;


    // id of the first epoch to expire. Closed = expired and unclaimed funds sent back
    uint256 private nextRewardEpochToExpire;
    // reward epoch when setInitialRewardData is called (set to +1) - used for forwarding closeExpiredRewardEpoch
    uint256 private initialRewardEpoch;

    /**
     * @dev Provides a mapping of reward epoch ids to an address mapping of unclaimed rewards.
     */
    mapping(uint256 => mapping(address => UnclaimedRewardState)) private epochProviderUnclaimedReward;
    mapping(uint256 => mapping(address => uint256)) private epochProviderVotePowerIgnoringRevocation;
    mapping(uint256 => mapping(address => uint256)) private epochProviderRewardAmount;
    mapping(uint256 => mapping(address => mapping(address => RewardClaim))) private epochProviderClaimerReward;
    mapping(address => uint256) private claimerNextClaimableEpoch;
    mapping(uint256 => uint256) private epochVotePowerBlock;
    mapping(uint256 => uint256) private totalRewardEpochRewards;
    mapping(uint256 => uint256) private claimedRewardEpochRewards;

    DataProviderFee.State private dataProviderFee;

    // Totals
    uint256 private totalAwardedWei;     // rewards that were distributed
    uint256 private totalClaimedWei;     // rewards that were claimed in time
    uint256 private totalExpiredWei;     // rewards that were not claimed in time and expired
    uint256 private totalUnearnedWei;    // rewards that were unearned (ftso fallback) and thus not distributed
    uint256 private totalBurnedWei;      // rewards that were unearned or expired and thus burned
    uint256 private totalInflationAuthorizedWei;
    uint256 private totalInflationReceivedWei;
    uint256 private lastInflationAuthorizationReceivedTs;
    uint256 private dailyAuthorizedInflation;

    uint256 private lastBalance;

    // Addresses

    /// The `FtsoManager` contract that controls reward distribution.
    IIFtsoManager public ftsoManager;
    /// The `ClaimSetupManager` contract that helps automate reward claiming.
    IIClaimSetupManager public claimSetupManager;
    address private inflation;
    /// Address of the wrapped native token (`WNat`) contract.
    WNat public wNat;

    /// Address of the old `FtsoRewardManager`, replaced by this one.
    address public immutable oldFtsoRewardManager;
    /// Address of the new `FtsoRewardManager` that replaced this one.
    address public newFtsoRewardManager;

    modifier mustBalance {
        _;
        _checkMustBalance();
    }

    /// Only the `ftsoManager` contract can call this method.
    modifier onlyFtsoManager () {
        _checkOnlyFtsoManager();
        _;
    }

    /// This method can only be called if the contract is `active`.
    modifier onlyIfActive() {
        _checkOnlyActive();
        _;
    }

    /// Only the `Inflation` contract can call this method.
    modifier onlyInflation {
        _checkOnlyInflation();
        _;
    }

    /// Only the reward owner and its authorized executors can call this method.
    /// Executors can only send rewards to authorized recipients.
    /// See `ClaimSetupManager`.
    modifier onlyExecutorAndAllowedRecipient(address _rewardOwner, address _recipient) {
        _checkExecutorAndAllowedRecipient(_rewardOwner, _recipient);
        _;
    }

    constructor(
        address _governance,
        address _addressUpdater,
        address _oldFtsoRewardManager,
        uint256 _feePercentageUpdateOffset,
        uint256 _defaultFeePercentage
    )
        Governed(_governance) AddressUpdatable(_addressUpdater)
    {
        oldFtsoRewardManager = _oldFtsoRewardManager;
        dataProviderFee.feePercentageUpdateOffset = _feePercentageUpdateOffset;
        dataProviderFee.defaultFeePercentage = _defaultFeePercentage;
        firstClaimableRewardEpoch = FIRST_CLAIMABLE_EPOCH;
    }

    /**
     * @inheritdoc IFtsoRewardManager
     */
    function claimReward(
        address payable _recipient,
        uint256[] calldata _rewardEpochs
    )
        external override
        onlyIfActive
        mustBalance
        nonReentrant
        returns (uint256 _rewardAmount)
    {
        uint256 maxRewardEpoch = 0;
        for (uint256 i = 0; i < _rewardEpochs.length; i++) {
            if (maxRewardEpoch < _rewardEpochs[i]) {
                maxRewardEpoch = _rewardEpochs[i];
            }
        }
        _rewardAmount = _claimOrWrapReward(msg.sender, _recipient, maxRewardEpoch, false);
    }

    /**
     * @inheritdoc IFtsoRewardManager
     */
    function claim(
        address _rewardOwner,
        address payable _recipient,
        uint256 _rewardEpoch,
        bool _wrap
    )
        external override
        onlyIfActive
        mustBalance
        nonReentrant
        onlyExecutorAndAllowedRecipient(_rewardOwner, _recipient)
        returns (uint256 _rewardAmount)
    {
        _rewardAmount = _claimOrWrapReward(_rewardOwner, _recipient, _rewardEpoch, _wrap);
    }

    /**
     * @inheritdoc IFtsoRewardManager
     */
    function claimRewardFromDataProviders(
        address payable _recipient,
        uint256[] calldata _rewardEpochs,
        address[] calldata _dataProviders
    )
        external override
        onlyIfActive
        mustBalance
        nonReentrant
        returns (uint256 _rewardAmount)
    {
        _rewardAmount = _claimOrWrapRewardFromDataProviders(msg.sender, _recipient,
            _rewardEpochs, _dataProviders, false);
    }

    /**
     * @inheritdoc IFtsoRewardManager
     */
    function claimFromDataProviders(
        address _rewardOwner,
        address payable _recipient,
        uint256[] calldata _rewardEpochs,
        address[] calldata _dataProviders,
        bool _wrap
    )
        external override
        onlyIfActive
        mustBalance
        nonReentrant
        onlyExecutorAndAllowedRecipient(_rewardOwner, _recipient)
        returns (uint256 _rewardAmount)
    {
        _rewardAmount = _claimOrWrapRewardFromDataProviders(_rewardOwner, _recipient,
            _rewardEpochs, _dataProviders, _wrap);
    }

    /**
     * @inheritdoc IFtsoRewardManager
     */
    //slither-disable-next-line reentrancy-eth          // guarded by nonReentrant
    function autoClaim(address[] calldata _rewardOwners, uint256 _rewardEpoch)
        external override
        onlyIfActive
        mustBalance
        nonReentrant
    {
        _handleSelfDestructProceeds();
        for (uint256 i = 0; i < _rewardOwners.length; i++) {
            _checkNonzeroRecipient(_rewardOwners[i]);
        }

        uint256 currentRewardEpoch = _getCurrentRewardEpoch();
        require(_isRewardClaimable(_rewardEpoch, currentRewardEpoch), "not claimable");

        (address[] memory claimAddresses, uint256 executorFeeValue) =
            claimSetupManager.getAutoClaimAddressesAndExecutorFee(msg.sender, _rewardOwners);

        uint256 minClaimableEpoch = _minClaimableRewardEpoch();
        for (uint256 i = 0; i < _rewardOwners.length; i++) {
            address rewardOwner = _rewardOwners[i];
            address claimAddress = claimAddresses[i];
            // claim for owner
            uint256 rewardAmount =
                _claimRewardPercentageDelegation(rewardOwner, claimAddress, _rewardEpoch, minClaimableEpoch);
            if (rewardOwner != claimAddress) {
                // claim for PDA
                rewardAmount +=
                    _claimRewardPercentageDelegation(claimAddress, claimAddress, _rewardEpoch, minClaimableEpoch);
            }
            rewardAmount = rewardAmount.sub(executorFeeValue, "claimed amount too small");
            if (rewardAmount > 0) {
                // transfer total amount (state is updated and events are emitted in _claimReward)
                //slither-disable-next-line arbitrary-send-eth          // amount always calculated by _claimReward
                wNat.depositTo{value: rewardAmount}(claimAddress);
            }
        }

        _transferOrWrapAndUpdateBalance(msg.sender, executorFeeValue.mul(_rewardOwners.length), false);
    }

    /**
     * @inheritdoc IIFtsoRewardManager
     * @dev Only governance can call this method.
     */
    function activate() external override onlyImmediateGovernance {
        require(inflation != address(0) && address(ftsoManager) != address(0) && address(wNat) != address(0),
            "addresses not set");
        active = true;
        emit FtsoRewardManagerActivated(address(this));
    }

    /**
     * @inheritdoc IIFtsoRewardManager
     * @dev Only governance can call this method.
     */
    function enableClaims() external override onlyImmediateGovernance {
        require (firstClaimableRewardEpoch == FIRST_CLAIMABLE_EPOCH, "already enabled");
        firstClaimableRewardEpoch = _getCurrentRewardEpoch();
        emit RewardClaimsEnabled(firstClaimableRewardEpoch);
    }

    /**
     * @inheritdoc IIFtsoRewardManager
     * @dev Only governance can call this method.
     */
    function deactivate() external override onlyImmediateGovernance {
        active = false;
        emit FtsoRewardManagerDeactivated(address(this));
    }

    /**
     * @inheritdoc IIInflationReceiver
     * @dev Only the `inflation` contract can call this method.
     */
    function setDailyAuthorizedInflation(uint256 _toAuthorizeWei) external override onlyInflation {
        dailyAuthorizedInflation = _toAuthorizeWei;
        totalInflationAuthorizedWei = totalInflationAuthorizedWei.add(_toAuthorizeWei);
        lastInflationAuthorizationReceivedTs = block.timestamp;

        emit DailyAuthorizedInflationSet(_toAuthorizeWei);
    }

    /**
     * @inheritdoc IIInflationReceiver
     * @dev Only the `inflation` contract can call this method.
     */
    function receiveInflation() external payable override mustBalance onlyInflation {
        lastBalance = _handleSelfDestructProceeds();
        totalInflationReceivedWei = totalInflationReceivedWei.add(msg.value);
        // If there are accrued rewards pending to burn, do so...
        _burnUnearnedRewards();

        emit InflationReceived(msg.value);
    }

    /**
     * @inheritdoc IIFtsoRewardManager
     * @dev Only the FTSO Manager can call this method.
     */
    function accrueUnearnedRewards(
        uint256 _epochId,
        uint256 _priceEpochDurationSeconds,
        uint256 _priceEpochEndTime // end time included in epoch
    )
        external override
        onlyFtsoManager
    {
        uint256 totalPriceEpochReward =
            _getTotalPriceEpochRewardWei(_priceEpochDurationSeconds, _priceEpochEndTime);

        totalUnearnedWei = totalUnearnedWei.add(totalPriceEpochReward);

        emit UnearnedRewardsAccrued(_epochId, totalPriceEpochReward);
    }

    /**
     * @inheritdoc IIFtsoRewardManager
     * @dev Only the `ftsoManager` can call this method.
     */
    function distributeRewards(
        address[] memory _addresses,
        uint256[] memory _weights,
        uint256 _totalWeight,
        uint256 _epochId,
        address _ftso,
        uint256 _priceEpochDurationSeconds,
        uint256 _currentRewardEpoch,
        uint256 _priceEpochEndTime, // end time included in epoch
        uint256 _votePowerBlock
    )
        external override
        onlyFtsoManager
    {
        // FTSO manager should never call with bad values.
        assert (_totalWeight != 0 && _addresses.length != 0);
        epochVotePowerBlock[_currentRewardEpoch] = _votePowerBlock;

        uint256 totalPriceEpochReward =
            _getTotalPriceEpochRewardWei(_priceEpochDurationSeconds, _priceEpochEndTime);

        uint256[] memory rewards = new uint256[](_addresses.length);
        rewards[0] = totalPriceEpochReward;
        _weights[0] = _totalWeight;

        uint256 i = _addresses.length - 1;
        while (true) {
            address addr = _addresses[i];
            rewards[i] = rewards[0].mulDiv(_weights[i], _weights[0]);
            UnclaimedRewardState storage state = epochProviderUnclaimedReward[_currentRewardEpoch][addr];
            state.amount += rewards[i].toUint128();
            state.weight = wNat.votePowerOfAt(addr, _votePowerBlock).mul(MAX_BIPS).toUint128();
            epochProviderRewardAmount[_currentRewardEpoch][addr] += rewards[i];
            if (epochProviderVotePowerIgnoringRevocation[_currentRewardEpoch][addr] == 0) {
                epochProviderVotePowerIgnoringRevocation[_currentRewardEpoch][addr] =
                    wNat.votePowerOfAtIgnoringRevocation(addr, _votePowerBlock);
            }

            if (i == 0) {
                break;
            }
            rewards[0] -= rewards[i];
            _weights[0] -= _weights[i];
            i--;
        }

        totalRewardEpochRewards[_currentRewardEpoch] += totalPriceEpochReward;

        // Update total awarded with amount distributed
        totalAwardedWei = totalAwardedWei.add(totalPriceEpochReward);

        emit RewardsDistributed(_ftso, _epochId, _addresses, rewards);
    }

    /**
     * @inheritdoc IFtsoRewardManager
     */
    function setDataProviderFeePercentage(uint256 _feePercentageBIPS) external override returns (uint256) {
        uint256 rewardEpoch =
            dataProviderFee.setDataProviderFeePercentage(_feePercentageBIPS, _getCurrentRewardEpoch());
        emit FeePercentageChanged(msg.sender, _feePercentageBIPS, rewardEpoch);
        return rewardEpoch;
    }

    /**
     * Copy initial reward data from `oldFtsoRewardManager` before starting up this new reward manager.
     * Should be called at the time of switching to the new reward manager, can be called only once, and only
     * by governance.
     */
    function setInitialRewardData() external onlyGovernance {
        require(!active && oldFtsoRewardManager != address(0) &&
            initialRewardEpoch == 0 && nextRewardEpochToExpire == 0, "not initial state");
        initialRewardEpoch = _getCurrentRewardEpoch().add(1); // in order to distinguish from 0
        nextRewardEpochToExpire = ftsoManager.getRewardEpochToExpireNext();
        firstClaimableRewardEpoch = IIFtsoRewardManager(oldFtsoRewardManager).firstClaimableRewardEpoch();
    }

    /**
     * Sets new ftso reward manager which will take over closing expired reward epochs
     * Should be called at the time of switching to the new reward manager, can be called only once, and only
     * by governance.
     */
    function setNewFtsoRewardManager(address _newFtsoRewardManager) external onlyGovernance {
        require(newFtsoRewardManager == address(0), "already set");
        require(_newFtsoRewardManager != address(0), "address zero");
        newFtsoRewardManager = _newFtsoRewardManager;
    }

    /**
     * @inheritdoc IIFtsoRewardManager
     */
    function closeExpiredRewardEpoch(uint256 _rewardEpoch) external override {
        require (msg.sender == address(ftsoManager) || msg.sender == newFtsoRewardManager, "only managers");
        require(nextRewardEpochToExpire == _rewardEpoch, "wrong epoch id");
        if (oldFtsoRewardManager != address(0) && _rewardEpoch < initialRewardEpoch + 50) {
            IIFtsoRewardManager(oldFtsoRewardManager).closeExpiredRewardEpoch(_rewardEpoch);
        }

        uint256 expiredWei = totalRewardEpochRewards[_rewardEpoch] - claimedRewardEpochRewards[_rewardEpoch];
        totalExpiredWei = totalExpiredWei.add(expiredWei);
        emit RewardClaimsExpired(_rewardEpoch);
        nextRewardEpochToExpire = _rewardEpoch + 1;
    }

    /**
     * @inheritdoc IFtsoRewardManager
     */
    function getEpochReward(
        uint256 _rewardEpoch
    )
        external view override
        returns (uint256 _totalReward, uint256 _claimedReward)
    {
        _totalReward = totalRewardEpochRewards[_rewardEpoch];
        _claimedReward = claimedRewardEpochRewards[_rewardEpoch];
    }

    /**
     * @inheritdoc IIInflationReceiver
     */
    function getInflationAddress() external view override returns(address) {
        return inflation;
    }

    /**
     * @inheritdoc IIInflationReceiver
     */
    function getExpectedBalance() external view override returns(uint256) {
        return _getExpectedBalance();
    }

    /**
     * @inheritdoc IFtsoRewardManager
     */
    function getStateOfRewards(
        address _beneficiary,
        uint256 _rewardEpoch
    )
        external view override
        returns (
            address[] memory _dataProviders,
            uint256[] memory _rewardAmounts,
            bool[] memory _claimed,
            bool _claimable
        )
    {
        uint256 currentRewardEpoch = _getCurrentRewardEpoch();
        _claimable = _isRewardClaimable(_rewardEpoch, currentRewardEpoch);
        if (_claimable || (_rewardEpoch == currentRewardEpoch && _rewardEpoch >= firstClaimableRewardEpoch)) {
            RewardState memory rewardState = _getStateOfRewards(_beneficiary, _rewardEpoch, false);
            _dataProviders = rewardState.dataProviders;
            _rewardAmounts = rewardState.amounts;
            _claimed = rewardState.claimed;
        }
    }

    /**
     * @inheritdoc IFtsoRewardManager
     */
    function getStateOfRewardsFromDataProviders(
        address _beneficiary,
        uint256 _rewardEpoch,
        address[] calldata _dataProviders
    )
        external view override
        returns (
            uint256[] memory _rewardAmounts,
            bool[] memory _claimed,
            bool _claimable
        )
    {
        uint256 currentRewardEpoch = _getCurrentRewardEpoch();
        _claimable = _isRewardClaimable(_rewardEpoch, currentRewardEpoch);
        if (_claimable || (_rewardEpoch == currentRewardEpoch && _rewardEpoch >= firstClaimableRewardEpoch)) {
            RewardState memory rewardState = _getStateOfRewardsFromDataProviders(
                _beneficiary,
                _rewardEpoch,
                _dataProviders,
                false
            );
            _rewardAmounts = rewardState.amounts;
            _claimed = rewardState.claimed;
        }
    }

    /**
     * @inheritdoc IFtsoRewardManager
     */
    function getEpochsWithClaimableRewards() external view override
        returns (uint256 _startEpochId, uint256 _endEpochId)
    {
        (_startEpochId, _endEpochId) = _getEpochsWithClaimableRewards();
    }

    /**
     * @inheritdoc IFtsoRewardManager
     */
    function getEpochsWithUnclaimedRewards(address _beneficiary) external view override
        returns (uint256[] memory _epochIds)
    {
        (uint256 startId, uint256 endId) = _getEpochsWithClaimableRewards();
        uint256 count = endId - startId + 1;
        bool[] memory unclaimed = new bool[](count);
        uint256 unclaimedCount = 0;
        for (uint256 i = 0; i < count; i++) {
            RewardState memory rewardState = _getStateOfRewards(_beneficiary, startId + i, true);
            for (uint256 j = 0; j < rewardState.claimed.length; j++) {
                if (!rewardState.claimed[j] && rewardState.amounts[j] > 0) {
                    unclaimed[i] = true;
                    unclaimedCount++;
                    break;
                }
            }
        }
        _epochIds = new uint256[](unclaimedCount);
        uint256 index = 0;
        for (uint256 i = 0; i < count; i++) {
            if (unclaimed[i]) {
                _epochIds[index] = startId + i;
                index++;
            }
        }
    }

    /**
     * @inheritdoc IIFtsoRewardManager
     */
    function getUnclaimedReward(
        uint256 _rewardEpoch,
        address _dataProvider
    )
        external view override
        returns (uint256 _amount, uint256 _weight)
    {
        UnclaimedRewardState storage state = epochProviderUnclaimedReward[_rewardEpoch][_dataProvider];
        _amount = state.amount;
        _weight = state.weight;
    }

    /**
     * @inheritdoc IFtsoRewardManager
     */
    function getDataProviderPerformanceInfo(
        uint256 _rewardEpoch,
        address _dataProvider
    )
        external view override
        returns (uint256 _rewardAmount, uint256 _votePowerIgnoringRevocation)
    {
        _rewardAmount = epochProviderRewardAmount[_rewardEpoch][_dataProvider];
        _votePowerIgnoringRevocation = epochProviderVotePowerIgnoringRevocation[_rewardEpoch][_dataProvider];
    }

    /**
     * @inheritdoc IFtsoRewardManager
     */
    function getClaimedReward(
        uint256 _rewardEpoch,
        address _dataProvider,
        address _claimer
    )
        external view override
        returns(bool _claimed, uint256 _amount)
    {
        _claimed = _isRewardClaimedAnyDelegation(_rewardEpoch, _dataProvider, _claimer);
        _amount = epochProviderClaimerReward[_rewardEpoch][_dataProvider][_claimer].amount;
    }

    /**
     * @inheritdoc IFtsoRewardManager
     */
    function getDataProviderCurrentFeePercentage(address _dataProvider) external view override returns (uint256) {
        return dataProviderFee._getDataProviderFeePercentage(_dataProvider, _getCurrentRewardEpoch());
    }

    /**
     * @inheritdoc IFtsoRewardManager
     */
    function getDataProviderFeePercentage(
        address _dataProvider,
        uint256 _rewardEpoch
    )
        external view override
        returns (uint256 _feePercentageBIPS)
    {
        require(_getInitialRewardEpoch() <= _rewardEpoch &&
            _rewardEpoch <= _getCurrentRewardEpoch().add(dataProviderFee.feePercentageUpdateOffset),
            "invalid reward epoch");
        return dataProviderFee._getDataProviderFeePercentage(_dataProvider, _rewardEpoch);
    }

    /**
     * @inheritdoc IFtsoRewardManager
     */
    function getDataProviderScheduledFeePercentageChanges(
        address _dataProvider
    )
        external view override
        returns (
            uint256[] memory _feePercentageBIPS,
            uint256[] memory _validFromEpoch,
            bool[] memory _fixed
        )
    {
        return dataProviderFee.getDataProviderScheduledFeePercentageChanges(_dataProvider, _getCurrentRewardEpoch());
    }

    /**
     * @inheritdoc IFtsoRewardManager
     */
    function getRewardEpochToExpireNext() external view override returns (uint256) {
        return nextRewardEpochToExpire;
    }

    /**
     * @inheritdoc IITokenPool
     */
    function getTokenPoolSupplyData() external view override
        returns (
            uint256 _lockedFundsWei,
            uint256 _totalInflationAuthorizedWei,
            uint256 _totalClaimedWei
        )
    {
        return (0, totalInflationAuthorizedWei, totalClaimedWei.add(totalBurnedWei));
    }

    /**
     * Returns the amount of reward epoch that need to ellapse before a fee change takes effect.
     */
    function feePercentageUpdateOffset() external view returns (uint256) {
        return dataProviderFee.feePercentageUpdateOffset;
    }

    /**
     * Returns the configured default fee percentage.
     */
    function defaultFeePercentage() external view returns (uint256) {
        return dataProviderFee.defaultFeePercentage;
    }

    /**
     * Returns statistics regarding rewards, accumulated over the whole lifespan of the reward manager contract.
     * @return _totalAwardedWei Rewards that were distributed (wei).
     * @return _totalClaimedWei Distributed rewards that were claimed in time (wei).
     * @return _totalExpiredWei Distributed rewards that were not claimed in time and expired (wei).
     * @return _totalUnearnedWei Rewards that were unearned (due to FTSO being in fallback mode) and thus
     * were not distributed (wei).
     * @return _totalBurnedWei Rewards that were unearned or expired and thus burned (wei).
     * @return _totalInflationAuthorizedWei Total inflation authorized amount (wei).
     * @return _totalInflationReceivedWei Total inflation received amount (wei).
     * @return _lastInflationAuthorizationReceivedTs UNIX timestamp of the last inflation authorization.
     * @return _dailyAuthorizedInflation Inflation authorized amount (wei) at the time of last authorization.
     */
    function getTotals()
        external view
        returns (
            uint256 _totalAwardedWei,
            uint256 _totalClaimedWei,
            uint256 _totalExpiredWei,
            uint256 _totalUnearnedWei,
            uint256 _totalBurnedWei,
            uint256 _totalInflationAuthorizedWei,
            uint256 _totalInflationReceivedWei,
            uint256 _lastInflationAuthorizationReceivedTs,
            uint256 _dailyAuthorizedInflation
        )
    {
        return (
            totalAwardedWei,
            totalClaimedWei,
            totalExpiredWei,
            totalUnearnedWei,
            totalBurnedWei,
            totalInflationAuthorizedWei,
            totalInflationReceivedWei,
            lastInflationAuthorizationReceivedTs,
            dailyAuthorizedInflation
        );
    }

    /**
     * @inheritdoc IFtsoRewardManager
     */
    function getRewardEpochVotePowerBlock(uint256 _rewardEpoch) external view override returns (uint256) {
        return _getRewardEpochVotePowerBlock(_rewardEpoch);
    }

    /**
     * @inheritdoc IFtsoRewardManager
     */
    function getCurrentRewardEpoch() external view override returns (uint256) {
        return _getCurrentRewardEpoch();
    }

    /**
     * @inheritdoc IFtsoRewardManager
     */
    function getInitialRewardEpoch() external view override returns (uint256 _initialRewardEpoch) {
        return _getInitialRewardEpoch();
    }

    /**
     * @inheritdoc IFtsoRewardManager
     */
    function nextClaimableRewardEpoch(address _rewardOwner) external view override returns (uint256) {
        return _nextClaimableEpoch(_rewardOwner, _minClaimableRewardEpoch());
    }

    /**
     * @inheritdoc IIInflationReceiver
     */
    function getContractName() external pure override returns (string memory) {
        return "FtsoRewardManager";
    }

    function _handleSelfDestructProceeds() internal returns (uint256 _expectedBalance) {
        _expectedBalance = lastBalance.add(msg.value);
        uint256 currentBalance = address(this).balance;
        if (currentBalance > _expectedBalance) {
            // Then assume extra were self-destruct proceeds and burn it
            //slither-disable-next-line arbitrary-send-eth
            BURN_ADDRESS.transfer(currentBalance.sub(_expectedBalance));
        } else if (currentBalance < _expectedBalance) {
            // This is a coding error
            assert(false);
        }
    }

    /**
     * Burn rewards if there are any pending to burn, up to the maximum allowable.
     * This is meant to be called once per day, right after inflation is received.
     * There is a max allowable pct to burn so that the contract does not run out
     * of funds for rewarding.
     */
    function _burnUnearnedRewards() internal {
        // Are there any rewards to burn?
        uint256 rewardsToBurnWei = totalUnearnedWei.add(totalExpiredWei).sub(totalBurnedWei);

        if (rewardsToBurnWei > 0) {
            // Calculate max rewards that can be burned
            uint256 maxToBurnWei = address(this).balance.mulDiv(MAX_BURNABLE_PCT, 100);

            uint256 toBurnWei = 0;
            // Calculate what we will burn
            if (rewardsToBurnWei > maxToBurnWei) {
                toBurnWei = maxToBurnWei;
            } else {
                toBurnWei = rewardsToBurnWei;
            }

            // Any to burn?
            if (toBurnWei > 0) {
                // Accumulate what we are about to burn
                totalBurnedWei = totalBurnedWei.add(toBurnWei);

                // Update lastBalance before transfer
                lastBalance = lastBalance.sub(toBurnWei);

                // Burn
                //slither-disable-next-line arbitrary-send-eth
                BURN_ADDRESS.transfer(toBurnWei);

                // Emit event to signal what we did
                emit RewardsBurned(toBurnWei);
            }
        }
    }

    /**
     * Allows a percentage delegator to claim rewards.
     * This function is intended to be used to claim rewards in case of delegation by percentage.
     * @param _recipient            address to transfer funds to
     * @param _rewardEpoch          last reward epoch to claim for
     * @param _wrap                 should reward be wrapped immediately
     * @return _rewardAmount        amount of total claimed rewards
     * @dev Reverts if `msg.sender` is delegating by amount
     */
    function _claimOrWrapReward(
        address _rewardOwner,
        address payable _recipient,
        uint256 _rewardEpoch,
        bool _wrap
    )
        internal
        returns (uint256 _rewardAmount)
    {
        _checkNonzeroRecipient(_recipient);
        _handleSelfDestructProceeds();

        uint256 currentRewardEpoch = _getCurrentRewardEpoch();
        if (_rewardEpoch >= currentRewardEpoch && currentRewardEpoch > 0) {
            _rewardEpoch = currentRewardEpoch - 1;
        }
        if (!_isRewardClaimable(_rewardEpoch, currentRewardEpoch)) {
            return 0;
        }

        _rewardAmount =
            _claimRewardPercentageDelegation(_rewardOwner, _recipient, _rewardEpoch, _minClaimableRewardEpoch());

        _transferOrWrapAndUpdateBalance(_recipient, _rewardAmount, _wrap);
    }

    /**
     * Allows the sender to claim the rewards from specified data providers.
     * This function is intended to be used to claim rewards in case of delegation by amount.
     * @param _recipient            address to transfer funds to
     * @param _rewardEpochs         array of reward epoch numbers to claim for
     * @param _dataProviders        array of addresses representing data providers to claim the reward from
     * @param _wrap                 should reward be wrapped immediately
     * @return _rewardAmount        amount of total claimed rewards
     */
    function _claimOrWrapRewardFromDataProviders(
        address _rewardOwner,
        address payable _recipient,
        uint256[] calldata _rewardEpochs,
        address[] calldata _dataProviders,
        bool _wrap
    )
        internal
        returns (uint256 _rewardAmount)
    {
        _checkNonzeroRecipient(_recipient);
        _handleSelfDestructProceeds();
        require(wNat.delegationModeOf(_rewardOwner) == uint256(Delegatable.DelegationMode.AMOUNT),
            "explicit delegation only");

        uint256 currentRewardEpoch = _getCurrentRewardEpoch();

        for (uint256 i = 0; i < _rewardEpochs.length; i++) {
            if (!_isRewardClaimable(_rewardEpochs[i], currentRewardEpoch)) {
                continue;
            }
            RewardState memory rewardState =
                _getStateOfRewardsFromDataProviders(_rewardOwner, _rewardEpochs[i], _dataProviders, true);
            uint256 amount = _claimReward(_rewardOwner, _recipient, _rewardEpochs[i], rewardState, true);
            claimedRewardEpochRewards[_rewardEpochs[i]] += amount;
            _rewardAmount += amount;
        }

        _transferOrWrapAndUpdateBalance(_recipient, _rewardAmount, _wrap);
    }

    /**
     * Claims `_rewardAmounts` for `_dataProviders`.
     * @dev Internal function that takes care of reward bookkeeping
     * @param _recipient            address representing the recipient of the reward
     * @param _rewardEpoch          reward epoch number
     * @param _rewardState          object holding reward state
     * @param _explicitDelegation   indicates if claiming for explicit or percentage delegation
     * @return Returns the total reward amount.
     */
    function _claimReward(
        address _rewardOwner,
        address _recipient,
        uint256 _rewardEpoch,
        RewardState memory _rewardState,
        bool _explicitDelegation
    )
        internal
        returns (uint256)
    {
        uint256 totalRewardAmount = 0;
        for (uint256 i = 0; i < _rewardState.dataProviders.length; i++) {
            if (_rewardState.claimed[i]) {
                continue;
            }

            address dataProvider = _rewardState.dataProviders[i];
            UnclaimedRewardState storage state =  epochProviderUnclaimedReward[_rewardEpoch][dataProvider];

            uint128 rewardWeight = _rewardState.weights[i].toUint128();
            if (rewardWeight > 0) {
                state.weight -= rewardWeight; // can not underflow
            }

            uint128 rewardAmount = _rewardState.amounts[i].toUint128();
            if (rewardAmount > 0) {
                state.amount -= rewardAmount; // can not underflow
                totalClaimedWei += rewardAmount;
                totalRewardAmount += rewardAmount;
            }

            if (_explicitDelegation) {
                RewardClaim storage rewardClaim = epochProviderClaimerReward[_rewardEpoch][dataProvider][_rewardOwner];
                require (!rewardClaim.claimed, "already claimed");
                rewardClaim.claimed = true;
                rewardClaim.amount = rewardAmount;
            }

            emit RewardClaimed({
                dataProvider: dataProvider,
                whoClaimed: _rewardOwner,
                sentTo: _recipient,
                rewardEpoch: _rewardEpoch,
                amount: rewardAmount
            });
        }

        return totalRewardAmount;
    }

    function _claimRewardPercentageDelegation(
        address _rewardOwner,
        address _recipient,
        uint256 _rewardEpoch,
        uint256 _minClaimableEpoch
    )
        internal
        returns (uint256 _rewardAmount)
    {
        for (uint256 epoch = _nextClaimableEpoch(_rewardOwner, _minClaimableEpoch); epoch <= _rewardEpoch; epoch++) {
            RewardState memory rewardState = _getStateOfRewards(_rewardOwner, epoch, true);
            uint256 amount = _claimReward(_rewardOwner, _recipient, epoch, rewardState, false);
            claimedRewardEpochRewards[epoch] += amount;
            _rewardAmount += amount;
        }
        if (claimerNextClaimableEpoch[_rewardOwner] < _rewardEpoch + 1) {
            claimerNextClaimableEpoch[_rewardOwner] = _rewardEpoch + 1;
        }
    }

    /**
     * Transfers or wrap (deposit) `_rewardAmount` to `_recipient` and updates last balance.
     * @param _recipient            address representing the reward recipient
     * @param _rewardAmount         number representing the amount to transfer
     * @param _wrap                 should reward be wrapped immediately
     * @dev Uses low level call to transfer funds.
     */
    function _transferOrWrapAndUpdateBalance(address _recipient, uint256 _rewardAmount, bool _wrap) internal {
        if (_rewardAmount > 0) {
            if (_wrap) {
                // transfer total amount (state is updated and events are emitted in _claimReward)
                //slither-disable-next-line arbitrary-send-eth          // amount always calculated by _claimReward
                wNat.depositTo{value: _rewardAmount}(_recipient);
            } else {
                // transfer total amount (state is updated and events are emitted in _claimReward)
                /* solhint-disable avoid-low-level-calls */
                //slither-disable-next-line arbitrary-send-eth          // amount always calculated by _claimReward
                (bool success, ) = _recipient.call{value: _rewardAmount}("");
                /* solhint-enable avoid-low-level-calls */
                require(success, "claim failed");
            }
        }

        //slither-disable-next-line reentrancy-eth      // guarded by nonReentrant
        lastBalance = address(this).balance;
    }

    /**
     * Implementation of the AddressUpdatable abstract method.
     */
    function _updateContractAddresses(
        bytes32[] memory _contractNameHashes,
        address[] memory _contractAddresses
    )
        internal override
    {
        inflation = _getContractAddress(_contractNameHashes, _contractAddresses, "Inflation");
        ftsoManager = IIFtsoManager(_getContractAddress(_contractNameHashes, _contractAddresses, "FtsoManager"));
        wNat = WNat(payable(_getContractAddress(_contractNameHashes, _contractAddresses, "WNat")));
        claimSetupManager = IIClaimSetupManager(
            _getContractAddress(_contractNameHashes, _contractAddresses, "ClaimSetupManager"));
    }

    /**
     * Return initial reward epoch number
     * @return _initialRewardEpoch Initial reward epoch number.
     */
    function _getInitialRewardEpoch() internal view returns (uint256 _initialRewardEpoch) {
        (, _initialRewardEpoch) = initialRewardEpoch.trySub(1);
    }

    /**
     * Return current reward epoch number
     */
    function _getCurrentRewardEpoch() internal view returns (uint256) {
        return ftsoManager.getCurrentRewardEpoch();
    }

    /**
     * Return reward epoch vote power block
     * @param _rewardEpoch          reward epoch number
     */
    function _getRewardEpochVotePowerBlock(uint256 _rewardEpoch) internal view returns (uint256 _votePowerBlock) {
        _votePowerBlock = epochVotePowerBlock[_rewardEpoch];
        if (_votePowerBlock == 0) {
            _votePowerBlock = ftsoManager.getRewardEpochVotePowerBlock(_rewardEpoch);
        }
    }

    function _getDistributableFtsoInflationBalance() internal view returns (uint256) {
        return totalInflationAuthorizedWei
            .sub(totalAwardedWei)
            .sub(totalUnearnedWei);
    }

    function _getRemainingPriceEpochCount(
        uint256 _fromThisTs,
        uint256 _priceEpochDurationSeconds
    )
        internal view
        returns (uint256)
    {
        // Get the end of the daily period
        uint256 dailyPeriodEndTs = lastInflationAuthorizationReceivedTs.add(ALMOST_FULL_DAY_SEC);
        require(_fromThisTs <= dailyPeriodEndTs, "after daily cycle");
        return dailyPeriodEndTs.sub(_fromThisTs).div(_priceEpochDurationSeconds) + 1;
    }

    /**
     * Returns the reward to distribute for a given price epoch.
     * @param _priceEpochDurationSeconds    Number of seconds for a price epoch.
     * @param _priceEpochEndTime            Datetime stamp of the end of the price epoch
     * @return                              Price epoch reward in wei
     * @dev Based on a daily distribution and period.
     */
    function _getTotalPriceEpochRewardWei(
        uint256 _priceEpochDurationSeconds,
        uint256 _priceEpochEndTime // end time included in epoch
    )
        internal view
        returns (uint256)
    {
        return
            _getDistributableFtsoInflationBalance()
            .div(_getRemainingPriceEpochCount(_priceEpochEndTime, _priceEpochDurationSeconds));
    }

    /**
     * Returns the state of rewards for `_beneficiary` at `_rewardEpoch`.
     * @dev Internal function
     * @param _beneficiary          address of reward beneficiary
     * @param _rewardEpoch          reward epoch number
     * @param _zeroForClaimed       boolean value that enables skipping amount computation for claimed rewards
     * @return _rewardState         object holding reward state
     * @dev Reverts when queried with `_beneficiary` delegating by amount.
     */
    function _getStateOfRewards(
        address _beneficiary,
        uint256 _rewardEpoch,
        bool _zeroForClaimed
    )
        internal view
        returns (RewardState memory _rewardState)
    {
        uint256 votePowerBlock = _getRewardEpochVotePowerBlock(_rewardEpoch);
        // setup for data provider reward
        bool includeDataProviderInfo;
        uint256 dataProviderRewardWeight;
        RewardClaim memory dataProviderReward;
        if (_isRewardClaimedPercentageDelegation(_rewardEpoch, _beneficiary)) {
            return _rewardState;
        }

        if (epochProviderRewardAmount[_rewardEpoch][_beneficiary] != 0 || !_zeroForClaimed) {
            // _beneficiary is data provider with rewards
            dataProviderRewardWeight = _getRewardWeightForDataProvider(
                _beneficiary,
                _rewardEpoch,
                votePowerBlock
            );
            dataProviderReward.amount = _getRewardAmount(
                _rewardEpoch,
                _beneficiary,
                dataProviderRewardWeight
            );
            // flag if data is to be included
            includeDataProviderInfo = dataProviderReward.amount > 0;
        }

        // setup for delegation rewards
        address[] memory delegates;
        uint256[] memory bips;
        (delegates, bips, , ) = wNat.delegatesOfAt(_beneficiary, votePowerBlock);

        // reward state setup
        _rewardState.dataProviders = new address[]((includeDataProviderInfo ? 1 : 0) + delegates.length);
        _rewardState.weights = new uint256[](_rewardState.dataProviders.length);
        _rewardState.amounts = new uint256[](_rewardState.dataProviders.length);
        _rewardState.claimed = new bool[](_rewardState.dataProviders.length);

        // data provider reward
        if (includeDataProviderInfo) {
            _rewardState.dataProviders[0] = _beneficiary;
            _rewardState.weights[0] = dataProviderRewardWeight;
            _rewardState.amounts[0] = dataProviderReward.amount;
        }

        // delegation rewards
        if (delegates.length > 0) {
            uint256 delegatorBalance = wNat.balanceOfAt(_beneficiary, votePowerBlock);
            for (uint256 i = 0; i < delegates.length; i++) {
                uint256 p = (includeDataProviderInfo ? 1 : 0) + i;
                _rewardState.dataProviders[p] = delegates[i];
                _rewardState.weights[p] = _getRewardWeightForDelegator(
                    delegates[i],
                    delegatorBalance.mulDiv(bips[i], MAX_BIPS),
                    _rewardEpoch
                );
                _rewardState.amounts[p] = _getRewardAmount(
                    _rewardEpoch,
                    delegates[i],
                    _rewardState.weights[p]
                );
            }
        }
    }

    /**
     * Returns the state of rewards for `_beneficiary` at `_rewardEpoch` from `_dataProviders`
     * @param _beneficiary          address of reward beneficiary
     * @param _rewardEpoch          reward epoch number
     * @param _dataProviders        positional array of addresses representing data providers
     * @param _zeroForClaimed       boolean value that enables skipping amount computation for claimed rewards
     * @return _rewardState         object holding reward state
     */
    function _getStateOfRewardsFromDataProviders(
        address _beneficiary,
        uint256 _rewardEpoch,
        address[] calldata _dataProviders,
        bool _zeroForClaimed
    )
        internal view
        returns (RewardState memory _rewardState)
    {
        uint256 votePowerBlock = _getRewardEpochVotePowerBlock(_rewardEpoch);

        uint256 count = _dataProviders.length;
        _rewardState.dataProviders = _dataProviders;
        _rewardState.weights = new uint256[](count);
        _rewardState.amounts = new uint256[](count);
        _rewardState.claimed = new bool[](count);

        for (uint256 i = 0; i < count; i++) {
            _rewardState.claimed[i] =
                _isRewardClaimedAnyDelegation(_rewardEpoch, _dataProviders[i], _beneficiary);
            if (_rewardState.claimed[i]) {
                if (!_zeroForClaimed) {
                    // weight is irrelevant
                    _rewardState.amounts[i] =
                        epochProviderClaimerReward[_rewardEpoch][_dataProviders[i]][_beneficiary].amount;
                }
                continue;
            }

            if (_dataProviders[i] == _beneficiary) {
                _rewardState.weights[i] = _getRewardWeightForDataProvider(
                    _beneficiary,
                    _rewardEpoch,
                    votePowerBlock
                );
            } else {
                uint256 delegatedVotePower = wNat.votePowerFromToAt(_beneficiary, _dataProviders[i], votePowerBlock);
                _rewardState.weights[i] = _getRewardWeightForDelegator(
                    _dataProviders[i],
                    delegatedVotePower,
                    _rewardEpoch
                );
            }
            _rewardState.amounts[i] = _getRewardAmount(
                _rewardEpoch,
                _dataProviders[i],
                _rewardState.weights[i]
            );
        }
    }

    /**
     * Reports if rewards for `_rewardEpoch` are claimable.
     * @param _rewardEpoch          reward epoch number
     * @param _currentRewardEpoch   number of the current reward epoch
     */
    function _isRewardClaimable(uint256 _rewardEpoch, uint256 _currentRewardEpoch) internal view returns (bool) {
        return _rewardEpoch >= firstClaimableRewardEpoch &&
               _rewardEpoch >= nextRewardEpochToExpire &&
               _rewardEpoch < _currentRewardEpoch;
    }

    function _nextClaimableEpoch(address _claimer, uint256 _minClaimableEpoch) internal view returns (uint256) {
        return Math.max(claimerNextClaimableEpoch[_claimer], _minClaimableEpoch);
    }

    function _minClaimableRewardEpoch() internal view returns (uint256) {
        return Math.max(firstClaimableRewardEpoch, Math.max(_getInitialRewardEpoch(), nextRewardEpochToExpire));
    }

    /**
     * Returns the start and the end of the reward epoch range for which the reward is claimable
     * @return _startEpochId        the oldest epoch id that allows reward claiming
     * @return _endEpochId          the newest epoch id that allows reward claiming
     */
    function _getEpochsWithClaimableRewards() internal view
        returns (
            uint256 _startEpochId,
            uint256 _endEpochId
        )
    {
        _startEpochId = nextRewardEpochToExpire;
        uint256 currentRewardEpochId = _getCurrentRewardEpoch();
        require(currentRewardEpochId > 0, "no epoch with claimable rewards");
        _endEpochId = currentRewardEpochId - 1;
    }

    /**
     * Reports if reward at `_rewardEpoch` has already been claimed by `_claimer`.
     * @param _rewardEpoch          reward epoch number
     * @param _claimer              address representing a reward claimer
     */
    function _isRewardClaimedPercentageDelegation(
        uint256 _rewardEpoch,
        address _claimer
    )
        internal view
        returns (bool)
    {
        return claimerNextClaimableEpoch[_claimer] > _rewardEpoch;
    }

    /**
     * Reports if reward at `_rewardEpoch` for `_dataProvider` has already been claimed by `_claimer`.
     * @param _rewardEpoch          reward epoch number
     * @param _dataProvider         address representing a data provider
     * @param _claimer              address representing a reward claimer
     */
    function _isRewardClaimedAnyDelegation(
        uint256 _rewardEpoch,
        address _dataProvider,
        address _claimer
    )
        internal view
        returns (bool)
    {
        return epochProviderClaimerReward[_rewardEpoch][_dataProvider][_claimer].claimed ||
            _isRewardClaimedPercentageDelegation(_rewardEpoch, _claimer);
    }

    /**
     * Returns the reward amount for `_dataProvider` at `_rewardEpoch`
     * @param _rewardEpoch          reward epoch number
     * @param _dataProvider         address representing a data provider
     * @param _rewardWeight         number representing reward weight
     */
    function _getRewardAmount(
        uint256 _rewardEpoch,
        address _dataProvider,
        uint256 _rewardWeight
    )
        internal view
        returns (uint128)
    {
        if (_rewardWeight == 0) {
            return 0;
        }

        UnclaimedRewardState storage state = epochProviderUnclaimedReward[_rewardEpoch][_dataProvider];
        uint128 unclaimedRewardAmount = state.amount;
        if (unclaimedRewardAmount == 0) {
            return 0;
        }
        uint128 unclaimedRewardWeight = state.weight;
        if (_rewardWeight == unclaimedRewardWeight) {
            return unclaimedRewardAmount;
        }
        assert(_rewardWeight < unclaimedRewardWeight);
        return uint256(unclaimedRewardAmount).mulDiv(_rewardWeight, unclaimedRewardWeight).toUint128();
    }

    /**
     * Returns reward weight for `_dataProvider` at `_rewardEpoch`
     * @param _dataProvider         address representing a data provider
     * @param _rewardEpoch          reward epoch number
     * @param _votePowerBlock       block number used to determine the vote power for reward computation
     */
    function _getRewardWeightForDataProvider(
        address _dataProvider,
        uint256 _rewardEpoch,
        uint256 _votePowerBlock
    )
        internal view
        returns (uint256)
    {
        uint256 dataProviderVotePower = wNat.undelegatedVotePowerOfAt(_dataProvider, _votePowerBlock);
        uint256 votePower = wNat.votePowerOfAt(_dataProvider, _votePowerBlock);

        if (dataProviderVotePower == votePower) {
            // shortcut, but also handles (unlikely) zero vote power case
            return votePower.mul(MAX_BIPS);
        }
        assert(votePower > dataProviderVotePower);

        uint256 rewardWeight = 0;

        // weight share based on data provider undelegated vote power
        if (dataProviderVotePower > 0) {
            rewardWeight += dataProviderVotePower.mul(MAX_BIPS);
        }

        // weight share based on data provider fee
        uint256 feePercentageBIPS = dataProviderFee._getDataProviderFeePercentage(_dataProvider, _rewardEpoch);
        if (feePercentageBIPS > 0) {
            rewardWeight += (votePower - dataProviderVotePower).mul(feePercentageBIPS);
        }

        return rewardWeight;
    }

    /**
     * Returns reward weight at `_rewardEpoch` for delegator delegating `_delegatedVotePower` to `_delegate`.
     * @param _delegate             address representing a delegate (data provider)
     * @param _delegatedVotePower   number representing vote power delegated by delegator
     * @param _rewardEpoch          reward epoch number
     */
    function _getRewardWeightForDelegator(
        address _delegate,
        uint256 _delegatedVotePower,
        uint256 _rewardEpoch
    )
        internal view
        returns (uint256)
    {
        if (_delegatedVotePower == 0) {
            return 0;
        }

        uint256 rewardWeight = 0;

        // reward weight determined by vote power share
        uint256 feePercentageBIPS = dataProviderFee._getDataProviderFeePercentage(_delegate, _rewardEpoch);
        if (feePercentageBIPS < MAX_BIPS) {
            rewardWeight += _delegatedVotePower.mul(MAX_BIPS - feePercentageBIPS);
        }

        return rewardWeight;
    }

    function _getExpectedBalance() private view returns(uint256 _balanceExpectedWei) {
        return totalInflationReceivedWei
            .sub(totalClaimedWei)
            .sub(totalBurnedWei);
    }

    function _checkExecutorAndAllowedRecipient(address _rewardOwner, address _recipient) private view {
        if (msg.sender == _rewardOwner) {
            return;
        }
        claimSetupManager.checkExecutorAndAllowedRecipient(msg.sender, _rewardOwner, _recipient);
    }

    function _checkMustBalance() private view {
        require(address(this).balance == _getExpectedBalance(), "out of balance");
    }

    function _checkOnlyFtsoManager() private view {
        require (msg.sender == address(ftsoManager), "ftso manager only");
    }

    function _checkOnlyActive() private view {
        require(active, "reward manager deactivated");
    }

    function _checkOnlyInflation() private view {
        require(msg.sender == inflation, "inflation only");
    }

    function _checkNonzeroRecipient(address _address) private pure {
        require(_address != address(0), "recipient zero");
    }
}
