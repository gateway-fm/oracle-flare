// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import "./priceProviderMockFtso.sol";
import "../../userInterfaces/IPriceSubmitter.sol";
import "../../userInterfaces/IFtsoRegistry.sol";
import "../../userInterfaces/IVoterWhitelister.sol";
import "../../governance/implementation/Governed.sol";
import "../../addressUpdater/implementation/AddressUpdatable.sol";

/*
 * This file and ./priceProviderMockFtso.sol contains core contracts needed for Flare price providers.
 * All the mock contracts implement the same user interfaces that will be available to price providers in 
 * real network. Governance and administrative methods are mocked, but user facing methods work in a similar 
 * fashion.
 * 
 * PriceProvider works in the same way. It provides access to VoterWhitelister for whitelisting and FtsoRegistry
 * to get asset indices. Both submit and reveal prices are available and work in the same way as real ones. 
 * 
 * FtsoRegistry provides information about ftsos and corresponding assets. 
 * It works in the same way as in the real network.
 *
 * VoterWhitelister works similarly as in real network with few changes:
 *  - At most one voter can be whitelisted at time.
 *  - No vote power calculation is done during whitelisting, previously whitelisted user is always kicked out.
 * 
 * MockFtso implements only a minimal subset of methods required for submission and reveal. 
 * Notably, no median calculation, vote power calculation or rewarding is done.

*/


/**
 * @title A contract for FTSO registry
 */
