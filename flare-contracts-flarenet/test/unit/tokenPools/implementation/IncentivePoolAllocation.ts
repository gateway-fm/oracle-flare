import { IncentivePoolAllocationInstance } from "../../../../typechain-truffle";

import {constants, expectRevert, expectEvent, time} from '@openzeppelin/test-helpers';
import { encodeContractNames } from "../../../utils/test-helpers";
import { Contracts } from "../../../../deployment/scripts/Contracts";
const getTestFile = require('../../../utils/constants').getTestFile;


const IncentivePoolAllocation = artifacts.require("IncentivePoolAllocation");
const MockContract = artifacts.require("MockContract");

const BN = web3.utils.toBN;

const ERR_OUT_OF_BOUNDS = "annual incentivePool out of bounds";
const ERR_ANNUAL_INCENTIVE_SCHEDULE_EMPTY = "annual incentivePool schedule empty";
const ERR_TOO_MANY = "too many";
const ERR_NOT_100_PCT = "sum sharing percentage not 100%";
const ERR_ONLY_GOVERNANCE = "only governance";
const ERR_ONLY_INCENTIVE_POOL = "only incentivePool";
const ERR_ZERO_ADDRESS = "address is 0";
const ERR_LENGTH_MISMATCH = "length mismatch";
const ERR_HIGH_SHARING_PERCENTAGE = "high sharing percentage";

