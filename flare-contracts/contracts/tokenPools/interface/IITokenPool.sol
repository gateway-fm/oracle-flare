// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

/**
 * Internal interface for token pools.
 */
interface IITokenPool {

    /**
     * Returns token pool supply data.
     * @return _lockedFundsWei Total amount of funds ever locked in the token pool (wei).
     * `_lockedFundsWei` - `_totalClaimedWei` is the amount currently locked and outside the circulating supply.
     * @return _totalInflationAuthorizedWei Total inflation authorized amount (wei).
     * @return _totalClaimedWei Total claimed amount (wei).
     */
    function getTokenPoolSupplyData() external returns (
        uint256 _lockedFundsWei,
        uint256 _totalInflationAuthorizedWei,
        uint256 _totalClaimedWei
    );
}
