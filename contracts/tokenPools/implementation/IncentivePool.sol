// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import  "../../genesis/implementation/FlareDaemon.sol";
import "../../genesis/interface/IFlareDaemonize.sol";
import "../../utils/implementation/GovernedAndFlareDaemonized.sol";
import "../../addressUpdater/implementation/AddressUpdatable.sol";
import "../lib/IncentivePoolTimeSlots.sol";
import "../lib/IncentivePoolRewardServices.sol";
import "../interface/IIIncentivePoolAllocation.sol";
import "../../inflation/interface/IISupply.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "../../utils/implementation/SafePct.sol";
import "../interface/IITokenPool.sol";
import "../../genesis/implementation/IncentivePoolTreasury.sol";

/**
 * @title Incentive pool
 * @notice A contract to manage the process of recognizing, authorizing and funding
 *   native tokens for Flare services that are rewardable by incentive.
 **/
contract IncentivePool is GovernedAndFlareDaemonized, IFlareDaemonize, IITokenPool, AddressUpdatable {
    using IncentivePoolTimeSlots for IncentivePoolTimeSlots.IncentivePoolTimeSlotsState;
    using IncentivePoolTimeSlots for IncentivePoolTimeSlots.IncentivePoolTimeSlot;
    using IncentivePoolRewardServices for IncentivePoolRewardServices.IncentivePoolRewardServicesState;
    using SafeMath for uint256;
    using SafePct for uint256;

    // Composable contracts
    IncentivePoolTreasury public immutable treasury;
    IIIncentivePoolAllocation public incentivePoolAllocation;
    IISupply public supply;

    // Indicates if contract is no longer active
    bool public stopped;

    // Collection of time slots and reward services
    IncentivePoolTimeSlots.IncentivePoolTimeSlotsState private incentivePoolTimeSlots;
    IncentivePoolRewardServices.IncentivePoolRewardServicesState private rewardServices;

    // Balances
    uint256 private totalRecognizedIncentiveWei;
    uint256 private totalAuthorizedIncentiveWei;
    uint256 private totalIncentiveTopupRequestedWei;
    uint256 private totalIncentiveTopupDistributedWei;

    // Instance vars
    uint256 public lastAuthorizationTs;                         // The last time incentive was authorized
    mapping(IIIncentivePoolReceiver => TopupConfiguration)
        internal topupConfigurations;                           // A topup configuration for a contract
                                                                //   receiving incentive.
    uint256 public immutable rewardEpochStartTs;                // Do not start incentive pool time slots before this
    uint256 public rewardEpochStartedTs;                        // When the first reward epoch was started

    // Constants
    string internal constant ERR_IS_ZERO = "address is 0";
    string internal constant ERR_TOPUP_LOW = "topup low";
    string internal constant ERR_GET_TIME_SLOT_PERCENT = "unknown error. getTimeSlotPercentageBips";
    string internal constant ERR_TREASURY_ONLY = "treasury only";

    uint256 internal constant BIPS100 = 1e4;                            // 100% in basis points
    uint256 internal constant DEFAULT_TOPUP_FACTOR_X100 = 120;
    uint256 internal constant AUTHORIZE_TIME_FRAME_SEC = 1 days;

    event IncentiveAuthorized(uint256 amountWei);
    event TopupRequested(uint256 amountWei);
    event IncentivePoolAllocationSet(IIIncentivePoolAllocation incentivePoolAllocation);
    event IncentivePoolRewardServiceTopupComputed(IIIncentivePoolReceiver incentivePoolReceiver, uint256 amountWei);
    event IncentivePoolRewardServiceDailyAuthorizedIncentiveComputed(
        IIIncentivePoolReceiver incentivePoolReceiver,
        uint256 amountWei);
    event IncentivePoolRewardServiceTopupRequestReceived(
        IIIncentivePoolReceiver incentivePoolReceiver,
        uint256 amountWei);
    event SupplySet(IISupply oldSupply, IISupply newSupply);
    event TopupConfigurationSet(TopupConfiguration topupConfiguration);
    event NewTimeSlotInitialized(
        uint256 startTimeStamp,
        uint256 endTimeStamp,
        uint256 inflatableSupplyWei,
        uint256 recognizedIncentiveWei
    );

    modifier notZero(address _address) {
        require(_address != address(0), ERR_IS_ZERO);
        _;
    }

    constructor (
        address _governance,
        FlareDaemon _flareDaemon,
        address _addressUpdater,
        IncentivePoolTreasury _treasury,
        uint256 _rewardEpochStartTs
    )
        notZero(address(_treasury))
        GovernedAndFlareDaemonized(_governance, _flareDaemon)
        AddressUpdatable(_addressUpdater)
    {
        treasury = _treasury;
        rewardEpochStartTs = _rewardEpochStartTs;
    }

    /**
     * @notice Needed in order to receive funds from Treasury
     */
    receive() external payable {
        require(msg.sender == address(treasury), ERR_TREASURY_ONLY);
    }

    function stop() external onlyImmediateGovernance {
        stopped = true;
    }

    /**
     * @notice Set the topup configuration for a reward service.
     * @param _incentivePoolReceiver    The reward service to receive the incentive pool funds for distribution.
     * @param _topupType            The type to signal how the topup amounts are to be calculated.
     *                              FACTOROFDAILYAUTHORIZED = Use a factor of last daily authorized to set a
     *                              target balance for a reward service to maintain as a reserve for claiming.
     *                              ALLAUTHORIZED = Pull enough native tokens to topup reward service contract to hold
     *                              all authorized but unrequested rewards.
     * @param _topupFactorX100      If _topupType == FACTOROFDAILYAUTHORIZED, then this factor (times 100)
     *                              is multiplied by last daily authorized incentive to obtain the
     *                              maximum balance that a reward service can hold at any given time. If it holds less,
     *                              then this max amount is used to compute the request topup required to
     *                              bring the reward service contract native token balance up to that amount.
     * @dev Topup factor, if _topupType == FACTOROFDAILYAUTHORIZED, must be > 100 and <= 400.
     */
    function setTopupConfiguration(
        IIIncentivePoolReceiver _incentivePoolReceiver,
        TopupType _topupType,
        uint256 _topupFactorX100
    )
        external
        notZero(address(_incentivePoolReceiver))
        onlyGovernance
    {
        if (_topupType == TopupType.FACTOROFDAILYAUTHORIZED) {
            require(_topupFactorX100 > 100, ERR_TOPUP_LOW);
        }
        TopupConfiguration storage topupConfiguration = topupConfigurations[_incentivePoolReceiver];
        topupConfiguration.topupType = _topupType;
        topupConfiguration.topupFactorX100 = _topupFactorX100;
        topupConfiguration.configured = true;

        emit TopupConfigurationSet(topupConfiguration);
    }

    /**
     * @notice Pulsed by the FlareDaemon to trigger timing-based events for the incentive process.
     * @dev There are two events:
     *   1) a time slot event to recognize incentive for a new timeSlot
     *   2) a daily event to:
     *     a) authorize incentive for rewarding
     *     b) distribute enough native tokens to topup reward services for claiming reserves
     */
    function daemonize() external virtual override notZero(address(supply)) onlyFlareDaemon returns(bool) {
        // If incentive rewarding stopped, do nothing
        if (stopped) {
            return false;
        }

        // If incentive rewarding not started yet, blow off processing until it does.
        if (block.timestamp < rewardEpochStartTs) {
            return true;
        }

        // If incentive rewarding started and we have not updated when it started, do so now.
        if (rewardEpochStartedTs == 0) {
            rewardEpochStartedTs = block.timestamp;
        }

        // Is it time to recognize an initial incentive pool timeSlot?
        if (incentivePoolTimeSlots.getCount() == 0) {
            _initNewTimeSlot(block.timestamp);
        } else {
            uint256 currentTimeSlotEndTimeStamp = incentivePoolTimeSlots.getCurrentTimeSlot().endTimeStamp;

            // Is it time to recognize a new incentive pool timeSlot?
            if (block.timestamp > currentTimeSlotEndTimeStamp) {
                _initNewTimeSlot(block.timestamp);
            }
        }

        // Is it time to authorize new incentive? Do it daily.
        if (lastAuthorizationTs.add(AUTHORIZE_TIME_FRAME_SEC) <= block.timestamp) {
            // Update time we last authorized.
            lastAuthorizationTs = block.timestamp;

            // Authorize incentive for current sharing percentages.
            uint256 amountAuthorizedWei = rewardServices.authorizeDailyIncentive(
                totalRecognizedIncentiveWei,
                totalAuthorizedIncentiveWei,
                incentivePoolTimeSlots.getCurrentTimeSlot().getPeriodsRemaining(block.timestamp),
                incentivePoolAllocation.getSharingPercentages()
            );
            // Accumulate total authorized incentive across all time slots
            totalAuthorizedIncentiveWei = totalAuthorizedIncentiveWei.add(amountAuthorizedWei);
            // Make sure that total authorized never exceeds total recognized
            assert(totalAuthorizedIncentiveWei <= totalRecognizedIncentiveWei);
            emit IncentiveAuthorized(amountAuthorizedWei);

            // Time to compute topup amount for incentive pool receivers.
            uint256 topupRequestWei = rewardServices.computeTopupRequest(this, treasury.maxPullRequestWei());
            // Sum the topup request total across time slots
            totalIncentiveTopupRequestedWei = totalIncentiveTopupRequestedWei.add(topupRequestWei);
            // Make sure that total topup requested can never exceed incentive authorized
            assert(totalIncentiveTopupRequestedWei <= totalAuthorizedIncentiveWei);
            emit TopupRequested(topupRequestWei);

            // Pull funds from treasury contract
            treasury.pullFunds(topupRequestWei);

            // Distribute received funds
            uint256 amountPostedWei = rewardServices.receiveTopupRequest();
            // Post the amount of native tokens received and transferred to reward service contracts
            totalIncentiveTopupDistributedWei = totalIncentiveTopupDistributedWei.add(amountPostedWei);
            // Received should never be more than requested
            assert(totalIncentiveTopupDistributedWei <= totalIncentiveTopupRequestedWei);
            // calculated and distributed amount should be the same
            assert(topupRequestWei == amountPostedWei);
        }
        return true;
    }

    /**
     * @notice Return token pool supply data
     * @return _lockedFundsWei                  Funds that are intentionally locked in the token pool
     * and not part of circulating supply
     * @return _totalInflationAuthorizedWei     Total inflation authorized amount (wei)
     * @return _totalClaimedWei                 Total claimed amount (wei)
     */
    function getTokenPoolSupplyData() external view override returns (
        uint256 _lockedFundsWei,
        uint256 _totalInflationAuthorizedWei,
        uint256 _totalClaimedWei
    ){
        _lockedFundsWei = stopped ? totalIncentiveTopupDistributedWei :
            address(treasury).balance.add(totalIncentiveTopupDistributedWei);
        _totalInflationAuthorizedWei = 0;
        _totalClaimedWei = totalIncentiveTopupDistributedWei;
    }

    /**
     * @notice Get a tuple of totals across incentive pool time slots.
     * @return _totalAuthorizedIncentiveWei     Total authorized incentive
     * @return _totalIncentiveTopupRequestedWei Total incentive requested to be topped up for rewarding
     * @return _totalIncentiveTopupDistributedWei  Total incentive received for funding reward services
     * @return _totalRecognizedIncentiveWei     Total incentive recognized for rewarding
     */
    function getTotals()
        external view
        returns (
            uint256 _totalAuthorizedIncentiveWei,
            uint256 _totalIncentiveTopupRequestedWei,
            uint256 _totalIncentiveTopupDistributedWei,
            uint256 _totalRecognizedIncentiveWei
        )
    {
        _totalAuthorizedIncentiveWei = totalAuthorizedIncentiveWei;
        _totalIncentiveTopupRequestedWei = totalIncentiveTopupRequestedWei;
        _totalIncentiveTopupDistributedWei = totalIncentiveTopupDistributedWei;
        _totalRecognizedIncentiveWei = totalRecognizedIncentiveWei;
    }

    /**
     * @notice Given an index, return the time slot at that index.
     * @param _index    The index of the time slot to fetch.
     * @return          The incentive pool time slot state.
     * @dev Expect library to revert if index not found.
     */
    function getTimeSlot(uint256 _index) external view returns(IncentivePoolTimeSlots.IncentivePoolTimeSlot memory) {
        return incentivePoolTimeSlots.getTimeSlot(_index);
    }

    /**
     * @notice Return the current time slot.
     * @return The incentive pool time slot state of the current time slot.
     * @dev Expect library to revert if there is no current time slot.
     */
    function getCurrentTimeSlot() external view returns(IncentivePoolTimeSlots.IncentivePoolTimeSlot memory) {
        return incentivePoolTimeSlots.getCurrentTimeSlot();
    }

    /**
     * @notice Return current time slot id.
     * @return Id of the current time slot.
     * @dev Expect library to revert if there is no current time slot.
     */
    function getCurrentTimeSlotId() external view returns(uint256) {
        return incentivePoolTimeSlots.getCurrentTimeSlotId();
    }

    /**
     * Return the structure of reward services.
     * @return Reward services structure.
     */
    function getRewardServices() external view returns (IncentivePoolRewardServices.RewardService[] memory) {
        return rewardServices.rewardServices;
    }

    function switchToFallbackMode() external view override onlyFlareDaemon returns (bool) {
        // do nothing - there is no fallback mode in IncentivePool
        return false;
    }

    /**
     * @notice Given an incentive pool receiver, get the topup configuration.
     * @param _incentivePoolReceiver    The reward service.
     * @return _topupConfiguration      The configuration of how the topup requests are calculated for a given
     *                                  reward service.
     */
    function getTopupConfiguration(
        IIIncentivePoolReceiver _incentivePoolReceiver
    )
        external view
        notZero(address(_incentivePoolReceiver))
        returns(TopupConfiguration memory _topupConfiguration)
    {
        _topupConfiguration = topupConfigurations[_incentivePoolReceiver];
        if (!_topupConfiguration.configured) {
            _topupConfiguration.topupType = TopupType.FACTOROFDAILYAUTHORIZED;
            _topupConfiguration.topupFactorX100 = DEFAULT_TOPUP_FACTOR_X100;
        }
    }

    /**
     * @notice Returns next expected incentive topup timestamp which is also incentive authorization time.
     *     The returned time from this API is actually the time of the block in which the topup is requested.
     *     The Actual topup will take place in the same block.
     */
    function getNextExpectedTopupTs() external view returns (uint256 _nextTopupTs) {
        _nextTopupTs = lastAuthorizationTs.add(AUTHORIZE_TIME_FRAME_SEC);
    }

    /**
     * @notice Implement this function for updating daemonized contracts through AddressUpdater.
     */
    function getContractName() external pure override returns (string memory) {
        return "IncentivePool";
    }

    /**
     * @notice Implementation of the AddressUpdatable abstract method - updates supply and incentive pool allocation.
     * @notice Set a reference to a provider of sharing percentages by incentive pool receiver.
     * @dev Assume that sharing percentages sum to 100% if at least one exists, but
     *      if no sharing percentages are defined, then no incentive will be authorized.
     * @notice Set a reference to a provider of the time slot incentive pool percentage.
     * @dev Assume that referencing contract has reasonable limitations on percentages.
     */
    function _updateContractAddresses(
        bytes32[] memory _contractNameHashes,
        address[] memory _contractAddresses
    )
        internal override
    {
        IISupply _supply = IISupply(_getContractAddress(_contractNameHashes, _contractAddresses, "Supply"));
        emit SupplySet(supply, _supply);
        supply = _supply;

        incentivePoolAllocation = IIIncentivePoolAllocation(
            _getContractAddress(_contractNameHashes, _contractAddresses, "IncentivePoolAllocation"));
        emit IncentivePoolAllocationSet(incentivePoolAllocation);
    }

    function _initNewTimeSlot(uint256 startTs) internal {
        uint256 inflatableSupply = supply.getInflatableBalance();
        uint256 freeTreasuryBalance = address(treasury).balance
            .add(totalIncentiveTopupDistributedWei)
            .sub(totalAuthorizedIncentiveWei);

        // slither-disable-start uninitialized-local
        //slither-disable-next-line unused-return
        try incentivePoolAllocation.getTimeSlotPercentageBips() returns(uint256 timeSlotPercentBips) {
            IncentivePoolTimeSlots.IncentivePoolTimeSlot memory incentivePoolTimeSlot = incentivePoolTimeSlots
                .initializeNewTimeSlot(startTs, freeTreasuryBalance, inflatableSupply, timeSlotPercentBips);

            // Accumulate total recognized incentive across time slots
            totalRecognizedIncentiveWei =
                totalRecognizedIncentiveWei.add(incentivePoolTimeSlot.recognizedIncentiveWei);

            emit NewTimeSlotInitialized(
                incentivePoolTimeSlot.startTimeStamp,
                incentivePoolTimeSlot.endTimeStamp,
                inflatableSupply,
                incentivePoolTimeSlot.recognizedIncentiveWei
            );
        } catch Error(string memory message) {
            revert(message);
        } catch {
            revert(ERR_GET_TIME_SLOT_PERCENT);
        }
        // slither-disable-end uninitialized-local
    }
}