contract(`IncentivePoolAllocation.sol; ${getTestFile(__filename)}; IncentivePoolAllocation unit tests`, async accounts => {
  const ADDRESS_UPDATER = accounts[16];
  // contains a fresh contract for each test
  let incentivePoolAllocation: IncentivePoolAllocationInstance;


  describe("initialization", async() => {

    it("Should cap initial percentage at 10%", async() => {
      // Assemble
      // Act
      const promise = IncentivePoolAllocation.new(accounts[0], ADDRESS_UPDATER, [1001]);
      // Assert
      await expectRevert(promise, ERR_OUT_OF_BOUNDS);
    });

    it("Should revert if initial schedule is empty", async() => {
      // Assemble
      // Act
      const promise = IncentivePoolAllocation.new(accounts[0], ADDRESS_UPDATER, []);
      // Assert
      await expectRevert(promise, ERR_ANNUAL_INCENTIVE_SCHEDULE_EMPTY);
    });

    it("Should accept initial incentive percentage schedule", async() => {
      // Assemble
      const schedule: BN[] = [BN(1000), BN(900), BN(800)];
      // Act
      incentivePoolAllocation = await IncentivePoolAllocation.new(accounts[0], ADDRESS_UPDATER, schedule);
      // Assert
      const percentage0 = await incentivePoolAllocation.annualIncentivePoolPercentagesBips(0);
      const percentage1 = await incentivePoolAllocation.annualIncentivePoolPercentagesBips(1);
      const percentage2 = await incentivePoolAllocation.annualIncentivePoolPercentagesBips(2);
      assert.equal(percentage0.toNumber(), 1000);
      assert.equal(percentage1.toNumber(), 900);
      assert.equal(percentage2.toNumber(), 800);
    });
  });

  describe("annual incentive percentage schedule", async() => {
    beforeEach(async() => {
      incentivePoolAllocation = await IncentivePoolAllocation.new(accounts[0], ADDRESS_UPDATER, [1000]);
      await incentivePoolAllocation.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INCENTIVE_POOL]),
        [ADDRESS_UPDATER, accounts[0]], {from: ADDRESS_UPDATER});
    });
    
    it("Should get the initial annual percentage if no schedule", async() => {
      // Assemble
      // Act
      const percentage = await incentivePoolAllocation.getAnnualPercentageBips.call();
      // Assert
      assert.equal(percentage.toNumber(), 1000);
    });

    it("Should not get the initial annual percentage if incentive not set", async() => {
      // Assemble
      incentivePoolAllocation = await IncentivePoolAllocation.new(accounts[0], ADDRESS_UPDATER, [1000]);
      // Act
      const promise = incentivePoolAllocation.getAnnualPercentageBips({from: accounts[1]});
      // Assert
      await expectRevert(promise, ERR_ZERO_ADDRESS);
    });

    it("Should not get the initial annual percentage if not from incentive", async() => {
      // Assemble
      // Act
      const promise = incentivePoolAllocation.getAnnualPercentageBips({from: accounts[1]});
      // Assert
      await expectRevert(promise, ERR_ONLY_INCENTIVE_POOL);
    });

    it("Should accept an incentive percentage schedule", async() => {
      // Assemble
      const schedule: BN[] = [BN(1000), BN(900), BN(800)];
      // Act
      await incentivePoolAllocation.setAnnualIncentivePool(schedule);
      // Assert
      const percentage0 = await incentivePoolAllocation.annualIncentivePoolPercentagesBips(0);
      const percentage1 = await incentivePoolAllocation.annualIncentivePoolPercentagesBips(1);
      const percentage2 = await incentivePoolAllocation.annualIncentivePoolPercentagesBips(2);
      assert.equal(percentage0.toNumber(), 1000);
      assert.equal(percentage1.toNumber(), 900);
      assert.equal(percentage2.toNumber(), 800);
    });

    it("Should yield each incentive percentage from schedule", async() => {
      // Assemble
      const schedule: BN[] = [BN(1000), BN(900), BN(800)];
      await incentivePoolAllocation.setAnnualIncentivePool(schedule);
      // Act
      let percentage = await incentivePoolAllocation.getAnnualPercentageBips.call();
      await incentivePoolAllocation.getAnnualPercentageBips();
      // Assert
      assert.equal(percentage.toNumber(), 1000);
      // Act
      percentage = await incentivePoolAllocation.getAnnualPercentageBips.call();
      await incentivePoolAllocation.getAnnualPercentageBips();
      // Assert
      assert.equal(percentage.toNumber(), 900);
      // Act
      percentage = await incentivePoolAllocation.getAnnualPercentageBips.call();
      await incentivePoolAllocation.getAnnualPercentageBips();
      // Assert
      assert.equal(percentage.toNumber(), 800);
      // Act
      percentage = await incentivePoolAllocation.getAnnualPercentageBips.call();
      await incentivePoolAllocation.getAnnualPercentageBips();
      // Assert
      assert.equal(percentage.toNumber(), 800);
    });

    it("Should not take a schedule with a higher percentage than last given", async() => {
      // Assemble
      const schedule: BN[] = [BN(1001)];
      // Act
      const promise = incentivePoolAllocation.setAnnualIncentivePool(schedule);
      // Assert
      await expectRevert(promise, ERR_OUT_OF_BOUNDS);        
    });

    it("Should allow a schedule with an embeded higher percentage", async() => {
      // Assemble
      const schedule: BN[] = [BN(900), BN(800), BN(900)];
      // Act
      await incentivePoolAllocation.setAnnualIncentivePool(schedule);
      // Assert
      
    });

    it("Should not take a schedule count more than max allowed", async() => {
      // Assemble
      const schedule: BN[] = [BN(999), BN(998), BN(997), BN(996), BN(995), BN(994), BN(993), BN(992), BN(991), BN(990),
        BN(989), BN(988), BN(987), BN(986), BN(985), BN(984), BN(983), BN(982), BN(981), BN(980),
        BN(979), BN(978), BN(977), BN(976), BN(975), BN(974)];
      // Act
      const promise = incentivePoolAllocation.setAnnualIncentivePool(schedule);
      // Assert
      await expectRevert(promise, ERR_TOO_MANY);
    });

    it("Should make available last incentive percentage yielded from schedule", async() => {
      // Assemble
      const schedule: BN[] = [BN(900), BN(800)];
      await incentivePoolAllocation.setAnnualIncentivePool(schedule);
      // Act
      await incentivePoolAllocation.getAnnualPercentageBips();
      // Assert
      const percentage = await incentivePoolAllocation.lastAnnualIncentivePoolPercentageBips();
      assert.equal(percentage.toNumber(), 900);
    });

    it("Should take a schedule with no percents and yield last percentage given", async() => {
      // Assemble
      const schedule: BN[] = [BN(900), BN(800)];
      await incentivePoolAllocation.setAnnualIncentivePool(schedule);
      await incentivePoolAllocation.getAnnualPercentageBips();
      // Act
      const newSchedule: BN[] = [];
      await incentivePoolAllocation.setAnnualIncentivePool(schedule);
      // Assert
      const percentage = await incentivePoolAllocation.lastAnnualIncentivePoolPercentageBips();
      assert.equal(percentage.toNumber(), 900);
    });
  });

  describe("sharing percentages", async() => {
    beforeEach(async() => {
      incentivePoolAllocation = await IncentivePoolAllocation.new(accounts[0], ADDRESS_UPDATER, [1000]);
      await incentivePoolAllocation.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INCENTIVE_POOL]),
        [ADDRESS_UPDATER, accounts[0]], {from: ADDRESS_UPDATER});
    });

    it("Should require sharing percentages to sum to 100%", async() => {
      // Assemble
      const incentivePoolReceivers: string[] = [];
      const percentages: BN[] = [];
      // Act
      const promise = incentivePoolAllocation.setSharingPercentages(incentivePoolReceivers, percentages);
      // Assert
      await expectRevert(promise, ERR_NOT_100_PCT);
    });

    it("Should not allow zero address incentive receiver contracts", async() => {
      // Assemble
      const incentivePoolReceivers: string[] = [constants.ZERO_ADDRESS];
      const percentages: BN[] = [BN(10000)];
      // Act
      const promise = incentivePoolAllocation.setSharingPercentages(incentivePoolReceivers, percentages);
      // Assert
      await expectRevert(promise, ERR_ZERO_ADDRESS);
    });

    it("Should not set sharing percentages if not from governance", async() => {
      // Assemble
      const incentivePoolReceivers: string[] = [];
      const percentages: BN[] = [];
      // Act
      const promise = incentivePoolAllocation.setSharingPercentages(incentivePoolReceivers, percentages, {from: accounts[1]});
      // Assert
      await expectRevert(promise, ERR_ONLY_GOVERNANCE);
    });

    it("Should set sharing percentages", async() => {
      // Assemble
      const incentivePoolReceivers: string[] = [(await MockContract.new()).address, (await MockContract.new()).address];
      const percentages: BN[] = [BN(8000), BN(2000)];
      // Act
      await incentivePoolAllocation.setSharingPercentages(incentivePoolReceivers, percentages);
      // Assert
      const sharingPercentages = await incentivePoolAllocation.getSharingPercentages();
      assert.equal(sharingPercentages[0].incentivePoolReceiver, incentivePoolReceivers[0]);
      assert.equal(sharingPercentages[0].percentBips as any, percentages[0].toString());
      assert.equal(sharingPercentages[1].incentivePoolReceiver, incentivePoolReceivers[1]);
      assert.equal(sharingPercentages[1].percentBips as any, percentages[1].toString());
    });

    it("Should update sharing percentages", async() => {
      // Assemble
      const incentivePoolReceivers: string[] = [(await MockContract.new()).address, (await MockContract.new()).address, (await MockContract.new()).address];
      const percentages: BN[] = [BN(6000), BN(2000), BN(2000)];
      // Act
      await incentivePoolAllocation.setSharingPercentages(incentivePoolReceivers, percentages);
      // Assert
      const sharingPercentages = await incentivePoolAllocation.getSharingPercentages();
      assert.equal(sharingPercentages.length, 3);
      assert.equal(sharingPercentages[0].incentivePoolReceiver, incentivePoolReceivers[0]);
      assert.equal(sharingPercentages[0].percentBips as any, percentages[0].toString());
      assert.equal(sharingPercentages[1].incentivePoolReceiver, incentivePoolReceivers[1]);
      assert.equal(sharingPercentages[1].percentBips as any, percentages[1].toString());
      assert.equal(sharingPercentages[2].incentivePoolReceiver, incentivePoolReceivers[2]);
      assert.equal(sharingPercentages[2].percentBips as any, percentages[2].toString());

      const incentivePoolReceivers2: string[] = [(await MockContract.new()).address, (await MockContract.new()).address];
      const percentages2: BN[] = [BN(5000), BN(5000)];
      // Act
      await incentivePoolAllocation.setSharingPercentages(incentivePoolReceivers2, percentages2);
      // Assert
      const sharingPercentages2 = await incentivePoolAllocation.getSharingPercentages();
      assert.equal(sharingPercentages2.length, 2);
      assert.equal(sharingPercentages2[0].incentivePoolReceiver, incentivePoolReceivers2[0]);
      assert.equal(sharingPercentages2[0].percentBips as any, percentages2[0].toString());
      assert.equal(sharingPercentages2[1].incentivePoolReceiver, incentivePoolReceivers2[1]);
      assert.equal(sharingPercentages2[1].percentBips as any, percentages2[1].toString());
    });

    it("Should update a incentive receiver contract", async () => {
      // Assemble
      // Shim up mock
      const mockContractToReceiveIncentive = await MockContract.new();
      const newMockContractToReceiveIncentive = await MockContract.new();
      const getContractName = web3.utils.sha3("getContractName()")!.slice(0, 10); // first 4 bytes is function selector
      const getContractNameReturn = web3.eth.abi.encodeParameter('string', 'SOME_CONTRACT_NAME');
      await mockContractToReceiveIncentive.givenMethodReturn(getContractName, getContractNameReturn);

      // Register mock
      const incentivePoolReceivers: string[] = [mockContractToReceiveIncentive.address];
      const percentages: BN[] = [BN(10000)];
      await incentivePoolAllocation.setSharingPercentages(incentivePoolReceivers, percentages);
      
      // Act
      await incentivePoolAllocation.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INCENTIVE_POOL, "SOME_CONTRACT_NAME"]),
        [ADDRESS_UPDATER, accounts[0], newMockContractToReceiveIncentive.address], {from: ADDRESS_UPDATER});
      // Assert
      const sharingPercentages = await incentivePoolAllocation.getSharingPercentages();
      assert.equal(sharingPercentages.length, 1);
      assert.equal(sharingPercentages[0].incentivePoolReceiver, newMockContractToReceiveIncentive.address);
      assert.equal(sharingPercentages[0].percentBips as any, percentages[0].toString());
    });

    it("Should not set sharing percentages if any sharing percentage > 100%", async() => {
      // Assemble
      const incentivePoolReceivers: string[] = [(await MockContract.new()).address, (await MockContract.new()).address];
      const percentages: BN[] = [BN(1000), BN(11000)];
      // Act
      const promise = incentivePoolAllocation.setSharingPercentages(incentivePoolReceivers, percentages);
      // Assert
      await expectRevert(promise, ERR_HIGH_SHARING_PERCENTAGE);
    });

    it("Should not set sharing percentages if array lengths do not match", async() => {
      // Assemble
      const incentivePoolReceivers: string[] = [(await MockContract.new()).address, (await MockContract.new()).address];
      const percentages: BN[] = [BN(8000), BN(1000), BN(1000)];
      // Act
      const promise = incentivePoolAllocation.setSharingPercentages(incentivePoolReceivers, percentages);
      // Assert
      await expectRevert(promise, ERR_LENGTH_MISMATCH);
    });

    it("Should not set sharing percentages if too many", async() => {
      // Assemble
      const incentivePoolReceivers: string[] = [
        (await MockContract.new()).address, 
        (await MockContract.new()).address, 
        (await MockContract.new()).address, 
        (await MockContract.new()).address, 
        (await MockContract.new()).address, 
        (await MockContract.new()).address, 
        (await MockContract.new()).address, 
        (await MockContract.new()).address, 
        (await MockContract.new()).address, 
        (await MockContract.new()).address, 
        (await MockContract.new()).address
      ];
      const percentages: BN[] = [
        BN(1000), 
        BN(1000), 
        BN(1000), 
        BN(1000), 
        BN(1000), 
        BN(1000), 
        BN(1000), 
        BN(1000), 
        BN(1000), 
        BN(500), 
        BN(500)];
      // Act
      const promise = incentivePoolAllocation.setSharingPercentages(incentivePoolReceivers, percentages);
      // Assert
      await expectRevert(promise, ERR_TOO_MANY);
    });
  });
});
