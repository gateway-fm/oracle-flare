// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "./CloneFactory.sol";
import "../interface/IIClaimSetupManager.sol";
import "../interface/IIDelegationAccount.sol";
import "../../userInterfaces/IFtsoManager.sol";
import "../../governance/implementation/Governed.sol";
import "../../addressUpdater/implementation/AddressUpdatable.sol";
import "../../utils/implementation/AddressSet.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * Manages automation of operations related to reward claiming.
 *
 * Rewards include [FTSO rewards](https://docs.flare.network/tech/ftso) and
 * [airdrops](https://docs.flare.network/tech/the-flaredrop/).
 * Managed operations include [Automatic Claiming](https://docs.flare.network/tech/automatic-claiming) and
 * [Personal Delegation Accounts](https://docs.flare.network/tech/personal-delegation-account).
 */
contract ClaimSetupManager is IIClaimSetupManager,
    Governed, AddressUpdatable, CloneFactory, ReentrancyGuard
{
    using AddressSet for AddressSet.State;

    struct ExecutorFee {            // Used for storing executor fee settings.
        uint256 value;              // Fee value (value between `minFeeValueWei` and `maxFeeValueWei`).
        uint256 validFromEpoch;     // Id of the reward epoch from which the value is valid.
    }

    struct DelegationAccountData {              // Used for storing data about delegation account.
        IIDelegationAccount delegationAccount;  // Delegation account address.
        bool enabled;                           // Indicates if delegation account is enabled.
    }

    string internal constant ERR_EXECUTOR_FEE_INVALID = "invalid executor fee value";
    string internal constant ERR_TRANSFER_FAILURE = "transfer failed";
    string internal constant ERR_FEE_INVALID = "invalid fee value";
    string internal constant ERR_VALUE_ZERO = "value zero";
    string internal constant ERR_MIN_FEE_INVALID = "invalid min fee value";
    string internal constant ERR_MAX_FEE_INVALID = "invalid max fee value";
    string internal constant ERR_ADDRESS_ZERO = "address zero";
    string internal constant ERR_NOT_REGISTERED = "not registered";
    string internal constant ERR_ALREADY_REGISTERED = "already registered";
    string internal constant ERR_REWARD_EPOCH_INVALID = "invalid reward epoch";
    string internal constant ERR_FEE_UPDATE_FAILED = "fee can not be updated";
    string internal constant ERR_NO_DELEGATION_ACCOUNT = "no delegation account";
    string internal constant ERR_LIBRARY_ADDRESS_NOT_SET_YET = "library address not set yet";
    string internal constant ERR_CREATE_CLONE = "clone not successfully created";
    string internal constant ERR_ONLY_OWNER_OR_EXECUTOR = "only owner or executor";
    string internal constant ERR_RECIPIENT_NOT_ALLOWED = "recipient not allowed";
    string internal constant ERR_WRONG_WNAT_ADDRESS = "wrong wNat address";

    address payable constant internal BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    /// Number of reward epochs that must elapse before an executor's fee change takes effect.
    uint256 public immutable feeValueUpdateOffset;
    /// Minimum allowed value for an executor's fee.
    uint256 public minFeeValueWei;
    /// Maximum allowed value for an executor's fee.
    uint256 public maxFeeValueWei;
    /// Fee that must be paid to register an executor.
    uint256 public registerExecutorFeeValueWei;

    /// The `FtsoManager` contract.
    IFtsoManager public ftsoManager;
    /// The `WNat` contract.
    WNat public override wNat;
    /// The `GovernanceVotePower` contract.
    IGovernanceVotePower public governanceVP;

    address public libraryAddress;

    // mapping owner address => delegation account address
    mapping(address => DelegationAccountData) private ownerToDelegationAccountData;
    mapping(address => address) private delegationAccountToOwner;

    // mapping owner address => executor set
    mapping(address => AddressSet.State) private ownerClaimExecutorSet;

    // mapping owner address => claim recipient address
    mapping(address => AddressSet.State) private ownerAllowedClaimRecipientSet;

    // mapping executor address => executor fees
    //slither-disable-next-line uninitialized-state
    mapping(address => ExecutorFee[]) private claimExecutorFees;

    AddressSet.State private registeredExecutors;

    modifier onlyOwnerOrExecutor(address _executor, address[] memory _owners) {
        _checkOnlyOwnerOrExecutor(_executor, _owners);
        _;
    }

    constructor(
        address _governance,
        address _addressUpdater,
        uint256 _feeValueUpdateOffset,
        uint256 _minFeeValueWei,
        uint256 _maxFeeValueWei,
        uint256 _registerExecutorFeeValueWei
    )
        Governed(_governance)
        AddressUpdatable(_addressUpdater)
    {
        require(_feeValueUpdateOffset > 0, ERR_VALUE_ZERO);
        require(_maxFeeValueWei > _minFeeValueWei, ERR_MAX_FEE_INVALID);
        require(_registerExecutorFeeValueWei > 0, ERR_VALUE_ZERO);
        feeValueUpdateOffset = _feeValueUpdateOffset;
        minFeeValueWei = _minFeeValueWei;
        maxFeeValueWei = _maxFeeValueWei;
        emit MinFeeSet(_minFeeValueWei);
        emit MaxFeeSet(_maxFeeValueWei);
        registerExecutorFeeValueWei = _registerExecutorFeeValueWei;
        emit RegisterExecutorFeeSet(_registerExecutorFeeValueWei);
    }

    /**
     * @inheritdoc IClaimSetupManager
     */
    function setAutoClaiming(address[] memory _executors, bool _enableDelegationAccount)
        external payable override nonReentrant
    {
        _setClaimExecutors(_executors);
        if (_enableDelegationAccount) {
            _createOrEnableDelegationAccount();
        }
    }

    /**
     * @inheritdoc IClaimSetupManager
     */
    function setClaimExecutors(address[] memory _executors) external payable override nonReentrant {
        _setClaimExecutors(_executors);
    }

    /**
     * @inheritdoc IClaimSetupManager
     */
    function enableDelegationAccount() external override returns (IDelegationAccount) {
        return _createOrEnableDelegationAccount();
    }

    /**
     * @inheritdoc IClaimSetupManager
     */
    function disableDelegationAccount() external override {
        DelegationAccountData storage delegationAccountData = ownerToDelegationAccountData[msg.sender];
        IIDelegationAccount delegationAccount = delegationAccountData.delegationAccount;
        require(address(delegationAccount) != address(0), ERR_NO_DELEGATION_ACCOUNT);
        delegationAccountData.enabled = false;
        uint256 amount = wNat.balanceOf(address(delegationAccount));
        if (amount > 0) {
            delegationAccount.withdraw(wNat, amount);
        }
        emit DelegationAccountUpdated(msg.sender, delegationAccount, false);
    }

    /**
     * @inheritdoc IClaimSetupManager
     */
    function registerExecutor(uint256 _feeValue) external payable override returns (uint256) {
        require(registeredExecutors.index[msg.sender] == 0, ERR_ALREADY_REGISTERED);
        require(registerExecutorFeeValueWei == msg.value, ERR_EXECUTOR_FEE_INVALID);
        //slither-disable-next-line arbitrary-send-eth
        BURN_ADDRESS.transfer(msg.value);
        // add and emit event
        registeredExecutors.add(msg.sender);
        emit ExecutorRegistered(msg.sender);
        // check last executor fee change
        uint256 currentRewardEpoch = ftsoManager.getCurrentRewardEpoch();
        ExecutorFee[] storage efs = claimExecutorFees[msg.sender];
        if (efs.length == 0 || efs[efs.length - 1].validFromEpoch < currentRewardEpoch) {
            // if registering for the first time or after a while, sets the fee value from current epoch on
            require( _feeValue >= minFeeValueWei, ERR_FEE_INVALID);
            require( _feeValue <= maxFeeValueWei, ERR_FEE_INVALID);
            efs.push(ExecutorFee({value: _feeValue, validFromEpoch: currentRewardEpoch}));
            emit ClaimExecutorFeeValueChanged(msg.sender, currentRewardEpoch, _feeValue);
            return currentRewardEpoch;
        } else {
            return _updateExecutorFeeValue(currentRewardEpoch, _feeValue);
        }
    }

    /**
     * @inheritdoc IClaimSetupManager
     */
    function unregisterExecutor() external override returns (uint256 _validFromEpoch) {
        require(registeredExecutors.index[msg.sender] != 0, ERR_NOT_REGISTERED);
        // remove from registered
        registeredExecutors.remove(msg.sender);
        // set fee to 0 (after `feeValueUpdateOffset` - to prevent immediate new registration)
        _validFromEpoch = _updateExecutorFeeValue(ftsoManager.getCurrentRewardEpoch(), 0);
        // emit event
        emit ExecutorUnregistered(msg.sender, _validFromEpoch);
    }

    /**
     * @inheritdoc IClaimSetupManager
     */
    function updateExecutorFeeValue(
        uint256 _feeValue
    )
        external override
        returns (uint256)
    {
        require(registeredExecutors.index[msg.sender] != 0, ERR_NOT_REGISTERED);
        return _updateExecutorFeeValue(ftsoManager.getCurrentRewardEpoch(), _feeValue);
    }

    /**
     * @inheritdoc IClaimSetupManager
     */
    function delegate(address _to, uint256 _bips) external override {
        _getDelegationAccount(msg.sender).delegate(wNat, _to, _bips);
    }

    /**
     * @inheritdoc IClaimSetupManager
     */
    function batchDelegate(address[] memory _delegatees, uint256[] memory _bips) external override {
        _getDelegationAccount(msg.sender).batchDelegate(wNat, _delegatees, _bips);
    }

    /**
     * @inheritdoc IClaimSetupManager
     */
    function undelegateAll() external override {
        _getDelegationAccount(msg.sender).undelegateAll(wNat);
    }

    /**
     * @inheritdoc IClaimSetupManager
     */
    function revokeDelegationAt(address _who, uint256 _blockNumber) external override {
        _getDelegationAccount(msg.sender).revokeDelegationAt(wNat, _who, _blockNumber);
    }

    /**
     * @inheritdoc IClaimSetupManager
     */
    function delegateGovernance(address _to) external override {
        _getDelegationAccount(msg.sender).delegateGovernance(governanceVP, _to);
    }

    /**
     * @inheritdoc IClaimSetupManager
     */
    function undelegateGovernance() external override {
        _getDelegationAccount(msg.sender).undelegateGovernance(governanceVP);
    }

    /**
     * @inheritdoc IClaimSetupManager
     */
    function withdraw(uint256 _amount) external override {
        _getDelegationAccount(msg.sender).withdraw(wNat, _amount);
    }

    /**
     * @inheritdoc IClaimSetupManager
     */
    function transferExternalToken(IERC20 _token, uint256 _amount) external override nonReentrant {
        _getDelegationAccount(msg.sender).transferExternalToken(wNat, _token, _amount);
    }

    /**
     * @inheritdoc IIClaimSetupManager
     * @dev Only governance can call this.
     */
    function setMinFeeValueWei(uint256 _minFeeValueWei) external override onlyGovernance {
        require(_minFeeValueWei < maxFeeValueWei, ERR_MIN_FEE_INVALID);
        minFeeValueWei = _minFeeValueWei;
        emit MinFeeSet(_minFeeValueWei);
    }

    /**
     * @inheritdoc IIClaimSetupManager
     * @dev Only governance can call this.
     */
    function setMaxFeeValueWei(uint256 _maxFeeValueWei) external override onlyGovernance {
        require(_maxFeeValueWei > minFeeValueWei, ERR_MAX_FEE_INVALID);
        maxFeeValueWei = _maxFeeValueWei;
        emit MaxFeeSet(_maxFeeValueWei);
    }

    /**
     * @inheritdoc IIClaimSetupManager
     * @dev Only governance can call this.
     */
    function setRegisterExecutorFeeValueWei(uint256 _registerExecutorFeeValueWei) external override onlyGovernance {
        require(_registerExecutorFeeValueWei > 0, ERR_VALUE_ZERO);
        registerExecutorFeeValueWei = _registerExecutorFeeValueWei;
        emit RegisterExecutorFeeSet(_registerExecutorFeeValueWei);
    }

    /**
     * @inheritdoc IClaimSetupManager
     */
    function setAllowedClaimRecipients(address[] memory _recipients) external override {
        ownerAllowedClaimRecipientSet[msg.sender].replaceAll(_recipients);
        emit AllowedClaimRecipientsChanged(msg.sender, _recipients);
    }

    /**
     * @inheritdoc IIClaimSetupManager
     * @dev Only governance can call this.
     */
    function setLibraryAddress(address _libraryAddress) external override onlyGovernance {
        require(_libraryAddress != address(0), ERR_ADDRESS_ZERO);
        libraryAddress = _libraryAddress;
        emit SetLibraryAddress(libraryAddress);
    }

    /**
     * @inheritdoc IClaimSetupManager
     */
    function accountToDelegationAccount(address _owner) external view override returns (address) {
        return address(_getDelegationAccount(_owner));
    }

    /**
     * @inheritdoc IClaimSetupManager
     */
    function getDelegationAccountData(
        address _owner
    )
        external view override
        returns (IDelegationAccount _delegationAccount, bool _enabled)
    {
        DelegationAccountData storage delegationAccountData = ownerToDelegationAccountData[_owner];
        _delegationAccount = delegationAccountData.delegationAccount;
        _enabled = delegationAccountData.enabled;
    }

    /**
     * @inheritdoc IIClaimSetupManager
     */
    function getAutoClaimAddressesAndExecutorFee(
        address _executor,
        address[] calldata _owners
    )
        external view override
        onlyOwnerOrExecutor(_executor, _owners)
        returns (
            address[] memory _recipients,
            uint256 _executorFeeValue
        )
    {
        uint256 len = _owners.length;
        _recipients = new address[](len);
        while (len > 0) {
            len--;
            address owner = _owners[len];
            DelegationAccountData storage delegationAccountData = ownerToDelegationAccountData[owner];
            if (delegationAccountData.enabled) {
                _recipients[len] = address(delegationAccountData.delegationAccount);
            } else {
                _recipients[len] = owner;
            }
        }

        _executorFeeValue = getExecutorCurrentFeeValue(_executor);
    }

    /**
     * @inheritdoc IIClaimSetupManager
     */
    function checkExecutorAndAllowedRecipient(address _executor, address _claimFor, address _recipient)
        external view override
    {
        // checks if _executor is claiming for his account or his PDA account - allow any _recipient
        if (_claimFor == _executor || _claimFor == address(_getDelegationAccount(_executor))) {
            return;
        }
        // if claiming for PDA, use owner settings
        address owner = delegationAccountToOwner[_claimFor];
        if (owner != address(0)) {
            _claimFor = owner;
        }
        // checks if _executor is allowed executor
        require(ownerClaimExecutorSet[_claimFor].index[_executor] != 0, ERR_ONLY_OWNER_OR_EXECUTOR);
        // checks if _recipient is allowed recipient
        require(_recipient == _claimFor ||
            ownerAllowedClaimRecipientSet[_claimFor].index[_recipient] != 0 ||
            _recipient == address(_getDelegationAccount(_claimFor)),
            ERR_RECIPIENT_NOT_ALLOWED);
    }

    /**
     * @inheritdoc IClaimSetupManager
     */
    function isClaimExecutor(address _owner, address _executor) external view override returns(bool) {
        return ownerClaimExecutorSet[_owner].index[_executor] != 0;
    }

    /**
     * @inheritdoc IClaimSetupManager
     */
    function getRegisteredExecutors(
        uint256 _start,
        uint256 _end
    )
        external view override
        returns (address[] memory _registeredExecutors, uint256 _totalLength)
    {
        address[] storage executors = registeredExecutors.list;
        _totalLength = executors.length;
        _end = Math.min(_end, _totalLength);
        _start = Math.min(_start, _end);
        _registeredExecutors = new address[](_end - _start);
        for (uint256 i = _start; i < _end; i++) {
            _registeredExecutors[i - _start] = executors[i];
        }
    }

    /**
     * @inheritdoc IClaimSetupManager
     */
    function claimExecutors(address _owner) external view override returns (address[] memory) {
        return ownerClaimExecutorSet[_owner].list;
    }

    /**
     * @inheritdoc IClaimSetupManager
     */
    function allowedClaimRecipients(address _owner) external view override returns (address[] memory) {
        return ownerAllowedClaimRecipientSet[_owner].list;
    }

    /**
     * @inheritdoc IClaimSetupManager
     */
    function getExecutorFeeValue(address _executor, uint256 _rewardEpoch) external view override returns (uint256) {
        require(_rewardEpoch <= ftsoManager.getCurrentRewardEpoch() + feeValueUpdateOffset, ERR_REWARD_EPOCH_INVALID);
        return _getExecutorFeeValue(_executor, _rewardEpoch);
    }

    /**
     * @inheritdoc IClaimSetupManager
     */
    function getExecutorScheduledFeeValueChanges(address _executor)
        external view override
        returns (
            uint256[] memory _feeValue,
            uint256[] memory _validFromEpoch,
            bool[] memory _fixed
        )
    {
        ExecutorFee[] storage efs = claimExecutorFees[_executor];
        if (efs.length > 0) {
            uint256 currentEpoch = ftsoManager.getCurrentRewardEpoch();
            uint256 position = efs.length;
            while (position > 0 && efs[position - 1].validFromEpoch > currentEpoch) {
                position--;
            }
            uint256 count = efs.length - position;
            if (count > 0) {
                _feeValue = new uint256[](count);
                _validFromEpoch = new uint256[](count);
                _fixed = new bool[](count);
                for (uint256 i = 0; i < count; i++) {
                    _feeValue[i] = efs[i + position].value;
                    _validFromEpoch[i] = efs[i + position].validFromEpoch;
                    _fixed[i] = (_validFromEpoch[i] - currentEpoch) != feeValueUpdateOffset;
                }
            }
        }
    }

    /**
     * @inheritdoc IClaimSetupManager
     */
    function getExecutorInfo(address _executor)
        external view override
        returns (
            bool _registered,
            uint256 _currentFeeValue
        )
    {
        _registered = registeredExecutors.index[_executor] != 0;
        _currentFeeValue = getExecutorCurrentFeeValue(_executor);
    }

    /**
     * @inheritdoc IClaimSetupManager
     */
    function getExecutorCurrentFeeValue(address _executor) public view override returns (uint256) {
        return _getExecutorFeeValue(_executor, ftsoManager.getCurrentRewardEpoch());
    }

    /**
     * @notice Sets the addresses of executors.
     * @notice If setting registered executors some fee must be paid to them.
     * @param _executors        The new executors. All old executors will be deleted and replaced by these.
     */
    function _setClaimExecutors(address[] memory _executors) internal {
        // pay fee to new executors
        uint256 totalExecutorsFee = 0;
        for (uint256 i = 0; i < _executors.length; i++) {
            address executor = _executors[i];
            if (ownerClaimExecutorSet[msg.sender].index[executor] != 0) {
                continue; // current executor - fee already paid
            }
            uint256 executorFee = getExecutorCurrentFeeValue(executor);
            if (executorFee > 0) {
                totalExecutorsFee += executorFee;
                /* solhint-disable avoid-low-level-calls */
                //slither-disable-next-line arbitrary-send-eth
                (bool success, ) = executor.call{value: executorFee}(""); //nonReentrant
                /* solhint-enable avoid-low-level-calls */
                require(success, ERR_TRANSFER_FAILURE);
            }
        }
        require (totalExecutorsFee <= msg.value, ERR_EXECUTOR_FEE_INVALID);
        // replace executors
        ownerClaimExecutorSet[msg.sender].replaceAll(_executors);
        emit ClaimExecutorsChanged(msg.sender, _executors);
        // refund excess amount
        if (msg.value > totalExecutorsFee) {
            /* solhint-disable avoid-low-level-calls */
            //slither-disable-next-line arbitrary-send-eth
            (bool success, ) = msg.sender.call{value: msg.value - totalExecutorsFee}(""); //nonReentrant
            /* solhint-enable avoid-low-level-calls */
            require(success, ERR_TRANSFER_FAILURE);
            emit SetExecutorsExcessAmountRefunded(msg.sender, msg.value - totalExecutorsFee);
        }
    }

    /**
     * @notice Creates (enables) delegation account contract,
     * i.e. all airdrop and ftso rewards will be send to delegation account when using automatic claiming.
     * @return Address of delegation account contract.
     */
    function _createOrEnableDelegationAccount() internal returns (IDelegationAccount) {
        DelegationAccountData storage delegationAccountData = _getOrCreateDelegationAccountData();
        IIDelegationAccount delegationAccount = delegationAccountData.delegationAccount;
        delegationAccountData.enabled = true;
        emit DelegationAccountUpdated(msg.sender, delegationAccount, true);
        return delegationAccount;
    }

    /**
     * @notice Returns the delegation account data. If there is none it creates a new one.
     */
    function _getOrCreateDelegationAccountData() internal returns (DelegationAccountData storage) {
        DelegationAccountData storage delegationAccountData = ownerToDelegationAccountData[msg.sender];
        if (address(delegationAccountData.delegationAccount) != address(0)) {
            return delegationAccountData;
        }
        require(libraryAddress != address(0), ERR_LIBRARY_ADDRESS_NOT_SET_YET);

        // create delegation account
        IIDelegationAccount delegationAccount = IIDelegationAccount(payable(createClone(libraryAddress)));
        require(_isContract(address(delegationAccount)), ERR_CREATE_CLONE);
        delegationAccount.initialize(msg.sender, this);
        delegationAccountData.delegationAccount = delegationAccount;
        delegationAccountToOwner[address(delegationAccount)] = msg.sender;
        emit DelegationAccountCreated(msg.sender, delegationAccount);

        return delegationAccountData;
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
        ftsoManager = IFtsoManager(_getContractAddress(_contractNameHashes, _contractAddresses, "FtsoManager"));
        WNat newWNat = WNat(payable(_getContractAddress(_contractNameHashes, _contractAddresses, "WNat")));
        if (address(wNat) == address(0)) {
            wNat = newWNat;
        } else if (newWNat != wNat) {
            revert(ERR_WRONG_WNAT_ADDRESS);
        }
        governanceVP = wNat.governanceVotePower();
    }

    /**
     * @notice Allows executor to set (or update last scheduled) fee value.
     * @param _currentRewardEpoch   current reward epoch number
     * @param _feeValue             number representing fee value
     * @return _validFromEpoch      Returns the reward epoch number when the setting becomes effective.
     */
    function _updateExecutorFeeValue(
        uint256 _currentRewardEpoch,
        uint256 _feeValue
    )
        internal
        returns (uint256 _validFromEpoch)
    {
        require(_feeValue >= minFeeValueWei, ERR_FEE_INVALID);
        require(_feeValue <= maxFeeValueWei, ERR_FEE_INVALID);

        _validFromEpoch = _currentRewardEpoch + feeValueUpdateOffset;
        ExecutorFee[] storage efs = claimExecutorFees[msg.sender];

        // determine whether to update the last setting or add a new one
        uint256 position = efs.length;
        assert(position > 0); // this method can be called only after executor is registered
        uint256 lastValidFromEpoch = efs[position - 1].validFromEpoch;
        // do not allow updating the settings in the past - should never happen
        // (this can only happen if the current reward epoch is smaller than some previous one)
        require(_validFromEpoch >= lastValidFromEpoch, ERR_FEE_UPDATE_FAILED);

        if (_validFromEpoch == lastValidFromEpoch) { // update
            efs[position - 1].value = _feeValue;
        } else { // add
            efs.push(ExecutorFee({value: _feeValue, validFromEpoch: _validFromEpoch}));
        }

        emit ClaimExecutorFeeValueChanged(msg.sender, _validFromEpoch, _feeValue);
    }

    /**
     * @notice Returns delegation account for `_owner`.
     * @param _owner                owner's address
     */
    function _getDelegationAccount(address _owner) internal view returns (IIDelegationAccount) {
        return ownerToDelegationAccountData[_owner].delegationAccount;
    }

    /**
     * @notice Returns fee value setting for `_executor` at specified `_rewardEpoch`.
     * @param _executor             address representing executor
     * @param _rewardEpoch          reward epoch number
     */
    function _getExecutorFeeValue(
        address _executor,
        uint256 _rewardEpoch
    )
        internal view
        returns (uint256)
    {
        ExecutorFee[] storage efs = claimExecutorFees[_executor];
        uint256 index = efs.length;
        while (index > 0) {
            index--;
            if (_rewardEpoch >= efs[index].validFromEpoch) {
                return efs[index].value;
            }
        }
        return 0;
    }

    /**
     * @notice Checks if caller is owner or executor for all addresses `_owners`.
     */
    function _checkOnlyOwnerOrExecutor(address _executor, address[] memory _owners) internal view {
        for (uint256 i = 0; i < _owners.length; i++) {
            require(_executor == _owners[i] || ownerClaimExecutorSet[_owners[i]].index[_executor] != 0,
                ERR_ONLY_OWNER_OR_EXECUTOR);
        }
    }

    function _isContract(address _addr) private view returns (bool){
        uint32 size;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            size := extcodesize(_addr)
        }
        return (size > 0);
    }
}
