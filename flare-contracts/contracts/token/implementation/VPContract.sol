// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "../../governance/implementation/GovernedBase.sol";
import "./Delegatable.sol";
import "../interface/IIVPContract.sol";
import "../interface/IIVPToken.sol";
import "../../userInterfaces/IVPToken.sol";

/**
 * Helper contract handling all the vote power and delegation functionality for an associated VPToken.
 */
contract VPContract is IIVPContract, Delegatable {
    using SafeMath for uint256;

    /**
     * @inheritdoc IIVPContract
     */
    IVPToken public immutable override ownerToken;

    /**
     * @inheritdoc IIVPContract
     */
    bool public immutable override isReplacement;

    // The block number when vote power for an address was first set.
    // Reading vote power before this block would return incorrect result and must revert.
    mapping (address => uint256) private votePowerInitializationBlock;

    // Vote power cache for past blocks when vote power was not initialized.
    // Reading vote power at that block would return incorrect result, so cache must be set by some other means.
    // No need for revocation info, since there can be no delegations at such block.
    mapping (bytes32 => uint256) private uninitializedVotePowerCache;

    string constant private ALREADY_EXPLICIT_MSG = "Already delegated explicitly";
    string constant private ALREADY_PERCENT_MSG = "Already delegated by percentage";

    string constant internal VOTE_POWER_NOT_INITIALIZED = "Vote power not initialized";

    /// All external methods in VPContract can only be executed by the owner token.
    modifier onlyOwnerToken {
        require(msg.sender == address(ownerToken), "only owner token");
        _;
    }

    /// If a delegate cannot be added by percentage, revert.
    modifier onlyPercent(address sender) {
        require(_canDelegateByPct(sender), ALREADY_EXPLICIT_MSG);
        _;
    }

    /// If a delegate cannot be added by explicit amount, revert.
    modifier onlyExplicit(address sender) {
        require(_canDelegateByAmount(sender), ALREADY_PERCENT_MSG);
        _;
    }

    /**
     * Construct VPContract for given VPToken.
     */
    constructor(IVPToken _ownerToken, bool _isReplacement) {
        require(address(_ownerToken) != address(0), "VPContract must belong to a VPToken");
        ownerToken = _ownerToken;
        isReplacement = _isReplacement;
    }

    /**
     * @inheritdoc IICleanable
     * @dev The method can be called only by the owner token.
     */
    function setCleanupBlockNumber(uint256 _blockNumber) external override onlyOwnerToken {
        _setCleanupBlockNumber(_blockNumber);
    }

    /**
     * @inheritdoc IICleanable
     */
    function setCleanerContract(address _cleanerContract) external override onlyOwnerToken {
        _setCleanerContract(_cleanerContract);
    }

    /**
     * @inheritdoc IIVPContract
     */
    function updateAtTokenTransfer(
        address _from,
        address _to,
        uint256 _fromBalance,
        uint256 _toBalance,
        uint256 _amount
    )
        external override
        onlyOwnerToken
    {
        if (_from == address(0)) {
            // mint new vote power
            _initializeVotePower(_to, _toBalance);
            _mintVotePower(_to, _toBalance, _amount);
        } else if (_to == address(0)) {
            // burn vote power
            _initializeVotePower(_from, _fromBalance);
            _burnVotePower(_from, _fromBalance, _amount);
        } else {
            // transmit vote power _to receiver
            _initializeVotePower(_from, _fromBalance);
            _initializeVotePower(_to, _toBalance);
            _transmitVotePower(_from, _to, _fromBalance, _toBalance, _amount);
        }
    }

    /**
     * @inheritdoc IIVPContract
     */
    function delegate(
        address _from,
        address _to,
        uint256 _balance,
        uint256 _bips
    )
        external override
        onlyOwnerToken
        onlyPercent(_from)
    {
        _initializeVotePower(_from, _balance);
        if (!_votePowerInitialized(_to)) {
            _initializeVotePower(_to, ownerToken.balanceOf(_to));
        }
        _delegateByPercentage(_from, _to, _balance, _bips);
    }

    /**
     * @inheritdoc IIVPContract
     */
    function delegateExplicit(
        address _from,
        address _to,
        uint256 _balance,
        uint _amount
    )
        external override
        onlyOwnerToken
        onlyExplicit(_from)
    {
        _initializeVotePower(_from, _balance);
        if (!_votePowerInitialized(_to)) {
            _initializeVotePower(_to, ownerToken.balanceOf(_to));
        }
        _delegateByAmount(_from, _to, _balance, _amount);
    }

    /**
     * @inheritdoc IIVPContract
     */
    function revokeDelegationAt(
        address _from,
        address _to,
        uint256 _balance,
        uint _blockNumber
    )
        external override
        onlyOwnerToken
    {
        // ASSERT: if there was a delegation, _from and _to must be initialized
        if (!isReplacement ||
            (_votePowerInitializedAt(_from, _blockNumber) && _votePowerInitializedAt(_to, _blockNumber))) {
            _revokeDelegationAt(_from, _to, _balance, _blockNumber);
        }
    }

    /**
     * @inheritdoc IIVPContract
     */
    function undelegateAll(
        address _from,
        uint256 _balance
    )
        external override
        onlyOwnerToken
        onlyPercent(_from)
    {
        if (_hasAnyDelegations(_from)) {
            // ASSERT: since there were delegations, _from and its targets must be initialized
            _undelegateAllByPercentage(_from, _balance);
        }
    }

    /**
     * @inheritdoc IIVPContract
     */
    function undelegateAllExplicit(
        address _from,
        address[] memory _delegateAddresses
    )
        external override
        onlyOwnerToken
        onlyExplicit(_from)
        returns (uint256)
    {
        if (_hasAnyDelegations(_from)) {
            // ASSERT: since there were delegations, _from and its targets must be initialized
            return _undelegateAllByAmount(_from, _delegateAddresses);
        }
        return 0;
    }

    /**
     * @inheritdoc IIVPContract
     */
    function votePowerOfAtCached(address _who, uint256 _blockNumber) external override returns(uint256) {
        if (!isReplacement || _votePowerInitializedAt(_who, _blockNumber)) {
            // use standard method
            return _votePowerOfAtCached(_who, _blockNumber);
        } else {
            // use uninitialized vote power cache
            bytes32 key = keccak256(abi.encode(_who, _blockNumber));
            uint256 cached = uninitializedVotePowerCache[key];
            if (cached != 0) {
                return cached - 1;  // safe, cached != 0
            }
            uint256 balance = ownerToken.balanceOfAt(_who, _blockNumber);
            uninitializedVotePowerCache[key] = balance.add(1);
            return balance;
        }
    }

    /**
     * @inheritdoc IICleanable
     */
    function cleanupBlockNumber() external view override returns (uint256) {
        return _cleanupBlockNumber();
    }

    /**
     * @inheritdoc IIVPContract
     */
    function votePowerOf(address _who) external view override returns(uint256) {
        if (_votePowerInitialized(_who)) {
            return _votePowerOf(_who);
        } else {
            return ownerToken.balanceOf(_who);
        }
    }

    /**
     * @inheritdoc IIVPContract
     */
    function votePowerOfAt(address _who, uint256 _blockNumber) public view override returns(uint256) {
        if (!isReplacement || _votePowerInitializedAt(_who, _blockNumber)) {
            return _votePowerOfAt(_who, _blockNumber);
        } else {
            return ownerToken.balanceOfAt(_who, _blockNumber);
        }
    }

    /**
     * @inheritdoc IIVPContract
     */
    function votePowerOfAtIgnoringRevocation(address _who, uint256 _blockNumber)
        external view override
        returns(uint256)
    {
        if (!isReplacement || _votePowerInitializedAt(_who, _blockNumber)) {
            return _votePowerOfAtIgnoringRevocation(_who, _blockNumber);
        } else {
            return ownerToken.balanceOfAt(_who, _blockNumber);
        }
    }

    /**
     * @inheritdoc IIVPContract
     */
    function batchVotePowerOfAt(
        address[] memory _owners,
        uint256 _blockNumber
    )
        external view override
        returns(uint256[] memory _votePowers)
    {
        _votePowers = _batchVotePowerOfAt(_owners, _blockNumber);
        // zero results might not have been initialized
        if (isReplacement) {
            for (uint256 i = 0; i < _votePowers.length; i++) {
                if (_votePowers[i] == 0 && !_votePowerInitializedAt(_owners[i], _blockNumber)) {
                    _votePowers[i] = ownerToken.balanceOfAt(_owners[i], _blockNumber);
                }
            }
        }
    }

    /**
     * @inheritdoc IIVPContract
     */
    function votePowerFromTo(
        address _from,
        address _to,
        uint256 _balance
    )
        external view override
        returns (uint256)
    {
        // ASSERT: if the result is nonzero, _from and _to are initialized
        return _votePowerFromTo(_from, _to, _balance);
    }

    /**
     * @inheritdoc IIVPContract
     */
    function votePowerFromToAt(
        address _from,
        address _to,
        uint256 _balance,
        uint _blockNumber
    )
        external view override
        returns (uint256)
    {
        // ASSERT: if the result is nonzero, _from and _to were initialized at _blockNumber
        return _votePowerFromToAt(_from, _to, _balance, _blockNumber);
    }

    /**
     * @inheritdoc IIVPContract
     */
    function delegationModeOf(address _who) external view override returns (uint256) {
        return uint256(_delegationModeOf(_who));
    }

    /**
     * @inheritdoc IIVPContract
     */
    function undelegatedVotePowerOf(
        address _owner,
        uint256 _balance
    )
        external view override
        returns (uint256)
    {
        if (_votePowerInitialized(_owner)) {
            return _undelegatedVotePowerOf(_owner, _balance);
        } else {
            // ASSERT: there are no delegations
            return _balance;
        }
    }

    /**
     * @inheritdoc IIVPContract
     */
    function undelegatedVotePowerOfAt(
        address _owner,
        uint256 _balance,
        uint256 _blockNumber
    )
        external view override
        returns (uint256)
    {
        if (_votePowerInitialized(_owner)) {
            return _undelegatedVotePowerOfAt(_owner, _balance, _blockNumber);
        } else {
            // ASSERT: there were no delegations at _blockNumber
            return _balance;
        }
    }

    /**
     * @inheritdoc IIVPContract
     */
    function delegatesOf(address _owner)
        external view override
        returns (
            address[] memory _delegateAddresses,
            uint256[] memory _bips,
            uint256 _count,
            uint256 _delegationMode
        )
    {
        // ASSERT: either _owner is initialized or there are no delegations
        return delegatesOfAt(_owner, block.number);
    }

    /**
     * @inheritdoc IIVPContract
     */
    function delegatesOfAt(
        address _owner,
        uint256 _blockNumber
    )
        public view override
        returns (
            address[] memory _delegateAddresses,
            uint256[] memory _bips,
            uint256 _count,
            uint256 _delegationMode
        )
    {
        // ASSERT: either _owner was initialized or there were no delegations
        DelegationMode mode = _delegationModeOf(_owner);
        if (mode == DelegationMode.PERCENTAGE) {
            // Get the vote power delegation for the _owner
            (_delegateAddresses, _bips) = _percentageDelegatesOfAt(_owner, _blockNumber);
        } else if (mode == DelegationMode.NOTSET) {
            _delegateAddresses = new address[](0);
            _bips = new uint256[](0);
        } else {
            revert ("delegatesOf does not work in AMOUNT delegation mode");
        }
        _count = _delegateAddresses.length;
        _delegationMode = uint256(mode);
    }

    /**
     * Initialize vote power to current balance if not initialized already.
     * @param _owner The address to initialize voting power.
     * @param _balance The owner's current balance.
     */
    function _initializeVotePower(address _owner, uint256 _balance) internal {
        if (!isReplacement) return;
        if (_owner == address(0)) return;    // 0 address is special (usually marks no source/dest - no init needed)
        if (votePowerInitializationBlock[_owner] == 0) {
            // consistency check - no delegations should be made from or to owner before vote power is initialized
            // (that would be dangerous, because vote power would have been delegated incorrectly)
            assert(_votePowerOf(_owner) == 0 && !_hasAnyDelegations(_owner));
            _mintVotePower(_owner, 0, _balance);
            votePowerInitializationBlock[_owner] = block.number.add(1);
        }
    }

    /**
     * Has the vote power of `_owner` been initialized?
     * @param _owner The address to check.
     * @return true if vote power of _owner is initialized
     */
    function _votePowerInitialized(address _owner) internal view returns (bool) {
        if (!isReplacement) return true;
        return votePowerInitializationBlock[_owner] != 0;
    }

    /**
     * Was vote power of `_owner` initialized at some block?
     * @param _owner The address to check.
     * @param _blockNumber The block for which we want to check.
     * @return true if vote power of _owner was initialized at _blockNumber
     */
    function _votePowerInitializedAt(address _owner, uint256 _blockNumber) internal view returns (bool) {
        if (!isReplacement) return true;
        uint256 initblock = votePowerInitializationBlock[_owner];
        return initblock != 0 && initblock - 1 <= _blockNumber;
    }
}
