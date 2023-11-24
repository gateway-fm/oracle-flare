// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

import "../../userInterfaces/IPriceSubmitter.sol";

/**
 * Internal interface for the `PriceSubmitter` contract.
 */
interface IIPriceSubmitter is IPriceSubmitter {

    /**
     * Set trusted addresses that are always allowed to submit and reveal.
     * Only ftso manager can call this method.
     * @param _trustedAddresses Array of voter addresses.
     */
    function setTrustedAddresses(address[] memory _trustedAddresses) external;

    /**
     * Called from the `VoterWhitelister` contract when a new voter has been whitelisted.
     * @param _voter Voter address that has been added to the whitelist.
     * @param _ftsoIndex Index of the FTSO to which the voter has registered.
     * Each FTSO has its own whitelist.
     */
    function voterWhitelisted(address _voter, uint256 _ftsoIndex) external;

    /**
     * Called from the `VoterWhitelister` contract when one or more voters have been removed.
     * @param _voters Array of voter addresses that have been removed.
     * @param _ftsoIndex Index of the FTSO to which the voters were registered.
     * Each FTSO has its own whitelist.
     */
    function votersRemovedFromWhitelist(address[] memory _voters, uint256 _ftsoIndex) external;

    /**
     * Returns the list of trusted addresses that are always allowed to submit and reveal.
     * @return address[] Array of trusted voter addresses.
     */
    function getTrustedAddresses() external view returns (address[] memory);
}
