// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../../addressUpdater/implementation/AddressUpdatable.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";


abstract contract TokenPoolBase {
    using SafeMath for uint256;

    address payable constant internal BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    /**
     * @dev This modifier ensures that this contract's balance matches the expected balance.
     *      It also burns all funds that came from self-destructor sending a balance to this contract.
     *      Should be used in all methods changing the balance (claiming, receiving funds,...).
     */
    modifier mustBalance {
        _handleSelfDestructProceeds();
        _;
        _checkMustBalance();
    }

    /**
     * @dev Method that is used in `mustBalance` modifier. It should return expected balance after
     *      triggered function completes (claiming, burning, receiving funds,...).
     */
    function _getExpectedBalance() internal virtual view returns(uint256 _balanceExpectedWei);

    /**
     * @notice Burn all funds that came from self-destructor sending a balance to this contract.
     */
    function _handleSelfDestructProceeds() private {
        uint256 expectedBalance = _getExpectedBalance().add(msg.value);
        uint256 currentBalance = address(this).balance;
        if (currentBalance > expectedBalance) {
            // Then assume extra were self-destruct proceeds and burn it
            //slither-disable-next-line arbitrary-send-eth
            BURN_ADDRESS.transfer(currentBalance.sub(expectedBalance));
        } else if (currentBalance < expectedBalance) {
            // This is a coding error
            assert(false);
        }
    }

    function _checkMustBalance() private view {
        require(address(this).balance == _getExpectedBalance(), "out of balance");
    }
}
