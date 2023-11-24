
// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;


/**
 * Portion of the IFtso interface that is available to contracts deployed at genesis.
 */
interface IFtsoGenesis {

    /**
     * Reveals the price submitted by a voter on a specific epoch.
     * The hash of _price and _random must be equal to the submitted hash
     * @param _voter Voter address.
     * @param _epochId ID of the epoch in which the price hash was submitted.
     * @param _price Submitted price.
     * @param _voterWNatVP Voter's vote power in WNat units.
     */
    function revealPriceSubmitter(
        address _voter,
        uint256 _epochId,
        uint256 _price,
        uint256 _voterWNatVP
    ) external;

    /**
     * Get and cache the vote power of a voter on a specific epoch, in WNat units.
     * @param _voter Voter address.
     * @param _epochId ID of the epoch in which the price hash was submitted.
     * @return Voter's vote power in WNat units.
     */
    function wNatVotePowerCached(address _voter, uint256 _epochId) external returns (uint256);
}
