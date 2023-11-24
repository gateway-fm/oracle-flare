// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;


import "../interface/IIInflationReceiver.sol";
import "../../tokenPools/interface/IITokenPool.sol";
import "../../governance/implementation/Governed.sol";

import "../../utils/implementation/SafePct.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

contract InflationReceiverAndTokenPoolMock is IIInflationReceiver, IITokenPool, Governed, ReentrancyGuard {
    using SafePct for uint256;
    using SafeMath for uint256;

    string internal constant ERR_INFLATION_ONLY = "inflation only";
    string internal constant ERR_OUT_OF_BALANCE = "out of balance";
    string internal constant ERR_CLAIM_FAILED = "claim failed";

    // Totals
    uint256 public totalClaimedWei;
    uint256 public totalInflationAuthorizedWei;
    uint256 public totalInflationReceivedWei;
    uint256 public totalSelfDestructReceivedWei;
    uint256 public lastInflationAuthorizationReceivedTs;
    uint256 public dailyAuthorizedInflation;
    uint256 public foundationAllocatedFundsWei;

    uint256 private lastBalance;

    // addresses
    address public inflation;

    // events
    event DailyAuthorizedInflationSet(uint256 authorizedAmountWei);
    event InflationReceived(uint256 amountReceivedWei);
    event FoundationAllocatedFundsReceived(uint256 amountReceivedWei);

    modifier mustBalance {
        _;
        require(address(this).balance == _getExpectedBalance(), ERR_OUT_OF_BALANCE);
    }

    modifier onlyInflation {
        require(msg.sender == inflation, ERR_INFLATION_ONLY);
        _;
    }

    constructor(
        address _governance,
        address _inflation
    )
        Governed(_governance)
    {
        inflation = _inflation;
    }

    function receiveFoundationAllocatedFunds() external payable mustBalance onlyGovernance {
        (uint256 currentBalance, ) = _handleSelfDestructProceeds();
        foundationAllocatedFundsWei = foundationAllocatedFundsWei.add(msg.value);
        lastBalance = currentBalance;

        emit FoundationAllocatedFundsReceived(msg.value);
    }

    function receiveInflation() external payable override mustBalance onlyInflation {
        (uint256 currentBalance, ) = _handleSelfDestructProceeds();
        totalInflationReceivedWei = totalInflationReceivedWei.add(msg.value);
        lastBalance = currentBalance;

        emit InflationReceived(msg.value);
    }

    function setDailyAuthorizedInflation(uint256 _toAuthorizeWei) external override onlyInflation {
        dailyAuthorizedInflation = _toAuthorizeWei;
        totalInflationAuthorizedWei = totalInflationAuthorizedWei.add(_toAuthorizeWei);
        lastInflationAuthorizationReceivedTs = block.timestamp;

        emit DailyAuthorizedInflationSet(_toAuthorizeWei);
    }

    function claimMock(address payable _recipient, uint256 _rewardAmount) external mustBalance nonReentrant {
        _handleSelfDestructProceeds();

        totalClaimedWei += _rewardAmount;

        _transferReward(_recipient, _rewardAmount);

        //slither-disable-next-line reentrancy-eth          // guarded by nonReentrant
        lastBalance = address(this).balance;
    }

    function getTokenPoolSupplyData() external view override 
        returns (
            uint256 _foundationAllocatedFundsWei,
            uint256 _totalInflationAuthorizedWei,
            uint256 _totalClaimedWei
        )
    {
        return (foundationAllocatedFundsWei, totalInflationAuthorizedWei, totalClaimedWei);
    }
    
    function getInflationAddress() external view override returns(address) {
        return inflation;
    }

    function getContractName() external pure override returns (string memory) {
        return "InflationReceiverAndTokenPoolMock";
    }

    function _transferReward(address payable _recipient, uint256 _rewardAmount) internal {
        if (_rewardAmount > 0) {
            // transfer total amount (state is updated and events are emitted in _claimReward)
            /* solhint-disable avoid-low-level-calls */
            //slither-disable-next-line arbitrary-send-eth          // amount always calculated by _claimReward
            (bool success, ) = _recipient.call{value: _rewardAmount}("");
            /* solhint-enable avoid-low-level-calls */
            require(success, ERR_CLAIM_FAILED);
        }
    }

    function _handleSelfDestructProceeds() internal returns (uint256 _currentBalance, uint256 _expectedBalance) {
        _expectedBalance = lastBalance.add(msg.value);
        _currentBalance = address(this).balance;
        if (_currentBalance > _expectedBalance) {
            // Then assume extra were self-destruct proceeds
            totalSelfDestructReceivedWei = totalSelfDestructReceivedWei.add(_currentBalance).sub(_expectedBalance);
        } else if (_currentBalance < _expectedBalance) {
            // This is a coding error
            assert(false);
        }
    }
    
    function _getExpectedBalance() private view returns(uint256 _balanceExpectedWei) {
        return foundationAllocatedFundsWei
            .add(totalInflationReceivedWei)
            .add(totalSelfDestructReceivedWei)
            .sub(totalClaimedWei);
    }
}
