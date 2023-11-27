// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;


import "../interface/IIFtsoRegistry.sol";
import "../../addressUpdater/implementation/AddressUpdatable.sol";
import "../../ftso/interface/IIFtsoManager.sol";
import "../../governance/implementation/GovernedBase.sol";

/**
 * @title A contract for FTSO registry
 */
contract FtsoRegistry is IIFtsoRegistry, AddressUpdatable, GovernedBase { 

    // constants
    uint256 internal constant MAX_HISTORY_LENGTH = 5;
    address internal constant DEAD_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    // errors
    string internal constant ERR_TOKEN_NOT_SUPPORTED = "FTSO index not supported";
    string internal constant ERR_FTSO_MANAGER_ONLY = "FTSO manager only";

    // storage 
    IIFtso[MAX_HISTORY_LENGTH][] internal ftsoHistory;
    mapping(string => uint256) internal ftsoIndex;

    // addresses
    IIFtsoManager public ftsoManager;

    modifier onlyFtsoManager () {
        require (msg.sender == address(ftsoManager), ERR_FTSO_MANAGER_ONLY);
        _;
    }

    // Using a governed proxy pattern - no constructor will run. Using initialiseRegistry function instead.
    constructor() GovernedBase(DEAD_ADDRESS) AddressUpdatable(address(0)) {
        /* empty block */
    }

    function initialiseRegistry(address _addressUpdater) external onlyGovernance {
        require(getAddressUpdater() == address(0), "already initialized");
        require(_addressUpdater != address(0), "_addressUpdater zero");
        setAddressUpdaterValue(_addressUpdater);
    }

    /**
     * @notice Update current active FTSO contracts mapping
     * @param _ftsoContract new target FTSO contract
     */
    function addFtso(IIFtso _ftsoContract) external override onlyFtsoManager returns(uint256 _assetIndex) {
        string memory symbol = _ftsoContract.symbol();
        _assetIndex = ftsoIndex[symbol];
        // ftso with the symbol is not yet in history array, add it
        if (_assetIndex == 0) {
            _assetIndex = ftsoHistory.length;
            ftsoIndex[symbol] = _assetIndex + 1;
            ftsoHistory.push();
        } else {
            // Shift history
            _assetIndex = _assetIndex - 1;
            _shiftHistory(_assetIndex);
        }
        ftsoHistory[_assetIndex][0] = _ftsoContract;
    }

    /**
     * Removes the ftso at specified index and keeps part of the history
     * @dev Reverts if the provided index is unsupported
     * @param _ftso ftso to remove
     */
    function removeFtso(IIFtso _ftso) external override onlyFtsoManager {
        string memory symbol = _ftso.symbol();
        uint256 assetIndex = ftsoIndex[symbol];
        if (assetIndex > 0) {
            assetIndex = assetIndex - 1;
            _shiftHistory(assetIndex);
            ftsoHistory[assetIndex][0] = IIFtso(address(0));
            delete ftsoIndex[symbol];
            return;
        }

        revert(ERR_TOKEN_NOT_SUPPORTED);
    }

    /**
     * @dev Reverts if unsupported index is passed
     * @return _activeFtso FTSO contract for provided index
     */
    function getFtso(uint256 _assetIndex) external view override returns(IIFtso _activeFtso) {
        return _getFtso(_assetIndex);
    }

    /**
     * @dev Reverts if unsupported symbol is passed
     * @return _activeFtso FTSO contract for provided symbol
     */
    function getFtsoBySymbol(string memory _symbol) external view override returns(IIFtso _activeFtso) {
        return _getFtsoBySymbol(_symbol);
    }

    /**
     * @notice Public view function to get the price of active FTSO for given asset index
     * @param _assetIndex asset index
     * @dev Reverts if unsupported index is passed
     * @return _price current price of asset in USD
     * @return _timestamp timestamp for when this price was updated
     */
    function getCurrentPrice(uint256 _assetIndex) external view override 
        returns(uint256 _price, uint256 _timestamp) 
    {
        return _getFtso(_assetIndex).getCurrentPrice();
    }

    /**
     * @notice Public view function to get the price of active FTSO for given asset symbol
     * @param _symbol asset symbol
     * @dev Reverts if unsupported symbol is passed
     * @return _price current price of asset in USD
     * @return _timestamp timestamp for when this price was updated
     */
    function getCurrentPrice(string memory _symbol) external view override 
        returns(uint256 _price, uint256 _timestamp) 
    {
        return _getFtsoBySymbol(_symbol).getCurrentPrice();
    }

    /**
     * @notice Public view function to get the price of active FTSO for given asset index
     * @param _assetIndex asset index
     * @dev Reverts if unsupported index is passed
     * @return _price current price of asset in USD
     * @return _timestamp timestamp for when this price was updated
     * @return _assetPriceUsdDecimals number of decimals used for USD price
     */
    function getCurrentPriceWithDecimals(uint256 _assetIndex) external view override
        returns(uint256 _price, uint256 _timestamp, uint256 _assetPriceUsdDecimals)
    {
        return _getFtso(_assetIndex).getCurrentPriceWithDecimals();
    }

    /**
     * @notice Public view function to get the price of active FTSO for given asset symbol
     * @param _symbol asset symbol
     * @dev Reverts if unsupported symbol is passed
     * @return _price current price of asset in USD
     * @return _timestamp timestamp for when this price was updated
     * @return _assetPriceUsdDecimals number of decimals used for USD price
     */
    function getCurrentPriceWithDecimals(string memory _symbol) external view override
        returns(uint256 _price, uint256 _timestamp, uint256 _assetPriceUsdDecimals)
    {
        return _getFtsoBySymbol(_symbol).getCurrentPriceWithDecimals();
    }

    /**
     * @return _supportedIndices the array of all active FTSO indices in increasing order. 
     * Active FTSOs are ones that currently receive price feeds.
     */
    function getSupportedIndices() external view override returns(uint256[] memory _supportedIndices) {
        (_supportedIndices, ) = _getSupportedIndicesAndFtsos();
    }

    /**
     * @return _supportedSymbols the array of all active FTSO symbols in increasing order. 
     * Active FTSOs are ones that currently receive price feeds.
     */
    function getSupportedSymbols() external view override returns(string[] memory _supportedSymbols) {
        (, IIFtso[] memory ftsos) = _getSupportedIndicesAndFtsos();
        uint256 len = ftsos.length;
        _supportedSymbols = new string[](len);
        while (len > 0) {
            --len;
            _supportedSymbols[len] = ftsos[len].symbol();
        }
    }

    /**
     * @notice Get array of all supported indices and corresponding FTSOs
     * @return _supportedIndices the array of all supported indices
     * @return _ftsos the array of all supported ftsos
     */
    function getSupportedIndicesAndFtsos() external view override
        returns(uint256[] memory _supportedIndices, IIFtso[] memory _ftsos)
    {
        (_supportedIndices, _ftsos) = _getSupportedIndicesAndFtsos();
    }

    /**
     * @notice Get array of all supported symbols and corresponding FTSOs
     * @return _supportedSymbols the array of all supported symbols
     * @return _ftsos the array of all supported ftsos
     */
    function getSupportedSymbolsAndFtsos() external view override
        returns(string[] memory _supportedSymbols, IIFtso[] memory _ftsos)
    {
        (, _ftsos) = _getSupportedIndicesAndFtsos();
        uint256 len = _ftsos.length;
        _supportedSymbols = new string[](len);
        while (len > 0) {
            --len;
            _supportedSymbols[len] = _ftsos[len].symbol();
        }
    }

    /**
     * @notice Get array of all supported indices and corresponding symbols
     * @return _supportedIndices the array of all supported indices
     * @return _supportedSymbols the array of all supported symbols
     */
    function getSupportedIndicesAndSymbols() external view override
        returns(uint256[] memory _supportedIndices, string[] memory _supportedSymbols) 
    {
        IIFtso[] memory ftsos;
        (_supportedIndices, ftsos) = _getSupportedIndicesAndFtsos();
        uint256 len = _supportedIndices.length;
        _supportedSymbols = new string[](len);
        while (len > 0) {
            --len;
            _supportedSymbols[len] = ftsos[len].symbol();
        }
    }

    /**
     * @notice Get array of all supported indices, corresponding symbols and FTSOs
     * @return _supportedIndices the array of all supported indices
     * @return _supportedSymbols the array of all supported symbols
     * @return _ftsos the array of all supported ftsos
     */
    function getSupportedIndicesSymbolsAndFtsos() external view override
        returns(uint256[] memory _supportedIndices, string[] memory _supportedSymbols, IIFtso[] memory _ftsos)
    {
        (_supportedIndices, _ftsos) = _getSupportedIndicesAndFtsos();
        uint256 len = _supportedIndices.length;
        _supportedSymbols = new string[](len);
        while (len > 0) {
            --len;
            _supportedSymbols[len] = _ftsos[len].symbol();
        }
    }

    /**
     * @notice Get array of all FTSO contracts for all supported asset indices. 
     * The index of FTSO in returned array does not necessarily correspond to _assetIndex
     * Due to deletion, some indices might be unsupported. 
     * @dev See `getSupportedIndicesAndFtsos` for pair of correct indices and `getAllFtsos` 
     * for FTSOs at valid indices but with possible "null" holes.
     * @return _ftsos the array of all supported FTSOs
     */
    function getSupportedFtsos() external view override returns(IIFtso[] memory _ftsos) {
        (, _ftsos) = _getSupportedIndicesAndFtsos();
    }

    /**
     * @notice Get the active FTSOs for given indices
     * @return _ftsos the array of FTSOs
     */
    function getFtsos(uint256[] memory _assetIndices) external view override returns(IFtsoGenesis[] memory _ftsos) {
        uint256 ftsoLength = ftsoHistory.length;
        uint256 len = _assetIndices.length;
        _ftsos = new IFtsoGenesis[](len);
        while (len > 0) {
            --len;
            uint256 assetIndex = _assetIndices[len];
            require(assetIndex < ftsoLength, ERR_TOKEN_NOT_SUPPORTED);
            _ftsos[len] = ftsoHistory[assetIndex][0];
            if (address(_ftsos[len]) == address(0)) {
                // Invalid index, revert if address is zero address
                revert(ERR_TOKEN_NOT_SUPPORTED);
            }
        }
    }

    /**
     * @notice Get array of all FTSO contracts for all supported asset indices
     * @return _ftsos the array of all FTSOs
     * @dev Return value might contain uninitialized FTSOS at zero address. 
     */
    function getAllFtsos() external view returns(IIFtso[] memory _ftsos) {
        uint256 len = ftsoHistory.length;
        IIFtso[] memory ftsos = new IIFtso[](len);
        while (len > 0) {
            --len;
            ftsos[len] = ftsoHistory[len][0];
        }
        return ftsos;
    }

    /**
     * @notice Get the history of FTSOs for given index
     * @dev If there are less then MAX_HISTORY_LENGTH the remaining addresses will be 0 addresses
     * @param _assetIndex asset index
     * @return _ftsoAddressHistory the history of FTSOs contract for provided index
     */
    function getFtsoHistory(uint256 _assetIndex) external view 
        returns(IIFtso[MAX_HISTORY_LENGTH] memory _ftsoAddressHistory) 
    {
        require(_assetIndex < ftsoHistory.length && 
                address(ftsoHistory[_assetIndex][0]) != address(0), ERR_TOKEN_NOT_SUPPORTED);
        return ftsoHistory[_assetIndex];
    }

    function getFtsoIndex(string memory _symbol) external view override returns (uint256 _assetIndex) {
        return _getFtsoIndex(_symbol);
    }

    function getFtsoSymbol(uint256 _assetIndex) external view override returns (string memory _symbol) {
        return _getFtso(_assetIndex).symbol();
    }

    function getAllCurrentPrices() external view override returns (PriceInfo[] memory) {
        (uint256[] memory indices, IIFtso[] memory ftsos) = _getSupportedIndicesAndFtsos();
        return _getCurrentPrices(indices, ftsos);
    }

    function getCurrentPricesByIndices(uint256[] memory _indices) external view override returns (PriceInfo[] memory) {
        IIFtso[] memory ftsos = new IIFtso[](_indices.length);
        
        for (uint256 i = 0; i < _indices.length; i++) {
            ftsos[i] = _getFtso(_indices[i]);
        }
        return _getCurrentPrices(_indices, ftsos);
    }

    function getCurrentPricesBySymbols(string[] memory _symbols) external view override returns (PriceInfo[] memory) {
        uint256[] memory indices = new uint256[](_symbols.length);
        IIFtso[] memory ftsos = new IIFtso[](_symbols.length);

        for (uint256 i = 0; i < _symbols.length; i++) {
            indices[i] = _getFtsoIndex(_symbols[i]);
            ftsos[i] = ftsoHistory[indices[i]][0];
        }
        return _getCurrentPrices(indices, ftsos);
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
        ftsoManager = IIFtsoManager(_getContractAddress(_contractNameHashes, _contractAddresses, "FtsoManager"));
    }

    /**
     * @notice Shift the FTSOs history by one so the FTSO at index 0 can be overwritten
     * @dev Internal helper function
     */
    function _shiftHistory(uint256 _assetIndex) internal {
        for (uint256 i = MAX_HISTORY_LENGTH-1; i > 0; i--) {
            ftsoHistory[_assetIndex][i] = ftsoHistory[_assetIndex][i-1];
        }
    }

    function _getCurrentPrices(
        uint256[] memory indices,
        IIFtso[] memory ftsos
    ) 
        internal view 
        returns (PriceInfo[] memory _result)
    {
        uint256 length = ftsos.length;
        _result = new PriceInfo[](length);

        for(uint256 i = 0; i < length; i++) {
            _result[i].ftsoIndex = indices[i];
            (_result[i].price, _result[i].timestamp, _result[i].decimals) = ftsos[i].getCurrentPriceWithDecimals();
        }
    }

    function _getFtsoIndex(string memory _symbol) internal view returns (uint256) {
        uint256 assetIndex = ftsoIndex[_symbol];
        require(assetIndex > 0, ERR_TOKEN_NOT_SUPPORTED);
        return assetIndex - 1;
    }

    /**
     * @notice Get the active FTSO for given index
     * @dev Internal get ftso function so it can be used within other methods
     */
    function _getFtso(uint256 _assetIndex) internal view returns(IIFtso _activeFtso) {
        require(_assetIndex < ftsoHistory.length, ERR_TOKEN_NOT_SUPPORTED);

        IIFtso ftso = ftsoHistory[_assetIndex][0];
        if (address(ftso) == address(0)) {
            // Invalid index, revert if address is zero address
            revert(ERR_TOKEN_NOT_SUPPORTED);
        }
        _activeFtso = ftso;
    }

    /**
     * @notice Get the active FTSO for given symbol
     * @dev Internal get ftso function so it can be used within other methods
     */
    function _getFtsoBySymbol(string memory _symbol) internal view returns(IIFtso _activeFtso) {
        uint256 assetIndex = _getFtsoIndex(_symbol);
        _activeFtso = ftsoHistory[assetIndex][0];
    }

    function _getSupportedIndicesAndFtsos() internal view 
        returns(uint256[] memory _supportedIndices, IIFtso[] memory _ftsos) 
    {
        uint256 len = ftsoHistory.length;
        uint256[] memory supportedIndices = new uint256[](len);
        IIFtso[] memory ftsos = new IIFtso[](len);
        address zeroAddress = address(0);
        uint256 taken = 0;
        for (uint256 i = 0; i < len; ++i) {
            IIFtso ftso = ftsoHistory[i][0];
            if (address(ftso) != zeroAddress) {
                supportedIndices[taken] = i;
                ftsos[taken] = ftso;
                ++taken;
            }
        }
        _supportedIndices = new uint256[](taken);
        _ftsos = new IIFtso[](taken);
        while (taken > 0) {
            --taken;
            _supportedIndices[taken] = supportedIndices[taken];
            _ftsos[taken] = ftsos[taken];
        }
    }
}
