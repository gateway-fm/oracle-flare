// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;
pragma abicoder v2;

import "../ftso/interface/IIFtso.sol";
import "../genesis/interface/IFtsoRegistryGenesis.sol";

/**
 * Interface for the `FtsoRegistry` contract.
 */
interface IFtsoRegistry is IFtsoRegistryGenesis {

    /**
     * Structure describing the price of an FTSO asset at a particular point in time.
     */
    struct PriceInfo {
        // Index of the asset.
        uint256 ftsoIndex;
        // Price of the asset in USD, multiplied by 10^`ASSET_PRICE_USD_DECIMALS`
        uint256 price;
        // Number of decimals used in the `price` field.
        uint256 decimals;
        // Timestamp for when this price was updated, in seconds since UNIX epoch.
        uint256 timestamp;
    }

    /**
     * Returns the address of the FTSO contract for a given index.
     * Reverts if unsupported index is passed.
     * @param _activeFtso The queried index.
     * @return _activeFtsoAddress FTSO contract address for the queried index.
     */

    function getFtso(uint256 _activeFtso) external view returns(IIFtso _activeFtsoAddress);
    /**
     * Returns the address of the FTSO contract for a given symbol.
     * Reverts if unsupported symbol is passed.
     * @param _symbol The queried symbol.
     * @return _activeFtsoAddress FTSO contract address for the queried symbol.
     */

    function getFtsoBySymbol(string memory _symbol) external view returns(IIFtso _activeFtsoAddress);
    /**
     * Returns the indices of the currently supported FTSOs.
     * Active FTSOs are ones that currently receive price feeds.
     * @return _supportedIndices Array of all active FTSO indices in increasing order.
     */
    function getSupportedIndices() external view returns(uint256[] memory _supportedIndices);

    /**
     * Returns the symbols of the currently supported FTSOs.
     * Active FTSOs are ones that currently receive price feeds.
     * @return _supportedSymbols Array of all active FTSO symbols in increasing order.
     */
    function getSupportedSymbols() external view returns(string[] memory _supportedSymbols);

    /**
     * Get array of all FTSO contracts for all supported asset indices.
     * The index of FTSO in returned array does not necessarily correspond to the asset's index.
     * Due to deletion, some indices might be unsupported.
     *
     * Use `getSupportedIndicesAndFtsos` to retrieve pairs of correct indices and FTSOs,
     * where possible "null" holes are readily apparent.
     * @return _ftsos Array of all supported FTSOs.
     */
    function getSupportedFtsos() external view returns(IIFtso[] memory _ftsos);

    /**
     * Returns the FTSO index corresponding to a given asset symbol.
     * Reverts if the symbol is not supported.
     * @param _symbol Symbol to query.
     * @return _assetIndex The corresponding asset index.
     */
    function getFtsoIndex(string memory _symbol) external view returns (uint256 _assetIndex);

    /**
     * Returns the asset symbol corresponding to a given FTSO index.
     * Reverts if the index is not supported.
     * @param _ftsoIndex Index to query.
     * @return _symbol The corresponding asset symbol.
     */
    function getFtsoSymbol(uint256 _ftsoIndex) external view returns (string memory _symbol);

    /**
     * Public view function to get the current price of a given active FTSO index.
     * Reverts if the index is not supported.
     * @param _ftsoIndex Index to query.
     * @return _price Current price of the asset in USD multiplied by 10^`ASSET_PRICE_USD_DECIMALS`.
     * @return _timestamp Timestamp for when this price was updated, in seconds since UNIX epoch.
     */
    function getCurrentPrice(uint256 _ftsoIndex) external view returns(uint256 _price, uint256 _timestamp);

    /**
     * Public view function to get the current price of a given active asset symbol.
     * Reverts if the symbol is not supported.
     * @param _symbol Symbol to query.
     * @return _price Current price of the asset in USD multiplied by 10^`ASSET_PRICE_USD_DECIMALS`.
     * @return _timestamp Timestamp for when this price was updated, in seconds since UNIX epoch.
     */
    function getCurrentPrice(string memory _symbol) external view returns(uint256 _price, uint256 _timestamp);

