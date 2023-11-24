// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

/**
 * Interface for the `FtsoRewardManager` contract.
 */
interface IFtsoRewardManager {

    /**
     * Emitted when a data provider claims its FTSO rewards.
     * @param dataProvider Address of the data provider that accrued the reward.
     * @param whoClaimed Address that actually performed the claim.
     * @param sentTo Address that received the reward.
     * @param rewardEpoch ID of the reward epoch where the reward was accrued.
     * @param amount Amount of rewarded native tokens (wei).
     */
    event RewardClaimed(
        address indexed dataProvider,
        address indexed whoClaimed,
        address indexed sentTo,
        uint256 rewardEpoch,
        uint256 amount
    );

    /**
     * Emitted when rewards cannot be distributed during a reward epoch
     * (for example, because the FTSO went into fallback mode) and they are accrued
     * for later burning.
     * @param epochId ID of the reward epoch where the reward was accrued.
     * @param reward Total amount of accrued rewards (wei).
     */
    event UnearnedRewardsAccrued(
        uint256 epochId,
        uint256 reward
    );

    /**
     * Emitted every price epoch, when rewards have been distributed to each contributing data provider.
     * Note that rewards are not claimable until the reward epoch finishes.
     * @param ftso Address of the FTSO that generated the rewards.
     * @param epochId ID of the reward epoch where the rewards were accrued.
     * @param addresses Data provider addresses that have rewards to claim.
     * @param rewards Amounts available for claiming (wei).
     */
    event RewardsDistributed(
        address indexed ftso,
        uint256 epochId,
        address[] addresses,
        uint256[] rewards
    );

    /**
     * Emitted when reward claims have been enabled.
     * @param rewardEpochId First claimable reward epoch.
     */
    event RewardClaimsEnabled(
        uint256 rewardEpochId
    );

    /**
     * Emitted when a data provider changes its fee.
     * @param dataProvider Address of the data provider.
     * @param value New fee, in BIPS.
     * @param validFromEpoch Epoch ID where the new fee takes effect.
     */
    event FeePercentageChanged(
        address indexed dataProvider,
        uint256 value,
        uint256 validFromEpoch
    );

    /**
     * Unclaimed rewards have expired and are now inaccessible.
     *
     * `getUnclaimedReward()` can be used to retrieve more information.
     * @param rewardEpochId ID of the reward epoch that has just expired.
     */
    event RewardClaimsExpired(
        uint256 rewardEpochId
    );

    /**
     * Emitted when the reward manager contract is activated.
     * @param ftsoRewardManager The reward manager contract.
     */
    event FtsoRewardManagerActivated(address ftsoRewardManager);

    /**
     * Emitted when the reward manager contract is deactivated.
     * @param ftsoRewardManager The reward manager contract.
     */
    event FtsoRewardManagerDeactivated(address ftsoRewardManager);

    /**
     * Allows a percentage delegator to claim rewards.
     * This function is intended to be used to claim rewards in case of delegation by percentage.
     *
     * **This function is deprecated**: use `claim` instead.
     *
     * Reverts if `msg.sender` is delegating by amount.
     * Claims for all unclaimed reward epochs to the 'max(_rewardEpochs)'.
     * Retained for backward compatibility.
     * @param _recipient Address to transfer funds to.
     * @param _rewardEpochs Array of reward epoch numbers to claim for.
     * @return _rewardAmount Amount of total claimed rewards (wei).
     */
    function claimReward(
        address payable _recipient,
        uint256[] calldata _rewardEpochs
    )
        external returns (uint256 _rewardAmount);

