// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import {IWNat} from "../../userInterfaces/IWNat.sol";

/**
 * @notice Provide a means to test behavior of WNAT when natives are transfered to it.
 **/
contract TransferToWnatMock {
    receive() external payable {
    }

    function transferToWnat(address payable wNat, uint256 amount) public {
        wNat.transfer(amount);
    }

    function depositToWnat(address payable wNat, uint256 amount) public {
        IWNat(wNat).deposit{ value: amount }();
    }
}
