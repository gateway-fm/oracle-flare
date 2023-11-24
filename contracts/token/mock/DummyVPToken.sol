// SPDX-License-Identifier: MIT

pragma solidity 0.7.6;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IVPToken} from "../../userInterfaces/IVPToken.sol";
import {IVPContractEvents} from "../../userInterfaces/IVPContractEvents.sol";
import "../interface/IIVPToken.sol";

contract DummyVPToken is ERC20, IIVPToken {
    uint256 public constant MINTAMOUNT = 700 * 10 ** 18; 

    constructor (string memory name_, string memory symbol_) ERC20(name_, symbol_) {
        _mint(msg.sender, MINTAMOUNT);
    }

    // empty implementations, to satisfy the IIVPToken contract    
    function setCleanupBlockNumber(uint256 _blockNumber) external override {}

    function setCleanupBlockNumberManager(address _cleanupBlockNumberManager) external override {}

    function setCleanerContract(address _cleanerContract) external override {}

    function setGovernanceVotePower(IIGovernanceVotePower _governanceVotePower) external override {}

    function delegate(address _to, uint256 _bips) external override {}

    function delegateExplicit(address _to, uint256 _amount) external override {}

    function undelegateAll() external override {}

    function undelegateAllExplicit(address[] memory _delegateAddresses) external override returns (uint256) {}

    function revokeDelegationAt(address _who, uint256 _blockNumber) external override {}

    function totalVotePowerAtCached(uint256 _blockNumber) external override returns(uint256) {}

    function votePowerOfAtCached(address _owner, uint256 _blockNumber) external override returns(uint256) {}

    function totalSupplyAt(uint256 _blockNumber) external view override returns(uint256) {}

    function cleanupBlockNumber() external view override returns (uint256) {}

    function balanceOfAt(address _owner, uint256 _blockNumber) external view override returns (uint256) {}

    function readVotePowerContract() external view override returns (IVPContractEvents) {}

    function writeVotePowerContract() external view override returns (IVPContractEvents) {}

    function governanceVotePower() external view override returns (IGovernanceVotePower) {}

    function delegationModeOf(address _who) external view override returns (uint256 _delegationMode) {}

    function undelegatedVotePowerOf(address _owner) external view override returns(uint256) {}

    function undelegatedVotePowerOfAt(address _owner, uint256 _blockNumber) external view override returns (uint256) {}

    function delegatesOfAt(address _owner, uint256 _blockNumber) external view override 
        returns (
            address[] memory _delegateAddresses, 
            uint256[] memory _bips, 
            uint256 _count, 
            uint256 _delegationMode
        ) 
    {}

    function delegatesOf(address _owner) external view override 
        returns (
            address[] memory _delegateAddresses, 
            uint256[] memory _bips, 
            uint256 _count, 
            uint256 _delegationMode
        ) 
    {}

    function votePowerFromTo(address _from, address _to) external view override returns(uint256) {
    }

    function votePowerFromToAt(address _from, address _to, uint256 _blockNumber) external view override 
        returns(uint256) 
    {}

    function batchVotePowerOfAt(address[] memory _owners, uint256 _blockNumber) 
        external view override returns(uint256[] memory) {}

    function name() public view override(ERC20, IVPToken) returns (string memory) {
        return ERC20.name();
    }

    function symbol() public view override(ERC20, IVPToken) returns (string memory) {
        return ERC20.symbol();
    }

    function decimals() public view override(ERC20, IVPToken) returns (uint8) {
        return ERC20.decimals();
    }

    function totalVotePower() public view override returns(uint256) {}

    function totalVotePowerAt(uint256 _blockNumber) public view override returns(uint256) {}

    /// vote power for current block
    function votePowerOf(address _who) public view override returns (uint256) {
        return votePowerOfAt(_who, block.number);
    }

    /// @notice for any cotracts wishing to share rewards with depositers, this
    ///     function enables to check how much of the contracts vote power came 
    ///     from this delegator.
    function votePowerOfAt(address _who, uint256 _blockNumber) public view override
        returns (uint256)
    {
        _blockNumber;
        return balanceOf(_who) / 1e18;
    }
}
