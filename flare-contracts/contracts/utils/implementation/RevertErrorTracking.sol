// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;


/**
 * Revert error tracking contract.
 *
 * A contract to track and store revert errors.
 **/
contract RevertErrorTracking {

    /// A logged error.
    struct RevertedError {
        uint192 lastErrorBlock;
        uint64 numErrors;
        address fromContract;
        uint64 errorTypeIndex;
        string errorMessage;
    }

    /// Current error state.
    struct LastErrorData {
        uint192 totalRevertedErrors;
        uint64 lastErrorTypeIndex;
    }

    string internal constant INDEX_TOO_HIGH = "start index high";

    mapping(bytes32 => RevertedError) internal revertedErrors;
    bytes32 [] internal revertErrorHashes;
    /// Most recent error information.
    LastErrorData public errorData;

    /**
     * Emitted when a contract reverts.
     * @param theContract The culprit's address.
     * @param atBlock Block number where the error happened.
     * @param theMessage Reason for the revert, as reported by the contract.
     */
    event ContractRevertError(address theContract, uint256 atBlock, string theMessage);

    /**
     * Returns latest error information. All arrays will contain only one entry.
     * @return _lastErrorBlock Array of block numbers where the errors occurred.
     * @return _numErrors Array of number of times same error with same contract address has been reverted.
     * @return _errorString Array of revert error messages.
     * @return _erroringContract Array of addresses of the reverting contracts.
     * @return _totalRevertedErrors Total number of revert errors across all contracts.
     */
    function showLastRevertedError () external view
        returns(
            uint256[] memory _lastErrorBlock,
            uint256[] memory _numErrors,
            string[] memory _errorString,
            address[] memory _erroringContract,
            uint256 _totalRevertedErrors
        )
    {
        return showRevertedErrors(errorData.lastErrorTypeIndex, 1);
    }

    /**
     * @notice Adds caught error to reverted errors mapping
     * @param revertedContract         Address of the reverting contract
     * @param message                  Reverte message
     */
    function addRevertError(address revertedContract, string memory message) internal {
        bytes32 errorStringHash = keccak256(abi.encode(revertedContract, message));

        revertedErrors[errorStringHash].numErrors += 1;
        revertedErrors[errorStringHash].lastErrorBlock = uint192(block.number);
        emit ContractRevertError(revertedContract, block.number, message);
        errorData.totalRevertedErrors += 1;

        if (revertedErrors[errorStringHash].numErrors > 1) {
            // not first time this errors
            return;
        }

        // first time we recieve this error string.
        revertErrorHashes.push(errorStringHash);
        revertedErrors[errorStringHash].fromContract = revertedContract;
        revertedErrors[errorStringHash].errorMessage = message;
        revertedErrors[errorStringHash].errorTypeIndex = uint64(revertErrorHashes.length - 1);

        errorData.lastErrorTypeIndex = revertedErrors[errorStringHash].errorTypeIndex;
    }

    /**
     * Returns latest errors.
     * @param startIndex Starting index in the error list array.
     * @param numErrorTypesToShow Number of errors to show. The total amount can be found in `errorData`.
     * @return _lastErrorBlock Array of block numbers where the errors occurred.
     * @return _numErrors Array of number of times same error with same contract address has been reverted.
     * @return _errorString Array of revert error messages.
     * @return _erroringContract Array of addresses of the reverting contracts.
     * @return _totalRevertedErrors Total number of revert errors across all contracts.
     */
    function showRevertedErrors (uint startIndex, uint numErrorTypesToShow) public view
        returns(
            uint256[] memory _lastErrorBlock,
            uint256[] memory _numErrors,
            string[] memory _errorString,
            address[] memory _erroringContract,
            uint256 _totalRevertedErrors
        )
    {
        require(startIndex < revertErrorHashes.length, INDEX_TOO_HIGH);
        uint256 numReportElements =
            revertErrorHashes.length >= startIndex + numErrorTypesToShow ?
            numErrorTypesToShow :
            revertErrorHashes.length - startIndex;

        _lastErrorBlock = new uint256[] (numReportElements);
        _numErrors = new uint256[] (numReportElements);
        _errorString = new string[] (numReportElements);
        _erroringContract = new address[] (numReportElements);

        // we have error data error type.
        // error type is hash(error_string, source contract)
        // per error type we report how many times it happened.
        // what was last block it happened.
        // what is the error string.
        // what is the erroring contract
        for (uint i = 0; i < numReportElements; i++) {
            bytes32 hash = revertErrorHashes[startIndex + i];

            _lastErrorBlock[i] = revertedErrors[hash].lastErrorBlock;
            _numErrors[i] = revertedErrors[hash].numErrors;
            _errorString[i] = revertedErrors[hash].errorMessage;
            _erroringContract[i] = revertedErrors[hash].fromContract;
        }
        _totalRevertedErrors = errorData.totalRevertedErrors;
    }
}
