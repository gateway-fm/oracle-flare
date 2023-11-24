// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

import "../genesis/interface/IFtsoGenesis.sol";
import "../genesis/interface/IFtsoRegistryGenesis.sol";
import "../genesis/interface/IFtsoManagerGenesis.sol";

/**
 * Interface for the `PriceSubmitter` contract.
 *
 * This is the contract used by all [FTSO data providers](https://docs.flare.network/tech/ftso)
 * to submit their data.
 */
interface IPriceSubmitter {
    /**
     * Emitted when a hash is submitted through `submitHash`.
     * @param submitter Address of the submitting data provider.
     * @param epochId Current price epoch ID.
     * @param hash Submitted hash.
     * @param timestamp Current block timestamp.
     */
    event HashSubmitted(
        address indexed submitter,
        uint256 indexed epochId,
        bytes32 hash,
        uint256 timestamp
    );

    /**
     * Emitted when prices are revealed through `revealPrice`.
     * @param voter Address of the revealing data provider.
     * @param epochId ID of the epoch in which the price hash is revealed.
     * @param ftsos Array of FTSOs that correspond to the indexes in the call.
     * @param prices List of revealed prices.
     * @param random Revealed random number.
     * @param timestamp Current block timestamp.
     */
    event PricesRevealed(
        address indexed voter,
        uint256 indexed epochId,
        IFtsoGenesis[] ftsos,
        uint256[] prices,
        uint256 random,
        uint256 timestamp
    );

    /**
     * Submits a hash for the current epoch. Can only be called by FTSO data providers
     * whitelisted through the `VoterWhitelisted` contract.
     * Emits the `HashSubmitted` event.
     * @param _epochId ID of the target epoch to which the hash is submitted.
     * @param _hash A hash of the FTSO indices, prices, random number, and voter address.
     */
    function submitHash(
        uint256 _epochId,
        bytes32 _hash
    ) external;

    /**
     * Reveals submitted prices during the epoch reveal period.
     * The hash of FTSO indices, prices, random number, and voter address must be equal
     * to the hash previously submitted with `submitHash`.
     * Emits a `PricesRevealed` event.
     * @param _epochId ID of the epoch to which the price hashes are submitted.
     * @param _ftsoIndices List of FTSO indices in ascending order.
     * @param _prices List of submitted prices in USD.
     * @param _random Submitted random number.
     */
    function revealPrices(
        uint256 _epochId,
        uint256[] memory _ftsoIndices,
        uint256[] memory _prices,
        uint256 _random
    ) external;

    /**
     * Returns a bitmap of all FTSOs for which a data provider is allowed to submit prices or hashes.
     * @param _voter Address of the voter.
     * @return If a data provider is allowed to vote for a given FTSO index, the corresponding
     * bit in the result is 1.
     */
    function voterWhitelistBitmap(address _voter) external view returns (uint256);

    /**
     * Returns the address of the `VoterWhitelister` contract managing the data provider whitelist.
     */
    function getVoterWhitelister() external view returns (address);

    /**
     * Returns the address of the `FtsoRegistry` contract.
     */
    function getFtsoRegistry() external view returns (IFtsoRegistryGenesis);

    /**
     * Returns the address of the `FtsoManager` contract.
     */
    function getFtsoManager() external view returns (IFtsoManagerGenesis);

    /**
     * Returns the random number for the previous epoch, obtained from the random numbers
     * provided by all data providers along with their data submissions.
     * Note that the random number for the previous epoch keeps updating as new submissions are revealed.
     * @return Random number calculated from all data provider's submissions.
     */
    function getCurrentRandom() external view returns (uint256);

    /**
     * Returns the random number used in a specific past epoch, obtained from the random numbers
     * provided by all data providers along with their data submissions.
     * @param _epochId ID of the queried epoch.
     * Current epoch cannot be queried, and the previous epoch is constantly updated
     * as data providers reveal their prices and random numbers.
     * Note that only the last 50 epochs can be queried and there is no bounds checking
     * for this parameter. Out-of-bounds queries return undefined values.
     * @return The random number used in that epoch.
     */
    function getRandom(uint256 _epochId) external view returns (uint256);
}