    /**
     * Public view function to get the current price and decimals of a given active FTSO index.
     * Reverts if the index is not supported.
     * @param _assetIndex Index to query.
     * @return _price Current price of the asset in USD multiplied by 10^`_assetPriceUsdDecimals`.
     * @return _timestamp Timestamp for when this price was updated, in seconds since UNIX epoch.
     * @return _assetPriceUsdDecimals Number of decimals used to return the `_price`.
     */
    function getCurrentPriceWithDecimals(uint256 _assetIndex) external view
        returns(uint256 _price, uint256 _timestamp, uint256 _assetPriceUsdDecimals);

    /**
     * Public view function to get the current price and decimals of a given active asset symbol.
     * Reverts if the symbol is not supported.
     * @param _symbol Symbol to query.
     * @return _price Current price of the asset in USD multiplied by 10^`_assetPriceUsdDecimals`.
     * @return _timestamp Timestamp for when this price was updated, in seconds since UNIX epoch.
     * @return _assetPriceUsdDecimals Number of decimals used to return the `_price`.
     */
    function getCurrentPriceWithDecimals(string memory _symbol) external view
        returns(uint256 _price, uint256 _timestamp, uint256 _assetPriceUsdDecimals);

    /**
     * Returns the current price of all supported assets.
     * @return Array of `PriceInfo` structures.
     */
    function getAllCurrentPrices() external view returns (PriceInfo[] memory);

    /**
     * Returns the current price of a list of indices.
     * Reverts if any of the indices is not supported.
     * @param _indices Array of indices to query.
     * @return Array of `PriceInfo` structures.
     */
    function getCurrentPricesByIndices(uint256[] memory _indices) external view returns (PriceInfo[] memory);

    /**
     * Returns the current price of a list of asset symbols.
     * Reverts if any of the symbols is not supported.
     * @param _symbols Array of symbols to query.
     * @return Array of `PriceInfo` structures.
     */
    function getCurrentPricesBySymbols(string[] memory _symbols) external view returns (PriceInfo[] memory);

    /**
     * Get all supported indices and corresponding FTSO addresses.
     * Active FTSOs are ones that currently receive price feeds.
     * @return _supportedIndices Array of all supported indices.
     * @return _ftsos Array of all supported FTSO addresses.
     */
    function getSupportedIndicesAndFtsos() external view
        returns(uint256[] memory _supportedIndices, IIFtso[] memory _ftsos);

    /**
     * Get all supported symbols and corresponding FTSO addresses.
     * Active FTSOs are ones that currently receive price feeds.
     * @return _supportedSymbols Array of all supported symbols.
     * @return _ftsos Array of all supported FTSO addresses.
     */
    function getSupportedSymbolsAndFtsos() external view
        returns(string[] memory _supportedSymbols, IIFtso[] memory _ftsos);

    /**
     * Get all supported indices and corresponding symbols.
     * Active FTSOs are ones that currently receive price feeds.
     * @return _supportedIndices Array of all supported indices.
     * @return _supportedSymbols Array of all supported symbols.
     */
    function getSupportedIndicesAndSymbols() external view
        returns(uint256[] memory _supportedIndices, string[] memory _supportedSymbols);

    /**
     * Get all supported indices, symbols, and corresponding FTSO addresses.
     * Active FTSOs are ones that currently receive price feeds.
     * @return _supportedIndices Array of all supported indices.
     * @return _supportedSymbols Array of all supported symbols.
     * @return _ftsos Array of all supported FTSO addresses.
     */
    function getSupportedIndicesSymbolsAndFtsos() external view
        returns(uint256[] memory _supportedIndices, string[] memory _supportedSymbols, IIFtso[] memory _ftsos);
}
