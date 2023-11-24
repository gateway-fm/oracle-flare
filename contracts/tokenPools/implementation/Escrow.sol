// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../../governance/implementation/Governed.sol";
import "@openzeppelin/contracts/utils/SafeCast.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/math/Math.sol";
import "../../utils/implementation/SafePct.sol";
import "../interface/IITokenPool.sol";
import "../../addressUpdater/implementation/AddressUpdatable.sol";
import "../../token/implementation/WNat.sol";
import "../../utils/implementation/AddressSet.sol";


contract Escrow is Governed, IITokenPool, AddressUpdatable  {
    using SafeCast for uint256;
    using SafeMath for uint256;
    using SafePct for uint256;
    using AddressSet for AddressSet.State;

    struct LockedAmount {
        uint256 totalLockedAmountWei;
        uint256 totalClaimedAmountWei;
    }

    uint256 public immutable latestClaimStartTs;
    uint256 public claimStartTs;
    // Time based constants
    uint256 internal constant MONTH = 30;
    // 2.37% every 30 days (so total distribution takes 36 * 30 days =~ 3 years)
    uint256 internal constant MONTHLY_CLAIMABLE_BIPS = 237;

    uint256 public constant DIRECT_CLAIM_BIPS = 1500;
    uint256 public constant LOCKED_CLAIM_BIPS = 8500;
    uint256 public constant FULL_CLAIM_BIPS = DIRECT_CLAIM_BIPS + LOCKED_CLAIM_BIPS;

    // sum(lockedAmounts.totalLockedAmountWei)
    uint256 public totalLockedAmountWei = 0;
    // sum(lockedAmounts.totalClaimedAmountWei)
    uint256 public totalClaimedAmountWei = 0;

    mapping(address => LockedAmount) public lockedAmounts;
    mapping(address => address) public proposedNewOwner; // old owner => new owner mapping

    // mapping reward owner address => executor set
    mapping(address => AddressSet.State) private claimExecutorSet;
    
    // mapping reward owner address => claim recipient address
    mapping(address => AddressSet.State) private allowedClaimRecipientSet;

    // contracts
    WNat public wNat;

    event ClaimStart(uint256 claimStartTs);
    event AccountLocked(address indexed whoLocked, uint256 amountWei);
    event AccountClaimed(address indexed whoClaimed, address indexed sentTo, uint256 amountWei);
    event OwnerChanged(address indexed oldOwner, address indexed newOwner);
    event ClaimExecutorsChanged(address owner, address[] executors);
    event AllowedClaimRecipientsChanged(address owner, address[] recipients);

    modifier onlyExecutorAndAllowedRecipient(address _owner, address _recipient) {
        _checkExecutorAndAllowedRecipient(_owner, _recipient);
        _;
    }

    constructor(
        address _governance,
        address _addressUpdater,
        uint256 _latestClaimStartTs
    ) 
        Governed(_governance)
        AddressUpdatable(_addressUpdater)
    {
        require(_latestClaimStartTs >= block.timestamp, "In the past");
        latestClaimStartTs = _latestClaimStartTs;
        claimStartTs = _latestClaimStartTs;
        emit ClaimStart(_latestClaimStartTs);
    }

    /**
     * @notice Lock funds to the owner's (`msg.sender`) address 
     */
    function lock() external payable {
        totalLockedAmountWei += msg.value;
        lockedAmounts[msg.sender].totalLockedAmountWei += msg.value;
        // Emit the locked event
        emit AccountLocked(msg.sender, msg.value);
    }

    /**
     * Method for claiming unlocked funds directly to the owner's address.
     */
    function claim() external {
        _claimOrWrap(msg.sender, msg.sender, false);
    }

    /**
     * Method for claiming unlocked funds to a specified target address.
     * @param _target Target address to claim funds to
     */
    function claimTo(address _target) external {
        _claimOrWrap(msg.sender, _target, false);
    }

    /**
     * Method for claiming unlocked funds directly to the owner's address.
     * It can only be called by executor which can be set by the `_owner`.
     * @param _owner The address of the funds' owner.
     */
    function claimByExecutor(address _owner, address _recipient) external 
        onlyExecutorAndAllowedRecipient(_owner, _recipient)
    {
        _claimOrWrap(_owner, _recipient, false);
    }

    /**
     * Method for claiming and wrapping unlocked funds directly to the owner's address.
     */
    function claimAndWrap() external {
        _claimOrWrap(msg.sender, msg.sender, true);
    }

    /**
     * Method for claiming and wrapping unlocked funds to a specified target address.
     * @param _target Target address to claim funds to
     */
    function claimAndWrapTo(address _target) external {
        _claimOrWrap(msg.sender, _target, true);
    }

    /**
     * Method for claiming and wrapping unlocked funds directly to the owner's address.
     * It can only be called by executor which can be set by the `_owner`.
     * @param _owner The address of the funds' owner.
     */
    function claimAndWrapByExecutor(address _owner, address _recipient) external 
        onlyExecutorAndAllowedRecipient(_owner, _recipient)
    {
        _claimOrWrap(_owner, _recipient, true);
    }

    /**
     * Propose new owner of the funds.
     * @param _newOwner The address of a new owner.
     */
    function proposeNewOwner(address _newOwner) external {
        proposedNewOwner[msg.sender] = _newOwner;
    }

    /**
     * Claim ownership of the funds from `_oldOwner`.
     * @param _oldOwner The address of the old owner.
     */
    function claimNewOwner(address _oldOwner) external {
        address newOwner = msg.sender;
        require(proposedNewOwner[_oldOwner] != address(0) && proposedNewOwner[_oldOwner] == newOwner,
            "Wrong old owner");
        require(lockedAmounts[newOwner].totalLockedAmountWei == 0, "Already locked");
        lockedAmounts[newOwner].totalLockedAmountWei = lockedAmounts[_oldOwner].totalLockedAmountWei;
        lockedAmounts[newOwner].totalClaimedAmountWei = lockedAmounts[_oldOwner].totalClaimedAmountWei;
        delete lockedAmounts[_oldOwner];
        delete proposedNewOwner[_oldOwner];
        emit OwnerChanged(_oldOwner, newOwner);
    }

    /**
     * Set the addresses of executors, who are allowed to call claimByExecutor and claimAndWrapByExecutor.
     * @param _executors The new executors. All old executors will be deleted and replaced by these.
     */    
    function setClaimExecutors(address[] memory _executors) external {
        claimExecutorSet[msg.sender].replaceAll(_executors);
        emit ClaimExecutorsChanged(msg.sender, _executors);
    }
    
    /**
     * Set the addresses of allowed recipients in the methods claimByExecutor and claimAndWrapByExecutor.
     * Apart from these, the owner is always an allowed recipient.
     * @param _recipients The new allowed recipients. All old recipients will be deleted and replaced by these.
     */    
    function setAllowedClaimRecipients(address[] memory _recipients) external {
        allowedClaimRecipientSet[msg.sender].replaceAll(_recipients);
        emit AllowedClaimRecipientsChanged(msg.sender, _recipients);
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
        _lockedFundsWei = totalLockedAmountWei;
        _totalInflationAuthorizedWei = 0; // New funds are never created here
        _totalClaimedWei = totalClaimedAmountWei;
    }

    /**
     * @notice Enable claiming from contract at _claimStartTs timestamp
     * @param _claimStartTs point in time when we start
     */
    function setClaimingStartTs(uint256 _claimStartTs) public onlyGovernance {
        require(claimStartTs > block.timestamp, "Already started");
        require(_claimStartTs >= block.timestamp && _claimStartTs <= latestClaimStartTs,
            "Wrong start timestamp");
        claimStartTs = _claimStartTs;
    }

    /**
     * @notice Get the claimable percent for the current timestamp
     * @return percentBips maximal claimable bips at current timestamp
     */
    function getCurrentClaimablePercentBips(uint256 _timestamp) public view 
        returns(uint256 percentBips)
    {
        require(claimStartTs <= _timestamp, "Claiming not started");
        uint256 diffDays = _timestamp.sub(claimStartTs).div(1 days);
        percentBips = Math.min(diffDays.div(MONTH).mul(MONTHLY_CLAIMABLE_BIPS), LOCKED_CLAIM_BIPS);
    }

    /**
     * @notice Get current claimable amount for users account
     * @dev Every 30 days from initial day 2.37% of the reward is released
     */
    function getCurrentClaimableWei(address _owner) public view 
        returns(uint256 _claimableWei)
    {
        // Attempt to get the account in question
        LockedAmount memory lockedAmount = lockedAmounts[_owner];
        uint256 currentlyClaimableBips = getCurrentClaimablePercentBips(block.timestamp);

        uint256 availableClaimWei = lockedAmount.totalLockedAmountWei.mulDiv(
            currentlyClaimableBips, LOCKED_CLAIM_BIPS
        );
        // Can never claim more that we are initially entiteled to
        availableClaimWei = Math.min(availableClaimWei, lockedAmount.totalLockedAmountWei);
        // Substract already claimed
        _claimableWei = availableClaimWei - lockedAmount.totalClaimedAmountWei; 
    }

    /**
     * Get the addresses of executors, who are allowed to call claimByExecutor and claimAndWrapByExecutor.
     */    
    function claimExecutors(address _rewardOwner) external view returns (address[] memory) {
        return claimExecutorSet[_rewardOwner].list;
    }

    /**
     * Get the addresses of allowed recipients in the methods claimByExecutor and claimAndWrapByExecutor.
     * Apart from these, the owner is always an allowed recipient.
     */    
    function allowedClaimRecipients(address _rewardOwner) external view returns (address[] memory) {
        return allowedClaimRecipientSet[_rewardOwner].list;
    }

    function _claimOrWrap(address _owner, address _target, bool _wrap) internal {
        uint256 claimableWei = getCurrentClaimableWei(_owner);
        require(claimableWei > 0, "No claimable funds");

        lockedAmounts[_owner].totalClaimedAmountWei += claimableWei;
        totalClaimedAmountWei += claimableWei;
        if (_wrap) {
            _wrapFunds(_target, claimableWei);
        } else {
            _transferFunds(_target, claimableWei);
        }
        emit AccountClaimed(_owner, _target, claimableWei);
    }

    /**
     * @notice Wrap (deposit) `_claimableAmount` to `_recipient` on WNat.
     * @param _recipient            address representing the reward recipient
     * @param _claimableAmount      number representing the amount to transfer
     */
    function _wrapFunds(address _recipient, uint256 _claimableAmount) internal {
        // transfer total amount (state is updated and events are emitted in _claimOrWrap)
        //slither-disable-next-line arbitrary-send-eth          // amount always calculated by _claimOrWrap
        wNat.depositTo{value: _claimableAmount}(_recipient);
    }

    /**
     * @notice Transfers `_claimableAmount` to `_recipient`.
     * @param _recipient            address representing the reward recipient
     * @param _claimableAmount      number representing the amount to transfer
     * @dev Uses low level call to transfer funds.
     */
    function _transferFunds(address _recipient, uint256 _claimableAmount) internal {
        // transfer total amount (state is updated and events are emitted in _claimOrWrap)
        /* solhint-disable avoid-low-level-calls */
        //slither-disable-next-line arbitrary-send-eth          // amount always calculated by _claimOrWrap
        (bool success, ) = _recipient.call{value: _claimableAmount}("");
        /* solhint-enable avoid-low-level-calls */
        require(success, "Failed to call claiming contract");
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
        wNat = WNat(payable(_getContractAddress(_contractNameHashes, _contractAddresses, "WNat")));
    }

    function _checkExecutorAndAllowedRecipient(address _owner, address _recipient) private view {
        require(claimExecutorSet[_owner].index[msg.sender] != 0, "Claim executor only");
        require(_recipient == _owner || allowedClaimRecipientSet[_owner].index[_recipient] != 0,
            "Recipient not allowed");
    }
}
