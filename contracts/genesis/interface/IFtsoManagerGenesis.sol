
// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;


/**
 * Portion of the `IFtsoManager` interface that is available to contracts deployed at genesis.
 */
interface IFtsoManagerGenesis {

    /**
     * Returns current price epoch ID.
     * @return _priceEpochId Currently running epoch ID. IDs are consecutive numbers starting from zero.
     */
    function getCurrentPriceEpochId() external view returns (uint256 _priceEpochId);

}
