// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import "../../governance/implementation/Governed.sol";
import "../../utils/implementation/AddressSet.sol";
import "../../userInterfaces/IPChainStakeMirrorMultiSigVoting.sol";

/**
 * P-chain stake mirror multisig voting
 * A contract used for voting on P-chain stake mirror Merkle roots.
 */
contract PChainStakeMirrorMultiSigVoting is IPChainStakeMirrorMultiSigVoting, Governed {
    using AddressSet for AddressSet.State;

    mapping(uint256 => bytes32) internal pChainMerkleRoots;
    mapping(uint256 => PChainVotes[]) internal epochVotes;
    AddressSet.State internal voters;
    uint256 internal votingThreshold;

    // immutable settings
    uint256 internal immutable firstEpochStartTs;    // start timestamp of the first epoch instance
    uint256 internal immutable epochDurationSeconds; // duration of an epoch instance

    /// This method can only be called by voters.
    modifier onlyVoters {
        require(voters.index[msg.sender] != 0, "only voters");
        _;
    }

    /**
     * Initializes the contract with default parameters
     * @param _governance Address identifying the governance address
     * @param _firstEpochStartTs First epoch start timestamp
     * @param _epochDurationSeconds Epoch duration in seconds
     * @param _votingThreshold Voting threshold.
     * @param _voters Array of all voters.
     */
    constructor(
        address _governance,
        uint256 _firstEpochStartTs,
        uint256 _epochDurationSeconds,
        uint256 _votingThreshold,
        address[] memory _voters
    )
        Governed(_governance)
    {
        require(_firstEpochStartTs <= block.timestamp, "first epoch start in the future");
        require(_epochDurationSeconds > 0, "epoch duration too short");
        require(_votingThreshold > 1, "voting threshold too low");
        firstEpochStartTs = _firstEpochStartTs;
        epochDurationSeconds = _epochDurationSeconds;
        votingThreshold = _votingThreshold;
        voters.addAll(_voters);
        emit PChainStakeMirrorVotingThresholdSet(_votingThreshold);
        emit PChainStakeMirrorVotersSet(_voters);
    }

    /**
     * @inheritdoc IPChainStakeMirrorMultiSigVoting
     */
    function submitVote(uint256 _epochId, bytes32 _merkleRoot) external override onlyVoters {
        require(_epochId < getCurrentEpochId(), "epoch not ended yet");
        require (pChainMerkleRoots[_epochId] == bytes32(0), "epoch already finalized");
        PChainVotes[] storage votes = epochVotes[_epochId];
        uint256 len = votes.length;
        for (uint256 i = 0; i < len; i++) {
            PChainVotes storage merkleRootVotes = votes[i];
            if (merkleRootVotes.merkleRoot != _merkleRoot) {
                continue;
            }
            for (uint256 j = 0; j < merkleRootVotes.votes.length; j++) {
                require (merkleRootVotes.votes[j] != msg.sender, "already voted");
            }
            // not voted yet, check if it can be finalized or add voter to the list
            emit PChainStakeMirrorVoteSubmitted(_epochId, msg.sender, _merkleRoot);
            if (merkleRootVotes.votes.length + 1 >= votingThreshold) {
                // publish Merkle root
                pChainMerkleRoots[_epochId] = _merkleRoot;
                delete epochVotes[_epochId];
                emit PChainStakeMirrorVotingFinalized(_epochId, _merkleRoot);
            } else {
                // add voter to the list
                merkleRootVotes.votes.push(msg.sender);
            }
            return;
        }

        // Merkle root not found - add new one
        votes.push();
        votes[len].merkleRoot = _merkleRoot;
        votes[len].votes.push(msg.sender);
        emit PChainStakeMirrorVoteSubmitted(_epochId, msg.sender, _merkleRoot);
    }

    /**
     * @inheritdoc IPChainStakeMirrorMultiSigVoting
     */
    function submitValidatorUptimeVote(
        uint256 _rewardEpochId,
        bytes20[] calldata _nodeIds
    )
        external override
        onlyVoters
    {
        emit PChainStakeMirrorValidatorUptimeVoteSubmitted(_rewardEpochId, block.timestamp, msg.sender, _nodeIds);
    }

    /**
     * Method for changing votes. All old voters are replaced with the new list.
     * @param _newVotersList List of new voters.
     * **NOTE**: Already casted votes in an ongoing voting will not be deleted and will count towards the threshold.
     * **NOTE**: Setting fewer voters than the threshold will disable finalization of voting.
     * @dev Only governance can call this method.
     */
    function changeVoters(address[] calldata _newVotersList) external onlyGovernance {
        voters.replaceAll(_newVotersList);
        emit PChainStakeMirrorVotersSet(_newVotersList);
    }

    /**
     * Method for changing voting threshold.
     * @param _votingThreshold New voting threshold.
     * **NOTE**: Decreasing threshold will not finalize an ongoing voting.
     * Additional vote will be required, even if, according to the new threshold, voting should already be finalized.
     * **NOTE**: Setting higher threshold than the total number of voters will disable finalization of voting.
     * @dev Only governance can call this method.
     */
    function setVotingThreshold(uint256 _votingThreshold) external onlyGovernance {
        require(_votingThreshold > 1, "voting threshold too low");
        votingThreshold = _votingThreshold;
        emit PChainStakeMirrorVotingThresholdSet(_votingThreshold);
    }

    /**
     * Method for resetting already finalized epoch id. Should only be used in extreme cases.
     * @param _epochId Epoch id of the interest.
     * @dev Only governance can call this method.
     */
    function resetVoting(uint256 _epochId) external onlyImmediateGovernance {
        require (pChainMerkleRoots[_epochId] != bytes32(0), "epoch not finalized");
        pChainMerkleRoots[_epochId] = bytes32(0);
        emit PChainStakeMirrorVotingReset(_epochId);
    }

    /**
     * @inheritdoc IPChainStakeMirrorMultiSigVoting
     */
    function getEpochConfiguration() external view override
        returns (
            uint256 _firstEpochStartTs,
            uint256 _epochDurationSeconds
        )
    {
        return (
            firstEpochStartTs,
            epochDurationSeconds
        );
    }

    /**
     * @inheritdoc IPChainStakeMirrorMultiSigVoting
     */
    function getEpochId(uint256 _timestamp) external view override returns (uint256) {
        if (_timestamp < firstEpochStartTs) {
            return 0;
        } else {
            return (_timestamp - firstEpochStartTs) / epochDurationSeconds;
        }
    }

    /**
     * @inheritdoc IPChainStakeMirrorMultiSigVoting
     */
    function getMerkleRoot(uint256 _epochId) external view override returns(bytes32) {
        return pChainMerkleRoots[_epochId];
    }

    /**
     * @inheritdoc IPChainStakeMirrorMultiSigVoting
     */
    function getVotes(uint256 _epochId) external view override returns(PChainVotes[] memory) {
        require (pChainMerkleRoots[_epochId] == bytes32(0), "epoch already finalized");
        return epochVotes[_epochId];
    }

    /**
     * @inheritdoc IPChainStakeMirrorMultiSigVoting
     */
    function shouldVote(uint256 _epochId, address _voter) external view override returns(bool) {
        if (voters.index[_voter] == 0 || pChainMerkleRoots[_epochId] != bytes32(0)) {
            return false; // not a voter or voting already finished
        }
        PChainVotes[] storage votes = epochVotes[_epochId];
        uint256 len = votes.length;
        for (uint256 i = 0; i < len; i++) {
            PChainVotes storage merkleRootVotes = votes[i];
            for (uint256 j = 0; j < merkleRootVotes.votes.length; j++) {
                if (merkleRootVotes.votes[j] == _voter) {
                    return false; // already voted for some Merkle root
                }
            }
        }

        // voter can vote
        return true;
    }

    /**
     * @inheritdoc IPChainStakeMirrorMultiSigVoting
     */
    function getVoters() external view override returns(address[] memory) {
        return voters.list;
    }

    /**
     * @inheritdoc IPChainStakeMirrorMultiSigVoting
     */
    function getVotingThreshold() external view override returns(uint256) {
        return votingThreshold;
    }

    /**
     * @inheritdoc IPChainStakeMirrorMultiSigVoting
     */
    function getCurrentEpochId() public view override returns (uint256) {
        return (block.timestamp - firstEpochStartTs) / epochDurationSeconds;
    }
}
