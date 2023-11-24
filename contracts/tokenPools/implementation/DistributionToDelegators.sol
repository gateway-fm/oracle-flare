// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../../addressUpdater/implementation/AddressUpdatable.sol";
import "../../utils/implementation/GovernedAndFlareDaemonized.sol";
import "../../claiming/implementation/ClaimSetupManager.sol";
import "../../token/implementation/WNat.sol";
import "../../token/interface/IICombinedNatBalance.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../../userInterfaces/IDistributionToDelegators.sol";
import "../../utils/interface/IIRandomProvider.sol";
import "../interface/IITokenPool.sol";
import "../../genesis/implementation/DistributionTreasury.sol";
import "../../utils/implementation/AddressSet.sol";
import "../../genesis/interface/IFlareDaemonize.sol";

/**
 * @title Distribution to delegators
 * @notice A contract to manage the ongoing airdrop distribution after the initial airdrop allocation.
 * The remaining amount is distributed by this contract, with a set rate every 30 days
 * @notice The balance that will be added to this contract must initially be a part of circulating supply
 **/
//solhint-disable-next-line max-states-count
contract DistributionToDelegators is IDistributionToDelegators, IITokenPool,
    GovernedAndFlareDaemonized, IFlareDaemonize, ReentrancyGuard, AddressUpdatable
{
    using SafeMath for uint256;
    using SafePct for uint256;
    using AddressSet for AddressSet.State;

    // constants
    uint256 internal constant WEEK = 7 days;
    uint256 internal constant MONTH = 30 days;
    uint256 internal constant NUMBER_OF_VOTE_POWER_BLOCKS = 3;
    uint256 internal constant TOTAL_CLAIMABLE_BIPS = 8500;
    // 2.37% every 30 days (so total distribution takes 36 * 30 days =~ 3 years)
    uint256 internal constant MONTHLY_CLAIMABLE_BIPS = 237;
    uint256 internal constant NUMBER_OF_MONTHS = TOTAL_CLAIMABLE_BIPS / MONTHLY_CLAIMABLE_BIPS + 1; // 36
    address payable internal constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    // Errors
    string internal constant ERR_ADDRESS_ZERO = "address zero";
    string internal constant ERR_BALANCE_TOO_LOW = "balance too low";
    string internal constant ERR_IN_THE_PAST = "in the past";
    string internal constant ERR_NOT_STARTED = "not started";
    string internal constant ERR_ALREADY_FINISHED = "already finished";
    string internal constant ERR_MONTH_EXPIRED = "month expired";
    string internal constant ERR_MONTH_NOT_CLAIMABLE = "month not claimable";
    string internal constant ERR_MONTH_NOT_CLAIMABLE_YET = "month not claimable yet";
    string internal constant ERR_NO_MONTH_CLAIMABLE = "no month claimable";
    string internal constant ERR_CLAIM_FAILED = "claim failed";
    string internal constant ERR_OPT_OUT = "already opted out";
    string internal constant ERR_NOT_OPT_OUT = "not opted out";
    string internal constant ERR_TREASURY_ONLY = "treasury only";
    string internal constant ERR_ALREADY_STARTED = "already started";
    string internal constant ERR_WRONG_START_TIMESTAMP = "wrong start timestamp";
    string internal constant ERR_CLAIMED_AMOUNT_TOO_SMALL = "claimed amount too small";
    string internal constant ERR_RECIPIENT_ZERO = "recipient zero";
    string internal constant ERR_INVALID_PARAMS = "invalid parameters";
    string internal constant ERR_STOPPED = "stopped";
    string internal constant ERR_NOT_STOPPED = "not stopped";
    string internal constant ERR_SENDING_FUNDS_BACK = "sending funds back failed";

    // storage
    uint256 public totalEntitlementWei;     // Total wei to be distributed (all but initial airdrop)
    uint256 public immutable latestEntitlementStartTs;  // Latest day 0 when contract starts
    uint256 public totalClaimedWei;         // All wei already claimed
    uint256 public totalBurnedWei;          // Amounts that were not claimed in time and expired and was burned
    uint256 public totalDistributableAmount;// Total amount that was pulled from Distribution treasury for
                                            // distribution. (sum of totalAvailableAmount)
    uint256 public entitlementStartTs;      // Day 0 when contract starts
    // id of the first month to expire. Closed = expired and unclaimed amount will be burned
    uint128 internal nextMonthToExpireCandidate;
    // id of the next claimable month. Normally the same as current month - may be smaller if waiting for good random
    uint128 internal nextMonthToClaimCandidate;

    mapping(uint256 => uint256) public startBlockNumber; // mapping from month to first block used in randomization
    mapping(uint256 => uint256) public endBlockNumber; // mapping from month to last block used in randomization
    mapping(uint256 => uint256[]) public votePowerBlockNumbers; // mapping from month to blocks used in claiming
    mapping(uint256 => uint256) public totalAvailableAmount; // mapping from month to total available amount
    mapping(uint256 => uint256) public totalUnclaimedAmount; // mapping from month to unclaimed amount
    mapping(uint256 => uint256) public totalUnclaimedWeight; // mapping from month to weight of unclaimed amount
    mapping(address => uint256) private ownerNextClaimableMonth; // mapping from owner to next claimable month

    mapping(address => bool) public optOutCandidate; // indicates if user has triggered to opt out of airdrop
    mapping(address => bool) public optOut; // indicates if user is opted out of airdrop (confirmed by governance)
    address[] public optOutAddresses; // all opted out addresses (confirmed by governance)
    bool public stopped;
    bool public useGoodRandom;
    // both are used only together with useGoodRandom flag - 0 otherwise
    uint256 public maxWaitForGoodRandomSeconds;
    uint256 public waitingForGoodRandomSinceTs;

    // contracts
    DistributionTreasury public immutable treasury;
    IIRandomProvider public priceSubmitter;
    IICombinedNatBalance public combinedNat;
    WNat public wNat;
    ClaimSetupManager public claimSetupManager;

    /**
     * @dev This modifier ensures that this contract's balance matches the expected balance.
     */
    modifier mustBalance {
        _;
        require (_getExpectedBalance() <= address(this).balance, ERR_BALANCE_TOO_LOW);
    }

    modifier onlyExecutorAndAllowedRecipient(address _rewardOwner, address _recipient) {
        _checkExecutorAndAllowedRecipient(_rewardOwner, _recipient);
        _;
    }

    /**
     * @dev This modifier ensures that the entitelment was already started
     */
    modifier entitlementStarted {
        require (entitlementStartTs < block.timestamp, ERR_NOT_STARTED);
        _;
    }

    /**
     * @dev This modifier ensures that the contract is not stopped
     */
    modifier notStopped {
        require (!stopped, ERR_STOPPED);
        _;
    }

    constructor(
        address _governance,
        FlareDaemon _flareDaemon,
        address _addressUpdater,
        DistributionTreasury _treasury,
        uint256 _totalEntitlementWei,
        uint256 _latestEntitlementStartTs
    )
        GovernedAndFlareDaemonized(_governance, _flareDaemon) AddressUpdatable(_addressUpdater)
    {
        require(address(_treasury) != address(0), ERR_ADDRESS_ZERO);
        require(_latestEntitlementStartTs >= block.timestamp, ERR_IN_THE_PAST);
        treasury = _treasury;
        totalEntitlementWei = _totalEntitlementWei;
        latestEntitlementStartTs = _latestEntitlementStartTs;
        entitlementStartTs = _latestEntitlementStartTs;
        emit EntitlementStart(_latestEntitlementStartTs);
    }

    /**
     * @notice Needed in order to receive funds from DistributionTreasury
     */
    receive() external payable {
        require(msg.sender == address(treasury), ERR_TREASURY_ONLY);
    }

    function stop() external onlyImmediateGovernance {
        stopped = true;
    }

    /**
     * @notice Update the totalEntitlementWei
     */
    function updateTotalEntitlementWei() external onlyImmediateGovernance {
        uint256 newTotalEntitlementWei = totalDistributableAmount.add(address(treasury).balance);
        assert(newTotalEntitlementWei >= totalEntitlementWei);
        totalEntitlementWei = newTotalEntitlementWei;
    }

    /**
     * @notice Start the distribution contract at _entitlementStartTs timestamp
     * @param _entitlementStartTs point in time when we start
     */
    function setEntitlementStart(uint256 _entitlementStartTs) external onlyGovernance {
        require(entitlementStartTs > block.timestamp, ERR_ALREADY_STARTED);
        require(_entitlementStartTs >= block.timestamp - 2 * WEEK && _entitlementStartTs <= latestEntitlementStartTs,
            ERR_WRONG_START_TIMESTAMP);
        entitlementStartTs = _entitlementStartTs;
        emit EntitlementStart(_entitlementStartTs);
    }

    /**
     * @notice Method to opt-out of receiving airdrop rewards
     */
    function optOutOfAirdrop() external override {
        require(!optOutCandidate[msg.sender], ERR_OPT_OUT);
        optOutCandidate[msg.sender] = true;
        // emit opt out event
        emit AccountOptOut(msg.sender, false);
    }

    /**
     * @notice Confirm opt out addresses
     * @param _optOutAddresses addresses to opt out
     */
    function confirmOptOutOfAirdrop(address[] calldata _optOutAddresses) external onlyGovernance {
        uint256 len = _optOutAddresses.length;
        for (uint256 i = 0; i < len; i++) {
            address optOutAddress = _optOutAddresses[i];
            require(optOutCandidate[optOutAddress], ERR_NOT_OPT_OUT);
            _checkOptOut(optOutAddress);
            optOut[optOutAddress] = true;
            optOutAddresses.push(optOutAddress);
            // emit opt out event
            emit AccountOptOut(optOutAddress, true);
        }
    }

    /**
     * @notice Runs task triggered by Daemon.
     * The tasks include the following
     * - setting start block number for the month
     * - setting end block number for the month
     * - calculating random blocks and weight + polling funds from treasury contract
     */
    function daemonize() external override onlyFlareDaemon mustBalance nonReentrant returns(bool) {
        if (entitlementStartTs > block.timestamp || nextMonthToExpireCandidate >= NUMBER_OF_MONTHS) return false;

        uint256 diffSec = block.timestamp.sub(entitlementStartTs);
        uint256 currentMonth = diffSec.div(MONTH);
        uint256 remainingSec = diffSec - currentMonth * MONTH;
        uint256 currentWeek = remainingSec.div(WEEK);

        // if not the first week, which is left out for claiming, update start block
        if (currentWeek > 0 && currentMonth < NUMBER_OF_MONTHS && startBlockNumber[currentMonth] == 0) {
            startBlockNumber[currentMonth] = block.number;
        }

        // update ending block - sets to first block in new month
        if (currentMonth > 0 && currentMonth <= NUMBER_OF_MONTHS && endBlockNumber[currentMonth - 1] == 0) {
            endBlockNumber[currentMonth - 1] = block.number;
        }

        // expire old month
        uint256 cleanupBlockNumber = wNat.cleanupBlockNumber();
        uint256 blockNumber = startBlockNumber[nextMonthToExpireCandidate];
        if (blockNumber > 0 && blockNumber < cleanupBlockNumber) {
            uint256 toBurnWei = Math.min(totalUnclaimedAmount[nextMonthToExpireCandidate], address(this).balance);
            nextMonthToExpireCandidate++;

            // Any to burn?
            if (toBurnWei > 0) {
                // Accumulate what we are about to burn
                totalBurnedWei = totalBurnedWei.add(toBurnWei);
                //slither-disable-next-line arbitrary-send-eth
                BURN_ADDRESS.transfer(toBurnWei);
            }
        }

        // enable claiming for previous month
        if (currentMonth > 0 && currentMonth <= NUMBER_OF_MONTHS &&
            nextMonthToClaimCandidate == currentMonth - 1 && !stopped) {
            if (_updateVotePowerBlocksAndWeight(currentMonth - 1)) {
                _updateDistributableAmount(currentMonth - 1); // claim amount if random is ok
            }
        }
        return true;
    }

    /**
     * @notice Allow governance to switch to good random only
     * @param _useGoodRandom                    flag indicating using good random or not
     * @param _maxWaitForGoodRandomSeconds      max time in seconds to wait for the good random
            and if there is no after given time, distribution should proceed anyway
     */
    function setUseGoodRandom(bool _useGoodRandom, uint256 _maxWaitForGoodRandomSeconds) external onlyGovernance {
        if (_useGoodRandom) {
            require(_maxWaitForGoodRandomSeconds > 0 && _maxWaitForGoodRandomSeconds <= 7 days, ERR_INVALID_PARAMS);
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
     * Enable sending funds back to treasury contract in case distribution was stopped
     */
    function sendFundsBackToTreasury() external onlyGovernance {
        require(stopped, ERR_NOT_STOPPED);
        /* solhint-disable avoid-low-level-calls */
        //slither-disable-next-line arbitrary-send-eth
        (bool success, ) = address(treasury).call{value: address(this).balance}("");
        /* solhint-enable avoid-low-level-calls */
        require(success, ERR_SENDING_FUNDS_BACK);
    }

    /**
     * @notice Allows the sender to claim or wrap rewards for reward owner.
     * @notice The caller does not have to be the owner, but must be approved by the owner to claim on his behalf,
     *   this approval is done by calling `setClaimExecutors`.
     * @notice It is actually safe for this to be called by anybody (nothing can be stolen), but by limiting who can
     *   call, we allow the owner to control the timing of the calls.
     * @notice Reward owner can claim to any `_recipient`, while the executor can only claim to the reward owner,
     *   reward owners's personal delegation account or one of the addresses set by `setAllowedClaimRecipients`.
     * @param _rewardOwner          address of the reward owner
     * @param _recipient            address to transfer funds to
     * @param _month                last month to claim for
     * @param _wrap                 should reward be wrapped immediately
     * @return _rewardAmount        amount of total claimed rewards
     */
    function claim(
        address _rewardOwner,
        address _recipient,
        uint256 _month,
        bool _wrap
    )
        external override
        entitlementStarted
        notStopped
        mustBalance
        nonReentrant
        onlyExecutorAndAllowedRecipient(_rewardOwner, _recipient)
        returns (uint256 _rewardAmount)
    {
        _rewardAmount = _claimOrWrap(_rewardOwner, _recipient, _month, _wrap);
    }

    /**
     * @notice Allows batch claiming for the list of '_rewardOwners' up to given '_month'.
     * @notice If reward owner has enabled delegation account, rewards are also claimed for that delegation account and
     *   total claimed amount is sent to that delegation account, otherwise claimed amount is sent to owner's account.
     * @notice Claimed amount is automatically wrapped.
     * @notice Method can be used by reward owner or executor. If executor is registered with fee > 0,
     *   then fee is paid to executor for each claimed address from the list.
     * @param _rewardOwners         list of reward owners to claim for
     * @param _month                last month to claim for
     */
    //slither-disable-next-line reentrancy-eth          // guarded by nonReentrant
    function autoClaim(address[] calldata _rewardOwners, uint256 _month)
        external override
        entitlementStarted
        notStopped
        mustBalance
        nonReentrant
    {
        for (uint256 i = 0; i < _rewardOwners.length; i++) {
            _checkNonzeroRecipient(_rewardOwners[i]);
        }

        uint256 monthToExpireNext = getMonthToExpireNext();
        _checkIsMonthClaimable(monthToExpireNext, _month);

        (address[] memory claimAddresses, uint256 executorFeeValue) =
            claimSetupManager.getAutoClaimAddressesAndExecutorFee(msg.sender, _rewardOwners);

        uint256 totalClaimedWeiTemp;
        for (uint256 i = 0; i < _rewardOwners.length; i++) {
            address rewardOwner = _rewardOwners[i];
            address claimAddress = claimAddresses[i];
            uint256 rewardAmount = 0;

            if (!optOut[rewardOwner]) {
                // claim for owner
                rewardAmount += _claim(rewardOwner, claimAddress, monthToExpireNext, _month);
            }
            if (rewardOwner != claimAddress) {
                // claim for PDA - cannot be opt out
                rewardAmount += _claim(claimAddress, claimAddress, monthToExpireNext, _month);
            }
            totalClaimedWeiTemp += rewardAmount;
            rewardAmount = rewardAmount.sub(executorFeeValue, ERR_CLAIMED_AMOUNT_TOO_SMALL);
            _transferOrWrap(claimAddress, rewardAmount, true);
        }
        // Update grand total claimed
        totalClaimedWei = totalClaimedWei.add(totalClaimedWeiTemp);
        // send fees to executor
        _transferOrWrap(msg.sender, executorFeeValue.mul(_rewardOwners.length), false);
    }



    /**
     * @notice Return token pool supply data
     * @return _lockedFundsWei                  Foundation locked funds (wei)
     * @return _totalInflationAuthorizedWei     Total inflation authorized amount (wei)
     * @return _totalClaimedWei                 Total claimed amount (wei)
     */
    function getTokenPoolSupplyData() external view override
        returns (uint256 _lockedFundsWei, uint256 _totalInflationAuthorizedWei, uint256 _totalClaimedWei)
    {
        // This is the total amount of tokens that are actually already in circulating supply
        _lockedFundsWei =
            stopped ? totalClaimedWei.add(totalBurnedWei).add(address(this).balance) : totalEntitlementWei;
        // We will never increase this balance since distribution funds are taken from genesis
        // amounts and not from inflation.
        _totalInflationAuthorizedWei = 0;
        // What was actually already added to circulating supply
        _totalClaimedWei = totalClaimedWei.add(totalBurnedWei);
    }

    /**
     * @notice get claimable amount of wei for requesting account for specified month
     * @param _month month of interest
     * @return _amountWei amount of wei available for this account and provided month
     */
    function getClaimableAmount(uint256 _month) external view override entitlementStarted
        returns(uint256 _amountWei)
    {
        _checkOptOut(msg.sender);
        _checkIsMonthClaimable(getMonthToExpireNext(), _month);
        (, _amountWei) = _getClaimableWei(msg.sender, _month);
    }

    /**
     * @notice get claimable amount of wei for account for specified month
     * @param _account the address of an account we want to get the claimable amount of wei
     * @param _month month of interest
     * @return _amountWei amount of wei available for provided account and month
     */
    function getClaimableAmountOf(address _account, uint256 _month) external view override entitlementStarted
        returns(uint256 _amountWei)
    {
        _checkOptOut(_account);
        _checkIsMonthClaimable(getMonthToExpireNext(), _month);
        (, _amountWei) = _getClaimableWei(_account, _month);
    }

    /**
     * @notice Returns claimable months - reverts if none
     * @return _startMonth first claimable month
     * @return _endMonth last claimable month
     */
    function getClaimableMonths() external view override returns(uint256 _startMonth, uint256 _endMonth) {
        require(nextMonthToClaimCandidate > 0, ERR_NO_MONTH_CLAIMABLE);
        _startMonth = getMonthToExpireNext();
        _endMonth = nextMonthToClaimCandidate - 1;
        require(_startMonth <= _endMonth && _startMonth < NUMBER_OF_MONTHS, ERR_ALREADY_FINISHED);
    }

    /**
     * @notice Returns the next claimable month for '_rewardOwner'.
     * @param _rewardOwner          address of the reward owner
     */
    function nextClaimableMonth(address _rewardOwner) external view override returns (uint256) {
        return _nextClaimableMonth(_rewardOwner, getMonthToExpireNext());
    }

    function switchToFallbackMode() external view override onlyFlareDaemon returns (bool) {
        // do nothing - there is no fallback mode in DistributionToDelegators
        return false;
    }

    /**
     * @notice Implement this function for updating daemonized contracts through AddressUpdater.
     */
    function getContractName() external pure override returns (string memory) {
        return "DistributionToDelegators";
    }

    /**
     * @notice Returns the current month
     * @return _currentMonth Current month, 0 before entitlementStartTs
     */
    function getCurrentMonth() public view override returns (uint256 _currentMonth) {
        (, uint256 diffSec) = block.timestamp.trySub(entitlementStartTs);
        return diffSec.div(MONTH);
    }

    /**
     * @notice Returns the month that will expire next
     * @return _monthToExpireNext Month that will expire next, 36 when last month expired
     */
    function getMonthToExpireNext() public view override returns (uint256 _monthToExpireNext) {
        uint256 cleanupBlockNumber = wNat.cleanupBlockNumber();
        uint256 blockNumber = startBlockNumber[nextMonthToExpireCandidate];
        if (blockNumber > 0 && blockNumber < cleanupBlockNumber) return nextMonthToExpireCandidate + 1;
        return nextMonthToExpireCandidate;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////
    // Update contracts

    /**
     * @notice Implementation of the AddressUpdatable abstract method.
     */
    function _updateContractAddresses(
        bytes32[] memory _contractNameHashes,
        address[] memory _contractAddresses
    )
        internal override
    {
        wNat = WNat(payable(_getContractAddress(_contractNameHashes, _contractAddresses, "WNat")));
        claimSetupManager = ClaimSetupManager(
            _getContractAddress(_contractNameHashes, _contractAddresses, "ClaimSetupManager"));
        priceSubmitter = IIRandomProvider(
            _getContractAddress(_contractNameHashes, _contractAddresses, "PriceSubmitter"));
        combinedNat = IICombinedNatBalance(
            _getContractAddress(_contractNameHashes, _contractAddresses, "CombinedNat"));
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////
    // Helpers

    /**
     * @notice Method for claiming unlocked airdrop amounts for specified month
     * @param _rewardOwner address of the owner of airdrop rewards
     * @param _recipient address representing the recipient of the reward
     * @param _month last month of interest
     * @return _claimedWei claimed amount
     */
    function _claimOrWrap(
        address _rewardOwner,
        address _recipient,
        uint256 _month,
        bool _wrap
    )
        internal returns(uint256 _claimedWei)
    {
        _checkNonzeroRecipient(_recipient);
        _checkOptOut(_rewardOwner);
        uint256 monthToExpireNext = getMonthToExpireNext();
        _checkIsMonthClaimable(monthToExpireNext, _month);
        _claimedWei = _claim(_rewardOwner, _recipient, monthToExpireNext, _month);
        // Update grand total claimed
        totalClaimedWei = totalClaimedWei.add(_claimedWei);
        _transferOrWrap(_recipient, _claimedWei, _wrap);
    }

    /**
     * @notice Transfers or wrap (deposit) `_rewardAmount` to `_recipient`.
     * @param _recipient            address representing the reward recipient
     * @param _rewardAmount         number representing the amount to transfer
     * @param _wrap                 should reward be wrapped immediately
     * @dev Uses low level call to transfer funds.
     */
    function _transferOrWrap(address _recipient, uint256 _rewardAmount, bool _wrap) internal {
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
                require(success, ERR_CLAIM_FAILED);
            }
        }
    }

    /**
     * @notice Calculate and pull the distributable amount for the specified month
     * @param _month month of interest
     * @dev Every 30 days from initial day 1/36 of the total amount is unlocked and becomes available for claiming
     */
    function _updateDistributableAmount(uint256 _month) internal {
        // maximal claimable bips for this month
        uint256 claimBIPS = Math.min((_month + 1).mul(MONTHLY_CLAIMABLE_BIPS), TOTAL_CLAIMABLE_BIPS);
        // what can be distributed minus what was already distributed till now
        uint256 amountWei = Math.min(Math.min(
            totalEntitlementWei.mulDiv(claimBIPS, TOTAL_CLAIMABLE_BIPS) - totalDistributableAmount,
            treasury.MAX_PULL_AMOUNT_WEI()),
            address(treasury).balance);
        // update total values
        totalAvailableAmount[_month] = amountWei;
        totalUnclaimedAmount[_month] = amountWei;
        totalDistributableAmount += amountWei;
        // enable claims for current month
        nextMonthToClaimCandidate = uint128(_month + 1); // max _month is 35
        // pull funds
        treasury.pullFunds(amountWei);
    }

    /**
     * @notice Calculate random vote power blocks and weight for the specified month
     * @param _month month of interest
     * @return info if successfully calculated - random ok
     */
    function _updateVotePowerBlocksAndWeight(uint256 _month) internal returns (bool) {
        uint256 random;
        if (useGoodRandom) {
            bool goodRandom;
            (random, goodRandom) = priceSubmitter.getCurrentRandomWithQuality();
            if (!goodRandom) {
                if (waitingForGoodRandomSinceTs == 0) {
                    // random is not good for the first time - set start waiting timestamp
                    waitingForGoodRandomSinceTs = block.timestamp;
                    return false; // wait
                } else if (waitingForGoodRandomSinceTs + maxWaitForGoodRandomSeconds <= block.timestamp) {
                    // we have waited long enough - reset start waiting timestamp and proceed
                    waitingForGoodRandomSinceTs = 0;
                } else {
                    return false; // wait
                }
            } else {
                waitingForGoodRandomSinceTs = 0; // we got a good random - reset start waiting timestamp
            }
        } else {
            random = block.timestamp + priceSubmitter.getCurrentRandom();
        }

        uint256 startBlock = startBlockNumber[_month];
        uint256 endBlock = endBlockNumber[_month];
        // no underflow as endBlock is set later as startBlock
        uint256 slotSize = (endBlock - startBlock) / NUMBER_OF_VOTE_POWER_BLOCKS;
        uint256[] memory votePowerBlocks = new uint256[](NUMBER_OF_VOTE_POWER_BLOCKS);
        for (uint256 i = 0; i < NUMBER_OF_VOTE_POWER_BLOCKS; i++) {
            random = uint256(keccak256(abi.encode(random, i)));
            //slither-disable-next-line weak-prng
            uint256 votePowerBlock = startBlock + i * slotSize + random % slotSize;
            votePowerBlocks[i] = votePowerBlock;
        }
        votePowerBlockNumbers[_month] = votePowerBlocks;
        totalUnclaimedWeight[_month] = _calculateUnclaimedWeight(votePowerBlocks);
        return true;
    }

    function _claim(
        address _rewardOwner,
        address _recipient,
        uint256 _monthToExpireNext,
        uint256 _month
    )
        internal returns (uint256 _claimedWei)
    {
        for (uint256 month = _nextClaimableMonth(_rewardOwner, _monthToExpireNext); month <= _month; month++) {
            (uint256 weight, uint256 claimableWei) = _getClaimableWei(_rewardOwner, month);
            if (claimableWei > 0) {
                totalUnclaimedAmount[month] = totalUnclaimedAmount[month].sub(claimableWei);
                totalUnclaimedWeight[month] = totalUnclaimedWeight[month].sub(weight);
                _claimedWei += claimableWei;

                // Emit the claim event
                emit AccountClaimed(_rewardOwner, _recipient, month, claimableWei);
            }
        }
        if (ownerNextClaimableMonth[_rewardOwner] < _month + 1) {
            ownerNextClaimableMonth[_rewardOwner] = _month + 1;
        }
    }

    function _checkIsMonthClaimable(uint256 _monthToExpireNext, uint256 _month) internal view {
        require(_monthToExpireNext <= _month, ERR_MONTH_EXPIRED);
        require(_month < NUMBER_OF_MONTHS, ERR_MONTH_NOT_CLAIMABLE);
        // it may not be yet claimable if first block in new month or if waiting for good random
        require(_month < nextMonthToClaimCandidate, ERR_MONTH_NOT_CLAIMABLE_YET);
    }

    function _checkOptOut(address _account) internal view {
        require(!optOut[_account], ERR_OPT_OUT);
    }

    /**
     * @notice Get the total unclaimed weight for the specified vote power blocks
     * @param _votePowerBlocks array of vote power blocks of interest
     * @return _amountWei unclaimed weight of wei at vote power blocks
     */
    function _calculateUnclaimedWeight(uint256[] memory _votePowerBlocks) internal view returns (uint256 _amountWei) {
        for (uint256 i = 0; i < NUMBER_OF_VOTE_POWER_BLOCKS; i++) {
            _amountWei += combinedNat.totalSupplyAt(_votePowerBlocks[i]);
        }
        uint256 len = optOutAddresses.length;
        while (len > 0) {
            len--;
            address optOutAddress = optOutAddresses[len];
            for (uint256 i = 0; i < NUMBER_OF_VOTE_POWER_BLOCKS; i++) {
                _amountWei -= combinedNat.balanceOfAt(optOutAddress, _votePowerBlocks[i]);
            }
        }
    }

    function _nextClaimableMonth(address _owner, uint256 _monthToExpireNext) internal view returns (uint256) {
        return Math.max(ownerNextClaimableMonth[_owner], _monthToExpireNext);
    }

    /**
     * @notice Get weight and claimable amount for users account for the specified month
     * @param _owner address of interest
     * @param _month month of interest
     * @dev Every 30 days from initial day 1/36 of the amount is released
     */
    function _getClaimableWei(address _owner, uint256 _month) internal view
        returns(uint256 _weight, uint256 _claimableWei)
    {
        if (ownerNextClaimableMonth[_owner] > _month) {
            return (0, 0);
        }

        uint256 unclaimedAmount = totalUnclaimedAmount[_month];
        if (unclaimedAmount == 0) {
            return (0, 0);
        }

        uint256[] memory votePowerBlocks = votePowerBlockNumbers[_month];
        for (uint256 i = 0; i < NUMBER_OF_VOTE_POWER_BLOCKS; i++) {
            _weight += combinedNat.balanceOfAt(_owner, votePowerBlocks[i]);
        }
        if (_weight == 0) {
            return (0, 0);
        }

        uint256 unclaimedWeight = totalUnclaimedWeight[_month];
        if (_weight == unclaimedWeight) {
            return (_weight, unclaimedAmount);
        }
        assert(_weight < unclaimedWeight);
        return (_weight, unclaimedAmount.mulDiv(_weight, unclaimedWeight));
    }

    function _checkExecutorAndAllowedRecipient(address _rewardOwner, address _recipient) private view {
        if (msg.sender == _rewardOwner) {
            return;
        }
        claimSetupManager.checkExecutorAndAllowedRecipient(msg.sender, _rewardOwner, _recipient);
    }

    /**
     * @notice Compute the expected balance of this contract.
     * @param _balanceExpectedWei The computed balance expected.
     */
    function _getExpectedBalance() private view returns(uint256 _balanceExpectedWei) {
        return stopped ? 0 : totalDistributableAmount.sub(totalClaimedWei).sub(totalBurnedWei);
    }

    function _checkNonzeroRecipient(address _address) private pure {
        require(_address != address(0), ERR_RECIPIENT_ZERO);
    }
}