    /**
     * Allows the caller to claim rewards for a reward owner.
     * The caller does not have to be the owner of the rewards, but must be approved by the owner to claim on his
     * behalf by using `setClaimExecutors` on the `claimSetupManager`.
     *
     * This function is intended to be used to claim rewards in case of delegation by percentage.
     * Reverts if `msg.sender` is delegating by amount.
     *
     * Anybody can call this method, but rewards can only be sent to the reward owner, therefore no funds can be
     * stolen. However, by limiting the authorized callers, the owner can control the timing of the calls.
     *
     * When the reward owner is the caller, rewards can be sent to any recipient set by `setAllowedClaimRecipients` on
     * the `claimSetupManager`.
     * The reward owner's [Personal Delegation Account](https://docs.flare.network/tech/personal-delegation-account)
     * is always an authorized recipient.
     * @param _rewardOwner Address of the reward owner.
     * @param _recipient Address to transfer claimed rewards to.
     * @param _rewardEpoch Last reward epoch to claim for.
     * All previous epochs with pending rewards will be claimed too.
     * @param _wrap Whether claimed rewards should be wrapped through the `WNat` contract before transferring them
     * to the `_recipient`. This parameter is offered as a convenience.
     * @return _rewardAmount Total amount of claimed rewards (wei).
     */
    function claim(
        address _rewardOwner,
        address payable _recipient,
        uint256 _rewardEpoch,
        bool _wrap
    )
        external returns (uint256 _rewardAmount);

    /**
     * Allows the caller to claim rewards from specific data providers.
     * This function is intended to be used to claim rewards in case of delegation by amount.
     *
     * **This function is deprecated**: use `claimFromDataProviders` instead.
     * @param _recipient Address to transfer funds to.
     * @param _rewardEpochs Array of reward epoch numbers to claim for.
     * @param _dataProviders Array of addresses of the data providers to claim the reward from.
     * @return _rewardAmount Total amount of claimed rewards (wei).
     */
    function claimRewardFromDataProviders(
        address payable _recipient,
        uint256[] calldata _rewardEpochs,
        address[] calldata _dataProviders
    )
        external returns (uint256 _rewardAmount);

    /**
     * Allows the caller to claim rewards for a reward owner from specific data providers.
     * The caller does not have to be the owner of the rewards, but must be approved by the owner to claim on his
     * behalf by using `setClaimExecutors` on the `claimSetupManager`.
     *
     * This function is intended to be used to claim rewards in case of delegation by amount (explicit delegation).
     * Reverts if `msg.sender` is delegating by percentage.
     *
     * Anybody can call this method, but rewards can only be sent to the reward owner, therefore no funds can be
     * stolen. However, by limiting the authorized callers, the owner can control the timing of the calls.
     *
     * When the reward owner is the caller, rewards can be sent to any recipient set by `setAllowedClaimRecipients` on
     * the `claimSetupManager`.
     * The reward owner's [Personal Delegation Account](https://docs.flare.network/tech/personal-delegation-account)
     * is always an authorized recipient.
     * @param _rewardOwner Address of the reward owner.
     * @param _recipient Address to transfer claimed rewards to.
     * @param _rewardEpochs Array of reward epoch IDs to claim for.
     * @param _dataProviders Array of addresses of the data providers to claim the reward from.
     * @param _wrap Whether claimed rewards should be wrapped through the `WNat` contract before transferring them
     * to the `_recipient`. This parameter is offered as a convenience.
     * @return _rewardAmount Total amount of claimed rewards (wei).
     */
    function claimFromDataProviders(
        address _rewardOwner,
        address payable _recipient,
        uint256[] calldata _rewardEpochs,
        address[] calldata _dataProviders,
        bool _wrap
    )
        external returns (uint256 _rewardAmount);

    /**
     * Allows claiming rewards simultaneously for a list of reward owners and all unclaimed epochs before the
     * specified one.
     *
     * This is meant as a convenience all-in-one reward claiming method to be used both by reward owners and
     * [registered executors](https://docs.flare.network/tech/automatic-claiming/#registered-claiming-process).
     * It performs a series of operations, besides claiming rewards:
     *
     * * If a reward owner has enabled its
     * [Personal Delegation Account](https://docs.flare.network/tech/personal-delegation-account), rewards are also
     * claimed for the PDA and the total claimed amount is sent to that PDA.
     * Otherwise, the claimed amount is sent to the reward owner's account.
     *
     * * Claimed amount is automatically wrapped through the `WNat` contract.
     *
     * * If the caller is a registered executor with a non-zero fee, the fee is paid to the executor for each claimed
     * address.
     * @param _rewardOwners List of reward owners to claim for.
     * @param _rewardEpoch Last reward epoch ID to claim for.
     * All previous epochs with pending rewards will be claimed too.
     */
    function autoClaim(address[] calldata _rewardOwners, uint256 _rewardEpoch) external;

