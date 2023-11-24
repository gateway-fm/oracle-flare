// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../../governance/implementation/Governed.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/math/Math.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../../utils/implementation/SafePct.sol";

/**
 * @title InitialAirdrop
 * @notice A contract to manage the initial airdrop allocation. 
 * @notice The balance that will be added to this contract must initially be a part of circulating supply 
 **/
contract InitialAirdrop is Governed, ReentrancyGuard {
    using SafeMath for uint256;
    using SafePct for uint256;

    // constants
    uint256 internal constant CLAIMED_AT_GENESIS_BIPS = 1500;
    uint256 internal constant TOTAL_BIPS = 10000;
    address public constant DISTRIBUTION_ADDRESS = 0x628B0E1A5215fb2610347eEDbf9ceE68043D7c92;

    // storage
    address[] public airdropAccounts;
    mapping(address => uint256) internal airdropAccountsIndex;
    mapping(address => uint256) public airdropAmountsWei;
    uint256 public totalInitialAirdropWei;          // Total wei to be distributed by this contract (initial airdrop)
    uint256 public initialAirdropStartTs;           // Day 0 when airdrop starts
    uint256 public latestAirdropStartTs;            // Latest day 0 when airdrop starts
    uint256 public totalTransferredAirdropWei;      // All wei already transferred
    uint256 public nextAirdropAccountIndexToTransfer;

    // Errors
    string internal constant ERR_OUT_OF_BALANCE = "balance too low";
    string internal constant ERR_TOO_MANY = "too many";
    string internal constant ERR_NOT_STARTED = "not started";
    string internal constant ERR_ARRAY_MISMATCH = "arrays lengths mismatch";
    string internal constant ERR_ALREADY_SET = "already set";
    string internal constant ERR_WRONG_START_TIMESTAMP = "wrong start timestamp";
    string internal constant ERR_ALREADY_STARTED = "already started";
    string internal constant ERR_ACCOUNT_MISSING = "account missing";
    string internal constant ERR_TRANSFER_FAILURE = "transfer failed";
    string internal constant ERR_NOT_YET_DISTRIBUTED = "not yet distributed";

    // Events
    event AccountsAdded(address[] accounts);
    event AccountRemoved(address account);
    event AirdropStart(uint256 initialAirdropStartTs);
    event AirdropTransferFailure(address indexed account, uint256 amountWei);

    /**
     * @dev This modifier ensures that this contract's balance matches the expected balance.
     */
    modifier mustBalance {
        _;
        require (_getExpectedBalance() <= address(this).balance, ERR_OUT_OF_BALANCE);
    }

    /**
     * @dev This modifier ensures that the airdrop was already started
     */
    modifier airdropStarted {
        require (initialAirdropStartTs != 0 && initialAirdropStartTs < block.timestamp, ERR_NOT_STARTED);
        _;
    }

    constructor(address _governance) Governed(_governance) {
        /* empty block */
    }

    /**
     * @notice Needed in order to receive funds from governance address
     */
    receive() external payable {
        require(msg.sender == governance(), "only governance");
    }

    /**
     * @notice Method to set addresses and their respective balances in batches to this contract (initial airdrop)
     * @param _accounts         Array of adresses we are adding in batch
     * @param _balances         Array of balances to be airdropped to respective accounts (total amount - 100%)
     * @dev Note that _toAddresses and _balances arrays must be of equal length
     * @dev Note that script must use the same batches to fill data (if restarted), otherwise duplicates may occure
     */
    function setAirdropBalances(address[] calldata _accounts, uint256[] calldata _balances) external onlyGovernance {
        require(_accounts.length <= 1000, ERR_TOO_MANY);
        require(_accounts.length == _balances.length, ERR_ARRAY_MISMATCH);
        require (initialAirdropStartTs == 0, ERR_ALREADY_STARTED);

        if (airdropAmountsWei[_accounts[0]] > 0) return; // batch already added
        uint256 index = airdropAccounts.length;
        uint256 totalInitialAirdropWeiTemp = 0;
        for (uint16 i = 0; i < _accounts.length; i++) {
            address airdropAccount = _accounts[i];
            uint256 airdropAmountWei = _balances[i].mulDiv(CLAIMED_AT_GENESIS_BIPS, TOTAL_BIPS);
            airdropAccounts.push(airdropAccount);
            airdropAccountsIndex[airdropAccount] = ++index;
            airdropAmountsWei[airdropAccount] = airdropAmountWei;
            totalInitialAirdropWeiTemp = totalInitialAirdropWeiTemp.add(airdropAmountWei);
        }

        totalInitialAirdropWei = totalInitialAirdropWei.add(totalInitialAirdropWeiTemp);
        // We added the accounts to airdrop, emit event
        emit AccountsAdded(_accounts);
    }

    /** 
     * @notice Latest start of the initial airdrop at _latestAirdropStartTs timestamp
     * @param _latestAirdropStartTs point in time when latest start is possible
     */
    function setLatestAirdropStart(uint256 _latestAirdropStartTs) external onlyGovernance {
        require(latestAirdropStartTs == 0, ERR_ALREADY_SET);
        latestAirdropStartTs = _latestAirdropStartTs;
    }

    /** 
     * @notice Start the initial airdrop at _initialAirdropStartTs timestamp
     * @param _initialAirdropStartTs point in time when we start
     * @dev should be called immediately after all airdrop accounts and balances are set
     */
    function setAirdropStart(uint256 _initialAirdropStartTs) external onlyGovernance mustBalance {
        require(initialAirdropStartTs == 0 || initialAirdropStartTs > block.timestamp, ERR_ALREADY_STARTED);
        require(initialAirdropStartTs < _initialAirdropStartTs && _initialAirdropStartTs <= latestAirdropStartTs,
            ERR_WRONG_START_TIMESTAMP);
        initialAirdropStartTs = _initialAirdropStartTs;
        emit AirdropStart(_initialAirdropStartTs);
    }

    /** 
     * @notice Remove account from initial airdrop recipients
     * @param _addressToRemove          address to remove from the list of initial airdrop recipients
     * @param _sendAirdropToAddress     should initial airdrop funds be send to the address that is removed or
            "confiscated" and send to distribution address
     */
    function removeAirdropAccount(
        address _addressToRemove,
        bool _sendAirdropToAddress
    )
        external 
        onlyGovernance mustBalance nonReentrant
    {
        require(initialAirdropStartTs > block.timestamp, ERR_ALREADY_STARTED);
        uint256 position = airdropAccountsIndex[_addressToRemove];
        if (position == 0) revert(ERR_ACCOUNT_MISSING);
        if (position < airdropAccounts.length) {
            address addressToMove = airdropAccounts[airdropAccounts.length - 1];
            airdropAccounts[position - 1] = addressToMove;
            airdropAccountsIndex[addressToMove] = position;
        }
        uint256 amountToTransfer = airdropAmountsWei[_addressToRemove];
        airdropAccounts.pop();
        delete airdropAccountsIndex[_addressToRemove];
        delete airdropAmountsWei[_addressToRemove];
        if (_sendAirdropToAddress) {
            totalTransferredAirdropWei = totalTransferredAirdropWei.add(amountToTransfer);
            /* solhint-disable avoid-low-level-calls */
            //slither-disable-next-line arbitrary-send-eth
            (bool success, ) = _addressToRemove.call{ value: amountToTransfer }("");
            /* solhint-enable avoid-low-level-calls */
            require(success, ERR_TRANSFER_FAILURE);
        } else {
            totalInitialAirdropWei = totalInitialAirdropWei.sub(amountToTransfer);
            /* solhint-disable avoid-low-level-calls */
            //slither-disable-next-line arbitrary-send-eth
            (bool success, ) = DISTRIBUTION_ADDRESS.call{ value: amountToTransfer }("");
            /* solhint-enable avoid-low-level-calls */
            require(success, ERR_TRANSFER_FAILURE);
        }
        
        emit AccountRemoved(_addressToRemove);
    }

    /**
     * @notice Method for transferring initial airdrop amounts in batches of 50
     */
    //slither-disable-next-line reentrancy-eth          // guarded by nonReentrant
    function transferAirdrop() external airdropStarted mustBalance nonReentrant {
        uint256 upperBound = Math.min(nextAirdropAccountIndexToTransfer + 50, airdropAccounts.length);
        uint256 totalTransferredAirdropWeiTemp = 0;
        for (uint256 i = nextAirdropAccountIndexToTransfer; i < upperBound; i++) {
            // Get the account and amount
            address account = airdropAccounts[i];
            uint256 amountWei = airdropAmountsWei[account];
            // update state
            delete airdropAmountsWei[account];
            delete airdropAccountsIndex[account];
            delete airdropAccounts[i];
            // Send
            /* solhint-disable avoid-low-level-calls */
            //slither-disable-next-line arbitrary-send-eth
            (bool success, ) = account.call{ value: amountWei, gas: 21000 }("");
            /* solhint-enable avoid-low-level-calls */
            if (success) {
                totalTransferredAirdropWeiTemp = totalTransferredAirdropWeiTemp.add(amountWei);
            } else {
                emit AirdropTransferFailure(account, amountWei);
            }
        }

        // Update grand total transferred
        totalTransferredAirdropWei = totalTransferredAirdropWei.add(totalTransferredAirdropWeiTemp);

        // Update current position
        nextAirdropAccountIndexToTransfer = upperBound;
    }

    /**
     * @notice Method for withdrawing initial airdrop funds that were not distributed
     * @param _recipient                address to transfer funds to
     * @dev Can only be called once airdrop was distributed
     */
    function withdrawUndistributedFunds(address _recipient) external onlyGovernance airdropStarted {
        require(nextAirdropAccountIndexToTransfer == airdropAccounts.length, ERR_NOT_YET_DISTRIBUTED);
        /* solhint-disable avoid-low-level-calls */
        //slither-disable-next-line arbitrary-send-eth
        (bool success, ) = _recipient.call{ value: address(this).balance }("");
        /* solhint-enable avoid-low-level-calls */
        require(success, ERR_TRANSFER_FAILURE);
    }

    /**
     * @notice Return the number of airdrop accounts
     */
    function airdropAccountsLength() external view returns (uint256) {
        return airdropAccounts.length;
    }

    /**
     * @notice Compute the expected balance of this contract.
     * @param _balanceExpectedWei   The computed balance expected.
     */
    function _getExpectedBalance() private view returns(uint256 _balanceExpectedWei) {
        return totalInitialAirdropWei.sub(totalTransferredAirdropWei);
    }

}
