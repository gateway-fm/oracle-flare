// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import "../implementation/PChainStakeMirrorVerifier.sol";

/**
 * Contract used for P-chain staking verification using stake data and Merkle proof
 */
contract PChainStakeMirrorVerifierMock is PChainStakeMirrorVerifier {
    constructor(
        IPChainStakeMirrorMultiSigVoting _pChainStakeMirrorVoting,
        uint256 _minStakeDurationSeconds,
        uint256 _maxStakeDurationSeconds,
        uint256 _minStakeAmountGwei,
        uint256 _maxStakeAmountGwei
    )
        PChainStakeMirrorVerifier(
            _pChainStakeMirrorVoting,
            _minStakeDurationSeconds,
            _maxStakeDurationSeconds,
            _minStakeAmountGwei,
            _maxStakeAmountGwei
    )
    {
        // empty block
    }

    function merkleRootForEpochId(
        uint256 _epochId
    ) public view returns (bytes32) {
        return _merkleRootForEpochId(_epochId);
    }

    function hashPChainStaking(
        PChainStake calldata _data
    ) public pure returns (bytes32) {
        return _hashPChainStaking(_data);
    }
}
