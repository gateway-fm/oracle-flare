// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../interface/IIDelegationAccount.sol";
import "../interface/IIClaimSetupManager.sol";
import "@openzeppelin/contracts/math/Math.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";


contract DelegationAccount is IIDelegationAccount {
    using SafeERC20 for IERC20;

    string internal constant ERR_TRANSFER_FAILURE = "transfer failed";
    string internal constant ERR_MANAGER_ONLY = "only manager";

    address public owner;
    IIClaimSetupManager public manager;

    /**
     * Some external methods in DelegationAccount contract can only be executed by the manager.
     */
    modifier onlyManager {
        _checkOnlyManager();
        _;
    }

    receive() external payable {
        manager.wNat().deposit{value: msg.value}();
    }

    /**
     * Initialization of a new deployed contract
     * @param _owner                        contract owner address
     * @param _manager                      contract manager address
     */
    function initialize(
        address _owner,
        IIClaimSetupManager _manager
    )
        external override
    {
        require(address(owner) == address(0), "owner already set");
        require(address(_owner) != address(0), "owner address zero");
        require(address(_manager) != address(0), "manager address zero");
        owner = _owner;
        manager = _manager;
        emit Initialize(owner, _manager);
    }

    function delegate(WNat _wNat, address _to, uint256 _bips) external override onlyManager {
        _wNat.delegate(_to, _bips);
        emit DelegateFtso(_to, _bips);
    }

    function batchDelegate(
        WNat _wNat,
        address[] memory _delegatees,
        uint256[] memory _bips
    )
        external override onlyManager
    {
        _wNat.batchDelegate(_delegatees, _bips);
        emit UndelegateAllFtso();
        for (uint256 i = 0; i < _delegatees.length; i++) {
            emit DelegateFtso(_delegatees[i], _bips[i]);
        }
    }

    function undelegateAll(WNat _wNat) external override onlyManager {
        _wNat.undelegateAll();
        emit UndelegateAllFtso();
    }

    function revokeDelegationAt(WNat _wNat, address _who, uint256 _blockNumber) external override onlyManager {
        _wNat.revokeDelegationAt(_who, _blockNumber);
        emit RevokeFtso(_who, _blockNumber);
    }

    function delegateGovernance(IGovernanceVotePower _governanceVP, address _to) external override onlyManager {
        _governanceVP.delegate(_to);
        emit DelegateGovernance(_to);
    }

    function undelegateGovernance(IGovernanceVotePower _governanceVP) external override onlyManager {
        _governanceVP.undelegate();
        emit UndelegateGovernance();
    }

    function withdraw(WNat _wNat, uint256 _amount) external override onlyManager {
        emit WithdrawToOwner(_amount);
        bool success = _wNat.transfer(owner, _amount);
        require(success, ERR_TRANSFER_FAILURE);
    }

    /**
     * @notice Allows user to transfer balance of ERC20 tokens owned by the personal delegation contract.
     The main use case is to transfer tokens/NFTs that were received as part of an airdrop or register 
     as participant in such airdrop.
     * @param _token            Target token contract address
     * @param _amount           Amount of tokens to transfer
     * @dev Reverts if target token is WNat contract
     */
    function transferExternalToken(WNat _wNat, IERC20 _token, uint256 _amount) external override onlyManager {
        require(address(_token) != address(_wNat), "Transfer from wNat not allowed");
        emit ExternalTokenTransferred(_token, _amount);
        _token.safeTransfer(owner, _amount);
    }

    function _checkOnlyManager() internal view {
        require(msg.sender == address(manager), ERR_MANAGER_ONLY);
    }
}
