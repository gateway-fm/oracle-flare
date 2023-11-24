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
 * Vote power token.
 *
 * An ERC20 token that enables the holder to delegate a voting power
 * equal to their balance, with history tracking by block height.
 * Actual vote power and delegation functionality is implemented in an associated VPContract.
 */
contract VPToken is IIVPToken, ERC20, CheckPointable, Governed {
    using SafeMath for uint256;
    using SafePct for uint256;

    // The VPContract to use for reading vote powers and delegations
    IIVPContract private readVpContract;

    // The VPContract to use for writing vote powers and delegations.
    // Normally same as `readVpContract` except during switch
    // when reading happens from the old and writing goes to the new VPContract.
    IIVPContract private writeVpContract;

    // The contract to use for governance vote power and delegation.
    // Here only to properly update governance VP during transfers;
    // all actual operations go directly to governance VP contract.
    IIGovernanceVotePower private governanceVP;

    /// The contract that is allowed to set `cleanupBlockNumber`.
    /// Usually this will be an instance of `CleanupBlockNumberManager`.
    address public cleanupBlockNumberManager;

    /**
     * When true, the argument to `setWriteVpContract` must be a vpContract
     * with `isReplacement` set to `true`. To be used for creating the correct VPContract.
     */
    bool public vpContractInitialized = false;

    /**
     * Emitted when one of the vote power contracts is changed.
     *
     * It is used to track the history of VPToken -> VPContract / GovernanceVotePower
     * associations (e.g. by external cleaners).
     * @param _contractType 0 = Read VPContract, 1 = Write VPContract, 2 = Governance vote power.
     * @param _oldContractAddress Contract address before change.
     * @param _newContractAddress Contract address after change.
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
     * @inheritdoc IVPToken
     */
    function name() public view override(ERC20, IVPToken) returns (string memory) {
        return ERC20.name();
    }

    /**
     * @inheritdoc IVPToken
     */
    function symbol() public view override(ERC20, IVPToken) returns (string memory) {
        return ERC20.symbol();
    }

    /**
     * @inheritdoc IVPToken
     */
    function decimals() public view override(ERC20, IVPToken) returns (uint8) {
        return ERC20.decimals();
    }

    /**
     * @inheritdoc CheckPointable
     */
    function totalSupplyAt(uint256 _blockNumber) public view override(CheckPointable, IVPToken) returns(uint256) {
        return CheckPointable.totalSupplyAt(_blockNumber);
    }

    /**
     * @inheritdoc CheckPointable
     */
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
     * @inheritdoc IVPToken
     */
    function delegate(address _to, uint256 _bips) external override {
        // Get the current balance of sender and delegate by percentage _to recipient
        _checkWriteVpContract().delegate(msg.sender, _to, balanceOf(msg.sender), _bips);
    }

    /**
     * @inheritdoc IVPToken
     */
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
     * @inheritdoc IVPToken
     */
    function delegateExplicit(address _to, uint256 _amount) external override {
        _checkWriteVpContract().delegateExplicit(msg.sender, _to, balanceOf(msg.sender), _amount);
    }

    /**
     * @inheritdoc IVPToken
     */
    function undelegatedVotePowerOf(address _owner) external view override returns(uint256) {
        return _checkReadVpContract().undelegatedVotePowerOf(_owner, balanceOf(_owner));
    }

    /**
     * @inheritdoc IVPToken
     */
    function undelegatedVotePowerOfAt(address _owner, uint256 _blockNumber) external view override returns (uint256) {
        return _checkReadVpContract()
            .undelegatedVotePowerOfAt(_owner, balanceOfAt(_owner, _blockNumber), _blockNumber);
    }

    /**
     * @inheritdoc IVPToken
     */
    function undelegateAll() external override {
        _checkWriteVpContract().undelegateAll(msg.sender, balanceOf(msg.sender));
    }

    /**
     * @inheritdoc IVPToken
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
     * @inheritdoc IVPToken
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
     * @inheritdoc IVPToken
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
     * @inheritdoc IVPToken
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
     * @inheritdoc IVPToken
     */
    function totalVotePower() external view override returns(uint256) {
        return totalSupply();
    }

    /**
     * @inheritdoc IVPToken
     */
    function totalVotePowerAt(uint256 _blockNumber) external view override returns(uint256) {
        return totalSupplyAt(_blockNumber);
    }

    /**
     * @inheritdoc IIVPToken
    */
    function totalVotePowerAtCached(uint256 _blockNumber) public override returns(uint256) {
        return _totalSupplyAtCached(_blockNumber);
    }

    /**
     * @inheritdoc IVPToken
     */
    function delegationModeOf(address _who) external view override returns (uint256) {
        return _checkReadVpContract().delegationModeOf(_who);
    }

    /**
     * @inheritdoc IVPToken
     */
    function votePowerOf(address _owner) external view override returns(uint256) {
        return _checkReadVpContract().votePowerOf(_owner);
    }

    /**
     * @inheritdoc IVPToken
     */
    function votePowerOfAt(address _owner, uint256 _blockNumber) external view override returns(uint256) {
        return _checkReadVpContract().votePowerOfAt(_owner, _blockNumber);
    }

    /**
     * @inheritdoc IVPToken
     */
    function votePowerOfAtIgnoringRevocation(address _owner, uint256 _blockNumber)
        external view override
        returns(uint256)
    {
        return _checkReadVpContract().votePowerOfAtIgnoringRevocation(_owner, _blockNumber);
    }

    /**
     * @inheritdoc IIVPToken
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
     * @inheritdoc IIVPToken
     */
    function votePowerOfAtCached(address _owner, uint256 _blockNumber) public override returns(uint256) {
        return _checkReadVpContract().votePowerOfAtCached(_owner, _blockNumber);
    }

    /**
     * @inheritdoc IVPToken
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
     * @inheritdoc IVPToken
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
     * vpToken.setReadVpContract(new VPContract(vpToken)).
     *
     * Read VPContract must be set before any of the VPToken delegation or vote power reading methods are called,
     * otherwise they will revert.
     *
     * **NOTE**: If `readVpContract` differs from `writeVpContract` all reads will be "frozen" and will not reflect
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
     * vpToken.setWriteVpContract(new VPContract(vpToken)).
     *
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
     * Return vpContract used for reading, may be zero.
     */
    function _getReadVpContract() internal view returns (IIVPContract) {
        return readVpContract;
    }

    /**
     * Return vpContract used for writing, may be zero.
     */
    function _getWriteVpContract() internal view returns (IIVPContract) {
        return writeVpContract;
    }

    /**
     * @inheritdoc IVPToken
     */
    function readVotePowerContract() external view override returns (IVPContractEvents) {
        return readVpContract;
    }

    /**
     * @inheritdoc IVPToken
     */
    function writeVotePowerContract() external view override returns (IVPContractEvents) {
        return writeVpContract;
    }

    /**
     * @inheritdoc IICleanable
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
     * @inheritdoc IICleanable
     */
    function cleanupBlockNumber() external view override returns (uint256) {
        return _cleanupBlockNumber();
    }

    /**
     * @inheritdoc IIVPToken
     */
    function setCleanupBlockNumberManager(address _cleanupBlockNumberManager) external override onlyGovernance {
        cleanupBlockNumberManager = _cleanupBlockNumberManager;
    }

    /**
     * @inheritdoc IICleanable
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
     * @inheritdoc IIVPToken
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
