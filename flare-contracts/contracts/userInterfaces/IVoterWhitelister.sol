// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

/**
 * Interface for managers of the [FTSO whitelist](https://docs.flare.network/infra/data/whitelisting/).
 *
 * Only addresses registered in this contract can submit data to the FTSO system.
 */
interface IVoterWhitelister {
    /**
     * Emitted when an account is added to the voter whitelist.
     * @param voter Address of the added account.
     * @param ftsoIndex Index of the FTSO to which it has been registered.
     */
    event VoterWhitelisted(address voter, uint256 ftsoIndex);

    /**
     * Emitted when an account is removed from the voter whitelist.
     * @param voter Address of the removed account.
     * @param ftsoIndex Index of the FTSO in which it was registered.
     */
    event VoterRemovedFromWhitelist(address voter, uint256 ftsoIndex);

    /**
     * Emitted when an account is chilled from the voter whitelist.
     * @param voter Address of the chilled account.
     * @param untilRewardEpoch Epoch ID when the chill will be lifted.
     */
    event VoterChilled(address voter, uint256 untilRewardEpoch);

    /**
     * Requests whitelisting an account to act as a data provider for a specific FTSO.
     * Reverts if the vote power of the account is too low.
     * May be called by any address, including the voter itself.
     * @param _voter Address of the voter to be whitelisted.
     * @param _ftsoIndex Index of the FTSO.
     */
    function requestWhitelistingVoter(address _voter, uint256 _ftsoIndex) external;

    /**
     * Requests whitelisting an account to act as a data provider for all active FTSOs.
     * May be called by any address, including the voter itself.
     * @param _voter Address of the voter to be whitelisted.
     * @return _supportedIndices Array of currently supported FTSO indices.
     * @return _success Array of success flags by FTSO index.
     */
    function requestFullVoterWhitelisting(
        address _voter
    )
        external
        returns (
            uint256[] memory _supportedIndices,
            bool[] memory _success
        );

    /**
     * Maximum number of voters in the whitelist for a new FTSO.
     * @return uint256 Default maximum allowed voters.
     */
    function defaultMaxVotersForFtso() external view returns (uint256);

    /**
     * Maximum number of voters in the whitelist for a specific FTSO.
     * Adjustable separately for each index.
     * @param _ftsoIndex Index of the FTSO.
     * @return uint256 Maximum allowed voters.
     */
    function maxVotersForFtso(uint256 _ftsoIndex) external view returns (uint256);

    /**
     * Gets whitelisted price providers for the FTSO with a specified symbol.
     * @param _symbol Queried symbol.
     * @return Array of addresses of the whitelisted data providers.
     */
    function getFtsoWhitelistedPriceProvidersBySymbol(string memory _symbol) external view returns (address[] memory);

    /**
     * Gets whitelisted price providers for the FTSO at a given index.
     * @param _ftsoIndex Queried index.
     * @return Array of addresses of the whitelisted data providers.
     */
    function getFtsoWhitelistedPriceProviders(uint256 _ftsoIndex) external view returns (address[] memory);

    /**
     * In case of providing bad prices (e.g. collusion), the voter can be chilled for a few reward epochs.
     * A voter can whitelist again from a returned reward epoch onwards.
     * @param _voter Address of the queried data provider.
     * @return uint256 ID of the epoch where the data provider can start submitting prices again.
     */
    function chilledUntilRewardEpoch(address _voter) external view returns (uint256);
}
