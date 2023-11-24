// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "./CheckPointable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "../../utils/implementation/SafePct.sol";
import "../../userInterfaces/IVPToken.sol";
import "../../userInterfaces/IVPContractEvents.sol";
import "../interface/IIVPToken.sol";
import "../interface/IIVPContract.sol";
import "../interface/IIGovernanceVotePower.sol";
import "../../userInterfaces/IGovernanceVotePower.sol";
import "../../governance/implementation/Governed.sol";

/**
 * @title Vote Power Token
 * @dev An ERC20 token to enable the holder to delegate voting power
 *  equal 1-1 to their balance, with history tracking by block.
 **/
contract VPToken is IIVPToken, ERC20, CheckPointable, Governed {
    using SafeMath for uint256;
    using SafePct for uint256;

    // the VPContract to use for reading vote powers and delegations
    IIVPContract private readVpContract;

    // the VPContract to use for writing vote powers and delegations
    // normally same as `readVpContract` except during switch
    // when reading happens from the old and writing goes to the new VPContract
    IIVPContract private writeVpContract;
    
    // the contract to use for governance vote power and delegation
    // here only to properly update governance vp during transfers -
    // all actual operations go directly to governance vp contract
    IIGovernanceVotePower private governanceVP;
    
    // the contract that is allowed to set cleanupBlockNumber
    // usually this will be an instance of CleanupBlockNumberManager
    address public cleanupBlockNumberManager;
    
    /**
     * When true, the argument to `setWriteVpContract` must be a vpContract
     * with `isReplacement` set to `true`. To be used for creating the correct VPContract.
     */
    bool public vpContractInitialized = false;

    /**
     * Event used to track history of VPToken -> VPContract / GovernanceVotePower 
     * associations (e.g. by external cleaners).
     * @param _contractType 0 = read VPContract, 1 = write VPContract, 2 = governance vote power
     * @param _oldContractAddress vote power contract address before change
     * @param _newContractAddress vote power contract address after change
     */ 
    event VotePowerContractChanged(uint256 _contractType, address _oldContractAddress, address _newContractAddress);
    
    constructor(
        address _governance,
        //slither-disable-next-line shadowing-local
        string memory _name, 
        //slither-disable-next-line shadowing-local
        string memory _symbol
    )
        Governed(_governance) ERC20(_name, _symbol) 
    {
        /* empty block */
    }
    
    /**
     * @dev Should be compatible with ERC20 method
     */
    function name() public view override(ERC20, IVPToken) returns (string memory) {
        return ERC20.name();
    }

    /**
     * @dev Should be compatible with ERC20 method
     */
    function symbol() public view override(ERC20, IVPToken) returns (string memory) {
        return ERC20.symbol();
    }

    /**
     * @dev Should be compatible with ERC20 method
     */
    function decimals() public view override(ERC20, IVPToken) returns (uint8) {
        return ERC20.decimals();
    }

    /**
     * @notice Total amount of tokens at a specific `_blockNumber`.
     * @param _blockNumber The block number when the totalSupply is queried
     * @return The total amount of tokens at `_blockNumber`
     **/
    function totalSupplyAt(uint256 _blockNumber) public view override(CheckPointable, IVPToken) returns(uint256) {
        return CheckPointable.totalSupplyAt(_blockNumber);
    }

    /**
     * @dev Queries the token balance of `_owner` at a specific `_blockNumber`.
     * @param _owner The address from which the balance will be retrieved.
     * @param _blockNumber The block number when the balance is queried.
     * @return The balance at `_blockNumber`.
     **/
    function balanceOfAt(
        address _owner, 
        uint256 _blockNumber
    )
        public view 
        override(CheckPointable, IVPToken)
        returns (uint256)
    {
        return CheckPointable.balanceOfAt(_owner, _blockNumber);
    }
    
    /**
     * @notice Delegate `_bips` of voting power to `_to` from `msg.sender`
     * @param _to The address of the recipient
     * @param _bips The percentage of voting power to be delegated expressed in basis points (1/100 of one percent).
     *   Not cumulative - every call resets the delegation value (and value of 0 revokes delegation).
     **/
    function delegate(address _to, uint256 _bips) external override {
        // Get the current balance of sender and delegate by percentage _to recipient
        _checkWriteVpContract().delegate(msg.sender, _to, balanceOf(msg.sender), _bips);
    }

    /**
     * @notice Undelegate all percentage delegations from the sender and then delegate corresponding 
     *   `_bips` percentage of voting power from the sender to each member of `_delegatees`.
     * @param _delegatees The addresses of the new recipients.
     * @param _bips The percentages of voting power to be delegated expressed in basis points (1/100 of one percent).
     *   Total of all `_bips` values must be at most 10000.
     **/
    function batchDelegate(address[] memory _delegatees, uint256[] memory _bips) external override {
        require(_delegatees.length == _bips.length, "Array length mismatch");
        IIVPContract vpContract = _checkWriteVpContract();
        uint256 balance = balanceOf(msg.sender);
        vpContract.undelegateAll(msg.sender, balance);
        for (uint256 i = 0; i < _delegatees.length; i++) {
            vpContract.delegate(msg.sender, _delegatees[i], balance, _bips[i]);
        }
    }
    
    /**
     * @notice Delegate `_amount` of voting power to `_to` from `msg.sender`
     * @param _to The address of the recipient
     * @param _amount An explicit vote power amount to be delegated.
     *   Not cumulative - every call resets the delegation value (and value of 0 revokes delegation).
     **/    
    function delegateExplicit(address _to, uint256 _amount) external override {
        _checkWriteVpContract().delegateExplicit(msg.sender, _to, balanceOf(msg.sender), _amount);
    }

    /**
     * @notice Compute the current undelegated vote power of `_owner`
     * @param _owner The address to get undelegated voting power.
     * @return The unallocated vote power of `_owner`
     */
    function undelegatedVotePowerOf(address _owner) external view override returns(uint256) {
        return _checkReadVpContract().undelegatedVotePowerOf(_owner, balanceOf(_owner));
    }

    /**
     * @notice Get the undelegated vote power of `_owner` at given block.
     * @param _owner The address to get undelegated voting power.
     * @param _blockNumber The block number at which to fetch.
     * @return The unallocated vote power of `_owner`
     */
    function undelegatedVotePowerOfAt(address _owner, uint256 _blockNumber) external view override returns (uint256) {
        return _checkReadVpContract()
            .undelegatedVotePowerOfAt(_owner, balanceOfAt(_owner, _blockNumber), _blockNumber);
    }

    /**
     * @notice Undelegate all voting power for delegates of `msg.sender`
     **/
    function undelegateAll() external override {
        _checkWriteVpContract().undelegateAll(msg.sender, balanceOf(msg.sender));
    }

    /**
     * @notice Undelegate all explicit vote power by amount delegates for `msg.sender`.
     * @param _delegateAddresses Explicit delegation does not store delegatees' addresses, 
     *   so the caller must supply them.
     * @return _remainingDelegation The amount still delegated (in case the list of delegates was incomplete).
     */
    function undelegateAllExplicit(
        address[] memory _delegateAddresses
    )
        external override 
        returns (uint256 _remainingDelegation)
    {
        return _checkWriteVpContract().undelegateAllExplicit(msg.sender, _delegateAddresses);
    }
    
    /**
    * @notice Revoke all delegation from sender to `_who` at given block. 
    *    Only affects the reads via `votePowerOfAtCached()` in the block `_blockNumber`.
    *    Block `_blockNumber` must be in the past. 
    *    This method should be used only to prevent rogue delegate voting in the current voting block.
    *    To stop delegating use delegate/delegateExplicit with value of 0 or undelegateAll/undelegateAllExplicit.
    */
    function revokeDelegationAt(address _who, uint256 _blockNumber) public override {
        IIVPContract writeVPC = writeVpContract;
        IIVPContract readVPC = readVpContract;
        if (address(writeVPC) != address(0)) {
            writeVPC.revokeDelegationAt(msg.sender, _who, balanceOfAt(msg.sender, _blockNumber), _blockNumber);
        }
        if (address(readVPC) != address(writeVPC) && address(readVPC) != address(0)) {
            try readVPC.revokeDelegationAt(msg.sender, _who, balanceOfAt(msg.sender, _blockNumber), _blockNumber) {
            } catch {
                // do nothing
            }
        }
    }

    /**
    * @notice Get current delegated vote power `_from` delegator delegated `_to` delegatee.
    * @param _from Address of delegator
    * @param _to Address of delegatee
    * @return votePower The delegated vote power.
    */
    function votePowerFromTo(
        address _from, 
        address _to
    )
        external view override 
        returns(uint256)
    {
        return _checkReadVpContract().votePowerFromTo(_from, _to, balanceOf(_from));
    }
    
    /**
    * @notice Get delegated the vote power `_from` delegator delegated `_to` delegatee at `_blockNumber`.
    * @param _from Address of delegator
    * @param _to Address of delegatee
    * @param _blockNumber The block number at which to fetch.
    * @return The delegated vote power.
    */
    function votePowerFromToAt(
        address _from, 
        address _to, 
        uint256 _blockNumber
    )
        external view override 
        returns(uint256)
    {
        return _checkReadVpContract().votePowerFromToAt(_from, _to, balanceOfAt(_from, _blockNumber), _blockNumber);
    }
    
    /**
     * @notice Get the current total vote power.
     * @return The current total vote power (sum of all accounts' vote powers).
     */
    function totalVotePower() external view override returns(uint256) {
        return totalSupply();
    }

    /**
    * @notice Get the total vote power at block `_blockNumber`
    * @param _blockNumber The block number at which to fetch.
    * @return The total vote power at the block  (sum of all accounts' vote powers).
    */
    function totalVotePowerAt(uint256 _blockNumber) external view override returns(uint256) {
        return totalSupplyAt(_blockNumber);
    }

    /**
    * @notice Get the total vote power at block `_blockNumber` using cache.
    *   It tries to read the cached value and if not found, reads the actual value and stores it in cache.
    *   Can only be used if `_blockNumber` is in the past, otherwise reverts.    
    * @param _blockNumber The block number at which to fetch.
    * @return The total vote power at the block (sum of all accounts' vote powers).
    */
    function totalVotePowerAtCached(uint256 _blockNumber) public override returns(uint256) {
        return _totalSupplyAtCached(_blockNumber);
    }
    
    /**
     * @notice Get the delegation mode for '_who'. This mode determines whether vote power is
     *  allocated by percentage or by explicit value. Once the delegation mode is set, 
     *  it never changes, even if all delegations are removed.
     * @param _who The address to get delegation mode.
     * @return delegation mode: 0 = NOTSET, 1 = PERCENTAGE, 2 = AMOUNT (i.e. explicit)
     */
    function delegationModeOf(address _who) external view override returns (uint256) {
        return _checkReadVpContract().delegationModeOf(_who);
    }

    /**
     * @notice Get the current vote power of `_owner`.
     * @param _owner The address to get voting power.
     * @return Current vote power of `_owner`.
     */
    function votePowerOf(address _owner) external view override returns(uint256) {
        return _checkReadVpContract().votePowerOf(_owner);
    }


    /**
    * @notice Get the vote power of `_owner` at block `_blockNumber`
    * @param _owner The address to get voting power.
    * @param _blockNumber The block number at which to fetch.
    * @return Vote power of `_owner` at `_blockNumber`.
    */
    function votePowerOfAt(address _owner, uint256 _blockNumber) external view override returns(uint256) {
        return _checkReadVpContract().votePowerOfAt(_owner, _blockNumber);
    }

    /**
    * @notice Get the vote power of `_owner` at block `_blockNumber`, ignoring revocation information (and cache).
    * @param _owner The address to get voting power.
    * @param _blockNumber The block number at which to fetch.
    * @return Vote power of `_owner` at `_blockNumber`. Result doesn't change if vote power is revoked.
    */
    function votePowerOfAtIgnoringRevocation(address _owner, uint256 _blockNumber)
        external view override
        returns(uint256) 
    {
        return _checkReadVpContract().votePowerOfAtIgnoringRevocation(_owner, _blockNumber);
    }

    /**
     * Return vote powers for several addresses in a batch.
     * @param _owners The list of addresses to fetch vote power of.
     * @param _blockNumber The block number at which to fetch.
     * @return A list of vote powers.
     */    
    function batchVotePowerOfAt(
        address[] memory _owners, 
        uint256 _blockNumber
    )
        external view override 
        returns(uint256[] memory)
    {
        return _checkReadVpContract().batchVotePowerOfAt(_owners, _blockNumber);
    }
    
    /**
    * @notice Get the vote power of `_owner` at block `_blockNumber` using cache.
    *   It tries to read the cached value and if not found, reads the actual value and stores it in cache.
    *   Can only be used if _blockNumber is in the past, otherwise reverts.    
    * @param _owner The address to get voting power.
    * @param _blockNumber The block number at which to fetch.
    * @return Vote power of `_owner` at `_blockNumber`.
    */
    function votePowerOfAtCached(address _owner, uint256 _blockNumber) public override returns(uint256) {
        return _checkReadVpContract().votePowerOfAtCached(_owner, _blockNumber);
    }
    
    /**
    * @notice Get the vote power delegation `delegationAddresses` 
    *  and `_bips` of `_who`. Returned in two separate positional arrays.
    * @param _owner The address to get delegations.
    * @return _delegateAddresses Positional array of delegation addresses.
    * @return _bips Positional array of delegation percents specified in basis points (1/100 or 1 percent)
    * @return _count The number of delegates.
    * @return _delegationMode The mode of the delegation (NOTSET=0, PERCENTAGE=1, AMOUNT=2).
    */
    function delegatesOf(
        address _owner
    )
        external view override 
        returns (
            address[] memory _delegateAddresses, 
            uint256[] memory _bips,
            uint256 _count,
            uint256 _delegationMode
        )
    {
        return _checkReadVpContract().delegatesOf(_owner);
    }
    
    /**
    * @notice Get the vote power delegation `delegationAddresses` 
    *  and `pcts` of `_who`. Returned in two separate positional arrays.
    * @param _owner The address to get delegations.
    * @param _blockNumber The block for which we want to know the delegations.
    * @return _delegateAddresses Positional array of delegation addresses.
    * @return _bips Positional array of delegation percents specified in basis points (1/100 or 1 percent)
    * @return _count The number of delegates.
    * @return _delegationMode The mode of the delegation (NOTSET=0, PERCENTAGE=1, AMOUNT=2).
    */
    function delegatesOfAt(
        address _owner,
        uint256 _blockNumber
    )
        external view override 
        returns (
            address[] memory _delegateAddresses, 
            uint256[] memory _bips,
            uint256 _count,
            uint256 _delegationMode
        )
    {
        return _checkReadVpContract().delegatesOfAt(_owner, _blockNumber);
    }

    // Update vote power and balance checkpoints before balances are modified. This is implemented
    // in the _beforeTokenTransfer hook, which is executed for _mint, _burn, and _transfer operations.
    function _beforeTokenTransfer(
        address _from, 
        address _to, 
        uint256 _amount
    )
        internal virtual 
        override(ERC20)
    {
        require(_from != _to, "Cannot transfer to self");
        
        uint256 fromBalance = _from != address(0) ? balanceOf(_from) : 0;
        uint256 toBalance = _to != address(0) ? balanceOf(_to) : 0;
        
        // update vote powers
        IIVPContract vpc = writeVpContract;
        if (address(vpc) != address(0)) {
            vpc.updateAtTokenTransfer(_from, _to, fromBalance, toBalance, _amount);
        } else if (!vpContractInitialized) {
            // transfers without vpcontract are allowed, but after they are made
            // any added vpcontract must have isReplacement set
            vpContractInitialized = true;
        }
        
        // update governance vote powers
        IIGovernanceVotePower gvp = governanceVP;
        if (address(gvp) != address(0)) {
            gvp.updateAtTokenTransfer(_from, _to, fromBalance, toBalance, _amount);
        }

        // update balance history
        _updateBalanceHistoryAtTransfer(_from, _to, _amount);
    }

    /**
     * Call from governance to set read VpContract on token, e.g. 
     * `vpToken.setReadVpContract(new VPContract(vpToken))`
     * Read VPContract must be set before any of the VPToken delegation or vote power reading methods are called, 
     * otherwise they will revert.
     * NOTE: If readVpContract differs from writeVpContract all reads will be "frozen" and will not reflect
     * changes (not even revokes; they may or may not reflect balance transfers).
     * @param _vpContract Read vote power contract to be used by this token.
     */
    function setReadVpContract(IIVPContract _vpContract) external onlyGovernance {
        if (address(_vpContract) != address(0)) {
            require(address(_vpContract.ownerToken()) == address(this),
                "VPContract not owned by this token");
            // set contract's cleanup block
            _vpContract.setCleanupBlockNumber(_cleanupBlockNumber());
        }
        emit VotePowerContractChanged(0, address(readVpContract), address(_vpContract));
        readVpContract = _vpContract;
    }

    /**
     * Call from governance to set write VpContract on token, e.g. 
     * `vpToken.setWriteVpContract(new VPContract(vpToken))`
     * Write VPContract must be set before any of the VPToken delegation modifying methods are called, 
     * otherwise they will revert.
     * @param _vpContract Write vote power contract to be used by this token.
     */
    function setWriteVpContract(IIVPContract _vpContract) external onlyGovernance {
        if (address(_vpContract) != address(0)) {
            require(address(_vpContract.ownerToken()) == address(this),
                "VPContract not owned by this token");
            require(!vpContractInitialized || _vpContract.isReplacement(),
                "VPContract not configured for replacement");
            // set contract's cleanup block
            _vpContract.setCleanupBlockNumber(_cleanupBlockNumber());
            // once a non-null vpcontract is set, every other has to have isReplacement flag set
            vpContractInitialized = true;
        }
        emit VotePowerContractChanged(1, address(writeVpContract), address(_vpContract));
        writeVpContract = _vpContract;
    }
    
    /**
     * Return read vpContract, ensuring that it is not zero.
     */
    function _checkReadVpContract() internal view returns (IIVPContract) {
        IIVPContract vpc = readVpContract;
        require(address(vpc) != address(0), "Token missing read VPContract");
        return vpc;
    }

    /**
     * Return write vpContract, ensuring that it is not zero.
     */
    function _checkWriteVpContract() internal view returns (IIVPContract) {
        IIVPContract vpc = writeVpContract;
        require(address(vpc) != address(0), "Token missing write VPContract");
        return vpc;
    }
    
    /**
     * Return vpContract use for reading, may be zero.
     */
    function _getReadVpContract() internal view returns (IIVPContract) {
        return readVpContract;
    }

    /**
     * Return vpContract use for writing, may be zero.
     */
    function _getWriteVpContract() internal view returns (IIVPContract) {
        return writeVpContract;
    }

    /**
     * Returns VPContract event interface used for readonly operations (view methods).
     */
    function readVotePowerContract() external view override returns (IVPContractEvents) {
        return readVpContract;
    }

    /**
     * Returns VPContract event interface used for state changing operations (non-view methods).
     */
    function writeVotePowerContract() external view override returns (IVPContractEvents) {
        return writeVpContract;
    }

    /**
     * Set the cleanup block number.
     * Historic data for the blocks before `cleanupBlockNumber` can be erased,
     * history before that block should never be used since it can be inconsistent.
     * In particular, cleanup block number must be before current vote power block.
     * @param _blockNumber The new cleanup block number.
     */
    function setCleanupBlockNumber(uint256 _blockNumber) external override {
        require(msg.sender == cleanupBlockNumberManager, "only cleanup block manager");
        _setCleanupBlockNumber(_blockNumber);
        if (address(readVpContract) != address(0)) {
            readVpContract.setCleanupBlockNumber(_blockNumber);
        }
        if (address(writeVpContract) != address(0) && address(writeVpContract) != address(readVpContract)) {
            writeVpContract.setCleanupBlockNumber(_blockNumber);
        }
        if (address(governanceVP) != address(0)) {
            governanceVP.setCleanupBlockNumber(_blockNumber);
        }
    }
    
    /**
     * Get the current cleanup block number.
     */
    function cleanupBlockNumber() external view override returns (uint256) {
        return _cleanupBlockNumber();
    }
    
    /**
     * Set the contract that is allowed to set cleanupBlockNumber.
     * Usually this will be an instance of CleanupBlockNumberManager.
     */
    function setCleanupBlockNumberManager(address _cleanupBlockNumberManager) external override onlyGovernance {
        cleanupBlockNumberManager = _cleanupBlockNumberManager;
    }
    
    /**
     * Set the contract that is allowed to call history cleaning methods.
     */
    function setCleanerContract(address _cleanerContract) external override onlyGovernance {
        _setCleanerContract(_cleanerContract);
        if (address(readVpContract) != address(0)) {
            readVpContract.setCleanerContract(_cleanerContract);
        }
        if (address(writeVpContract) != address(0) && address(writeVpContract) != address(readVpContract)) {
            writeVpContract.setCleanerContract(_cleanerContract);
        }
        if (address(governanceVP) != address(0)) {
            governanceVP.setCleanerContract(_cleanerContract);
        }
    }
    
    /**
     * Sets new governance vote power contract that allows token owners to participate in governance voting
     * and delegate governance vote power. 
     */
    function setGovernanceVotePower(IIGovernanceVotePower _governanceVotePower) external override onlyGovernance {
        require(address(_governanceVotePower.ownerToken()) == address(this), 
            "Governance vote power contract does not belong to this token.");
        emit VotePowerContractChanged(2, address(governanceVP), address(_governanceVotePower));
        governanceVP = _governanceVotePower;
    }

    /**
     * When set, allows token owners to participate in governance voting
     * and delegate governance vote power. 
     */
     function governanceVotePower() external view override returns (IGovernanceVotePower) {
         return governanceVP;
     }
}
