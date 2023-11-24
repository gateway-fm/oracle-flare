// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import {FtsoMedian} from "../lib/FtsoMedian.sol";


/**
 * @title Ftso Median mock contract
 * @notice A contract to expose the FtsoMedian library for unit testing.
 **/
contract FtsoMedianMock {
    using FtsoMedian for FtsoMedian.Data;
    
    function computeWeighted(
        uint256[] memory _price,
        uint256[] memory _weight
    )
        public view 
        returns (
            uint256[] memory _index, 
            FtsoMedian.Data memory _d,
            uint256[] memory,
            uint256[] memory
        )
    {
        (_index, _d) = FtsoMedian._computeWeighted(_price, _weight, 0);
        return (_index, _d, _price, _weight);
    }
    
    function swap(uint256 _i, uint256 _j, uint256[] memory _index) public pure returns (uint256[] memory) {
        FtsoMedian._swap(_i, _j, _index);
        return _index;
    }

    function partition(
        uint256 _left0,
        uint256 _right0,
        uint256 _pivotId,
        uint256 _leftSum0, 
        uint256 _rightSum0,
        uint256[] memory _index,
        uint256[] memory _price, 
        uint256[] memory _weight
    ) 
        public pure 
        returns (
            uint256 _pos, 
            uint256 _leftSum, 
            uint256 _rightSum, 
            uint256[] memory,
            uint256[] memory, 
            uint256[] memory
        )
    {
        (_pos, _leftSum, _rightSum) = 
            FtsoMedian._partition(_left0, _right0, _pivotId, _leftSum0, _rightSum0, _index, _price, _weight);
        return (_pos, _leftSum, _rightSum, _index, _price, _weight);
    }

    function samePriceFix(
        uint256 _start,
        uint256 _end,
        int256 _direction,
        uint256 _sumInit,
        uint256[] memory _index,
        uint256[] memory _price,
        uint256[] memory _weight
    )
        public pure 
        returns (
            uint256 _pos, 
            uint256 _sum,
            uint256[] memory,
            uint256[] memory, 
            uint256[] memory
        )
    {
        (_pos, _sum) = FtsoMedian._samePriceFix(_start, _end, _direction, _sumInit, _index, _price, _weight);
        return (_pos, _sum, _index, _price, _weight);
    }

    function closestPriceFix(
        uint256 _start,
        uint256 _end,
        uint256[] memory _index,
        uint256[] memory _price
    )
        public pure 
        returns (uint256)
    {
        return FtsoMedian._closestPriceFix(_start, _end, _index, _price);
    }

    function computeSimple(
        uint256[] memory _prices
    )
        public pure 
        returns (
            uint256 _finalMedianPrice, 
            uint256[] memory
        )
    {
        return (FtsoMedian._computeSimple(_prices), _prices);
    }
}
