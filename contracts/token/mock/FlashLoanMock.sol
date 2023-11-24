// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import { WNat } from "../implementation/WNat.sol";
import { MockFtso } from "../../ftso/mock/MockFtso.sol";

interface IFlashLenderMock {
    function requestNativeLoan(uint256 value) external;
    function returnNativeLoan() external payable;
}

interface IFlashLoanMock {
    function receiveNativeLoan(IFlashLenderMock lender) external payable;
}

contract FlashLenderMock is IFlashLenderMock {
    mapping(address => uint256) private loans;
    
    receive() external payable {}
    
    function donateTo(address payable target, uint256 value) external {
        require(address(this).balance >= value, "Not enough funds for donation");
        target.transfer(value);
    }
    
    function requestNativeLoan(uint256 value) override external {
        require(address(this).balance >= value, "Not enough funds for loan");
        require(loans[msg.sender] == 0, "Can only loan once to a address");
        loans[msg.sender] = value;
        // call back and send money
        IFlashLoanMock(msg.sender).receiveNativeLoan{ value: value }(this);
        // loan should be returned
        require(loans[msg.sender] == 0, "Flash loan must be returned");
    }
    
    function returnNativeLoan() override external payable {
        require(msg.value > 0);
        require(msg.value == loans[msg.sender]);
        delete loans[msg.sender];
    }
}

contract FlashLoanMock is IFlashLoanMock {
    FlashLenderMock private flashLender;
    WNat private wNat;
    MockFtso private ftso;
    
    uint256 private requestedValue;
    
    constructor(
        FlashLenderMock _flashLender,
        WNat _wNat,
        MockFtso _ftso
    )
    {
        flashLender = _flashLender;
        wNat = _wNat;
        ftso = _ftso;
    }
    
    receive() external payable {}
    
    function testRequestLoan(uint256 _value) external {
        requestedValue = _value;
        require(address(this).balance == 0, "Starting balance not zero");
        flashLender.requestNativeLoan(_value);
        require(address(this).balance == 0, "Ending balance not zero");
    }

    function receiveNativeLoan(IFlashLenderMock _lender) override external payable {
        require(msg.value == requestedValue, "Loan value does not match requested value");
        require(address(this).balance == msg.value, "Balance does not match loan value");
        doSomethingWithLoanedNatives(msg.value);
        _lender.returnNativeLoan{ value: msg.value }();
    }
    
    function mintWnat(uint256 _amount) public {
        require(address(this).balance >= _amount, "Not enought natives to mint wNat");
        wNat.deposit{ value: address(this).balance }();
    }

    function cashWnat(uint256 _amount) public {
        wNat.withdraw(_amount);
    }
    
    function submitPriceHash(uint256 _epochId, uint256 _price, uint256 _random) public {
        bytes32 _hash = keccak256(abi.encode(_price, _random, this));
        ftso.submitPriceHash(_epochId, _hash);
    }

    function revealPrice(uint256 _epochId, uint256 _price, uint256 _random) public {
        ftso.revealPrice(_epochId, _price, _random);
    }

    function doSomethingWithLoanedNatives(uint256) internal virtual {
        // to be overriden
    }
}


contract VotingFlashLoanMock is FlashLoanMock {
    uint256 private epochId;
    uint256 private price;
    uint256 private random;
   
    constructor(
        FlashLenderMock _flashLender,
        WNat _wNat,
        MockFtso _ftso
    )
        FlashLoanMock(_flashLender, _wNat, _ftso)
    {
    }
    
    function setVote(uint256 _epochId, uint256 _price, uint256 _random) public {
        epochId = _epochId;
        price = _price;
        random = _random;
    }

    function doSomethingWithLoanedNatives(uint256 _value) internal override {
        // to be overriden
        mintWnat(_value);
        revealPrice(epochId, price, random);
        cashWnat(_value);
    }
}
