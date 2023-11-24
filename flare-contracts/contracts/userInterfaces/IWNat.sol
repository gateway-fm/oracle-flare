// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

/**
 * Wrapped native token interface.
 *
 * This contract converts native tokens into `WNAT` (wrapped native) tokens and vice versa.
 * `WNAT` tokens are a one-to-one [ERC20](https://ethereum.org/en/developers/docs/standards/tokens/erc-20/)
 * representation of native tokens, which are minted and burned as needed by this contract.
 *
 * The wrapped versions of the native `FLR` and `SGB` tokens are called `WFLR` and `WSGB` respectively.
 *
 * Code attribution: WETH9.
 */
interface IWNat {
    /**
     * Deposits native tokens and mints the same amount of `WNAT` tokens,
     * which are added to the `msg.sender`'s balance.
     * This operation is commonly known as "wrapping".
     */
    function deposit() external payable;

    /**
     * Burns `_amount` of `WNAT` tokens from `msg.sender`'s `WNAT` balance and
     * transfers the same amount of native tokens to `msg.sender`.
     * This operation is commonly known as "unwrapping".
     *
     * Reverts if `_amount` is higher than `msg.sender`'s `WNAT` balance.
     * @param _amount            The amount to withdraw.
     */
    function withdraw(uint256 _amount) external;

    /**
     * Deposits native tokens and mints the same amount of `WNAT` tokens,
     * which are added to `_recipient`'s balance.
     * This operation is commonly known as "wrapping".
     *
     * This is equivalent to using `deposit` followed by `transfer`.
     * @param _recipient         The address to receive the minted `WNAT`.
     */
    function depositTo(address _recipient) external payable;

    /**
     * Burns `_amount` of `WNAT` tokens from `_owner`'s `WNAT` balance and
     * transfers the same amount of native tokens to `msg.sender`.
     * This operation is commonly known as "unwrapping".
     *
     * `msg.sender` must have been authorized to withdraw from `_owner`'s account
     * through ERC-20's approve mechanism.
     *
     * Reverts if `_amount` is higher than `_owners`'s `WNAT` balance or than
     * `msg.sender`'s allowance over `_owner`'s tokens.
     * @param _owner             The address containing the tokens to withdraw.
     * @param _amount            The amount to withdraw.
     */
    function withdrawFrom(address _owner, uint256 _amount) external;
}
