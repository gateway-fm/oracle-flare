// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import  "../../genesis/implementation/FlareDaemon.sol";
import "../../genesis/interface/IFlareDaemonize.sol";
import "../../genesis/interface/IInflationGenesis.sol";
import "../../utils/implementation/GovernedAndFlareDaemonized.sol";
import "../../addressUpdater/implementation/AddressUpdatable.sol";
import "../lib/InflationTimeSlots.sol";
import "../lib/InflationRewardServices.sol";
import "../interface/IIPreInflationCalculation.sol";
import "../interface/IIInflationAllocation.sol";
import "../interface/IISupply.sol";
import "../interface/IIInflationV1.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "../../utils/implementation/SafePct.sol";

/**
 * Recognizes, authorizes, mints, and funds native tokens to Flare services that are rewardable through inflation.
 *
 * See the [technical specification](
 * https://gitlab.com/flarenetwork/flare-smart-contracts/-/blob/master/docs/specs/Inflation.md).
 **/
contract Inflation is IInflationGenesis, GovernedAndFlareDaemonized, IFlareDaemonize, AddressUpdatable {
    using InflationTimeSlots for InflationTimeSlots.InflationTimeSlotsState;
    using InflationTimeSlots for InflationTimeSlots.InflationTimeSlot;
    using InflationRewardServices for InflationRewardServices.InflationRewardServicesState;
    using InflationRewardServices for InflationRewardServices.RewardService;
    using SafeMath for uint256;
    using SafePct for uint256;

    // Composable contracts
    IIInflationAllocation public inflationAllocation;
    IISupply public supply;
    IIPreInflationCalculation public preInflationCalculation;

    // Collection of time slots and reward services
    InflationTimeSlots.InflationTimeSlotsState private inflationTimeSlots;
    InflationRewardServices.InflationRewardServicesState private rewardServices;

    // Balances
    uint256 private totalRecognizedInflationWei;
    uint256 private totalAuthorizedInflationWei;
    uint256 private totalInflationTopupRequestedWei;
    uint256 private totalInflationTopupDistributedWei;

    // Instance vars

    /// The last time inflation was authorized.
    uint256 public lastAuthorizationTs;
    // A topup configuration for a contract receiving inflation.
    mapping(IIInflationReceiver => TopupConfiguration)
        internal topupConfigurations;
    /// Do not start inflation time slots before this, in seconds after UNIX epoch.
    uint256 immutable public rewardEpochStartTs;
    /// When the first reward epoch was started, in seconds after UNIX epoch.
    uint256 public rewardEpochStartedTs;

    // Constants
    string internal constant ERR_IS_ZERO = "address is 0";
    string internal constant ERR_TOPUP_LOW = "topup low";
    string internal constant ERR_GET_TIME_SLOT_PERCENT = "unknown error. getTimeSlotPercentageBips";
    string internal constant ERR_SUPPLY_UPDATE = "unknown error. updateAuthorizedInflationAndCirculatingSupply";
    string internal constant ERR_REQUEST_MINT = "unknown error. requestMinting";

    uint256 internal constant DEFAULT_TOPUP_FACTOR_X100 = 120;
    // DO NOT UPDATE - this affects supply contract, which is expected to be updated once a day
    uint256 internal constant AUTHORIZE_TIME_FRAME_SEC = 1 days;
    address payable internal constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    event InflationAuthorized(uint256 amountWei);
    event MintingReceived(uint256 amountWei, uint256 selfDestructAmountWei);
    event TopupRequested(uint256 requestAmountWei, uint256 reRequestAmountWei);
    event InflationAllocationSet(IIInflationAllocation inflationAllocation);
    event InflationRewardServiceTopupComputed(IIInflationReceiver inflationReceiver, uint256 amountWei);
    event InflationRewardServiceDailyAuthorizedInflationComputed(
        IIInflationReceiver inflationReceiver, uint256 amountWei);
    event InflationRewardServiceTopupRequestReceived(IIInflationReceiver inflationReceiver, uint256 amountWei);
    event SupplySet(IISupply oldSupply, IISupply newSupply);
    event TopupConfigurationSet(TopupConfiguration topupConfiguration);
    event NewTimeSlotInitialized(
        uint256 startTimeStamp,
        uint256 endTimeStamp,
        uint256 inflatableSupplyWei,
        uint256 recognizedInflationWei
    );

    modifier notZero(address _address) {
        require(_address != address(0), ERR_IS_ZERO);
        _;
    }

    constructor (
        address _governance,
        FlareDaemon _flareDaemon,
        address _addressUpdater,
        uint256 _rewardEpochStartTs
    )
        GovernedAndFlareDaemonized(_governance, _flareDaemon)
        AddressUpdatable(_addressUpdater)
    {
        rewardEpochStartTs = _rewardEpochStartTs;
    }

    /**
     * Used to copy data from old inflation contract.
     *
     * Only governance can call.
     * @param _oldInflation Address of old inflation.
     * @param _noOfAnnums Number of annums in old inflation.
     */
    function setInitialData(
        IIInflationV1 _oldInflation,
        uint256 _noOfAnnums
    )
        external
        onlyImmediateGovernance
    {
        require(lastAuthorizationTs == 0, "already initialized");
        lastAuthorizationTs = _oldInflation.lastAuthorizationTs();
        rewardEpochStartedTs = _oldInflation.rewardEpochStartedTs();

        uint256 totalAuthorizedInflationWeiTemp = 0;
        uint256 totalInflationTopupRequestedWeiTemp = 0;
        uint256 totalInflationTopupDistributedWeiTemp = 0;
        for (uint256 i = 0; i < _noOfAnnums; i++) {
            IIInflationV1.InflationAnnumState memory annum = _oldInflation.getAnnum(i);
            for (uint256 j = 0; j < annum.rewardServices.rewardServices.length; j++) {
                IIInflationV1.RewardServiceState memory oldRewardService = annum.rewardServices.rewardServices[j];
                (bool found, uint256 index) = rewardServices.findRewardService(oldRewardService.inflationReceiver);
                InflationRewardServices.RewardService storage rewardService;
                if (found) { // Get the existing reward service
                    rewardService = rewardServices.rewardServices[index];
                } else { // Initialize a new reward service
                    rewardService = rewardServices.rewardServices.push();
                    rewardService.initialize(oldRewardService.inflationReceiver);
                }
                rewardService.lastDailyAuthorizedInflationWei = oldRewardService.lastDailyAuthorizedInflationWei;
                rewardService.authorizedInflationWei += oldRewardService.authorizedInflationWei;
                rewardService.inflationTopupRequestedWei += oldRewardService.inflationTopupRequestedWei;
                rewardService.inflationTopupDistributedWei += oldRewardService.inflationTopupReceivedWei;

                totalAuthorizedInflationWeiTemp += oldRewardService.authorizedInflationWei;
                totalInflationTopupRequestedWeiTemp += oldRewardService.inflationTopupRequestedWei;
                totalInflationTopupDistributedWeiTemp += oldRewardService.inflationTopupReceivedWei;
            }
        }
        totalAuthorizedInflationWei = totalAuthorizedInflationWeiTemp;
        totalInflationTopupRequestedWei = totalInflationTopupRequestedWeiTemp;
        totalInflationTopupDistributedWei = totalInflationTopupDistributedWeiTemp;
        totalRecognizedInflationWei = totalAuthorizedInflationWeiTemp;

        // add cumulative time slot
        InflationTimeSlots.InflationTimeSlot storage inflationTimeSlot = inflationTimeSlots.inflationTimeSlots.push();
        inflationTimeSlot.startTimeStamp = rewardEpochStartedTs;
        inflationTimeSlot.recognizedInflationWei = totalAuthorizedInflationWeiTemp;
        inflationTimeSlot.endTimeStamp = lastAuthorizationTs + AUTHORIZE_TIME_FRAME_SEC - 1;
    }

    /**
     * @inheritdoc IInflationGenesis
     */
    function receiveMinting() external override payable onlyFlareDaemon {
        uint256 amountPostedWei = rewardServices.receiveTopupRequest();
        // Post the amount of native tokens received and transferred to reward service contracts
        totalInflationTopupDistributedWei = totalInflationTopupDistributedWei.add(amountPostedWei);
        // Received should never be more than requested
        assert(totalInflationTopupDistributedWei <= totalInflationTopupRequestedWei);
        // Assume that if we received (or already have) more than we posted,
        // it must be amounts sent from a contract self-destruct
        // recipient in this block.
        uint256 selfDestructProceeds = address(this).balance;
        if (selfDestructProceeds > 0) {
            // Then assume extra were self-destruct proceeds and burn it
            //slither-disable-next-line arbitrary-send-eth
            BURN_ADDRESS.transfer(selfDestructProceeds);
        }
        emit MintingReceived(amountPostedWei, selfDestructProceeds);
    }

    /**
     * Set the topup configuration for a reward service.
     *
     * Only governance can call.
     * @param _inflationReceiver    The reward service to receive the inflation funds for distribution.
     * @param _topupType            The type to signal how the topup amounts are to be calculated.
     *                              FACTOROFDAILYAUTHORIZED = Use a factor of last daily authorized to set a
     *                              target balance for a reward service to maintain as a reserve for claiming.
     *                              ALLAUTHORIZED = Mint enough native tokens to topup reward service contract to hold
     *                              all authorized but unrequested rewards.
     * @param _topupFactorX100      If _topupType == FACTOROFDAILYAUTHORIZED, then this factor (times 100)
     *                              is multiplied by last daily authorized inflation to obtain the
     *                              maximum balance that a reward service can hold at any given time. If it holds less,
     *                              then this max amount is used to compute the mint request topup required to
     *                              bring the reward service contract native token balance up to that amount.
     * @dev Topup factor, if _topupType == FACTOROFDAILYAUTHORIZED, must be greater than 100.
     */
    function setTopupConfiguration(
        IIInflationReceiver _inflationReceiver,
        TopupType _topupType,
        uint256 _topupFactorX100
    )
        external
        notZero(address(_inflationReceiver))
        onlyGovernance
    {
        if (_topupType == TopupType.FACTOROFDAILYAUTHORIZED) {
            require(_topupFactorX100 > 100, ERR_TOPUP_LOW);
        }
        TopupConfiguration storage topupConfiguration = topupConfigurations[_inflationReceiver];
        topupConfiguration.topupType = _topupType;
        topupConfiguration.topupFactorX100 = _topupFactorX100;
        topupConfiguration.configured = true;

        emit TopupConfigurationSet(topupConfiguration);
    }

    /**
     * Pulsed by the FlareDaemon to trigger timing-based events for the inflation process.
     * @dev There are two events:
     *   1) a time slot event to recognize inflation for a new time slot
     *   2) a daily event to:
     *     a) authorize mintable inflation for rewarding
     *     b) request minting of enough native tokens to topup reward services for claiming reserves
     */
    function daemonize() external virtual override notZero(address(supply)) onlyFlareDaemon returns(bool) {
        // If inflation rewarding not started yet, blow off processing until it does.
        if (block.timestamp < rewardEpochStartTs) {
            return true;
        }

        // If inflation rewarding started and we have not updated when it started, do so now.
        if (rewardEpochStartedTs == 0) {
            rewardEpochStartedTs = block.timestamp;
        }

        // Is it time to recognize an initial inflation time slot?
        if (inflationTimeSlots.getCount() == 0) {
            _initNewTimeSlot(block.timestamp);
        } else {
            uint256 currentTimeSlotEndTimeStamp = inflationTimeSlots.getCurrentTimeSlot().endTimeStamp;

            // Is it time to recognize a new inflation time slot?
            if (block.timestamp > currentTimeSlotEndTimeStamp) {
                _initNewTimeSlot(block.timestamp);
            }
        }

        // Is it time to authorize new inflation? Do it daily.
        if (lastAuthorizationTs.add(AUTHORIZE_TIME_FRAME_SEC) <= block.timestamp) {

            // Update time we last authorized.
            lastAuthorizationTs = block.timestamp;

            // pre inflation calculation trigger
            if (preInflationCalculation != IIPreInflationCalculation(0)) {
                preInflationCalculation.trigger();
            }

            // Authorize inflation for current sharing percentages.
            uint256 amountAuthorizedWei = rewardServices.authorizeDailyInflation(
                totalRecognizedInflationWei,
                totalAuthorizedInflationWei,
                inflationTimeSlots.getCurrentTimeSlot().getPeriodsRemaining(block.timestamp),
                inflationAllocation.getSharingPercentages()
            );
            // Accumulate total authorized inflation across all time slots
            totalAuthorizedInflationWei = totalAuthorizedInflationWei.add(amountAuthorizedWei);
            // Make sure that total authorized never exceeds total recognized
            assert(totalAuthorizedInflationWei <= totalRecognizedInflationWei);

            emit InflationAuthorized(amountAuthorizedWei);

            // Call supply contract to keep inflatable balance and circulating supply updated.
            // slither-disable-start uninitialized-local
            try supply.updateAuthorizedInflationAndCirculatingSupply(amountAuthorizedWei) {
            } catch Error(string memory message) {
                revert(message);
            } catch {
                revert(ERR_SUPPLY_UPDATE);
            }
            // slither-disable-end uninitialized-local

            uint256 pendingMintRequestFlareDaemon =
                flareDaemon.totalMintingRequestedWei().sub(flareDaemon.totalMintingReceivedWei());
            uint256 pendingMintRequestInflation =
                totalInflationTopupRequestedWei.sub(totalInflationTopupDistributedWei);
            assert(pendingMintRequestInflation >= pendingMintRequestFlareDaemon);
            // Time to compute topup amount for inflation receivers.
            uint256 topupRequestWei = rewardServices.computeTopupRequest(this,
                flareDaemon.maxMintingRequestWei().sub(pendingMintRequestInflation)); // max minting - pending
            // Sum the topup request total across time slots
            totalInflationTopupRequestedWei = totalInflationTopupRequestedWei.add(topupRequestWei);
            // Make sure that total topup requested can never exceed inflation authorized
            assert(totalInflationTopupRequestedWei <= totalAuthorizedInflationWei);
            // Additionally request pending but not received amount
            uint256 topupReRequestWei = pendingMintRequestInflation.sub(pendingMintRequestFlareDaemon);
            emit TopupRequested(topupRequestWei, topupReRequestWei);

            // Send mint request to the daemon.
            // slither-disable-start uninitialized-local
            try flareDaemon.requestMinting(topupRequestWei.add(topupReRequestWei)) {
            } catch Error(string memory message) {
                revert(message);
            } catch {
                revert(ERR_REQUEST_MINT);
            }
            // slither-disable-end uninitialized-local
        }
        return true;
    }

    /**
     * Set contract that should be triggered before new inflation is calculated (it can be address(0))
     *
     * Only governance can call.
     */
    function setPreInflationCalculation(IIPreInflationCalculation _preInflationCalculation) external onlyGovernance {
        preInflationCalculation = _preInflationCalculation;
    }

    /**
     * Get a tuple of totals across inflation time slots.
     * @return _totalAuthorizedInflationWei         Total inflation authorized to be mintable
     * @return _totalInflationTopupRequestedWei     Total inflation requested to be topped up for rewarding
     * @return _totalInflationTopupDistributedWei   Total inflation received for funding reward services
     * @return _totalRecognizedInflationWei         Total inflation recognized for rewarding
     */
    function getTotals()
        external view
        returns (
            uint256 _totalAuthorizedInflationWei,
            uint256 _totalInflationTopupRequestedWei,
            uint256 _totalInflationTopupDistributedWei,
            uint256 _totalRecognizedInflationWei
        )
    {
        _totalAuthorizedInflationWei = totalAuthorizedInflationWei;
        _totalInflationTopupRequestedWei = totalInflationTopupRequestedWei;
        _totalInflationTopupDistributedWei = totalInflationTopupDistributedWei;
        _totalRecognizedInflationWei = totalRecognizedInflationWei;
    }

    /**
     * Given an index, return the time slot at that index.
     * @param _index    The index of the time slot to fetch.
     * @return          The inflation time slot state.
     * @dev Expect library to revert if index not found.
     */
    function getTimeSlot(uint256 _index) external view returns(InflationTimeSlots.InflationTimeSlot memory) {
        return inflationTimeSlots.getTimeSlot(_index);
    }

    /**
     * Return the current time slot.
     * @return The inflation time slot state of the current time slot.
     * @dev Expect library to revert if there is no current time slot.
     */
    function getCurrentTimeSlot() external view returns(InflationTimeSlots.InflationTimeSlot memory) {
        return inflationTimeSlots.getCurrentTimeSlot();
    }

    /**
     * Return current time slot id.
     * @return Id of the current time slot.
     * @dev Expect library to revert if there is no current time slot.
     */
    function getCurrentTimeSlotId() external view returns(uint256) {
        return inflationTimeSlots.getCurrentTimeSlotId();
    }

    /**
     * Return the structure of reward services.
     * @return Reward services structure.
     */
    function getRewardServices() external view returns (InflationRewardServices.RewardService[] memory) {
        return rewardServices.rewardServices;
    }

    /**
     * @inheritdoc IFlareDaemonize
     */
    function switchToFallbackMode() external view override onlyFlareDaemon returns (bool) {
        // do nothing - there is no fallback mode in Inflation
        return false;
    }

    /**
     * Given an inflation receiver, get the topup configuration.
     * @param _inflationReceiver    The reward service.
     * @return _topupConfiguration  The configuration of how the topup requests are calculated for a given
     *                              reward service.
     */
    function getTopupConfiguration(
        IIInflationReceiver _inflationReceiver
    )
        external view
        notZero(address(_inflationReceiver))
        returns(TopupConfiguration memory _topupConfiguration)
    {
        _topupConfiguration = topupConfigurations[_inflationReceiver];
        if (!_topupConfiguration.configured) {
            _topupConfiguration.topupType = TopupType.FACTOROFDAILYAUTHORIZED;
            _topupConfiguration.topupFactorX100 = DEFAULT_TOPUP_FACTOR_X100;
        }
    }

    /**
     * Returns next expected inflation topup time stamp which is also inflation authorization time.
     * The returned time from this API is actually the time of the block in which the topup is requested.
     * The Actual topup will take place in the next block.
     * Expected diff is up to a few seconds (max is less then a minute).
     */
    function getNextExpectedTopupTs() external view returns (uint256 _nextTopupTs) {
        _nextTopupTs = lastAuthorizationTs.add(AUTHORIZE_TIME_FRAME_SEC);
    }

    /**
     * @inheritdoc IFlareDaemonize
     */
    function getContractName() external pure override returns (string memory) {
        return "Inflation";
    }

    /**
     * @notice Implementation of the AddressUpdatable abstract method - updates supply and inflation allocation.
     * @notice Set a reference to a provider of sharing percentages by inflation receiver.
     * @dev Assume that sharing percentages sum to 100% if at least one exists, but
     *   if no sharing percentages are defined, then no inflation will be authorized.
     * @notice Set a reference to a provider of the time slot inflation percentage.
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

        inflationAllocation = IIInflationAllocation(
            _getContractAddress(_contractNameHashes, _contractAddresses, "InflationAllocation"));

        emit InflationAllocationSet(inflationAllocation);
    }

    function _initNewTimeSlot(uint256 startTs) internal {
        supply.updateCirculatingSupply();
        uint256 inflatableSupply = supply.getInflatableBalance();

        // slither-disable-start uninitialized-local
        //slither-disable-next-line unused-return
        try inflationAllocation.getTimeSlotPercentageBips() returns(uint256 timeSlotPercentBips) {
            InflationTimeSlots.InflationTimeSlot memory inflationTimeSlot =
                inflationTimeSlots.initializeNewTimeSlot(startTs, inflatableSupply, timeSlotPercentBips);

            // Accumulate total recognized inflation across time slots
            totalRecognizedInflationWei = totalRecognizedInflationWei.add(inflationTimeSlot.recognizedInflationWei);

            emit NewTimeSlotInitialized(
                inflationTimeSlot.startTimeStamp,
                inflationTimeSlot.endTimeStamp,
                inflatableSupply,
                inflationTimeSlot.recognizedInflationWei
            );
        } catch Error(string memory message) {
            revert(message);
        } catch {
            revert(ERR_GET_TIME_SLOT_PERCENT);
        }
        // slither-disable-end uninitialized-local
    }
}
