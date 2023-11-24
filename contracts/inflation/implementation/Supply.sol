// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../interface/IISupply.sol";
import "../../tokenPools/interface/IITokenPool.sol";
import "../../token/lib/CheckPointHistory.sol";
import "../../token/lib/CheckPointHistoryCache.sol";
import "../../governance/implementation/Governed.sol";
import "../../addressUpdater/implementation/AddressUpdatable.sol";
import "../../utils/implementation/AddressSet.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";


/**
 * @title Supply contract
 * @notice This contract maintains and computes various native token supply totals.
 **/

contract Supply is IISupply, Governed, AddressUpdatable {
    using CheckPointHistory for CheckPointHistory.CheckPointHistoryState;
    using CheckPointHistoryCache for CheckPointHistoryCache.CacheState;
    using SafeMath for uint256;
    using AddressSet for AddressSet.State;

    struct SupplyData {
        IITokenPool tokenPool;
        uint256 totalLockedWei;
        uint256 totalInflationAuthorizedWei;
        uint256 totalClaimedWei;
    }

    address payable private constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;
    address payable private constant BURN_ADDRESS_SONGBIRD_TX_FEE = 0x0100000000000000000000000000000000000000;

    uint256 constant internal SWITCH_OVER_BLOCK = uint(-1);

    string internal constant ERR_INFLATION_ONLY = "inflation only";
    string internal constant ERR_TOKEN_POOL_ALREADY_ADDED = "token pool already added";
    string internal constant ERR_INITIAL_GENESIS_AMOUNT_ZERO = "initial genesis amount zero";

    CheckPointHistory.CheckPointHistoryState private circulatingSupplyWei;
    CheckPointHistoryCache.CacheState private circulatingSupplyWeiCache;

    uint256 immutable public initialGenesisAmountWei;
    uint256 immutable public totalExcludedSupplyWei; // Distribution treasury, team escrow
    uint256 public distributedExcludedSupplyWei;
    uint256 public totalLockedWei; // Amounts temporary locked and not considered in the inflatable supply
    uint256 public totalInflationAuthorizedWei;
    uint256 public totalClaimedWei;

    SupplyData[] public tokenPools;

    address public inflation;

    IISupply public oldSupply;
    uint256 public switchOverBlock;

    // balance of burn addresses at last check - needed for updating circulating supply
    uint256 private burnAddressesBalance;

    AddressSet.State private foundationAddresses;
    // balance of all Foundation address at last check - needed for updating circulating supply
    uint256 private foundationAddressesBalance;

    // events
    event AuthorizedInflationUpdateError(uint256 actual, uint256 expected);
    event FoundationAddressesChanged(address[] addedFoundationAddresses, address[] removedFoundationAddresses);

    modifier onlyInflation {
        require(msg.sender == inflation, ERR_INFLATION_ONLY);
        _;
    }

    constructor(
        address _governance,
        address _addressUpdater,
        uint256 _initialGenesisAmountWei,
        uint256 _totalExcludedSupplyWei,
        IITokenPool[] memory _tokenPools,
        address[] memory _foundationAddresses,
        IISupply _oldSupply
    )
        Governed(_governance) AddressUpdatable(_addressUpdater)
    {
        require(_initialGenesisAmountWei > 0, ERR_INITIAL_GENESIS_AMOUNT_ZERO);
        initialGenesisAmountWei = _initialGenesisAmountWei;
        totalExcludedSupplyWei = _totalExcludedSupplyWei;

        _increaseCirculatingSupply(_initialGenesisAmountWei.sub(_totalExcludedSupplyWei));

        for (uint256 i = 0; i < _tokenPools.length; i++) {
            _addTokenPool(_tokenPools[i]);
        }

        foundationAddresses.addAll(_foundationAddresses);
        emit FoundationAddressesChanged(_foundationAddresses, new address[](0));

        if (_oldSupply != IISupply(0)) {
            oldSupply = _oldSupply;
            switchOverBlock = SWITCH_OVER_BLOCK;
        }

        _updateCirculatingSupply();
    }

    /**
     * @notice Updates circulating supply
     * @dev Also updates the burn address amount
    */
    function updateCirculatingSupply() external override onlyInflation {
        if (switchOverBlock == SWITCH_OVER_BLOCK) {
            switchOverBlock = block.number;
        }
        _updateCirculatingSupply();
    }

    /**
     * @notice Updates authorized inflation and circulating supply - emits event if error
     * @param _inflationAuthorizedWei               Authorized inflation
     * @dev Also updates the burn address amount
    */
    function updateAuthorizedInflationAndCirculatingSupply(
            uint256 _inflationAuthorizedWei
    )
        external override
        onlyInflation
    {
        // Save old total inflation authorized value to compare with after update.
        uint256 oldTotalInflationAuthorizedWei = totalInflationAuthorizedWei;

        _updateCirculatingSupply();

        // Check if new authorized inflation was distributed and updated correctly.
        if (totalInflationAuthorizedWei != oldTotalInflationAuthorizedWei.add(_inflationAuthorizedWei)) {
            emit AuthorizedInflationUpdateError(totalInflationAuthorizedWei - oldTotalInflationAuthorizedWei,
                _inflationAuthorizedWei);
        }
    }

    /**
     * @notice Adds token pool so it can call updateTokenPoolDistributedAmount method when
        some tokens are distributed
     * @param _tokenPool                            Token pool address
     * @param _increaseDistributedSupplyByAmountWei If token pool was given initial supply from excluded supply,
        increase distributed value by this amount
     */
    function addTokenPool(
        IITokenPool _tokenPool,
        uint256 _increaseDistributedSupplyByAmountWei
    )
        external
        onlyGovernance
    {
        _increaseDistributedSupply(_increaseDistributedSupplyByAmountWei);
        _addTokenPool(_tokenPool);
        _updateCirculatingSupply();
    }

    /**
     * @notice Change foundation addresses
     * @param _foundationAddressesToAdd             Foundation addresses to add
     * @param _foundationAddressesToRemove          Foundation addresses to remove
     */
    function changeFoundationAddresses(
        address[] memory _foundationAddressesToAdd,
        address[] memory _foundationAddressesToRemove
    )
        external
        onlyGovernance
    {
        emit FoundationAddressesChanged(_foundationAddressesToAdd, _foundationAddressesToRemove);
        for (uint256 i = 0; i < _foundationAddressesToRemove.length; i++) {
            foundationAddresses.remove(_foundationAddressesToRemove[i]);
        }
        foundationAddresses.addAll(_foundationAddressesToAdd);
        _updateCirculatingSupply();
    }

    /**
     * @notice Increase distributed supply when excluded funds are released to a token pool or team members
     * @param _amountWei                            Amount to increase by
     */
    function increaseDistributedSupply(uint256 _amountWei) external onlyGovernance {
        _increaseDistributedSupply(_amountWei);
        _updateCirculatingSupply();
    }

    /**
     * @notice Decrease distributed supply if excluded funds are no longer locked to a token pool
     * @param _amountWei                            Amount to decrease by
     */
    function decreaseDistributedSupply(uint256 _amountWei) external onlyGovernance {
        distributedExcludedSupplyWei = distributedExcludedSupplyWei.sub(_amountWei);
        _decreaseCirculatingSupply(_amountWei);
        _updateCirculatingSupply();
    }

    /**
     * @notice Get approximate circulating supply for given block number from cache - only past block
     * @param _blockNumber                          Block number
     * @return _circulatingSupplyWei Return approximate circulating supply for last known block <= _blockNumber
    */
    function getCirculatingSupplyAtCached(
        uint256 _blockNumber
    )
        external override
        returns(uint256 _circulatingSupplyWei)
    {
        // use cache only for the past (the value will never change)
        require(_blockNumber < block.number, "Can only be used for past blocks");
        if (_blockNumber < switchOverBlock) {
            return oldSupply.getCirculatingSupplyAtCached(_blockNumber);
        }
        (_circulatingSupplyWei,) = circulatingSupplyWeiCache.valueAt(circulatingSupplyWei, _blockNumber);
    }

    /**
     * @notice Get approximate circulating supply for given block number
     * @param _blockNumber                          Block number
     * @return _circulatingSupplyWei Return approximate circulating supply for last known block <= _blockNumber
    */
    function getCirculatingSupplyAt(
        uint256 _blockNumber
    )
        external view override
        returns(uint256 _circulatingSupplyWei)
    {
        if (_blockNumber < switchOverBlock) {
            return oldSupply.getCirculatingSupplyAt(_blockNumber);
        }
        return circulatingSupplyWei.valueAt(_blockNumber);
    }

    /**
     * @notice Get total inflatable balance (initial genesis amount + total claimed - total excluded/locked amount)
     * @return _inflatableBalanceWei Return inflatable balance
    */
    function getInflatableBalance() external view override returns(uint256 _inflatableBalanceWei) {
        if (block.number < switchOverBlock) {
            return oldSupply.getInflatableBalance();
        }
        return initialGenesisAmountWei
            .add(totalClaimedWei)
            .sub(totalExcludedSupplyWei.sub(distributedExcludedSupplyWei))
            .sub(totalLockedWei);
    }

    /**
     * @notice Return the list of Foundation addresses.
     */
    function getFoundationAddresses() external view returns(address[] memory) {
        return foundationAddresses.list;
    }

    /**
     * @notice Return the burn address (a constant).
     */
    function burnAddress() external pure returns(address payable) {
        return BURN_ADDRESS;
    }

    /**
     * @notice Return the burn address used on Songbird for tx fee (a constant).
     */
    function burnAddressSongbirdTxFee() external pure returns(address payable) {
        return BURN_ADDRESS_SONGBIRD_TX_FEE;
    }

    /**
     * @notice Implementation of the AddressUpdatable abstract method.
     */
    function _updateContractAddresses(
        bytes32[] memory _contractNameHashes,
        address[] memory _contractAddresses
    )
        internal override
    {
        inflation = _getContractAddress(_contractNameHashes, _contractAddresses, "Inflation");
    }

    function _increaseCirculatingSupply(uint256 _increaseBy) internal {
        circulatingSupplyWei.writeValue(circulatingSupplyWei.valueAtNow().add(_increaseBy));
    }

    function _decreaseCirculatingSupply(uint256 _decreaseBy) internal {
        circulatingSupplyWei.writeValue(circulatingSupplyWei.valueAtNow().sub(_decreaseBy));
    }

    function _updateCirculatingSupply() internal {
        uint256 len = tokenPools.length;
        for (uint256 i = 0; i < len; i++) {
            SupplyData storage data = tokenPools[i];

            uint256 newTotalLockedWei;
            uint256 newTotalInflationAuthorizedWei;
            uint256 newTotalClaimedWei;

            (newTotalLockedWei, newTotalInflationAuthorizedWei, newTotalClaimedWei) =
                data.tokenPool.getTokenPoolSupplyData();
            assert(newTotalLockedWei.add(newTotalInflationAuthorizedWei) >= newTotalClaimedWei);

            // updates total inflation authorized with daily authorized inflation
            uint256 dailyInflationAuthorizedWei = newTotalInflationAuthorizedWei.sub(data.totalInflationAuthorizedWei);
            totalInflationAuthorizedWei = totalInflationAuthorizedWei.add(dailyInflationAuthorizedWei);

            // updates circulating supply
            uint256 claimChange = newTotalClaimedWei.sub(data.totalClaimedWei);
            _increaseCirculatingSupply(claimChange);
            totalClaimedWei = totalClaimedWei.add(claimChange);
            if (newTotalLockedWei >= data.totalLockedWei) {
                uint256 lockChange = newTotalLockedWei - data.totalLockedWei;
                _decreaseCirculatingSupply(lockChange);
                totalLockedWei = totalLockedWei.add(lockChange);
            } else {
                // if founds are unlocked, they are returned to excluded amount
                uint256 lockChange = data.totalLockedWei - newTotalLockedWei;
                distributedExcludedSupplyWei = distributedExcludedSupplyWei.sub(lockChange);
                totalLockedWei = totalLockedWei.sub(lockChange);
            }

            // update data
            data.totalLockedWei = newTotalLockedWei;
            data.totalInflationAuthorizedWei = newTotalInflationAuthorizedWei;
            data.totalClaimedWei = newTotalClaimedWei;
        }

        _updateBurnAddressesAmount();
        _updateFoundationAddressesAmount();
    }

    function _updateBurnAddressesAmount() internal {
        uint256 newBalance = BURN_ADDRESS.balance.add(BURN_ADDRESS_SONGBIRD_TX_FEE.balance);
        _decreaseCirculatingSupply(newBalance.sub(burnAddressesBalance));
        burnAddressesBalance = newBalance;
    }

    function _updateFoundationAddressesAmount() internal {
        uint256 newBalance = 0;
        address[] memory addresses = foundationAddresses.list;
        for (uint256 i = 0; i < addresses.length; i++) {
            newBalance = newBalance.add(addresses[i].balance);
        }
        if (foundationAddressesBalance == newBalance) {
            return;
        } else if (foundationAddressesBalance > newBalance) {
            _increaseCirculatingSupply(foundationAddressesBalance - newBalance);
        } else {
            _decreaseCirculatingSupply(newBalance - foundationAddressesBalance);
        }
        foundationAddressesBalance = newBalance;
    }

    function _addTokenPool(IITokenPool _tokenPool) internal {
        uint256 len = tokenPools.length;
        for (uint256 i = 0; i < len; i++) {
            if (_tokenPool == tokenPools[i].tokenPool) {
                revert(ERR_TOKEN_POOL_ALREADY_ADDED);
            }
        }
        tokenPools.push();
        tokenPools[len].tokenPool = _tokenPool;
    }

    function _increaseDistributedSupply(uint256 _amountWei) internal {
        assert(totalExcludedSupplyWei.sub(distributedExcludedSupplyWei) >= _amountWei);
        _increaseCirculatingSupply(_amountWei);
        distributedExcludedSupplyWei = distributedExcludedSupplyWei.add(_amountWei);
    }
}
