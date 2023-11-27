// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;


import "../interface/IIFtsoRegistryV1.sol";
import "../../ftso/interface/IIFtso.sol";
import "../../ftso/interface/IIFtsoManager.sol";
import "../../governance/implementation/Governed.sol";

/**
 * @title A contract for FTSO registry
 */
contract FtsoRegistryV1Mock is Governed, IIFtsoRegistryV1 {

    // constants
    uint256 internal constant MAX_HISTORY_LENGTH = 5;

    // errors
    string internal constant ERR_TOKEN_NOT_SUPPORTED = "FTSO index not supported";
    string internal constant ERR_FTSO_MANAGER_ONLY = "FTSO manager only";

    // storage 
    IIFtso[MAX_HISTORY_LENGTH][] private ftsoHistory;

    // addresses
    // This address has to be set in deploy phase
    IIFtsoManager public ftsoManager;

    modifier onlyFtsoManager () {
        require (msg.sender == address(ftsoManager), ERR_FTSO_MANAGER_ONLY);
        _;
    }

    constructor(address _governance) Governed(_governance) { }

    function setFtsoManagerAddress(IIFtsoManager _ftsoManager) external override onlyGovernance {
        ftsoManager = _ftsoManager;
    }

    /**
     * @notice Update current active FTSO contracts mapping
     * @param _ftsoContract new target FTSO contract
     */
    function addFtso(IIFtso _ftsoContract) external override onlyFtsoManager returns(uint256 _ftsoIndex) {
        uint256 len = ftsoHistory.length;
        string memory _symbol = _ftsoContract.symbol();
        bytes32 _encodedSymbol = keccak256(abi.encode(_symbol));
        _ftsoIndex = 0;
        // Iterate over supported symbol array
        for ( ; _ftsoIndex < len; _ftsoIndex++) {
            // Deletion of symbols leaves an empty address "hole", so the address might be zero
            IIFtso current = ftsoHistory[_ftsoIndex][0];
            if (address(current) == address(0)) {
                continue;
            }
            if (_encodedSymbol == keccak256(abi.encode(current.symbol()))) {
                break;
            }
        }
        // ftso with the same symbol is not yet in history array, add it
        if (_ftsoIndex == len) {
            ftsoHistory.push();
        } else {
            // Shift history
            _shiftHistory(_ftsoIndex);
        }
        ftsoHistory[_ftsoIndex][0] = _ftsoContract;
    }

    /**
     * Removes the ftso at specified index and keeps part of the history
     * @dev Reverts if the provided index is unsupported
     * @param _ftso ftso to remove
     */
    function removeFtso(IIFtso _ftso) external override onlyFtsoManager {
        bytes32 _encodedSymbol = keccak256(abi.encode(_ftso.symbol()));
        uint256 len = ftsoHistory.length;
        for (uint256 i = 0; i < len; ++i) {
            IIFtso current = ftsoHistory[i][0];
            if (address(current) == address(0)) {
                continue;
            }
            // Removal behaves the same as setting null value as current
            if (_encodedSymbol == keccak256(abi.encode(current.symbol()))) {
                _shiftHistory(i);
                ftsoHistory[i][0] = IIFtso(address(0));
                return;
            }

        }

        revert(ERR_TOKEN_NOT_SUPPORTED);
    }

    /**
     * @dev Reverts if unsupported symbol is passed
     * @return _activeFtso FTSO contract for provided symbol
     */
    function getFtsoBySymbol(string memory _symbol) external view override returns(IIFtso _activeFtso) {
        return _getFtso(_getFtsoIndex(_symbol));
    }

    /**
     * @return _supportedSymbols the array of all active FTSO symbols in increasing order. 
     * Active FTSOs are ones that currently receive price feeds.
     */
    function getSupportedSymbols() external view override returns(string[] memory _supportedSymbols) {
        uint256[] memory _supportedIndices = _getSupportedIndices();
        uint256 len = _supportedIndices.length;
        _supportedSymbols = new string[](len);
        while (len > 0) {
            --len;
            IIFtso ftso = ftsoHistory[_supportedIndices[len]][0];
            _supportedSymbols[len] = ftso.symbol();
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
        uint256[] memory supportedIndices = _getSupportedIndices();
        uint256 len = supportedIndices.length;
        _ftsos = new IIFtso[](len);
        while (len > 0) {
            --len;
            _ftsos[len] = ftsoHistory[supportedIndices[len]][0];
        }
    }

    function getFtsoIndex(string memory _symbol) external view override returns (uint256 _assetIndex) {
        return _getFtsoIndex(_symbol);
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

    function _getFtsoIndex(string memory _symbol) private view returns (uint256 _assetIndex) {
        bytes32 _encodedSymbol = keccak256(abi.encode(_symbol));
        uint256 len = ftsoHistory.length;
        for (uint256 i = 0; i < len; ++i) {
            IIFtso current = ftsoHistory[i][0];
            if (address(current) == address(0)) {
                continue;
            }
            if (_encodedSymbol == keccak256(abi.encode(current.symbol()))) {
                return i;
            }
        }

        revert(ERR_TOKEN_NOT_SUPPORTED); 
    }

    /**
     * @notice Get the active FTSO for given index
     * @dev Internal get ftso function so it can be used within other methods
     */
    function _getFtso(uint256 _assetIndex) private view returns(IIFtso _activeFtso) {
        require(_assetIndex < ftsoHistory.length, ERR_TOKEN_NOT_SUPPORTED);

        IIFtso ftso = ftsoHistory[_assetIndex][0];
        if (address(ftso) == address(0)) {
            // Invalid index, revert if address is zero address
            revert(ERR_TOKEN_NOT_SUPPORTED);
        }
        _activeFtso = ftso;
    }

    function _getSupportedIndices() private view 
        returns(uint256[] memory _supportedIndices) 
    {
        uint256 len = ftsoHistory.length;
        uint256[] memory supportedIndices = new uint256[](len);
        address zeroAddress = address(0);
        uint256 taken = 0;
        for (uint256 i = 0; i < len; ++i) {
            if (address(ftsoHistory[i][0]) != zeroAddress) {
                supportedIndices[taken] = i;
                ++taken;
            }
        }
        _supportedIndices = new uint256[](taken);
        while (taken > 0) {
            --taken;
            _supportedIndices[taken] = supportedIndices[taken];
        }
        return _supportedIndices;
    }
}