    /**
     * Sets the [fee](https://docs.flare.network/tech/ftso/#rewards) a data provider keeps from all delegations.
     *
     * Takes effect after `feeValueUpdateOffset` reward epochs have elapsed.
     *
     * When called multiple times inside the same reward epoch, only the last value remains.
     * @param _feePercentageBIPS Fee percentage in BIPS.
     * @return _validFromEpoch Reward epoch number when the new fee percentage will become effective.
     */
    function setDataProviderFeePercentage(uint256 _feePercentageBIPS)
        external returns (uint256 _validFromEpoch);

    /**
     * Whether rewards can be claimed from this reward manager.
     */
    function active() external view returns (bool);

    /**
     * Returns the current [fee](https://docs.flare.network/tech/ftso/#rewards) percentage of a data provider.
     * @param _dataProvider Address of the queried data provider.
     * @return _feePercentageBIPS Fee percentage in BIPS.
     */
    function getDataProviderCurrentFeePercentage(address _dataProvider)
        external view returns (uint256 _feePercentageBIPS);

    /**
     * Returns the [fee](https://docs.flare.network/tech/ftso/#rewards) percentage of a data provider at a
     * given reward epoch.
     * @param _dataProvider Address of the queried data provider.
     * @param _rewardEpoch Reward epoch ID.
     * @return _feePercentageBIPS Fee percentage in BIPS.
     */
    function getDataProviderFeePercentage(
        address _dataProvider,
        uint256 _rewardEpoch
    )
        external view
        returns (uint256 _feePercentageBIPS);

    /**
     * Returns the scheduled [fee](https://docs.flare.network/tech/ftso/#rewards) percentage changes for a data
     * provider.
     * @param _dataProvider Address of the queried data provider.
     * @return _feePercentageBIPS Array of fee percentages in BIPS.
     * @return _validFromEpoch Array of block numbers from which the fee settings are effective.
     * @return _fixed Array of boolean values indicating whether settings are subject to change or not.
     */
    function getDataProviderScheduledFeePercentageChanges(address _dataProvider) external view
        returns (
            uint256[] memory _feePercentageBIPS,
            uint256[] memory _validFromEpoch,
            bool[] memory _fixed
        );

    /**
     * Returns information on an epoch's rewards.
     * @param _rewardEpoch Reward epoch ID.
     * @return _totalReward Total amount of rewards accrued on that epoch, in wei.
     * @return _claimedReward Total amount of rewards that have already been claimed, in wei.
     */
    function getEpochReward(uint256 _rewardEpoch) external view
        returns (uint256 _totalReward, uint256 _claimedReward);

    /**
     * Returns the state of rewards for a given address at a specific reward epoch.
     * @param _beneficiary Address of the beneficiary to query.
     * It can be a data provider or a delegator, for example.
     *
     * Reverts if the queried address is delegating by amount.
     * @param _rewardEpoch Reward epoch ID to query.
     * @return _dataProviders Array of addresses of data providers.
     * @return _rewardAmounts Array of reward amounts received from each provider, in wei.
     * @return _claimed Array of boolean values indicating whether each reward has been claimed or not.
     * @return _claimable Boolean value indicating whether rewards are claimable or not.
     */
    function getStateOfRewards(
        address _beneficiary,
        uint256 _rewardEpoch
    )
        external view
        returns (
            address[] memory _dataProviders,
            uint256[] memory _rewardAmounts,
            bool[] memory _claimed,
            bool _claimable
        );

