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

contract ClaimSetupManager is IIClaimSetupManager, 
    Governed, AddressUpdatable, CloneFactory, ReentrancyGuard
{
    using AddressSet for AddressSet.State;

    struct ExecutorFee {            // used for storing executor fee settings
        uint256 value;              // fee value (value between `minFeeValueWei` and `maxFeeValueWei`)
        uint256 validFromEpoch;     // id of the reward epoch from which the value is valid
    }

    struct DelegationAccountData {              // used for storing data about delegation account
        IIDelegationAccount delegationAccount;  // delegation account address
        bool enabled;                           // indicates if delegation account is enabled
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

    uint256 public immutable feeValueUpdateOffset;      // fee value update timelock measured in reward epochs
    uint256 public minFeeValueWei;                      // min value for fee
    uint256 public maxFeeValueWei;                      // max value for fee
    uint256 public registerExecutorFeeValueWei;         // fee value that executor must pay to register

    IFtsoManager public ftsoManager;
    WNat public override wNat;
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
     * @notice Sets the addresses of executors and optionally enables (creates) delegation account.
     * @notice If setting registered executors some fee must be paid to them.
     * @param _executors        The new executors. All old executors will be deleted and replaced by these.
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
     * @notice Sets the addresses of executors.
     * @notice If setting registered executors some fee must be paid to them.
     * @param _executors        The new executors. All old executors will be deleted and replaced by these.
     */
    function setClaimExecutors(address[] memory _executors) external payable override nonReentrant {
        _setClaimExecutors(_executors);
    }

    /**
     * @notice Enables (creates) delegation account contract,
     * i.e. all airdrop and ftso rewards will be send to delegation account when using automatic claiming.
     * @return Address of delegation account contract.
     */
    function enableDelegationAccount() external override returns (IDelegationAccount) {
        return _createOrEnableDelegationAccount();
    }

    /**
     * @notice Disables delegation account contract,
     * i.e. all airdrop and ftso rewards will be send to owner's account when using automatic claiming.
     * @notice Automatic claiming will not claim airdrop and ftso rewards for delegation account anymore.
     * @dev Reverts if there is no delegation account
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
     * @notice Allows executor to register and set initial fee value from current reward epoch on.
     * If executor was already registered before (has fee set), only update fee value after `feeValueUpdateOffset`.
     * @notice Executor must pay fee in order to register - `registerExecutorFeeValueWei`.
     * @param _feeValue    number representing fee value - zero value is allowed
     * @return Returns the reward epoch number when the setting becomes effective.
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
     * @notice Allows executor to unregister.
     * @return _validFromEpoch Returns the reward epoch number when the setting becomes effective.
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
     * @notice Allows registered executor to set (or update last scheduled) fee value.
     * @param _feeValue     number representing fee value - zero value is allowed
     * @return Returns the reward epoch number when the setting becomes effective.
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
     * @notice Delegate `_bips` of voting power to `_to` from msg.sender's delegation account
     * @param _to The address of the recipient
     * @param _bips The percentage of voting power to be delegated expressed in basis points (1/100 of one percent).
     *   Not cumulative - every call resets the delegation value (and value of 0 revokes delegation).
     */
    function delegate(address _to, uint256 _bips) external override {
        _getDelegationAccount(msg.sender).delegate(wNat, _to, _bips);
    }

    /**
     * @notice Undelegate all percentage delegations from the msg.sender's delegation account and then delegate 
     *   corresponding `_bips` percentage of voting power to each member of `_delegatees`.
     * @param _delegatees The addresses of the new recipients.
     * @param _bips The percentages of voting power to be delegated expressed in basis points (1/100 of one percent).
     *   Total of all `_bips` values must be at most 10000.
     */
    function batchDelegate(address[] memory _delegatees, uint256[] memory _bips) external override {
        _getDelegationAccount(msg.sender).batchDelegate(wNat, _delegatees, _bips);
    }

    /**
     * @notice Undelegate all voting power for delegates of msg.sender's delegation account
     */
    function undelegateAll() external override {
        _getDelegationAccount(msg.sender).undelegateAll(wNat);
    }

    /**
     * @notice Revoke all delegation from msg.sender's delegation account to `_who` at given block. 
     *    Only affects the reads via `votePowerOfAtCached()` in the block `_blockNumber`.
     *    Block `_blockNumber` must be in the past. 
     *    This method should be used only to prevent rogue delegate voting in the current voting block.
     *    To stop delegating use delegate with value of 0 or undelegateAll.
     */
    function revokeDelegationAt(address _who, uint256 _blockNumber) external override {
        _getDelegationAccount(msg.sender).revokeDelegationAt(wNat, _who, _blockNumber);
    }

    /**
     * @notice Delegate all governance vote power of msg.sender's delegation account to `_to`.
     * @param _to The address of the recipient
     */
    function delegateGovernance(address _to) external override {
        _getDelegationAccount(msg.sender).delegateGovernance(governanceVP, _to);
    }

    /**
     * @notice Undelegate governance vote power for delegate of msg.sender's delegation account
     */
    function undelegateGovernance() external override {
        _getDelegationAccount(msg.sender).undelegateGovernance(governanceVP);
    }

    /**
     * @notice Allows user to transfer WNat to owner's account.
     * @param _amount           Amount of tokens to transfer
     */
    function withdraw(uint256 _amount) external override {
        _getDelegationAccount(msg.sender).withdraw(wNat, _amount);
    }

    /**
     * @notice Allows user to transfer balance of ERC20 tokens owned by the personal delegation contract.
     The main use case is to transfer tokens/NFTs that were received as part of an airdrop or register 
     as participant in such airdrop.
     * @param _token            Target token contract address
     * @param _amount           Amount of tokens to transfer
     * @dev Reverts if target token is WNat contract - use method `withdraw` for that
     */
    function transferExternalToken(IERC20 _token, uint256 _amount) external override nonReentrant {
        _getDelegationAccount(msg.sender).transferExternalToken(wNat, _token, _amount);
    }
    
    /**
     * @notice Sets new min fee value which must be higher than 0.
     * @dev Only governance can call this.
     */
    function setMinFeeValueWei(uint256 _minFeeValueWei) external override onlyGovernance {
        require(_minFeeValueWei < maxFeeValueWei, ERR_MIN_FEE_INVALID);
        minFeeValueWei = _minFeeValueWei;
        emit MinFeeSet(_minFeeValueWei);
    }

    /**
     * @notice Sets new max fee value which must be higher than min fee value.
     * @dev Only governance can call this.
     */
    function setMaxFeeValueWei(uint256 _maxFeeValueWei) external override onlyGovernance {
        require(_maxFeeValueWei > minFeeValueWei, ERR_MAX_FEE_INVALID);
        maxFeeValueWei = _maxFeeValueWei;
        emit MaxFeeSet(_maxFeeValueWei);
    }

    /**
     * @notice Sets new register executor fee value which must be higher than 0.
     * @dev Only governance can call this.
     */
    function setRegisterExecutorFeeValueWei(uint256 _registerExecutorFeeValueWei) external override onlyGovernance {
        require(_registerExecutorFeeValueWei > 0, ERR_VALUE_ZERO);
        registerExecutorFeeValueWei = _registerExecutorFeeValueWei;
        emit RegisterExecutorFeeSet(_registerExecutorFeeValueWei);
    }

    /**
     * Set the addresses of allowed recipients.
     * Apart from these, the owner is always an allowed recipient.
     * @param _recipients The new allowed recipients. All old recipients will be deleted and replaced by these.
     */    
    function setAllowedClaimRecipients(address[] memory _recipients) external override {
        ownerAllowedClaimRecipientSet[msg.sender].replaceAll(_recipients);
        emit AllowedClaimRecipientsChanged(msg.sender, _recipients);
    }

    /**
     * @notice Sets new library address.
     * @dev Only governance can call this.
     */
    function setLibraryAddress(address _libraryAddress) external override onlyGovernance {
        require(_libraryAddress != address(0), ERR_ADDRESS_ZERO);
        libraryAddress = _libraryAddress;
        emit SetLibraryAddress(libraryAddress);
    }

    /**
     * @notice Gets the delegation account of the `_owner`. Returns address(0) if not created yet.
     */
    function accountToDelegationAccount(address _owner) external view override returns (address) {
        return address(_getDelegationAccount(_owner));
    }

    /**
     * @notice Gets the delegation account data for the `_owner`. Returns address(0) if not created yet.
     * @param _owner                        owner's address
     * @return _delegationAccount           owner's delegation account address - could be address(0)
     * @return _enabled                     indicates if delegation account is enabled
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
     * @notice Gets the delegation accounts for the `_owners`. Returns owner address if not created yet or not enabled.
     * @param _executor                     executor's address
     * @param _owners                       owners' addresses
     * @return _recipients              addresses for claiming (PDA or owner)
     * @return _executorFeeValue            executor's fee value
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
     * @notice Checks if executor can claim for given address and send funds to recipient address
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
     * @notice Returns info if `_executor` is allowed to execute calls for `_owner`
     */
    function isClaimExecutor(address _owner, address _executor) external view override returns(bool) {
        return ownerClaimExecutorSet[_owner].index[_executor] != 0;
    }

    /**
     * @notice Get registered executors
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
     * @notice Get the addresses of executors.
     */    
    function claimExecutors(address _owner) external view override returns (address[] memory) {
        return ownerClaimExecutorSet[_owner].list;
    }

    /**
     * Get the addresses of allowed recipients.
     * Apart from these, the owner is always an allowed recipient.
     */    
    function allowedClaimRecipients(address _owner) external view override returns (address[] memory) {
        return ownerAllowedClaimRecipientSet[_owner].list;
    }

    /**
     * @notice Returns the fee value of `_executor` at `_rewardEpoch`
     * @param _executor             address representing executor
     * @param _rewardEpoch          reward epoch number
     */
    function getExecutorFeeValue(address _executor, uint256 _rewardEpoch) external view override returns (uint256) {
        require(_rewardEpoch <= ftsoManager.getCurrentRewardEpoch() + feeValueUpdateOffset, ERR_REWARD_EPOCH_INVALID);
        return _getExecutorFeeValue(_executor, _rewardEpoch);
    }

    /**
     * @notice Returns the scheduled fee value changes of `_executor`
     * @param _executor             address representing executor
     * @return _feeValue            positional array of fee values
     * @return _validFromEpoch      positional array of reward epochs the fee settings are effective from
     * @return _fixed               positional array of boolean values indicating if settings are subjected to change
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
     * @notice Returns some info about the `_executor`
     * @param _executor             address representing executor
     * @return _registered          information if executor is registered
     * @return _currentFeeValue     executor's current fee value
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
     * @notice Returns the current fee value of `_executor`
     * @param _executor             address representing executor
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
