// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../../utils/implementation/SafePct.sol";


/**
 * @title A library used for FTSO vote management
 * @dev Every vote corresponds to a specific FTSO epoch
 */
library FtsoVote {

    using SafePct for uint256;

    struct Instance {                           // struct holding vote data
        uint128 price;                          // submitted price in USD
        uint64 weightNat;                       // native token weight
        uint64 weightAsset;                     // asset weight
        address voter;                          // the sender of this vote
        uint32 index;
    }

    uint256 internal constant TERA = 10**12;    // 10^12

    /**
     * @notice Creates a vote instance and stores data associated with the vote
     * @param _voter                Sender of the vote
     * @param _votePowerNat         Native token vote power 
     * @param _votePowerAsset       Asset vote power
     * @param _totalVotePowerNat    Total native token vote power in epoch
     * @param _totalVotePowerAsset  Total asset vote power in epoch
     * @param _price                Price in USD submitted in a vote
     * @return vote                 The combined vote
     */
    function _createInstance(
        address _voter,
        uint256 _votePowerNat,
        uint256 _votePowerAsset,
        uint256 _totalVotePowerNat,
        uint256 _totalVotePowerAsset,
        uint256 _price
    ) 
        internal pure 
        returns (Instance memory vote)
    {
        vote.voter = _voter;
        vote.weightNat = _getWeight(_votePowerNat, _totalVotePowerNat);
        vote.weightAsset = _getWeight(_votePowerAsset, _totalVotePowerAsset);
        vote.price = uint128(_price);
    }

    /**
     * @notice Returns the vote weight (NAT or asset) computed based on vote power
     * @param _votePower            Vote power
     * @param _totalVotePower       Total vote power in epoch
     * @return Vote weight
     * @dev Vote power is adjusted to uint64 and is a number between 0 and TERA
     */
    function _getWeight(uint256 _votePower, uint256 _totalVotePower) private pure returns (uint64) {
        if (_totalVotePower == 0 || _votePower == 0) {
            return 0;
        } else {
            return uint64(_votePower.mulDiv(TERA, _totalVotePower));
        }
    }
}
