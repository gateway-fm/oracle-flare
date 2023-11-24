// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import "../interface/IIPChainStakeMirrorVerifier.sol";
import "../../userInterfaces/IPChainStakeMirrorMultiSigVoting.sol";
import {MerkleProof} from "@openzeppelin/contracts/cryptography/MerkleProof.sol";

/**
 * Contract used for P-chain staking verification using stake data and Merkle proof
 */
contract PChainStakeMirrorVerifier is IIPChainStakeMirrorVerifier {
    using MerkleProof for bytes32[];

    /// P-chain stake mirror voting contract with voted Merkle roots
    IPChainStakeMirrorMultiSigVoting public pChainStakeMirrorVoting;

    uint256 public immutable minStakeDurationSeconds;
    uint256 public immutable maxStakeDurationSeconds;
    uint256 public immutable minStakeAmountGwei;
    uint256 public immutable maxStakeAmountGwei;

    /**
     * Initializes the contract with default parameters
     * @param _pChainStakeMirrorVoting PChainStakeMirrorVoting contract address.
     * @param _minStakeDurationSeconds Minimum stake duration in seconds.
     * @param _maxStakeDurationSeconds Maximum stake duration in seconds.
     * @param _minStakeAmountGwei Minimum stake amount in Gwei.
     * @param _maxStakeAmountGwei Maximum stake amount in Gwei.
     */
    constructor(
        IPChainStakeMirrorMultiSigVoting _pChainStakeMirrorVoting,
        uint256 _minStakeDurationSeconds,
        uint256 _maxStakeDurationSeconds,
        uint256 _minStakeAmountGwei,
        uint256 _maxStakeAmountGwei
    )
    {
        require (_minStakeDurationSeconds <= _maxStakeDurationSeconds, "durations invalid");
        require (_minStakeAmountGwei <= _maxStakeAmountGwei, "amounts invalid");
        pChainStakeMirrorVoting = _pChainStakeMirrorVoting;
        minStakeDurationSeconds = _minStakeDurationSeconds;
        maxStakeDurationSeconds = _maxStakeDurationSeconds;
        minStakeAmountGwei = _minStakeAmountGwei;
        maxStakeAmountGwei = _maxStakeAmountGwei;
    }

    /**
     * @inheritdoc IIPChainStakeMirrorVerifier
     */
    function verifyStake(
        PChainStake calldata _stakeData,
        bytes32[] calldata _merkleProof
    )
        external view override
        returns (bool)
    {
        if(_stakeData.endTime < _stakeData.startTime) {
            return false;
        }
        uint256 stakeDuration = _stakeData.endTime - _stakeData.startTime;

        return stakeDuration >= minStakeDurationSeconds &&
            stakeDuration <= maxStakeDurationSeconds &&
            _stakeData.weight >= minStakeAmountGwei &&
            _stakeData.weight <= maxStakeAmountGwei &&
            _verifyMerkleProof(
                _merkleProof,
                _merkleRootForEpochId(pChainStakeMirrorVoting.getEpochId(_stakeData.startTime)),
                _hashPChainStaking(_stakeData)
            );
    }

    function _merkleRootForEpochId(uint256 _epochId) internal view returns(bytes32) {
        return pChainStakeMirrorVoting.getMerkleRoot(_epochId);
    }

    function _hashPChainStaking(PChainStake calldata _data) internal pure returns (bytes32) {
        return keccak256(abi.encode(_data));
    }

    function _verifyMerkleProof(
        bytes32[] memory proof,
        bytes32 merkleRoot,
        bytes32 leaf
    )
        internal pure
        returns (bool)
    {
        return proof.verify(merkleRoot, leaf);
    }

}
