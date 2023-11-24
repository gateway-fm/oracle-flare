// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../../token/interface/IIGovernanceVotePower.sol";
import "../../token/implementation/WNat.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "../lib/CheckPointsByAddress.sol";
import "../lib/DelegateCheckPointsByAddress.sol";

contract GovernanceVotePower is IIGovernanceVotePower {
    using SafeMath for uint256;
    using SafeCast for uint256;
    using CheckPointsByAddress for CheckPointsByAddress.CheckPointsByAddressState;
    using DelegateCheckPointsByAddress for DelegateCheckPointsByAddress.DelegateCheckPointsByAddressState;

    // `votePowerFromDelegationsHistory` tracks vote power balances obtained by delegation
    CheckPointsByAddress.CheckPointsByAddressState private votePowerFromDelegationsHistory;

    // `delegatesHistory` tracks delegates' addresses history
    DelegateCheckPointsByAddress.DelegateCheckPointsByAddressState private delegatesHistory;

    /**
     * The VPToken (or some other contract) that owns this GovernanceVotePower.
     * All state changing methods may be called only from this address.
     * This is because original msg.sender is sent in `_from` parameter
     * and we must be sure that it cannot be faked by directly calling GovernanceVotePower.
     */
    IVPToken public immutable override ownerToken;

    // The number of history cleanup steps executed for every write operation.
    // It is more than 1 to make as certain as possible that all history gets cleaned eventually.
    uint256 private constant CLEANUP_COUNT = 2;

    // Historic data for the blocks before `cleanupBlockNumber` can be erased,
    // history before that block should never be used since it can be inconsistent.
    uint256 private cleanupBlockNumber;

    // Address of the contract that is allowed to call methods for history cleaning.
    address public cleanerContract;

    // A record of each account's delegate
    // can delegate to only one address
    // mapping(address => address) public delegates;

    /**
     * All external methods in GovernanceVotePower can only be executed by the owner token.
     */
    modifier onlyOwnerToken {
        require(msg.sender == address(ownerToken), "only owner token");
        _;
    }

    /**
     * Setting cleaner contract is allowed from
     * owner token or owner token's governance (when GovernanceVotePower is detached,
     * methods can no longer be called via the owner token, but the GovernanceVotePower
     * still remembers the old owner token and can see its governance).
     */
    modifier onlyOwnerOrGovernance {
        require(msg.sender == address(ownerToken) || 
            msg.sender == GovernedBase(address(ownerToken)).governance(),
            "only owner or governance");
        _;
    }

    /**
     * History cleaning methods can be called only from the cleaner address.
     */
    modifier onlyCleaner {
        require(msg.sender == cleanerContract, "only cleaner contract");
        _;
    }

    /**
     * Construct GovernanceVotePower for given VPToken.
     */
    constructor(IVPToken _ownerToken) {
        require(address(_ownerToken) != address(0), "governanceVotePower must belong to a VPToken");
        ownerToken = _ownerToken;
    }

    /**
     * @notice Delegate all governance vote power of `msg.sender` to `_to`.
     * @param _to The address of the recipient
     **/
    function delegate(address _to) public override {
        require(_to != msg.sender, "can't delegate to yourself");
        
        uint256 senderBalance = ownerToken.balanceOf(msg.sender);

        address currentTo = getDelegateOfAtNow(msg.sender);

        // msg.sender has already delegated
        if (currentTo != address(0)) {
            subVP(msg.sender, currentTo, senderBalance);
        }
        
        // write delegate's address to checkpoint
        delegatesHistory.writeAddress(msg.sender, _to);
        // cleanup checkpoints
        delegatesHistory.cleanupOldCheckpoints(msg.sender, CLEANUP_COUNT, cleanupBlockNumber);

        if (_to != address(0)) {
            addVP(msg.sender, _to, senderBalance);
        }

        emit DelegateChanged(msg.sender, currentTo, _to);
    }

    /**
     * Undelegate governance vote power.
     **/
    function undelegate() public override {
        delegate(address(0));
    }

    /**
     * Update governance vote powers when tokens are transferred.
     **/
    function updateAtTokenTransfer(
        address _from, 
        address _to, 
        uint256 /* fromBalance */,
        uint256 /* toBalance */, 
        uint256 _amount
    )
        external override onlyOwnerToken
    {   
        require(_from != _to, "Can't transfer to yourself"); // should already revert in _beforeTokenTransfer
        require(_from != address(0) || _to != address(0));
        // require(_amount > 0, "Cannot transfer zero amount");

        address fromDelegate = getDelegateOfAtNow(_from);
        address toDelegate = getDelegateOfAtNow(_to);

        if (_from == address(0)) { // mint
            if (toDelegate != address(0)) {
                addVP(_to, toDelegate, _amount);
            }
        } else if (_to == address(0)) { // burn
            if (fromDelegate != address(0)) {
                subVP(_from, fromDelegate, _amount);
            }
        } else if (fromDelegate != toDelegate) { // transfer
            if (fromDelegate != address(0)) {
                subVP(_from, fromDelegate, _amount);
            }
            if (toDelegate != address(0)) {
                addVP(_to, toDelegate, _amount);
            } 
        }
    }

    /**
     * Set the cleanup block number.
     * Historic data for the blocks before `cleanupBlockNumber` can be erased,
     * history before that block should never be used since it can be inconsistent.
     * In particular, cleanup block number must be before current vote power block.
     * @param _blockNumber The new cleanup block number.
     */
    function setCleanupBlockNumber(uint256 _blockNumber) external override onlyOwnerOrGovernance {
        require(_blockNumber >= cleanupBlockNumber, "cleanup block number must never decrease");
        require(_blockNumber < block.number, "cleanup block must be in the past");
        cleanupBlockNumber = _blockNumber;
    }

    function getCleanupBlockNumber() external view override returns(uint256) {
        return cleanupBlockNumber;
    }

    /**
     * Set the contract that is allowed to call history cleaning methods.
     * The method can be called by the owner token or its governance.
     */
    function setCleanerContract(address _cleanerContract) external override onlyOwnerOrGovernance {
        cleanerContract = _cleanerContract;
    }

    /**
     * Delete governance vote power checkpoints that expired (i.e. are before `cleanupBlockNumber`).
     * Method can only be called from the `cleanerContract` (which may be a proxy to external cleaners).
     * @param _owner vote power owner account address
     * @param _count maximum number of checkpoints to delete
     * @return the number of checkpoints deleted
     */    
    function delegatedGovernanceVotePowerHistoryCleanup(
        address _owner,
        uint256 _count
    ) external onlyCleaner returns (uint256) {
        return votePowerFromDelegationsHistory.cleanupOldCheckpoints(_owner, _count, cleanupBlockNumber);
    }

    /**
     * Delete delegates checkpoints that expired (i.e. are before `cleanupBlockNumber`).
     * Method can only be called from the `cleanerContract` (which may be a proxy to external cleaners).
     * @param _owner vote power owner account address
     * @param _count maximum number of checkpoints to delete
     * @return the number of checkpoints deleted
     */    
    function delegatesHistoryCleanup(
        address _owner,
        uint256 _count
    ) external onlyCleaner returns (uint256) {
        return delegatesHistory.cleanupOldCheckpoints(_owner, _count, cleanupBlockNumber);
    }
    
    /**
    * @notice Get the governance vote power of `_who` at block `_blockNumber`
    * @param _who The address to get voting power.
    * @param _blockNumber The block number at which to fetch.
    * @return Vote power of `_who` at `_blockNumber`.
    */
    function votePowerOfAt(address _who, uint256 _blockNumber) public override view returns (uint256) {
        uint256 votePower = votePowerFromDelegationsHistory.valueOfAt(_who, _blockNumber);
    
        address to = getDelegateOfAt(_who, _blockNumber);
        if (to == address(0)) { // _who didn't delegate at _blockNumber
            uint256 balance = ownerToken.balanceOfAt(_who, _blockNumber);
            votePower += balance;
        }

        return votePower;
    }

    /**
    * @notice Get the governance vote power of `account` at the current block.
    * @param _who The address to get voting power.
    * @return Vote power of `account` at the current block number.
    */    
    function getVotes(address _who) public override view returns (uint256) {
        return votePowerOfAt(_who, block.number);
    }

    /**
    * @notice Get the delegate of `_who` at block `_blockNumber`
    * @param _who The address to get delegate's address.
    * @param _blockNumber The block number at which to fetch.
    * @return Delegate of `_who` at `_blockNumber`.
    */
    function getDelegateOfAt(address _who, uint256 _blockNumber) public override view returns (address) {
        return delegatesHistory.delegateAddressOfAt(_who, _blockNumber);
    }

    /**
    * @notice Get the delegate of `_who` at the current block.
    * @param _who The address to get delegate's address.
    * @return Delegate of `_who` at the current block number.
    */    
    function getDelegateOfAtNow(address _who) public override view returns (address) {
        return delegatesHistory.delegateAddressOfAtNow(_who);
    }
       
    function addVP(address /* _from */, address _to, uint256 _amount) internal {
        uint256 toOldVP = votePowerFromDelegationsHistory.valueOfAtNow(_to);
        uint256 toNewVP = toOldVP.add(_amount);
        
        votePowerFromDelegationsHistory.writeValue(_to, toNewVP);
        votePowerFromDelegationsHistory.cleanupOldCheckpoints(_to, CLEANUP_COUNT, cleanupBlockNumber);

        emit DelegateVotesChanged(_to, toOldVP, toNewVP);
    }

    function subVP(address /* _from */, address _to, uint256 _amount) internal {
        uint256 toOldVP = votePowerFromDelegationsHistory.valueOfAtNow(_to);
        uint256 toNewVP = toOldVP.sub(_amount);

        votePowerFromDelegationsHistory.writeValue(_to, toNewVP);
        votePowerFromDelegationsHistory.cleanupOldCheckpoints(_to, CLEANUP_COUNT, cleanupBlockNumber);

        emit DelegateVotesChanged(_to, toOldVP, toNewVP);
    }

}
