// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

import "../../userInterfaces/IVoterWhitelister.sol";

/**
 * Internal interface for managers of the [FTSO whitelist](https://docs.flare.network/infra/data/whitelisting/).
 *
 * Only addresses registered in this contract can submit data to the FTSO system.
 */
interface IIVoterWhitelister is IVoterWhitelister {
    /**
     * Used to chill a data provider, this is, remove it from the whitelist for a
     * specified number of reward epochs.
     * @param _voter Data provider being chilled.
     * @param _noOfRewardEpochs Number of epochs to chill the provider for.
     * @param _ftsoIndices Array of indices of the FTSOs that will not allow this provider
     * to submit data.
     */
    function chillVoter(
        address _voter,
        uint256 _noOfRewardEpochs,
        uint256[] memory _ftsoIndices
    )
        external
        returns(
            bool[] memory _removed,
            uint256 _untilRewardEpoch
        );

    /**
     * Set the maximum number of voters in the whitelist for a specific FTSO.
     * Can remove voters with the least votepower from the whitelist.
     * @param _ftsoIndex Index of the FTSO to modify.
     * @param _newMaxVoters New size of the whitelist.
     */
    function setMaxVotersForFtso(uint256 _ftsoIndex, uint256 _newMaxVoters) external;

    /**
     * Set the maximum number of voters in the whitelist for a new FTSOs.
     * @param _defaultMaxVotersForFtso New maximum default value.
     */
    function setDefaultMaxVotersForFtso(uint256 _defaultMaxVotersForFtso) external;

    /**
     * Create an empty whitelist with default size for a new FTSO.
     * @param _ftsoIndex Index of the new FTSO.
     */
    function addFtso(uint256 _ftsoIndex) external;

    /**
     * Clear whitelist for a removed FTSO.
     * @param _ftsoIndex Index of the removed FTSO.
     */
    function removeFtso(uint256 _ftsoIndex) external;

    /**
     * Remove a trusted address from whitelist.
     * @param _trustedAddress Address to remove.
     * @param _ftsoIndex Index of the FTSO being modified.
     */
    function removeTrustedAddressFromWhitelist(address _trustedAddress, uint256 _ftsoIndex) external;
}
