// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import { GasConsumer6 } from "../mock/GasConsumer6.sol";

/**
 * @title Gas consumer contract that emulates manager for priority lists.
 * Function push(n) is used for heavy transaction load tests. 
 **/
contract GasConsumer7 {

    GasConsumer6[] public gasConsumers6Contracts;

    function setContracts(GasConsumer6[] calldata gasConsumers6) external {

        uint256 gasConsumer6Length = gasConsumers6.length;

        while (gasConsumers6Contracts.length > 0) {
            gasConsumers6Contracts.pop();
        }

        for (uint256 i = 0; i < gasConsumer6Length; i++) {
            gasConsumers6Contracts.push(gasConsumers6[i]);
        }
    }


    function push(uint256 n) external {

        uint256 gasConsumer6Length = gasConsumers6Contracts.length;

        for (uint256 i = 0; i < gasConsumer6Length; i++) {
            uint256 tmp = uint256(keccak256(abi.encode(n, i)));
            gasConsumers6Contracts[i].push(tmp);
        }
    }



}