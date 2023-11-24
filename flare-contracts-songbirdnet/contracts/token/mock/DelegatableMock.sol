// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import {Delegatable} from "../implementation/Delegatable.sol";
import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";
import {CheckPointHistory} from "../lib/CheckPointHistory.sol";

/**
 * @title Delegatable mock contract
 * @notice A contract to instantiate the abstract Delegatable contract for unit testing.
 **/
contract DelegatableMock is Delegatable {
    using CheckPointHistory for CheckPointHistory.CheckPointHistoryState;
    using SafeMath for uint256;

    mapping(address => CheckPointHistory.CheckPointHistoryState) private senderBalances;

    constructor() Delegatable() {
    }
    
    function balanceOf(address _who) public view returns (uint256) {
        return senderBalances[_who].valueAtNow();
    }

    function balanceOfAt(address _who, uint256 _blockNumber) public view returns (uint256) {
        return senderBalances[_who].valueAt(_blockNumber);
    }

    function addUpdateBalance(address _who, uint256 _balance) private {
        senderBalances[_who].writeValue(balanceOf(_who).add(_balance));
    }

    function subtractBalance(address _who, uint256 _balance) private {
        senderBalances[_who].writeValue(balanceOf(_who).sub(_balance));
    }

    function delegate(address _to, uint256 _bips) public {
        _delegateByPercentage(msg.sender, _to, balanceOf(msg.sender), _bips);
    }

    function delegateExplicit(address _to, uint256 _votePower) public {
        _delegateByAmount(msg.sender, _to, balanceOf(msg.sender), _votePower);
    }

    function undelegateAll() public {
        _undelegateAllByPercentage(msg.sender, balanceOf(msg.sender));
    }
    
    function undelegateAllExplicit(address[] memory _delegateAddresses) external returns (uint256) {
        return _undelegateAllByAmount(msg.sender, _delegateAddresses);
    }

    function burnVotePower(address _owner, uint256 _amount) public {
        _burnVotePower(_owner, balanceOf(_owner), _amount);
        subtractBalance(_owner, _amount);
    }

    function mintVotePower(address _owner, uint256 _amount) public {
        _mintVotePower(_owner, balanceOf(_owner), _amount);
        addUpdateBalance(_owner, _amount);
    }

    function transmitVotePower(address from, address to, uint256 _amount) public {
        _transmitVotePower(from, to, balanceOf(from), balanceOf(to), _amount);
    }

    function undelegatedVotePowerOf(address _owner) public view returns(uint256 _votePower) {
        return _undelegatedVotePowerOf(_owner, balanceOf(_owner));
    }

    function undelegatedVotePowerOfAt(address _owner, uint256 _blockNumber) 
        public view returns (uint256 _votePower) {
        return _undelegatedVotePowerOfAt(_owner, balanceOfAt(_owner, _blockNumber), _blockNumber);
    }

    function revokeDelegationAt(address _who, uint256 _blockNumber) external {
        _revokeDelegationAt(msg.sender, _who, balanceOfAt(msg.sender, _blockNumber), _blockNumber);
    }

    function votePowerOf(address _who) external view returns(uint256) {
        return _votePowerOf(_who);
    }

    function votePowerOfAt(address _who, uint256 _blockNumber) external view returns(uint256) {
        return _votePowerOfAt(_who, _blockNumber);
    }

    function votePowerFromTo(address _from, address _to) external view returns(uint256) {
        return _votePowerFromTo(_from, _to, balanceOf(_from));
    }
    
    function votePowerFromToAt(
        address _from, 
        address _to, 
        uint256 _blockNumber
    )
        external view
        returns(uint256)
    {
        return _votePowerFromToAt(_from, _to, balanceOfAt(_from, _blockNumber), _blockNumber);
    }

    function delegationModeOf(address _who) external view returns (uint256) {
        return uint256(_delegationModeOf(_who));
    }

    function delegatesOf(
        address _owner
    )
        external view 
        returns (
            address[] memory _delegateAddresses, 
            uint256[] memory _bips,
            uint256 _count,
            uint256 _delegationMode
        )
    {
        return delegatesOfAt(_owner, block.number);
    }

    function delegatesOfAt(
        address _owner,
        uint256 _blockNumber
    )
        public view 
        returns (
            address[] memory _delegateAddresses, 
            uint256[] memory _bips,
            uint256 _count,
            uint256 _delegationMode
        )
    {
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

    function setCleanupBlockNumber(uint256 _blockNumber) public {
        _setCleanupBlockNumber(_blockNumber);
    }
    
    function getCleanupBlockNumber() public view returns (uint256) {
        return _cleanupBlockNumber();
    }
}
