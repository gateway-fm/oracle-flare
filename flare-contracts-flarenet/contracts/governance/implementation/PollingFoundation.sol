// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import "./Governor.sol";
import "./Governed.sol";
import "./GovernorProposer.sol";
import "../interface/IIPollingFoundation.sol";


contract PollingFoundation is IIPollingFoundation, Governor, Governed, GovernorProposer {

    /**
     * @notice Initializes the contract with default parameters
     * @param _governance                   Address identifying the governance address
     * @param _priceSubmitter               Address identifying the price submitter contract
     * @param _addressUpdater               Address identifying the address updater contract
     * @param _proposers                    Array of addresses allowed to submit a proposal
     */
    constructor(
        address _governance,
        address _priceSubmitter,
        address _addressUpdater,
        address[] memory _proposers
    )
        Governed(_governance)
        Governor(
            _priceSubmitter,
            _addressUpdater
        )
        GovernorProposer(
            _proposers
        )
    {}

    /**
     * @notice Creates a new proposal without execution parameters
     * @param _description          String description of the proposal
     * @param _settings             Settings of the poposal
     * @return Proposal id (unique identifier obtained by hashing proposal data)
     * @notice Emits a ProposalCreated event
     */
    function propose(
        string memory _description,
        GovernorSettingsWithoutExecParams memory _settings
    ) external override returns (uint256) {
        GovernorSettings memory settings = GovernorSettings({
            accept: _settings.accept,
            votingDelaySeconds: _settings.votingDelaySeconds,
            votingPeriodSeconds: _settings.votingPeriodSeconds,
            vpBlockPeriodSeconds:_settings.vpBlockPeriodSeconds,
            thresholdConditionBIPS:_settings.thresholdConditionBIPS,
            majorityConditionBIPS:_settings.majorityConditionBIPS,
            executionDelaySeconds: 0,
            executionPeriodSeconds: 1 // should be > 0
        });
        return _propose(new address[](0), new uint256[](0), new bytes[](0), _description, settings);
    }    

    /**
     * @notice Creates a new proposal with execution parameters
     * @param _targets              Array of target addresses on which the calls are to be invoked
     * @param _values               Array of values with which the calls are to be invoked
     * @param _calldatas            Array of call data to be invoked
     * @param _description          String description of the proposal
     * @param _settings             Settings of the poposal
     * @return Proposal id (unique identifier obtained by hashing proposal data)
     * @notice Emits a ProposalCreated event
     */
    function propose(
        address[] memory _targets,
        uint256[] memory _values,
        bytes[] memory _calldatas,
        string memory _description,
        GovernorSettings memory _settings
    ) external override returns (uint256) {
        return _propose(_targets, _values, _calldatas, _description, _settings);
    }

    /**
     * @notice Returns the name of the governor contract
     * @return String representing the name
     */
    function name() public pure override returns (string memory) {
        return "PollingFoundation";
    }

    /**
     * @notice Returns the version of the governor contract
     * @return String representing the version
     */
    function version() public pure override returns (string memory) {
        return "1";
    }

    /**
     * @notice Determines if the submitter of a proposal is a valid proposer
     * @param _proposer             Address of the submitter
     * @param *_votePowerBlock*     Number representing the vote power block for which the validity is checked
     * @return True if the submitter is valid, and false otherwise
     */
    function _isValidProposer(address _proposer, uint256 /*_votePowerBlock*/) internal view override returns (bool) {
        return isProposer(_proposer);
    }
}
