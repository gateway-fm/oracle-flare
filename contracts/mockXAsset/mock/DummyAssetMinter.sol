// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "./AssetToken.sol";
import "../interface/ICollateralizable.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

/**
 * @title Dummy Asset Minter
 * @notice A minter contract for Asset tokens which implements the Flare collateralization framework.
 * @dev This contract implements a trial skeleton for the framework with a proposed interface. But the
 *   contract, at present, simply mints upon request without collateral.
 **/
contract DummyAssetMinter is ICollateralizable {
    using SafeMath for uint256;

    AssetToken public immutable mintableToken;
    uint256 public maxMintRequestTwei;

    constructor(
        AssetToken mintableToken_,
        uint256 maxMintRequestTwei_
    )
    {
        mintableToken = mintableToken_;
        maxMintRequestTwei = maxMintRequestTwei_;
    }

    /* solhint-disable no-unused-vars */

    /// addRewardToAgentPosition function will be triggered by the reward contract per reward allocation.
    /// Function will claim rewards for last epoch, and allocate to relevant agents
    /// Flow:
    ///     - check which FTSO won.
    ///     - claim relevant reward from reward contract.
    ///     - iterate list of current delegators to this FTSO
    ///     - per the list, check weight agent delegated to this FTSO
    ///     - add NAT reward to this Agent position. 
    function addRewardToAgentPosition(uint256 epochID) external override returns (bool succeess) {
        revert("Not implemented");
    }
    
    function deposit(
        uint256 amount,
        uint256 freshMint, // amount to add to fresh minting pool
        uint256 agentPosition, // amount to add to position pool 
        uint256 freshMintMinRatio, // if position pool collateral ratio < min, no new mints
        address natAddress,
        FeeHandling handling
    )
        external override 
    {
        revert("Not implemented");
    }

    /// note: eventually must send collateral reservation fee as msg.value. or approve to this contract
    // For now, just mint...
    function mintRequest ( // AKA collateral reservation
        uint256 mintAmountTwei,
        address mintDestination,
        bytes32 underlyingAddress
    ) 
        external override 
        returns (
            uint256 mintRequestId,
            address[] memory agents, // agent list
            uint256[] memory assetAmounts, // amount to send to agent in underlying chain
            bytes32[] memory assetAddress  // underlying chain address
        )
    {
        require(mintAmountTwei <= maxMintRequestTwei || maxMintRequestTwei == 0, "max exceeded");

        mintableToken.mint(mintDestination, mintAmountTwei);

        return (0, agents, assetAmounts, assetAddress);
    }

    function proveMintPayment ( // AKA mint
        uint256 mintRequestId,
        bytes32 minterSourceAddress, //do we need this?
        bytes32 agentAssetAddress,
        bytes32 destinationTag,
        uint256 assetAmount,
        bytes32[] calldata merkleProof
    ) 
        external override 
        returns (
            uint256 mintedAmount
        )
    {
        revert("Not implemented");
    }

    function assetRedemptionRequest (
        uint256 amount,
        bytes32 assetAddress // address in underlying chain[]
    ) 
        external override 
        returns (
            uint256 redemptionId,
            address[] calldata agents, // agent list
            uint256[] calldata assetAmounts // amount agent should  in underlying chain
        )
    {
        revert("Not implemented");
    }

    function proveRedemptionPayment ( // same as prove mint payment?
        uint256 redemptionRequestId,
        bytes32 agentSourceAssetAddress, //do we need this?
        bytes32 redeemerAssetAddress,
        bytes32 destinationTag,
        uint256 assetAmount,
        bytes32[] calldata merkleProof
    ) 
        external override
        returns (
            uint256 redeemedAmount
        )
    {
        revert("Not implemented");
    }

    /* solhint-enable no-unused-vars */
}
