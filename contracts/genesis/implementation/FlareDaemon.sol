// SPDX-License-Identifier: MIT
// WARNING, WARNING, WARNING
// If you modify this contract, you need to re-install the binary into the validator
// genesis file for the chain you wish to run. See ./docs/CompilingContracts.md for more information.
// You have been warned. That is all.
pragma solidity 0.7.6;
pragma abicoder v2;

import "../../governance/implementation/GovernedAtGenesis.sol";
import "../../addressUpdater/implementation/AddressUpdatable.sol";
import "../interface/IInflationGenesis.sol";
import "../interface/IFlareDaemonize.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "../../utils/implementation/SafePct.sol";


/**
 * Flare Daemon contract.
 *
 * This contract exists to coordinate regular daemon-like polling of contracts
 * that are registered to receive said polling. The trigger method is called by the
 * validator right at the end of block state transition.
 */
contract FlareDaemon is GovernedAtGenesis, AddressUpdatable {
    using SafeMath for uint256;
    using SafePct for uint256;

    //====================================================================
    // Data Structures
    //====================================================================
    struct DaemonizedError {
        uint192 lastErrorBlock;
        uint64 numErrors;
        address fromContract;
        uint64 errorTypeIndex;
        string errorMessage;
    }

    struct LastErrorData {
        uint192 totalDaemonizedErrors;
        uint64 lastErrorTypeIndex;
    }

    struct Registration {
        IFlareDaemonize daemonizedContract;
        uint256 gasLimit;
    }

    string internal constant ERR_ALREADY_SET = "already set";
    string internal constant ERR_OUT_OF_BALANCE = "out of balance";
    string internal constant ERR_NOT_INFLATION = "not inflation";
    string internal constant ERR_TOO_MANY = "too many";
    string internal constant ERR_TOO_BIG = "too big";
    string internal constant ERR_TOO_OFTEN = "too often";
    string internal constant ERR_INFLATION_ZERO = "inflation zero";
    string internal constant ERR_BLOCK_NUMBER_SMALL = "block.number small";
    string internal constant INDEX_TOO_HIGH = "start index high";
    string internal constant UPDATE_GAP_TOO_SHORT = "time gap too short";
    string internal constant MAX_MINT_TOO_HIGH = "max mint too high";
    string internal constant MAX_MINT_IS_ZERO = "max mint is zero";
    string internal constant ERR_DUPLICATE_ADDRESS = "dup address";
    string internal constant ERR_ADDRESS_ZERO = "address zero";
    string internal constant ERR_OUT_OF_GAS = "out of gas";
    string internal constant ERR_INFLATION_MINT_RECEIVE_FAIL = "unknown error. receiveMinting";

    uint256 internal constant MAX_DAEMONIZE_CONTRACTS = 10;
    // Initial max mint request - 60 million native token
    uint256 internal constant MAX_MINTING_REQUEST_DEFAULT = 60000000 ether;
    // How often can inflation request minting from the validator - 23 hours constant
    uint256 internal constant MAX_MINTING_FREQUENCY_SEC = 23 hours;
    // How often can the maximal mint request amount be updated
    uint256 internal constant MAX_MINTING_REQUEST_FREQUENCY_SEC = 24 hours;
    // By how much can the maximum be increased (as a percentage of the previous maximum)
    uint256 internal constant MAX_MINTING_REQUEST_INCREASE_PERCENT = 110;
    // upper estimate of gas needed after error occurs in call to daemonizedContract.daemonize()
    uint256 internal constant MIN_GAS_LEFT_AFTER_DAEMONIZE = 300000;
    // lower estimate for gas needed for daemonize() call in trigger
    uint256 internal constant MIN_GAS_FOR_DAEMONIZE_CALL = 5000;

    IInflationGenesis public inflation;
    uint256 public systemLastTriggeredAt;
    uint256 public totalMintingRequestedWei;
    uint256 public totalMintingReceivedWei;
    uint256 public totalMintingWithdrawnWei;
    uint256 public totalSelfDestructReceivedWei;
    uint256 public maxMintingRequestWei;
    uint256 public lastMintRequestTs;
    uint256 public lastUpdateMaxMintRequestTs;
    LastErrorData public errorData;
    uint256 public blockHoldoff;

    uint256 private lastBalance;
    uint256 private expectedMintRequest;
    bool private initialized;

    // track deamonized contracts
    IFlareDaemonize[] internal daemonizeContracts;
    mapping (IFlareDaemonize => uint256) internal gasLimits;
    mapping (IFlareDaemonize => uint256) internal blockHoldoffsRemaining;

    // track daemonize errors
    mapping(bytes32 => DaemonizedError) internal daemonizedErrors;
    bytes32 [] internal daemonizeErrorHashes;

    event ContractDaemonized(address theContract, uint256 gasConsumed);
    event ContractDaemonizeErrored(address theContract, uint256 atBlock, string theMessage, uint256 gasConsumed);
    event ContractHeldOff(address theContract, uint256 blockHoldoffsRemaining);
    event ContractsSkippedOutOfGas(uint256 numberOfSkippedConstracts);
    event MintingRequestReceived(uint256 amountWei);
    event MintingRequestTriggered(uint256 amountWei);
    event MintingReceived(uint256 amountWei);
    event MintingWithdrawn(uint256 amountWei);
    event RegistrationUpdated(IFlareDaemonize theContract, bool add);
    event SelfDestructReceived(uint256 amountWei);
    event InflationSet(IInflationGenesis theNewContract, IInflationGenesis theOldContract);

    /**
     * @dev As there is not a constructor, this modifier exists to make sure the inflation
     *   contract is set for methods that require it.
     */
    modifier inflationSet {
        // Don't revert...just report.
        if (address(inflation) == address(0)) {
            addDaemonizeError(address(this), ERR_INFLATION_ZERO, 0);
        }
        _;
    }

    /**
     * @dev Access control to protect methods to allow only minters to call select methods
     *   (like transferring balance out).
     */
    modifier onlyInflation (address _inflation) {
        require (address(inflation) == _inflation, ERR_NOT_INFLATION);
        _;
    }
    
    /**
     * @dev Access control to protect trigger() method. 
     * Please note that the sender address is the same as deployed FlareDaemon address in this case.
     */
    modifier onlySystemTrigger {
        require (msg.sender == 0x1000000000000000000000000000000000000002);
        _;
    }

    //====================================================================
    // Constructor for pre-compiled code
    //====================================================================

    /**
     * @dev This constructor should contain no code as this contract is pre-loaded into the genesis block.
     *   The super constructor is called for testing convenience.
     */
    constructor() GovernedAtGenesis(address(0)) AddressUpdatable(address(0)) {
        /* empty block */
    }

    //====================================================================
    // Functions
    //====================================================================  

    /**
     * @notice Register contracts to be polled by the daemon process.
     * @param _registrations    An array of Registration structures of IFlareDaemonize contracts to daemonize
     *                          and gas limits for each contract.
     * @dev A gas limit of zero will set no limit for the contract but the validator has an overall
     *   limit for the trigger() method.
     * @dev If any registrations already exist, they will be unregistered.
     * @dev Contracts will be daemonized in the order in which presented via the _registrations array.
     */
    function registerToDaemonize(Registration[] memory _registrations) external onlyGovernance {
        _registerToDaemonize(_registrations);
    }

    /**
     * @notice Queue up a minting request to send to the validator at next trigger.
     * @param _amountWei    The amount to mint.
     */
    function requestMinting(uint256 _amountWei) external onlyInflation(msg.sender) {
        require(_amountWei <= maxMintingRequestWei, ERR_TOO_BIG);
        require(_getNextMintRequestAllowedTs() < block.timestamp, ERR_TOO_OFTEN);
        if (_amountWei > 0) {
            lastMintRequestTs = block.timestamp;
            totalMintingRequestedWei = totalMintingRequestedWei.add(_amountWei);
            emit MintingRequestReceived(_amountWei);
        }
    }

    /**
     * @notice Set number of blocks that must elapse before a daemonized contract exceeding gas limit can have
     *   its daemonize() method called again.
     * @param _blockHoldoff    The number of blocks to holdoff.
     */
    function setBlockHoldoff(uint256 _blockHoldoff) external onlyGovernance {
        blockHoldoff = _blockHoldoff;
    }

    /**
     * @notice Set limit on how much can be minted per request.
     * @param _maxMintingRequestWei    The request maximum in wei.
     * @notice this number can't be udated too often
     */
    function setMaxMintingRequest(uint256 _maxMintingRequestWei) external onlyGovernance {
        // make sure increase amount is reasonable
        require(
            _maxMintingRequestWei <= (maxMintingRequestWei.mulDiv(MAX_MINTING_REQUEST_INCREASE_PERCENT,100)),
            MAX_MINT_TOO_HIGH
        );
        require(_maxMintingRequestWei > 0, MAX_MINT_IS_ZERO);
        // make sure enough time since last update
        require(
            block.timestamp > lastUpdateMaxMintRequestTs + MAX_MINTING_REQUEST_FREQUENCY_SEC,
            UPDATE_GAP_TOO_SHORT
        );

        maxMintingRequestWei = _maxMintingRequestWei;
        lastUpdateMaxMintRequestTs = block.timestamp;
    }

    /**
     * @notice Sets the address udpater contract.
     * @param _addressUpdater   The address updater contract.
     */
    function setAddressUpdater(address _addressUpdater) external onlyGovernance {
        require(getAddressUpdater() == address(0), ERR_ALREADY_SET);
        setAddressUpdaterValue(_addressUpdater);
    }

    /**
     * @notice The meat of this contract. Poll all registered contracts, calling the daemonize() method of each,
     *   in the order in which registered.
     * @return  _toMintWei     Return the amount to mint back to the validator. The asked for balance will show
     *                          up in the next block (it is actually added right before this block's state transition,
     *                          but well after this method call will see it.)
     * @dev This method watches for balances being added to this contract and handles appropriately - legit
     *   mint requests as made via requestMinting, and also self-destruct sending to this contract, should
     *   it happen for some reason.
     */
    //slither-disable-next-line reentrancy-eth      // method protected by reentrancy guard (see comment below)
    function trigger() external virtual inflationSet onlySystemTrigger returns (uint256 _toMintWei) {
        return triggerInternal();
    }

    function getDaemonizedContractsData() external view 
        returns(
            IFlareDaemonize[] memory _daemonizeContracts,
            uint256[] memory _gasLimits,
            uint256[] memory _blockHoldoffsRemaining
        )
    {
        uint256 len = daemonizeContracts.length;
        _daemonizeContracts = new IFlareDaemonize[](len);
        _gasLimits = new uint256[](len);
        _blockHoldoffsRemaining = new uint256[](len);

        for (uint256 i; i < len; i++) {
            IFlareDaemonize daemonizeContract = daemonizeContracts[i];
            _daemonizeContracts[i] = daemonizeContract;
            _gasLimits[i] = gasLimits[daemonizeContract];
            _blockHoldoffsRemaining[i] = blockHoldoffsRemaining[daemonizeContract];
        }
    }

    function getNextMintRequestAllowedTs() external view returns(uint256) {
        return _getNextMintRequestAllowedTs();
    }

    function showLastDaemonizedError () external view 
        returns(
            uint256[] memory _lastErrorBlock,
            uint256[] memory _numErrors,
            string[] memory _errorString,
            address[] memory _erroringContract,
            uint256 _totalDaemonizedErrors
        )
    {
        return showDaemonizedErrors(errorData.lastErrorTypeIndex, 1);
    }

    /**
     * @notice Set the governance address to a hard-coded known address.
     * @dev This should be done at contract deployment time.
     * @return The governance address.
     */
    function initialiseFixedAddress() public override returns(address) {
        if (!initialized) {
            initialized = true;
            address governanceAddress = super.initialiseFixedAddress();
            return governanceAddress;
        } else {
            return governance();
        }
    }

    function showDaemonizedErrors (uint startIndex, uint numErrorTypesToShow) public view 
        returns(
            uint256[] memory _lastErrorBlock,
            uint256[] memory _numErrors,
            string[] memory _errorString,
            address[] memory _erroringContract,
            uint256 _totalDaemonizedErrors
        )
    {
        require(startIndex < daemonizeErrorHashes.length, INDEX_TOO_HIGH);
        uint256 numReportElements = 
            daemonizeErrorHashes.length >= startIndex + numErrorTypesToShow ?
            numErrorTypesToShow :
            daemonizeErrorHashes.length - startIndex;

        _lastErrorBlock = new uint256[] (numReportElements);
        _numErrors = new uint256[] (numReportElements);
        _errorString = new string[] (numReportElements);
        _erroringContract = new address[] (numReportElements);

        // we have error data error type.
        // error type is hash(error_string, source contract)
        // per error type we report how many times it happened.
        // what was last block it happened.
        // what is the error string.
        // what is the erroring contract
        for (uint i = 0; i < numReportElements; i++) {
            bytes32 hash = daemonizeErrorHashes[startIndex + i];

            _lastErrorBlock[i] = daemonizedErrors[hash].lastErrorBlock;
            _numErrors[i] = daemonizedErrors[hash].numErrors;
            _errorString[i] = daemonizedErrors[hash].errorMessage;
            _erroringContract[i] = daemonizedErrors[hash].fromContract;
        }
        _totalDaemonizedErrors = errorData.totalDaemonizedErrors;
    }

    /**
     * @notice Implementation of the AddressUpdatable abstract method - updates Inflation and daemonized contracts.
     * @dev It also sets `maxMintingRequestWei` if it was not set before.
     */
    function _updateContractAddresses(
        bytes32[] memory _contractNameHashes,
        address[] memory _contractAddresses
    )
        internal override
    {
        IInflationGenesis _inflation = IInflationGenesis(
            _getContractAddress(_contractNameHashes, _contractAddresses, "Inflation"));
        emit InflationSet(_inflation, inflation);
        inflation = _inflation;
        if (maxMintingRequestWei == 0) {
            maxMintingRequestWei = MAX_MINTING_REQUEST_DEFAULT;
        }

        uint256 len = daemonizeContracts.length;
        if (len == 0) {
            return;
        }

        Registration[] memory registrations = new Registration[](len);
        for (uint256 i = 0; i < len; i++) {
            IFlareDaemonize daemonizeContract = daemonizeContracts[i];
            registrations[i].daemonizedContract = IFlareDaemonize(
                _getContractAddress(_contractNameHashes, _contractAddresses, daemonizeContract.getContractName()));
            registrations[i].gasLimit = gasLimits[daemonizeContract];
        }

        _registerToDaemonize(registrations);
    }

    /**
     * @notice Implementation of the trigger() method. The external wrapper has extra guard for msg.sender.
     */
    //slither-disable-next-line reentrancy-eth      // method protected by reentrancy guard (see comment below)
    function triggerInternal() internal returns (uint256 _toMintWei) {
        // only one trigger() call per block allowed
        // this also serves as reentrancy guard, since any re-entry will happen in the same block
        if(block.number == systemLastTriggeredAt) return 0;
        systemLastTriggeredAt = block.number;

        uint256 currentBalance = address(this).balance;

        // Did the validator or a self-destructor conjure some native token?
        if (currentBalance > lastBalance) {
            uint256 balanceExpected = lastBalance.add(expectedMintRequest);
            // Did we get what was last asked for?
            if (currentBalance == balanceExpected) {
                // Yes, so assume it all came from the validator.
                uint256 minted = expectedMintRequest;
                totalMintingReceivedWei = totalMintingReceivedWei.add(minted);
                emit MintingReceived(minted);
                //slither-disable-next-line arbitrary-send-eth          // only sent to inflation, set by governance
                try inflation.receiveMinting{ value: minted }() {
                    totalMintingWithdrawnWei = totalMintingWithdrawnWei.add(minted);
                    emit MintingWithdrawn(minted);
                } catch Error(string memory message) {
                    addDaemonizeError(address(this), message, 0);
                } catch {
                    addDaemonizeError(address(this), ERR_INFLATION_MINT_RECEIVE_FAIL, 0);
                }
            } else if (currentBalance < balanceExpected) {
                // No, and if less, there are two possibilities: 1) the validator did not
                // send us what we asked (not possible unless a bug), or 2) an attacker
                // sent us something in between a request and a mint. Assume 2.
                uint256 selfDestructReceived = currentBalance.sub(lastBalance);
                totalSelfDestructReceivedWei = totalSelfDestructReceivedWei.add(selfDestructReceived);
                emit SelfDestructReceived(selfDestructReceived);
            } else {
                // No, so assume we got a minting request (perhaps zero...does not matter)
                // and some self-destruct proceeds (unlikely but can happen).
                totalMintingReceivedWei = totalMintingReceivedWei.add(expectedMintRequest);
                uint256 selfDestructReceived = currentBalance.sub(lastBalance).sub(expectedMintRequest);
                totalSelfDestructReceivedWei = totalSelfDestructReceivedWei.add(selfDestructReceived);
                emit MintingReceived(expectedMintRequest);
                emit SelfDestructReceived(selfDestructReceived);
                //slither-disable-next-line arbitrary-send-eth          // only sent to inflation, set by governance
                try inflation.receiveMinting{ value: expectedMintRequest }() {
                    totalMintingWithdrawnWei = totalMintingWithdrawnWei.add(expectedMintRequest);
                    emit MintingWithdrawn(expectedMintRequest);
                } catch Error(string memory message) {
                    addDaemonizeError(address(this), message, 0);
                } catch {
                    addDaemonizeError(address(this), ERR_INFLATION_MINT_RECEIVE_FAIL, 0);
                }
            }
        }

        uint256 len = daemonizeContracts.length;

        // Perform trigger operations here
        for (uint256 i = 0; i < len; i++) {
            IFlareDaemonize daemonizedContract = daemonizeContracts[i];
            uint256 blockHoldoffRemainingForContract = blockHoldoffsRemaining[daemonizedContract];
            if (blockHoldoffRemainingForContract > 0) {
                blockHoldoffsRemaining[daemonizedContract] = blockHoldoffRemainingForContract - 1;
                emit ContractHeldOff(address(daemonizedContract), blockHoldoffRemainingForContract);
            } else {
                // Figure out what gas to limit call by
                uint256 gasLimit = gasLimits[daemonizedContract];
                uint256 startGas = gasleft();
                // End loop if there isn't enough gas left for any daemonize call
                if (startGas < MIN_GAS_LEFT_AFTER_DAEMONIZE + MIN_GAS_FOR_DAEMONIZE_CALL) {
                    emit ContractsSkippedOutOfGas(len - i);
                    break;
                }
                // Calculate the gas limit for the next call
                uint256 useGas = startGas - MIN_GAS_LEFT_AFTER_DAEMONIZE;
                if (gasLimit > 0 && gasLimit < useGas) {
                    useGas = gasLimit;
                }
                // Run daemonize for the contract, consume errors, and record
                try daemonizedContract.daemonize{gas: useGas}() {
                    emit ContractDaemonized(address(daemonizedContract), (startGas - gasleft()));
                // Catch all requires with messages
                } catch Error(string memory message) {
                    addDaemonizeError(address(daemonizedContract), message, (startGas - gasleft()));
                    daemonizedContract.switchToFallbackMode();
                // Catch everything else...out of gas, div by zero, asserts, etc.
                } catch {
                    uint256 endGas = gasleft();
                    // Interpret out of gas errors
                    if (gasLimit > 0 && startGas.sub(endGas) >= gasLimit) {
                        addDaemonizeError(address(daemonizedContract), ERR_OUT_OF_GAS, (startGas - endGas));
                        // When daemonize() fails with out-of-gas, try to fix it in two steps:
                        // 1) try to switch contract to fallback mode
                        //    (to allow the contract's daemonize() to recover in fallback mode in next block)
                        // 2) if constract is already in fallback mode or fallback mode is not supported
                        //    (switchToFallbackMode() returns false), start the holdoff for this contract
                        bool switchedToFallback = daemonizedContract.switchToFallbackMode();
                        if (!switchedToFallback) {
                            blockHoldoffsRemaining[daemonizedContract] = blockHoldoff;
                        }
                    } else {
                        // Don't know error cause...just log it as unknown
                        addDaemonizeError(address(daemonizedContract), "unknown", (startGas - endGas));
                        daemonizedContract.switchToFallbackMode();
                    }
                }
            }
        }

        // Get any requested minting and return to validator
        _toMintWei = getPendingMintRequest();
        if (_toMintWei > 0) {
            expectedMintRequest = _toMintWei;
            emit MintingRequestTriggered(_toMintWei);
        } else {
            expectedMintRequest = 0;            
        }

        // Update balance
        lastBalance = address(this).balance;
        
        // We should be in balance - don't revert, just report...
        uint256 contractBalanceExpected = getExpectedBalance();
        if (contractBalanceExpected != address(this).balance) {
            addDaemonizeError(address(this), ERR_OUT_OF_BALANCE, 0);
        }
    }

    function addDaemonizeError(address daemonizedContract, string memory message, uint256 gasConsumed) internal {
        bytes32 errorStringHash = keccak256(abi.encode(daemonizedContract, message));

        DaemonizedError storage daemonizedError = daemonizedErrors[errorStringHash];
        if (daemonizedError.numErrors == 0) {
            // first time we recieve this error string.
            daemonizeErrorHashes.push(errorStringHash);
            daemonizedError.fromContract = daemonizedContract;
            // limit message length to fit in fixed number of storage words (to make gas usage predictable)
            daemonizedError.errorMessage = truncateString(message, 64);
            daemonizedError.errorTypeIndex = uint64(daemonizeErrorHashes.length - 1);
        }
        daemonizedError.numErrors += 1;
        daemonizedError.lastErrorBlock = uint192(block.number);
        emit ContractDaemonizeErrored(daemonizedContract, block.number, message, gasConsumed);

        errorData.totalDaemonizedErrors += 1;
        errorData.lastErrorTypeIndex = daemonizedError.errorTypeIndex;        
    }

    /**
     * @notice Register contracts to be polled by the daemon process.
     * @param _registrations    An array of Registration structures of IFlareDaemonize contracts to daemonize
     *                          and gas limits for each contract.
     * @dev A gas limit of zero will set no limit for the contract but the validator has an overall
     *   limit for the trigger() method.
     * @dev If any registrations already exist, they will be unregistered.
     * @dev Contracts will be daemonized in the order in which presented via the _registrations array.
     */
    function _registerToDaemonize(Registration[] memory _registrations) internal {
        // Make sure there are not too many contracts to register.
        uint256 registrationsLength = _registrations.length;
        require(registrationsLength <= MAX_DAEMONIZE_CONTRACTS, ERR_TOO_MANY);

        // Unregister everything first
        _unregisterAll();

        // Loop over all contracts to register
        for (uint256 registrationIndex = 0; registrationIndex < registrationsLength; registrationIndex++) {
            // Address cannot be zero
            require(address(_registrations[registrationIndex].daemonizedContract) != address(0), ERR_ADDRESS_ZERO);

            uint256 daemonizeContractsLength = daemonizeContracts.length;
            // Make sure no dups...yes, inefficient. Registration should not be done often.
            for (uint256 i = 0; i < daemonizeContractsLength; i++) {
                require(_registrations[registrationIndex].daemonizedContract != daemonizeContracts[i], 
                    ERR_DUPLICATE_ADDRESS); // already registered
            }
            // Store off the registered contract to daemonize, in the order presented.
            daemonizeContracts.push(_registrations[registrationIndex].daemonizedContract);
            // Record the gas limit for the contract.
            gasLimits[_registrations[registrationIndex].daemonizedContract] = 
                _registrations[registrationIndex].gasLimit;
            // Clear any blocks being held off for the given contract, if any. Contracts may be re-presented
            // if only order is being modified, for example.
            blockHoldoffsRemaining[_registrations[registrationIndex].daemonizedContract] = 0;
            emit RegistrationUpdated (_registrations[registrationIndex].daemonizedContract, true);
        }
    }

    /**
     * @notice Unregister all contracts from being polled by the daemon process.
     */
    function _unregisterAll() private {

        uint256 len = daemonizeContracts.length;

        for (uint256 i = 0; i < len; i++) {
            IFlareDaemonize daemonizedContract = daemonizeContracts[daemonizeContracts.length - 1];
            daemonizeContracts.pop();
            emit RegistrationUpdated (daemonizedContract, false);
        }
    }

    /**
     * @notice Net totals to obtain the expected balance of the contract.
     */
    function getExpectedBalance() private view returns(uint256 _balanceExpectedWei) {
        _balanceExpectedWei = totalMintingReceivedWei.
            sub(totalMintingWithdrawnWei).
            add(totalSelfDestructReceivedWei);
    }

    /**
     * @notice Net total received from total requested.
     */
    function getPendingMintRequest() private view returns(uint256 _mintRequestPendingWei) {
        _mintRequestPendingWei = totalMintingRequestedWei.sub(totalMintingReceivedWei);
    }


    function _getNextMintRequestAllowedTs() internal view returns (uint256) {
        return (lastMintRequestTs + MAX_MINTING_FREQUENCY_SEC);
    }

    function truncateString(string memory _str, uint256 _maxlength) private pure returns (string memory) {
        bytes memory strbytes = bytes(_str);
        if (strbytes.length <= _maxlength) {
            return _str;
        }
        bytes memory result = new bytes(_maxlength);
        for (uint256 i = 0; i < _maxlength; i++) {
            result[i] = strbytes[i];
        }
        return string(result);
    }
}
