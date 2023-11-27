// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../implementation/TokenPoolBase.sol";
import "../../inflation/interface/IIInflationReceiver.sol";
import "../../addressUpdater/implementation/AddressUpdatable.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";


abstract contract InflationReceiver is TokenPoolBase, IIInflationReceiver, AddressUpdatable {
    using SafeMath for uint256;

    // totals
    uint256 internal totalInflationAuthorizedWei;
    uint256 internal totalInflationReceivedWei;
    uint256 internal lastInflationAuthorizationReceivedTs;
    uint256 internal dailyAuthorizedInflation;

    // addresses
    address internal inflation;

    event DailyAuthorizedInflationSet(uint256 authorizedAmountWei);
    event InflationReceived(uint256 amountReceivedWei);

    /**
     * @dev This modifier ensures that method can only be called by inflation.
     */
    modifier onlyInflation{
        _checkOnlyInflation();
        _;
    }

    constructor(address _addressUpdater) AddressUpdatable(_addressUpdater) {}

    /**
     * @notice Notify the receiver that it is entitled to receive `_toAuthorizeWei` inflation amount.
     * @param _toAuthorizeWei the amount of inflation that can be awarded in the coming day
     */
    function setDailyAuthorizedInflation(uint256 _toAuthorizeWei) external override onlyInflation {
        dailyAuthorizedInflation= _toAuthorizeWei;
        totalInflationAuthorizedWei = totalInflationAuthorizedWei.add(_toAuthorizeWei);
        lastInflationAuthorizationReceivedTs = block.timestamp;

        _setDailyAuthorizedInflation(_toAuthorizeWei);

        emit DailyAuthorizedInflationSet(_toAuthorizeWei);
    }

    /**
     * @notice Receive native tokens from inflation.
     */
    function receiveInflation() external payable override mustBalance onlyInflation {
        totalInflationReceivedWei = totalInflationReceivedWei.add(msg.value);

        _receiveInflation();

        emit InflationReceived(msg.value);
    }

    /**
     * @notice Inflation receivers have a reference to the inflation contract.
     */
    function getInflationAddress() external view override returns(address) {
        return inflation;
    }

    /**
     * @notice Return expected balance of reward manager ignoring sent self-destruct funds
     */
    function getExpectedBalance() external view override returns(uint256) {
        return _getExpectedBalance();
    }

    /**
     * @notice Implementation of the AddressUpdatable abstract method.
     * @dev It can be overridden if other contracts are needed.
     */
    function _updateContractAddresses(
        bytes32[] memory _contractNameHashes,
        address[] memory _contractAddresses
    )
        internal virtual override
    {
        inflation = _getContractAddress(_contractNameHashes, _contractAddresses, "Inflation");
    }

    /**
     * @dev Method that is called when new daily inlfation is authorized.
     */
    function _setDailyAuthorizedInflation(uint256 _toAuthorizeWei) internal virtual {}

    /**
     * @dev Method that is called when new inflation is received.
     */
    function _receiveInflation() internal virtual {}

    /**
     * @dev Method that is used in `mustBalance` modifier. It should return expected balance after
     *      triggered function completes (claiming, burning, receiving inflation,...).
     */
    function _getExpectedBalance() internal virtual override view returns(uint256 _balanceExpectedWei) {
        return totalInflationReceivedWei;
    }

    function _checkOnlyInflation() private view {
        require(msg.sender == inflation, "inflation only");
    }
}
