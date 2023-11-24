// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "./VPToken.sol";
import "./VPContract.sol";
import "../../userInterfaces/IWNat.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

/**
 * Wrapped native token.
 *
 * This contract converts native tokens into `WNAT` (wrapped native) tokens and vice versa.
 * `WNAT` tokens are a one-to-one [ERC20](https://ethereum.org/en/developers/docs/standards/tokens/erc-20/)
 * representation of native tokens, which are minted and burned as needed by this contract.
 *
 * The wrapped versions of the native `FLR` and `SGB` tokens are called `WFLR` and `WSGB` respectively.
 *
 * Besides the standard ERC20 operations, this contract supports
 * [FTSO delegation](https://docs.flare.network/tech/ftso/#delegation) and
 * [governance vote delegation](https://docs.flare.network/tech/governance/#vote-transfer).
 *
 * Code attribution: WETH9.
 */
contract WNat is VPToken, IWNat {
    using SafeMath for uint256;
    /**
     * Emitted when tokens have been wrapped.
     * @param dst The account that received the wrapped tokens.
     * @param amount The amount that was wrapped.
     */
    event Deposit(address indexed dst, uint amount);
    /**
     * Emitted when tokens have been unwrapped.
     * @param src The account that received the unwrapped tokens.
     * @param amount The amount that was unwrapped.
     */
    event Withdrawal(address indexed src, uint amount);

    /**
     * Construct an ERC20 token.
     */
    constructor(address _governance, string memory _name, string memory _symbol)
        VPToken(_governance, _name, _symbol)
    {
    }

    /**
     * A proxy for the deposit method.
     */
    receive() external payable {
        deposit();
    }

    /**
     * @inheritdoc IWNat
     *
     * @dev Emits a Withdrawal event.
     */
    function withdrawFrom(address _owner, uint256 _amount) external override {
        // Reduce senders allowance
        _approve(_owner, msg.sender, allowance(_owner, msg.sender).sub(_amount, "allowance below zero"));
        // Burn the owners balance
        _burn(_owner, _amount);
        // Emit withdraw event
        emit Withdrawal(_owner, _amount);
        // Move value to sender (last statement, to prevent reentrancy)
        msg.sender.transfer(_amount);
    }

    /**
     * @inheritdoc IWNat
     *
     * @dev Emits a Deposit event.
     */
    function depositTo(address _recipient) external payable override {
        require(_recipient != address(0), "Cannot deposit to zero address");
        // Mint WNAT
        _mint(_recipient, msg.value);
        // Emit deposit event
        emit Deposit(_recipient, msg.value);
    }

    /**
     * @inheritdoc IWNat
     *
     * @dev Emits a Deposit event.
     */
    function deposit() public payable override {
        // Mint WNAT
        _mint(msg.sender, msg.value);
        // Emit deposit event
        emit Deposit(msg.sender, msg.value);
    }

    /**
     * @inheritdoc IWNat
     *
     * @dev Emits a Withdrawal event.
     */
    function withdraw(uint256 _amount) external override {
        // Burn WNAT tokens
        _burn(msg.sender, _amount);
        // Emit withdrawal event
        emit Withdrawal(msg.sender, _amount);
        // Send Native to sender (last statement, to prevent reentrancy)
        msg.sender.transfer(_amount);
    }
}