contract MockFtsoRegistry is Governed, IFtsoRegistry{


    // constants
    uint256 internal constant MAX_HISTORY_LENGTH = 5;

    // errors
    string internal constant ERR_TOKEN_NOT_SUPPORTED = "FTSO index not supported";
    string internal constant ERR_FTSO_MANAGER_ONLY = "FTSO manager only";

    // storage 
    IIFtso[MAX_HISTORY_LENGTH][] internal ftsoHistory;
    mapping(string => uint256) internal ftsoIndex;

    constructor(address _governance) Governed(_governance) {
        /* empty block */
    }

    /**
     * @notice Update current active FTSO contracts mapping
     * @param _ftsoContract new target FTSO contract
     */
    function addFtso(IIFtso _ftsoContract) external onlyGovernance returns(uint256 _assetIndex) {
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
    function removeFtso(IIFtso _ftso) external onlyGovernance {
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


contract MockVoterWhitelister is IVoterWhitelister {

    uint256 public override defaultMaxVotersForFtso = 1;
    mapping (uint256 => uint256) public override maxVotersForFtso;
    
    /**
     * In case of providing bad prices (e.g. collusion), the voter can be chilled for a few reward epochs.
     * A voter can whitelist again from a returned reward epoch onwards.
     */
    mapping (address => uint256) public override chilledUntilRewardEpoch;

    // mapping: ftsoIndex => array of whitelisted voters for this ftso
    mapping (uint256 => address) internal whitelist;
    
    MockPriceSubmitter internal priceSubmitter;
    
    IFtsoRegistry internal ftsoRegistry;
    
    modifier onlyPriceSubmitter {
        require(msg.sender == address(priceSubmitter), "only price submitter");
        _;
    }
    
    constructor(MockPriceSubmitter _priceSubmitter) {
        priceSubmitter = _priceSubmitter;
    }
    
    /**
     * Request to whitelist `_voter` account to all active ftsos.
     * May be called by any address.
     * It returns an array of supported ftso indices and success flag per index.
     */
    function requestFullVoterWhitelisting(
        address _voter
    ) 
        external override 
        returns (
            uint256[] memory _supportedIndices,
            bool[] memory _success
        )
    {
        if (_isTrustedAddress(_voter)) {
            revert("trusted address");
        }

        _supportedIndices = ftsoRegistry.getSupportedIndices();
        uint256 len = _supportedIndices.length;
        _success = new bool[](len);
        for (uint256 i = 0; i < len; i++) {
            _success[i] = _requestWhitelistingVoter(_voter, _supportedIndices[i]);
        }
    }

    /**
     * Request to whitelist `_voter` account to ftso at `_ftsoIndex`. Will revert if vote power too low.
     * May be called by any address.
     */
    function requestWhitelistingVoter(address _voter, uint256 _ftsoIndex) external override {
        if (_isTrustedAddress(_voter)) {
            revert("trusted address");
        }

        bool success = _requestWhitelistingVoter(_voter, _ftsoIndex);
        require(success, "vote power too low");
    }
    
    /**
     * Request to whitelist `_voter` account to ftso at `_ftsoIndex` - mock implementation.
     */
    function _requestWhitelistingVoter(address _voter, uint256 _ftsoIndex) internal returns(bool) {
        uint256 maxVoters = maxVotersForFtso[_ftsoIndex];
        require(maxVoters > 0, "FTSO index not supported");

        address addr = whitelist[_ftsoIndex];
        if (addr == _voter) {
            // _voter is already whitelisted, return
            return true;
        }

        whitelist[_ftsoIndex] = _voter;

        address[] memory removedVoters = new address[](1);
        removedVoters[0] = addr;
        _votersRemovedFromWhitelist(removedVoters, _ftsoIndex);
        _voterWhitelisted(_voter, _ftsoIndex);
        return true;
    }

    /**
     * Update a voter whitelisting and emit an event.
     */    
    function _voterWhitelisted(address _voter, uint256 _ftsoIndex) private {
        emit VoterWhitelisted(_voter, _ftsoIndex);
        priceSubmitter.voterWhitelisted(_voter, _ftsoIndex);
    }
    
    /**
     * Update when a  voter is removed from the whitelist. And emit an event.
     */    
    function _votersRemovedFromWhitelist(address[] memory _removedVoters, uint256 _ftsoIndex) private {
        for (uint256 i = 0; i < _removedVoters.length; i++) {
            emit VoterRemovedFromWhitelist(_removedVoters[i], _ftsoIndex);
        }
        priceSubmitter.votersRemovedFromWhitelist(_removedVoters, _ftsoIndex);
    }

    /**
     * Get whitelisted price providers for ftso with `_symbol`
     */
    function getFtsoWhitelistedPriceProvidersBySymbol(
        string memory _symbol
    ) 
        external view override 
        returns (
            address[] memory
    ) 
    {
        uint256 ftsoIndex = ftsoRegistry.getFtsoIndex(_symbol);
        return getFtsoWhitelistedPriceProviders(ftsoIndex);
    }

    /**
     * Get whitelisted price providers for ftso at `_ftsoIndex`
     */
    function getFtsoWhitelistedPriceProviders(uint256 _ftsoIndex) public view override returns (address[] memory) {
        uint256 maxVoters = maxVotersForFtso[_ftsoIndex];
        require(maxVoters > 0, "FTSO index not supported");
        address addr = whitelist[_ftsoIndex];
        if (addr == address(0)) {
            return new address[](0);
        } else {
            address[] memory result = new address[](1);
            result[0] = addr;
            return result;
        }
    }

    /**
     * Changes ftsoRegistry address.
     */
    function setFtsoRegistry(IFtsoRegistry _ftsoRegistry) external onlyPriceSubmitter {
        ftsoRegistry = _ftsoRegistry;
    }
    
    function addFtso(uint256 _ftsoIndex) external onlyPriceSubmitter {
        require(maxVotersForFtso[_ftsoIndex] == 0, "whitelist already exist");
        maxVotersForFtso[_ftsoIndex] = defaultMaxVotersForFtso;
    }

    /**
     * Checks if _voter is trusted address
     */
    function _isTrustedAddress(address /*_voter*/) internal pure returns(bool) {
        // Unused in mock contract
        return false;
    }
}


/**
 * @title Price submitter
 * @notice A contract used to submit/reveal prices to multiple Flare Time Series Oracles in one transaction
 */
contract MockPriceSubmitter is IPriceSubmitter, AddressUpdatable {

    string internal constant ERR_ALREADY_SET = "Already set";
    string internal constant ERR_ARRAY_LENGTHS = "Array lengths do not match";
    string internal constant ERR_NOT_WHITELISTED = "Not whitelisted";
    string internal constant ERR_INVALID_INDEX = "Invalid index";
    string internal constant ERR_WHITELISTER_ONLY = "Voter whitelister only";
    string internal constant ERR_WRONG_EPOCH_ID = "Wrong epoch id";
    string internal constant ERR_DUPLICATE_SUBMIT_IN_EPOCH = "Duplicate submit in epoch";
    string internal constant ERR_PRICE_INVALID = "Price already revealed or not valid";
    string internal constant ERR_RANDOM_TOO_SMALL = "Too small random number";
    string internal constant ERR_FTSO_INDICES_NOT_INCREASING = "FTSO indices not increasing";

    uint256 public constant MINIMAL_RANDOM = 2**128;    // minimal random value for price submission
    uint256 public constant RANDOM_EPOCH_CYCLIC_BUFFER_SIZE = 100;

    MockFtsoRegistry internal ftsoRegistry; 
    
    address internal voterWhitelister;

    // Bit at index `i` corresponds to being whitelisted for vote on ftso at index `i`
    mapping(address => uint256) private whitelistedFtsoBitmap;
    mapping(uint256 => mapping(address => bytes32)) internal epochVoterHash;

    uint256[RANDOM_EPOCH_CYCLIC_BUFFER_SIZE] internal randoms;

    modifier onlyWhitelister {
        require(msg.sender == address(voterWhitelister), ERR_WHITELISTER_ONLY);
        _;
    }

    /**
     * Deploy all needed contracts for testing
     */
    constructor(address _addressUpdater) AddressUpdatable(_addressUpdater) {

        ftsoRegistry = new MockFtsoRegistry(address(this));
        voterWhitelister = address(new MockVoterWhitelister(this));
        MockVoterWhitelister(voterWhitelister).setFtsoRegistry(ftsoRegistry);
        // Initialize all mock ftsos for pacakge
        string[10] memory symbols = ["SGB", "XRP", "LTC", "XLM", "XDG", "ADA", "ALGO", "BCH", "DGB", "BTC"];
        for (uint256 i = 0; i < symbols.length; ++i) {
            string memory symbol = symbols[i];
            MockNpmFtso ftso = new MockNpmFtso(symbol, this, block.timestamp - 120, 120, 30);
            ftsoRegistry.addFtso(ftso);
            uint256 ftsoIndex = ftsoRegistry.getFtsoIndex(symbol);
            MockVoterWhitelister(voterWhitelister).addFtso(ftsoIndex);
        }
    }
    
    /**
     * @notice Sets the address udpater contract.
     * @param _addressUpdater   The address updater contract.
     */
    function setAddressUpdater(address _addressUpdater) external {
        require(getAddressUpdater() == address(0), ERR_ALREADY_SET);
        setAddressUpdaterValue(_addressUpdater);
    }

    /**
     * Called from whitelister when new voter has been whitelisted.
     */
    function voterWhitelisted(address _voter, uint256 _ftsoIndex) external onlyWhitelister {
        whitelistedFtsoBitmap[_voter] |= 1 << _ftsoIndex;
    }
    
    /**
     * Called from whitelister when one or more voters have been removed.
     */
    function votersRemovedFromWhitelist(address[] memory _removedVoters, uint256 _ftsoIndex) 
        external 
        onlyWhitelister
    {
        for (uint256 i = 0; i < _removedVoters.length; i++) {
            whitelistedFtsoBitmap[_removedVoters[i]]  &= ~(1 << _ftsoIndex);
        }
    }
    
    /**
     * @notice Submits hash for current epoch
     * @param _epochId              Target epoch id to which hash is submitted
     * @param _hash                 Hash of ftso indices, prices, random number and voter address
     * @notice Emits HashSubmitted event
     */
    function submitHash(
        uint256 _epochId, 
        bytes32 _hash
    )
        external override
    {
        IIFtso ftso = ftsoRegistry.getFtso(0); // use first ftso instead of ftso manager as not used in mock
        require(_epochId == ftso.getCurrentEpochId(), ERR_WRONG_EPOCH_ID);
        require(epochVoterHash[_epochId][msg.sender] == 0, ERR_DUPLICATE_SUBMIT_IN_EPOCH);
        require(whitelistedFtsoBitmap[msg.sender] != 0, ERR_NOT_WHITELISTED);
        
        epochVoterHash[_epochId][msg.sender] = _hash;
        emit HashSubmitted(msg.sender, _epochId, _hash, block.timestamp);
    }

    /**
     * @notice Reveals submitted prices during epoch reveal period
     * @param _epochId              Id of the epoch in which the price hashes was submitted
     * @param _ftsoIndices          List of increasing ftso indices
     * @param _prices               List of submitted prices in USD
     * @param _random               Submitted random number
     * @notice The hash of ftso indices, prices, random number and voter address must be equal to the submitted hash
     * @notice Emits PricesRevealed event
     */
    function revealPrices(
        uint256 _epochId,
        uint256[] memory _ftsoIndices,
        uint256[] memory _prices,
        uint256 _random
    )
        external override
    {
        uint256 length  = _ftsoIndices.length;
        require(length == _prices.length, ERR_ARRAY_LENGTHS);
        require(_random >= MINIMAL_RANDOM, ERR_RANDOM_TOO_SMALL);
        require(epochVoterHash[_epochId][msg.sender] == 
            keccak256(abi.encode(_ftsoIndices, _prices, _random, msg.sender)), 
            ERR_PRICE_INVALID);

        IFtsoGenesis[] memory ftsos = ftsoRegistry.getFtsos(_ftsoIndices);
        uint256 allowedBitmask = whitelistedFtsoBitmap[msg.sender];

        // read native VP only once
        uint256 wNatVP = length > 0 ? ftsos[0].wNatVotePowerCached(msg.sender, _epochId) : 0;
        uint256 currentIndex;

        for (uint256 i = 0; i < length; i++) {
            if (i != 0 && currentIndex >= _ftsoIndices[i]) {
                revert(ERR_FTSO_INDICES_NOT_INCREASING);
            }
            currentIndex = _ftsoIndices[i];
            if (allowedBitmask & (1 << currentIndex) == 0) {
                revert(ERR_NOT_WHITELISTED);
            }
            // call reveal price on ftso
            ftsos[i].revealPriceSubmitter(msg.sender, _epochId, _prices[i], wNatVP);
        }
        // prevent price submission from being revealed twice
        delete epochVoterHash[_epochId][msg.sender];

        // random can overflow but still ok
        //slither-disable-next-line weak-prng // not used for random
        randoms[_epochId % RANDOM_EPOCH_CYCLIC_BUFFER_SIZE] += uint256(keccak256(abi.encode(_random, _prices)));

        emit PricesRevealed(msg.sender, _epochId, ftsos, _prices, _random, block.timestamp);
    }

    /**
     * @notice Returns current random number
     * @return Random number
     * @dev Should never revert
     */
    function getCurrentRandom() external view override returns (uint256) {
        IIFtso ftso = ftsoRegistry.getFtso(0); // use first ftso instead of ftso manager as not used in mock 
        uint256 currentEpochId = ftso.getCurrentEpochId();
        if (currentEpochId == 0) {
            return 0;
        }
        //slither-disable-next-line weak-prng // not used for random
        return randoms[(currentEpochId - 1) % RANDOM_EPOCH_CYCLIC_BUFFER_SIZE];
    }

    /**
     * @notice Returns random number of the specified epoch
     * @param _epochId Id of the epoch
     * @return Random number
     */
    function getRandom(uint256 _epochId) external view override returns (uint256) {
        //slither-disable-next-line weak-prng // not used for random
        return randoms[_epochId % RANDOM_EPOCH_CYCLIC_BUFFER_SIZE];
    }

    /**
     * Returns bitmap of all ftso's for which `_voter` is allowed to submit prices/hashes.
     * If voter is allowed to vote for ftso at index (see *_FTSO_INDEX), the corrsponding
     * bit in the result will be 1.
     */    
    function voterWhitelistBitmap(address _voter) external view override returns (uint256) {
        return whitelistedFtsoBitmap[_voter];
    }

    function getVoterWhitelister() public view override returns (address) {
        return address(voterWhitelister);
    }

    function getFtsoRegistry() public view override returns (IFtsoRegistryGenesis) {
        return ftsoRegistry;
    }

    function getFtsoManager() public pure override returns (IFtsoManagerGenesis) {
        revert("Not in dummy contract");
    }

    /**
     * @notice Implementation of the AddressUpdatable abstract method.
     * @dev If replacing the registry or the whitelist and the old one is not empty, make sure to replicate the state,
     * otherwise internal whitelist bitmaps won't match.
     */
    function _updateContractAddresses(
        bytes32[] memory _contractNameHashes,
        address[] memory _contractAddresses
    )
        internal override
    {
        ftsoRegistry = MockFtsoRegistry(
            _getContractAddress(_contractNameHashes, _contractAddresses, "FtsoRegistry"));
        voterWhitelister = _getContractAddress(_contractNameHashes, _contractAddresses, "VoterWhitelister");
    }

}