    /**
     * Returns the state of rewards for a given address coming from a specific set of data providers, at a specific
     * reward epoch.
     * @param _beneficiary Address of beneficiary to query.
     * @param _rewardEpoch Reward epoch ID to query.
     * @param _dataProviders Array of addresses of the data providers to query.
     * @return _rewardAmounts Array of reward amounts received from each provider, in wei.
     * @return _claimed Array of boolean values indicating whether each reward has been claimed or not.
     * @return _claimable Boolean value indicating whether rewards are claimable or not.
     */
    function getStateOfRewardsFromDataProviders(
        address _beneficiary,
        uint256 _rewardEpoch,
        address[] calldata _dataProviders
    )
        external view
        returns (
            uint256[] memory _rewardAmounts,
            bool[] memory _claimed,
            bool _claimable
        );

    /**
     * Returns the reward epoch range for which rewards can be claimed.
     * Rewards outside this range are unclaimable, either because they have expired or because the reward epoch is
     * still ongoing.
     * @return _startEpochId The oldest epoch ID that allows reward claiming.
     * @return _endEpochId The newest epoch ID that allows reward claiming.
     */
    function getEpochsWithClaimableRewards() external view
        returns (
            uint256 _startEpochId,
            uint256 _endEpochId
        );

    /**
     * Returns the next claimable reward epoch for a reward owner.
     * @param _rewardOwner Address of the reward owner to query.
     */
    function nextClaimableRewardEpoch(address _rewardOwner) external view returns (uint256);

    /**
     * Returns the array of claimable epoch IDs for which the rewards of a reward owner have not yet been claimed.
     * @param _beneficiary Address of the reward owner to query.
     * Reverts if it uses delegation by amount.
     * @return _epochIds Array of epoch IDs.
     */
    function getEpochsWithUnclaimedRewards(address _beneficiary) external view returns (
        uint256[] memory _epochIds
    );

    /**
     * Returns information on the rewards accrued by a reward owner from a specific data provider at a specific
     * reward epoch.
     * @param _rewardEpoch Reward epoch ID to query.
     * @param _dataProvider Address of the data provider to query.
     * @param _claimer Address of the reward owner to query.
     * @return _claimed Whether the reward has been claimed or not.
     * @return _amount Accrued amount in wei.
     */
    function getClaimedReward(
        uint256 _rewardEpoch,
        address _dataProvider,
        address _claimer
    )
        external view
        returns (
            bool _claimed,
            uint256 _amount
        );

    /**
     * Returns the reward epoch that will expire next once a new reward epoch starts.
     */
    function getRewardEpochToExpireNext() external view returns (uint256);

    /**
     * Returns the [vote power block](https://docs.flare.network/tech/ftso/#vote-power) of a given reward epoch.
     * @param _rewardEpoch Reward epoch ID.
     */
    function getRewardEpochVotePowerBlock(uint256 _rewardEpoch) external view returns (uint256);

    /**
     * Returns the current reward epoch ID.
     */
    function getCurrentRewardEpoch() external view returns (uint256);

    /**
     * Returns the initial reward epoch ID for this reward manager contract.
     * This corresponds to the oldest reward epoch with claimable rewards in the previous reward manager when this
     * one took over.
     * Set by governance through `setInitialRewardData`.
     */
    function getInitialRewardEpoch() external view returns (uint256);

    /**
     * Returns information on rewards and vote power of a data provider at a given reward epoch.
     * @param _rewardEpoch Reward epoch ID.
     * @param _dataProvider Address of the data provider to query.
     * @return _rewardAmount Amount of rewards (wei).
     * @return _votePowerIgnoringRevocation Vote power, not including revocations.
     */
    function getDataProviderPerformanceInfo(
        uint256 _rewardEpoch,
        address _dataProvider
    )
        external view
        returns (
            uint256 _rewardAmount,
            uint256 _votePowerIgnoringRevocation
        );
}
