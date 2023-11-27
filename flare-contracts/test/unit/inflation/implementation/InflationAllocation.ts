import { InflationAllocationInstance } from "../../../../typechain-truffle";

import {constants, expectRevert, expectEvent, time} from '@openzeppelin/test-helpers';
import { encodeContractNames } from "../../../utils/test-helpers";
import { Contracts } from "../../../../deployment/scripts/Contracts";
const getTestFile = require('../../../utils/constants').getTestFile;

const InflationAllocation = artifacts.require("InflationAllocation");
const MockContract = artifacts.require("MockContract");

const BN = web3.utils.toBN;

const ERR_OUT_OF_BOUNDS = "time slot inflation out of bounds";
const ERR_TIME_SLOT_INFLATION_SCHEDULE_EMPTY = "time slot inflation schedule empty";
const ERR_TOO_MANY = "too many";
const ERR_NOT_100_PCT = "sum sharing percentage not 100%";
const ERR_ONLY_GOVERNANCE = "only governance";
const ERR_ONLY_INFLATION = "only inflation";
const ERR_ZERO_ADDRESS = "address is 0";
const ERR_LENGTH_MISMATCH = "length mismatch";
const ERR_HIGH_SHARING_PERCENTAGE = "high sharing percentage";

contract(`InflationAllocation.sol; ${getTestFile(__filename)}; InflationAllocation unit tests`, async accounts => {
  const ADDRESS_UPDATER = accounts[16];
  // contains a fresh contract for each test
  let inflationAllocation: InflationAllocationInstance;

  describe("initialization", async() => {
    it("Should require initial percentage greater than 0", async() => {
      // Assemble
      // Act
      const promise = InflationAllocation.new(accounts[0], ADDRESS_UPDATER, [0]);
      // Assert
      await expectRevert(promise, ERR_OUT_OF_BOUNDS);
    });

    it("Should cap initial percentage at 10%", async() => {
      // Assemble
      // Act
      const promise = InflationAllocation.new(accounts[0], ADDRESS_UPDATER, [1001]);
      // Assert
      await expectRevert(promise, ERR_OUT_OF_BOUNDS);
    });

    it("Should revert if initial schedule is empty", async() => {
      // Assemble
      // Act
      const promise = InflationAllocation.new(accounts[0], ADDRESS_UPDATER, []);
      // Assert
      await expectRevert(promise, ERR_TIME_SLOT_INFLATION_SCHEDULE_EMPTY);
    });

    it("Should accept initial inflation percentage schedule", async() => {
      // Assemble
      const schedule: BN[] = [BN(1000), BN(900), BN(800)];
      // Act
      inflationAllocation = await InflationAllocation.new(accounts[0], ADDRESS_UPDATER, schedule);
      // Assert
      const percentage0 = await inflationAllocation.timeSlotInflationPercentagesBips(0);
      const percentage1 = await inflationAllocation.timeSlotInflationPercentagesBips(1);
      const percentage2 = await inflationAllocation.timeSlotInflationPercentagesBips(2);
      assert.equal(percentage0.toNumber(), 1000);
      assert.equal(percentage1.toNumber(), 900);
      assert.equal(percentage2.toNumber(), 800);
    });
  });

  describe("time slot inflation percentage schedule", async() => {
    beforeEach(async() => {
      inflationAllocation = await InflationAllocation.new(accounts[0], ADDRESS_UPDATER, [1000]);
      await inflationAllocation.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION]),
        [ADDRESS_UPDATER, accounts[0]], {from: ADDRESS_UPDATER});
    });

    it("Should get the initial time slot percentage if no schedule", async() => {
      // Assemble
      // Act
      const percentage = await inflationAllocation.getTimeSlotPercentageBips.call();
      // Assert
      assert.equal(percentage.toNumber(), 1000);
    });

    it("Should not get the initial time slot percentage if inflation not set", async() => {
      // Assemble
      inflationAllocation = await InflationAllocation.new(accounts[0], ADDRESS_UPDATER, [1000]);
      // Act
      const promise = inflationAllocation.getTimeSlotPercentageBips({from: accounts[1]});
      // Assert
      await expectRevert(promise, ERR_ZERO_ADDRESS);
    });

    it("Should not get the initial time slot percentage if not from inflation", async() => {
      // Assemble
      // Act
      const promise = inflationAllocation.getTimeSlotPercentageBips({from: accounts[1]});
      // Assert
      await expectRevert(promise, ERR_ONLY_INFLATION);
    });

    it("Should accept an inflation percentage schedule", async() => {
      // Assemble
      const schedule: BN[] = [BN(1000), BN(900), BN(800)];
      // Act
      await inflationAllocation.setTimeSlotInflation(schedule);
      // Assert
      const percentage0 = await inflationAllocation.timeSlotInflationPercentagesBips(0);
      const percentage1 = await inflationAllocation.timeSlotInflationPercentagesBips(1);
      const percentage2 = await inflationAllocation.timeSlotInflationPercentagesBips(2);
      assert.equal(percentage0.toNumber(), 1000);
      assert.equal(percentage1.toNumber(), 900);
      assert.equal(percentage2.toNumber(), 800);
    });

    it("Should yield each inflation percentage from schedule", async() => {
      // Assemble
      const schedule: BN[] = [BN(1000), BN(900), BN(800)];
      await inflationAllocation.setTimeSlotInflation(schedule);
      // Act
      let percentage = await inflationAllocation.getTimeSlotPercentageBips.call();
      await inflationAllocation.getTimeSlotPercentageBips();
      // Assert
      assert.equal(percentage.toNumber(), 1000);
      // Act
      percentage = await inflationAllocation.getTimeSlotPercentageBips.call();
      await inflationAllocation.getTimeSlotPercentageBips();
      // Assert
      assert.equal(percentage.toNumber(), 900);
      // Act
      percentage = await inflationAllocation.getTimeSlotPercentageBips.call();
      await inflationAllocation.getTimeSlotPercentageBips();
      // Assert
      assert.equal(percentage.toNumber(), 800);
      // Act
      percentage = await inflationAllocation.getTimeSlotPercentageBips.call();
      await inflationAllocation.getTimeSlotPercentageBips();
      // Assert
      assert.equal(percentage.toNumber(), 800);
    });

    it("Should not take a schedule with a higher percentage than last given", async() => {
      // Assemble
      const schedule: BN[] = [BN(1001)];
      // Act
      const promise = inflationAllocation.setTimeSlotInflation(schedule);
      // Assert
      await expectRevert(promise, ERR_OUT_OF_BOUNDS);
    });

    it("Should not take a schedule with an embeded higher percentage", async() => {
      // Assemble
      const schedule: BN[] = [BN(900), BN(800), BN(900)];
      // Act
      const promise = inflationAllocation.setTimeSlotInflation(schedule);
      // Assert
      await expectRevert(promise, ERR_OUT_OF_BOUNDS);
    });

    it("Should not take a schedule count more than max allowed", async() => {
      // Assemble
      const schedule: BN[] = [BN(999), BN(998), BN(997), BN(996), BN(995), BN(994), BN(993), BN(992), BN(991), BN(990),
        BN(989), BN(988), BN(987), BN(986), BN(985), BN(984), BN(983), BN(982), BN(981), BN(980),
        BN(979), BN(978), BN(977), BN(976), BN(975), BN(974)];
      // Act
      const promise = inflationAllocation.setTimeSlotInflation(schedule);
      // Assert
      await expectRevert(promise, ERR_TOO_MANY);
    });

    it("Should make available last inflation percentage yielded from schedule", async() => {
      // Assemble
      const schedule: BN[] = [BN(900), BN(800)];
      await inflationAllocation.setTimeSlotInflation(schedule);
      // Act
      await inflationAllocation.getTimeSlotPercentageBips();
      // Assert
      const percentage = await inflationAllocation.lastTimeSlotInflationPercentageBips();
      assert.equal(percentage.toNumber(), 900);
    });

    it("Should take a schedule with no percents and yield last percentage given", async() => {
      // Assemble
      const schedule: BN[] = [BN(900), BN(800)];
      await inflationAllocation.setTimeSlotInflation(schedule);
      await inflationAllocation.getTimeSlotPercentageBips();
      // Act
      const newSchedule: BN[] = [];
      await inflationAllocation.setTimeSlotInflation(schedule);
      // Assert
      const percentage = await inflationAllocation.lastTimeSlotInflationPercentageBips();
      assert.equal(percentage.toNumber(), 900);
    });
  });

  describe("sharing percentages", async() => {
    beforeEach(async() => {
      inflationAllocation = await InflationAllocation.new(accounts[0], ADDRESS_UPDATER, [1000]);
      await inflationAllocation.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION]),
        [ADDRESS_UPDATER, accounts[0]], {from: ADDRESS_UPDATER});
    });

    it("Should require sharing percentages to sum to 100%", async() => {
      // Assemble
      const inflationReceivers: string[] = [];
      const percentages: BN[] = [];
      // Act
      const promise = inflationAllocation.setSharingPercentages(inflationReceivers, percentages);
      // Assert
      await expectRevert(promise, ERR_NOT_100_PCT);
    });

    it("Should not allow zero address inflation receiver contracts", async() => {
      // Assemble
      const inflationReceivers: string[] = [constants.ZERO_ADDRESS];
      const percentages: BN[] = [BN(10000)];
      // Act
      const promise = inflationAllocation.setSharingPercentages(inflationReceivers, percentages);
      // Assert
      await expectRevert(promise, ERR_ZERO_ADDRESS);
    });

    it("Should not set sharing percentages if not from governance", async() => {
      // Assemble
      const inflationReceivers: string[] = [];
      const percentages: BN[] = [];
      // Act
      const promise = inflationAllocation.setSharingPercentages(inflationReceivers, percentages, {from: accounts[1]});
      // Assert
      await expectRevert(promise, ERR_ONLY_GOVERNANCE);
    });

    it("Should set sharing percentages", async() => {
      // Assemble
      const inflationReceivers: string[] = [(await MockContract.new()).address, (await MockContract.new()).address];
      const percentages: BN[] = [BN(8000), BN(2000)];
      // Act
      await inflationAllocation.setSharingPercentages(inflationReceivers, percentages);
      // Assert
      const sharingPercentages = await inflationAllocation.getSharingPercentages();
      assert.equal(sharingPercentages[0].inflationReceiver, inflationReceivers[0]);
      assert.equal(sharingPercentages[0].percentBips as any, percentages[0].toString());
      assert.equal(sharingPercentages[1].inflationReceiver, inflationReceivers[1]);
      assert.equal(sharingPercentages[1].percentBips as any, percentages[1].toString());
    });

    it("Should update sharing percentages", async() => {
      // Assemble
      const inflationReceivers: string[] = [(await MockContract.new()).address, (await MockContract.new()).address, (await MockContract.new()).address];
      const percentages: BN[] = [BN(6000), BN(2000), BN(2000)];
      // Act
      await inflationAllocation.setSharingPercentages(inflationReceivers, percentages);
      // Assert
      const sharingPercentages = await inflationAllocation.getSharingPercentages();
      assert.equal(sharingPercentages.length, 3);
      assert.equal(sharingPercentages[0].inflationReceiver, inflationReceivers[0]);
      assert.equal(sharingPercentages[0].percentBips as any, percentages[0].toString());
      assert.equal(sharingPercentages[1].inflationReceiver, inflationReceivers[1]);
      assert.equal(sharingPercentages[1].percentBips as any, percentages[1].toString());
      assert.equal(sharingPercentages[2].inflationReceiver, inflationReceivers[2]);
      assert.equal(sharingPercentages[2].percentBips as any, percentages[2].toString());

      const inflationReceivers2: string[] = [(await MockContract.new()).address, (await MockContract.new()).address];
      const percentages2: BN[] = [BN(5000), BN(5000)];
      // Act
      await inflationAllocation.setSharingPercentages(inflationReceivers2, percentages2);
      // Assert
      const sharingPercentages2 = await inflationAllocation.getSharingPercentages();
      assert.equal(sharingPercentages2.length, 2);
      assert.equal(sharingPercentages2[0].inflationReceiver, inflationReceivers2[0]);
      assert.equal(sharingPercentages2[0].percentBips as any, percentages2[0].toString());
      assert.equal(sharingPercentages2[1].inflationReceiver, inflationReceivers2[1]);
      assert.equal(sharingPercentages2[1].percentBips as any, percentages2[1].toString());
    });

    it("Should update a inflation receiver contract", async () => {
      // Assemble
      // Shim up mock
      const mockContractToReceiveInflation = await MockContract.new();
      const newMockContractToReceiveInflation = await MockContract.new();
      const getContractName = web3.utils.sha3("getContractName()")!.slice(0, 10); // first 4 bytes is function selector
      const getContractNameReturn = web3.eth.abi.encodeParameter('string', 'SOME_CONTRACT_NAME');
      await mockContractToReceiveInflation.givenMethodReturn(getContractName, getContractNameReturn);

      // Register mock
      const inflationReceivers: string[] = [mockContractToReceiveInflation.address];
      const percentages: BN[] = [BN(10000)];
      await inflationAllocation.setSharingPercentages(inflationReceivers, percentages);

      // Act
      await inflationAllocation.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION, "SOME_CONTRACT_NAME"]),
        [ADDRESS_UPDATER, accounts[0], newMockContractToReceiveInflation.address], {from: ADDRESS_UPDATER});
      // Assert
      const sharingPercentages = await inflationAllocation.getSharingPercentages();
      assert.equal(sharingPercentages.length, 1);
      assert.equal(sharingPercentages[0].inflationReceiver, newMockContractToReceiveInflation.address);
      assert.equal(sharingPercentages[0].percentBips as any, percentages[0].toString());
    });

    it("Should not set sharing percentages if any sharing percentage > 100%", async() => {
      // Assemble
      const inflationReceivers: string[] = [(await MockContract.new()).address, (await MockContract.new()).address];
      const percentages: BN[] = [BN(1000), BN(11000)];
      // Act
      const promise = inflationAllocation.setSharingPercentages(inflationReceivers, percentages);
      // Assert
      await expectRevert(promise, ERR_HIGH_SHARING_PERCENTAGE);
    });

    it("Should not set sharing percentages if array lengths do not match", async() => {
      // Assemble
      const inflationReceivers: string[] = [(await MockContract.new()).address, (await MockContract.new()).address];
      const percentages: BN[] = [BN(8000), BN(1000), BN(1000)];
      // Act
      const promise = inflationAllocation.setSharingPercentages(inflationReceivers, percentages);
      // Assert
      await expectRevert(promise, ERR_LENGTH_MISMATCH);
    });

    it("Should not set sharing percentages if too many", async() => {
      // Assemble
      const inflationReceivers: string[] = [
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
      const promise = inflationAllocation.setSharingPercentages(inflationReceivers, percentages);
      // Assert
      await expectRevert(promise, ERR_TOO_MANY);
    });
  });
});
