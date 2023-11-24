import {
  FlareDaemonMockInstance,
  IncentivePoolReceiverMockInstance,
  MockContractInstance, BokkyPooBahsDateTimeContractInstance,
  IncentivePoolInstance,
  IncentivePoolTreasuryInstance,
  IncentivePoolAllocationInstance
} from "../../../../typechain-truffle";

import { constants, expectRevert, expectEvent, time } from '@openzeppelin/test-helpers';
import { encodeContractNames, toBN } from "../../../utils/test-helpers";
import { Contracts } from "../../../../deployment/scripts/Contracts";
import { GOVERNANCE_GENESIS_ADDRESS } from "../../../utils/constants";
const getTestFile = require('../../../utils/constants').getTestFile;

const IncentivePool = artifacts.require("IncentivePool");
const IncentivePoolTreasury = artifacts.require("IncentivePoolTreasury");
const MockContract = artifacts.require("MockContract");
const IncentivePoolAllocationMock = artifacts.require("IncentivePoolAllocationMock");
const IncentivePoolReceiverMock = artifacts.require("IncentivePoolReceiverMock");
const FlareDaemonMock = artifacts.require("FlareDaemonMock");
const SuicidalMock = artifacts.require("SuicidalMock");
const IncentivePoolAllocation = artifacts.require("IncentivePoolAllocation");

// This library has a lot of unit tests, so it seems, that we should be able to use it for
// timestamp conversion
const DateTimeContract = artifacts.require("BokkyPooBahsDateTimeContract");

const ERR_TOPUP_LOW = "topup low";
const ONLY_GOVERNANCE_MSG = "only governance";
const ERR_IS_ZERO = "address is 0";
const ERR_TREASURY_ONLY = "treasury only";
const ERR_NO_TIME_SLOT = "no time slot";

const INCENTIVEAUTHORIZED_EVENT = "IncentiveAuthorized";
const TIME_SLOT_INITIALIZED_EVENT = "NewTimeSlotInitialized";
const TOPUPREQUESTED_EVENT = "TopupRequested";
const REWARDSERVICETOPUPCOMPUTED_EVENT = "IncentivePoolRewardServiceTopupComputed";
const IncentivePoolRewardServiceDailyAuthorizedIncentiveComputed_EVENT = "IncentivePoolRewardServiceDailyAuthorizedIncentiveComputed";
const SUPPLYSET_EVENT = "SupplySet";

const REWARDSERVICETOPUPREQUESTRECEIVED_EVENT = "IncentivePoolRewardServiceTopupRequestReceived";
const DAY = 60 * 60 * 24;

enum TopupType { FACTOROFDAILYAUTHORIZED, ALLAUTHORIZED }

const DEFAULT_TOPUP_FACTOR_X100 = 120;

const BN = web3.utils.toBN;
const getExpectedBalance = web3.utils.sha3("getExpectedBalance()")!.slice(0, 10); // first 4 bytes is function selector

contract(`IncentivePool.sol; ${getTestFile(__filename)}; Incentive pool unit tests`, async accounts => {
  const ADDRESS_UPDATER = accounts[16];
  // contains a fresh contract for each test
  let mockSupply: MockContractInstance;

  let mockIncentivePoolAllocation: MockContractInstance;

  let incentivePool: IncentivePoolInstance;
  let incentivePoolTreasury: IncentivePoolTreasuryInstance;
  let incentivePoolAllocation: IncentivePoolAllocationInstance;

  let mockIncentivePoolReceiverInstance: IncentivePoolReceiverMockInstance;
  let mockFlareDaemon: FlareDaemonMockInstance;
  let startTs: BN;
  let dateTimeContract: BokkyPooBahsDateTimeContractInstance;
  const supply = 1000000;
  const incentiveBips = 1000;
  const incentiveFactor = incentiveBips / 10000;
  const incentiveForTimeSlot = Math.floor(supply * incentiveFactor / 12);

  function isLeapYear(year: number) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  }

  async function timestampToDate(timestamp: BN): Promise<[year: number, month: number, day: number]> {
    const { 0: year, 1: month, 2: day } = await dateTimeContract.timestampToDate(timestamp);
    return [year.toNumber(), month.toNumber(), day.toNumber()];
  }

  /**
   * Return first timestamp after `timestamp` that has the given month and day
   * and for which the year is of type `yearType`.
   * @returns a timestamp for calculated date
   */
  async function firstDateLike(timestamp: BN, yearType: 'leap' | 'before_leap' | 'ordinary' | null, month: number, day: number): Promise<BN> {
    let [year, cmonth, cday] = await timestampToDate(timestamp);
    // advance year if month,day is before or equal to current date
    if (cmonth > month || (cmonth === month && cday >= day)) ++year;
    // adjust for leap year
    if (yearType !== null) {
      const yearsToLeapYearDict = { leap: 0, before_leap: 1, ordinary: 2 };
      const yearsToLeapYear = yearsToLeapYearDict[yearType];
      while (!isLeapYear(year + yearsToLeapYear)) ++year;
    }
    // convert back to timestamp
    // console.log(`Test date: ${year}-${month}-${day}`);
    return await dateTimeContract.timestampFromDate(year, month, day);
  }

  before(async () => {
    dateTimeContract = await DateTimeContract.new();
    // Assemble
    await time.advanceBlock();
    const nowTs = await time.latest() as BN;
    // a year yyyy-01-01 in the the future, that is not leap year
    const timestampTest = await firstDateLike(nowTs, 'ordinary', 1, 1);
    // Make sure the current blockchain time is before timestampTest
    // this should always pass
    assert.isAtLeast(timestampTest.toNumber(), nowTs.toNumber(), "Too many tests before this test, increase the starting time");
    // Act
    await time.increaseTo(timestampTest);
  });

  beforeEach(async () => {
    mockSupply = await MockContract.new();
    mockIncentivePoolAllocation = await MockContract.new();
    mockIncentivePoolReceiverInstance = await IncentivePoolReceiverMock.new(ADDRESS_UPDATER);

    mockFlareDaemon = await FlareDaemonMock.new();
    // Force a block in order to get most up to date time
    await time.advanceBlock();
    // Get the timestamp for the just mined block
    startTs = await time.latest();

    const getInflatableBalance = web3.utils.sha3("getInflatableBalance()")!.slice(0, 10); // first 4 bytes is function selector
    const getTimeSlotPercentageBips = web3.utils.sha3("getTimeSlotPercentageBips()")!.slice(0, 10);
    await mockSupply.givenMethodReturnUint(getInflatableBalance, supply);
    await mockIncentivePoolAllocation.givenMethodReturnUint(getTimeSlotPercentageBips, incentiveBips);

    incentivePoolTreasury = await IncentivePoolTreasury.new(GOVERNANCE_GENESIS_ADDRESS);

    incentivePool = await IncentivePool.new(
      accounts[0],
      mockFlareDaemon.address,
      ADDRESS_UPDATER,
      incentivePoolTreasury.address,
      startTs
    );
    await incentivePoolTreasury.setIncentivePoolContract(incentivePool.address, {from : GOVERNANCE_GENESIS_ADDRESS});

    // Send funds to treasury
    const suicidalMock = await SuicidalMock.new(incentivePoolTreasury.address);
    await web3.eth.sendTransaction({ from: accounts[0], to: suicidalMock.address, value: toBN(supply) });
    await suicidalMock.die();

    incentivePoolAllocation = await IncentivePoolAllocation.new(
      accounts[0],
      ADDRESS_UPDATER,
      [3, 2, 1]
    );

    await mockIncentivePoolReceiverInstance.updateContractAddresses(
			encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INCENTIVE_POOL]),
			[ADDRESS_UPDATER, incentivePool.address], {from: ADDRESS_UPDATER});

    await incentivePoolAllocation.updateContractAddresses(
			encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INCENTIVE_POOL]),
			[ADDRESS_UPDATER, incentivePool.address], {from: ADDRESS_UPDATER});

    await incentivePool.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.SUPPLY, Contracts.INCENTIVE_POOL_ALLOCATION]),
      [ADDRESS_UPDATER, mockSupply.address, mockIncentivePoolAllocation.address], {from: ADDRESS_UPDATER});

    await mockFlareDaemon.registerToDaemonize(incentivePool.address);
  });

  describe("init", async () => {
    it("Should sum recognized incentives", async () => {
      // Assemble
      // Act
      await mockFlareDaemon.trigger();
      // Assert
      const { 3: recognizedIncentive } = await incentivePool.getTotals();
      assert.equal(recognizedIncentive.toNumber(), incentiveForTimeSlot);
    });

    it("Should revert sending founds if not treasury contract", async () => {
      // Assemble
      // Act
      const res = web3.eth.sendTransaction({ from: accounts[0], to: incentivePool.address, value: 500 });
      // Assert
      await expectRevert(res, ERR_TREASURY_ONLY)
    });

    it("Should initialize the time slot", async () => {
      // Assemble
      // Assume blockchain start time is 1/1 (not a leap year)
      // Act
      const response = await mockFlareDaemon.trigger();
      const nowTs = await time.latest() as BN;
      const newTimeSlot = await incentivePool.getCurrentTimeSlot();

      // Assert
      const {
        0: recognizedIncentive,
        1: startTimeStamp,
        2: endTimeStamp } = await incentivePool.getCurrentTimeSlot() as any;

      assert.equal(startTimeStamp, nowTs.toNumber());
      assert.equal(endTimeStamp, nowTs.addn((30 * 86400) - 1).toNumber());
      assert.equal(recognizedIncentive, incentiveForTimeSlot);

      await expectEvent.inTransaction(response.tx, incentivePool, TIME_SLOT_INITIALIZED_EVENT, {
        startTimeStamp: newTimeSlot.startTimeStamp,
        endTimeStamp: newTimeSlot.endTimeStamp,
        inflatableSupplyWei: toBN(supply),
        recognizedIncentiveWei: newTimeSlot.recognizedIncentiveWei
      });
    });
  });

  describe("recognize", async () => {
    it("Should recognize new time slot when time slot rolls over", async () => {
      // Assume blockchain start time is 1/1 (not a leap year)
      // next year is also not a leap year...
      // Assemble
      await expectRevert(incentivePool.getTimeSlot(0), ERR_NO_TIME_SLOT);
      await expectRevert(incentivePool.getCurrentTimeSlot(), ERR_NO_TIME_SLOT);
      await expectRevert(incentivePool.getCurrentTimeSlotId(), ERR_NO_TIME_SLOT);
      await mockFlareDaemon.trigger();
      const firstTimeSlot = await incentivePool.getCurrentTimeSlot();
      const nowTs = await time.latest() as BN;
      // A month passes...
      await time.increaseTo(nowTs.addn((30 * 86400)));
      // Act
      const response = await mockFlareDaemon.trigger();
      const newTimeSlot = await incentivePool.getCurrentTimeSlot();
      const newTimeSlotId = await incentivePool.getCurrentTimeSlotId();
      const timeSlot = await incentivePool.getTimeSlot(newTimeSlotId);
      // Assert
      assert.equal(newTimeSlotId.toNumber(), 1);
      assert.isTrue(toBN(firstTimeSlot.endTimeStamp).lt(toBN(newTimeSlot.startTimeStamp)));
      assert.equal(newTimeSlot.startTimeStamp.toString(), timeSlot.startTimeStamp.toString());
      const { 3: recognizedIncentive } = await incentivePool.getTotals();
      // We should have twice the recognized incentive accumulated...
      assert.equal(recognizedIncentive.toNumber(), incentiveForTimeSlot * 2);

      await expectEvent.inTransaction(response.tx, incentivePool, TIME_SLOT_INITIALIZED_EVENT, {
        startTimeStamp: newTimeSlot.startTimeStamp,
        endTimeStamp: newTimeSlot.endTimeStamp,
        inflatableSupplyWei: toBN(supply),
        recognizedIncentiveWei: newTimeSlot.recognizedIncentiveWei
      });
    });
  });

  describe("time slot lengths", async () => {
    it("Test firstDateLike calculation", async () => {
      async function equalDate(timestamp: BN, [year, month, day]: [number, number, number]) {
        const datets = await dateTimeContract.timestampFromDate(year, month, day);
        assert.equal(timestamp.toNumber(), datets.toNumber());
      }
      {
        const current = await dateTimeContract.timestampFromDate(2020, 1, 8);
        await equalDate(await firstDateLike(current, null, 2, 1), [2020, 2, 1]);
        await equalDate(await firstDateLike(current, 'leap', 2, 1), [2020, 2, 1]);
        await equalDate(await firstDateLike(current, 'before_leap', 2, 1), [2023, 2, 1]);
        await equalDate(await firstDateLike(current, 'ordinary', 2, 1), [2022, 2, 1]);
      }
      {
        const current = await dateTimeContract.timestampFromDate(2022, 5, 1);
        await equalDate(await firstDateLike(current, null, 2, 1), [2023, 2, 1]);
        await equalDate(await firstDateLike(current, 'leap', 2, 1), [2024, 2, 1]);
        await equalDate(await firstDateLike(current, 'before_leap', 2, 1), [2023, 2, 1]);
        await equalDate(await firstDateLike(current, 'ordinary', 2, 1), [2026, 2, 1]);
      }
      {
        const current = await dateTimeContract.timestampFromDate(2021, 2, 1);
        await equalDate(await firstDateLike(current, null, 2, 1), [2022, 2, 1]);
      }
    });

    it("Counting time slot length", async () => {
      // Assemble
      await time.advanceBlock();
      const nowTs = await time.latest() as BN;
      // a year yyyy-02-01 in the the future, that is not leap year
      const timestampTest = await firstDateLike(nowTs, 'ordinary', 2, 1);
      // Make sure the current blockchain time is before timestampTest
      // this should always pass
      assert.isAtLeast(timestampTest.toNumber(), nowTs.toNumber(), "Too many tests before this test, increase the starting time");
      // Act
      await time.increaseTo(timestampTest);
      await mockFlareDaemon.trigger();
      const {
        1: startTimeStamp,
        2: endTimeStamp } = await incentivePool.getCurrentTimeSlot() as any;
      // Assert
      // Check that start and end timestamp are actually 30 days appart -1 sec as designed
      assert.equal(endTimeStamp - startTimeStamp, 30 * 24 * 60 * 60 - 1);
    });

    it("Counting time slot length starting from date not in leap year " +
      "but after march one year before leap year", async () => {
        // Assemble
        await time.advanceBlock();
        const nowTs = await time.latest() as BN;
        // a year yyyy-06-30 in the the future, that has 1 years to leap year
        const timestampTest = await firstDateLike(nowTs, 'before_leap', 6, 30);
        // Act
        await time.increaseTo(timestampTest);
        await mockFlareDaemon.trigger();
        const {
          1: startTimeStamp,
          2: endTimeStamp } = await incentivePool.getCurrentTimeSlot() as any;
        // Assert
        assert.equal(endTimeStamp - startTimeStamp, 30 * 24 * 60 * 60 - 1);
      });

    it("Counting time slot length starting on 28/2 not in leap year " +
      "but one year before leap year", async () => {
        // Assemble
        await time.advanceBlock();
        const nowTs = await time.latest() as BN;
        // a year yyyy-02-28 in the the future, that has 1 year to leap year
        const timestampTest = await firstDateLike(nowTs, 'before_leap', 2, 28);
        // Act
        await time.increaseTo(timestampTest);
        await mockFlareDaemon.trigger();
        const {
          1: startTimeStamp,
          2: endTimeStamp } = await incentivePool.getCurrentTimeSlot() as any;
        // Assert
        assert.equal(endTimeStamp - startTimeStamp, 30 * 24 * 60 * 60 - 1);
      });

    it("Counting time slot length starting from date in leap year " +
      "but after 29/2 in a leap year", async () => {
        // Assemble
        await time.advanceBlock();
        const nowTs = await time.latest() as BN;
        // a year yyyy-06-30 in the the future, that is a leap year
        const timestampTest = await firstDateLike(nowTs, 'leap', 6, 30);
        // Act
        await time.increaseTo(timestampTest);
        await mockFlareDaemon.trigger();
        const {
          1: startTimeStamp,
          2: endTimeStamp } = await incentivePool.getCurrentTimeSlot() as any;
        // Assert
        assert.equal(endTimeStamp - startTimeStamp, 30 * 24 * 60 * 60 - 1);
      });

    it("Counting time slot length starting on 29/2 in a leap year", async () => {
      // Assemble
      await time.advanceBlock();
      const nowTs = await time.latest() as BN;
      // a year yyyy-02-29 in the the future, that is a leap year
      const timestampTest = await firstDateLike(nowTs, 'leap', 2, 29);
      // Act
      await time.increaseTo(timestampTest);
      await mockFlareDaemon.trigger();
      const {
        1: startTimeStamp,
        2: endTimeStamp } = await incentivePool.getCurrentTimeSlot() as any;
      // Assert
      assert.equal(endTimeStamp - startTimeStamp, 30 * 24 * 60 * 60 - 1);
    });
  });

  describe("authorize", async () => {
    it("Should not authorize incentives if no sharing percentages", async () => {
      // Assemble
      // Act
      await mockFlareDaemon.trigger();
      // Assert
      const { 0: authorizedIncentive } = await incentivePool.getTotals();
      assert.equal(authorizedIncentive.toNumber(), 0);
    });

    it("Should authorize incentive - first cycle, 1 sharing percentage", async () => {
      // Assemble
      // Set up one sharing percentage
      const sharingPercentages = [];
      const incentiveReceiver = await MockContract.new();
      sharingPercentages[0] = { incentivePoolReceiver: incentiveReceiver.address, percentBips: 10000 };
      const percentageProviderMock = await IncentivePoolAllocationMock.new(sharingPercentages, incentiveBips);
      await incentivePool.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.SUPPLY, Contracts.INCENTIVE_POOL_ALLOCATION]),
        [ADDRESS_UPDATER, mockSupply.address, percentageProviderMock.address], {from: ADDRESS_UPDATER});
      // Act
      const response = await mockFlareDaemon.trigger();
      // Assert
      const expectedAuthorizedIncentive = Math.floor(incentiveForTimeSlot / 30);
      const { 0: actualAuthorizedIncentive } = await incentivePool.getTotals();
      assert.equal(actualAuthorizedIncentive.toNumber(), expectedAuthorizedIncentive);
      await expectEvent.inTransaction(response.tx, incentivePool, INCENTIVEAUTHORIZED_EVENT, { amountWei: expectedAuthorizedIncentive.toString() });
      await expectEvent.inTransaction(response.tx, incentivePool, IncentivePoolRewardServiceDailyAuthorizedIncentiveComputed_EVENT, { incentivePoolReceiver: incentiveReceiver.address, amountWei: expectedAuthorizedIncentive.toString() });
    });

    it("Should authorize incentive - first cycle, 2 sharing percentages", async () => {
      // Assemble
      // Set up two sharing percentages
      const sharingPercentages = [];
      sharingPercentages[0] = { incentivePoolReceiver: (await MockContract.new()).address, percentBips: 3000 };
      sharingPercentages[1] = { incentivePoolReceiver: (await MockContract.new()).address, percentBips: 7000 };
      const percentageProviderMock = await IncentivePoolAllocationMock.new(sharingPercentages, incentiveBips);
      await incentivePool.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.SUPPLY, Contracts.INCENTIVE_POOL_ALLOCATION]),
        [ADDRESS_UPDATER, mockSupply.address, percentageProviderMock.address], {from: ADDRESS_UPDATER});
      // Act
      await mockFlareDaemon.trigger();
      // Assert
      const expectedAuthorizedIncentive = Math.floor(incentiveForTimeSlot / 30);
      const { 0: actualAuthorizedIncentive } = await incentivePool.getTotals();
      // Check authorized incentive across time slots (only 1 time slot tho)
      assert.equal(actualAuthorizedIncentive.toNumber(), expectedAuthorizedIncentive);
      const incentivePoolRewardServices = await incentivePool.getRewardServices() as any;
      // Check authorized incentive for first reward service
      assert.equal(incentivePoolRewardServices[0].authorizedIncentiveWei, Math.floor(expectedAuthorizedIncentive * 0.3));
      // Check authorized incentive for the second reward service
      assert.equal(incentivePoolRewardServices[1].authorizedIncentiveWei, expectedAuthorizedIncentive - Math.floor(expectedAuthorizedIncentive * 0.3));
    });

    it("Should authorize incentive - first cycle, 3 sharing percentages", async () => {
      // Assemble
      // Set up three sharing percentages
      const sharingPercentages = [];
      sharingPercentages[0] = { incentivePoolReceiver: (await MockContract.new()).address, percentBips: 3333 };
      sharingPercentages[1] = { incentivePoolReceiver: (await MockContract.new()).address, percentBips: 3334 };
      sharingPercentages[2] = { incentivePoolReceiver: (await MockContract.new()).address, percentBips: 3333 };
      const percentageProviderMock = await IncentivePoolAllocationMock.new(sharingPercentages, incentiveBips);
      await incentivePool.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.SUPPLY, Contracts.INCENTIVE_POOL_ALLOCATION]),
        [ADDRESS_UPDATER, mockSupply.address, percentageProviderMock.address], {from: ADDRESS_UPDATER});
      // Act
      await mockFlareDaemon.trigger();
      // Assert
      const expectedAuthorizedIncentive = Math.floor(incentiveForTimeSlot / 30);
      const { 0: actualAuthorizedIncentive } = await incentivePool.getTotals();
      // Check authorized incentive across time slots (only 1 time slot tho)
      assert.equal(actualAuthorizedIncentive.toNumber(), expectedAuthorizedIncentive);
      const incentivePoolRewardServices = await incentivePool.getRewardServices() as any;
      // Check authorized incentive for first reward service
      assert.equal(incentivePoolRewardServices[0].authorizedIncentiveWei, Math.floor(expectedAuthorizedIncentive * 0.3333));
      // Check authorized incentive for second reward service
      assert.equal(incentivePoolRewardServices[1].authorizedIncentiveWei, Math.floor(expectedAuthorizedIncentive * 0.3334));
      // Check authorized incentive for the third reward service
      assert.equal(incentivePoolRewardServices[2].authorizedIncentiveWei, expectedAuthorizedIncentive - Math.floor(expectedAuthorizedIncentive * 0.3334) - Math.floor(expectedAuthorizedIncentive * 0.3333));
    });

    it("Should authorize incentive - second cycle, 2 sharing percentages", async () => {
      // Assemble
      // Set up two sharing percentages
      const sharingPercentages = [];
      sharingPercentages[0] = { incentivePoolReceiver: (await MockContract.new()).address, percentBips: 3000 };
      sharingPercentages[1] = { incentivePoolReceiver: (await MockContract.new()).address, percentBips: 7000 };
      const percentageProviderMock = await IncentivePoolAllocationMock.new(sharingPercentages, incentiveBips);
      await incentivePool.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.SUPPLY, Contracts.INCENTIVE_POOL_ALLOCATION]),
        [ADDRESS_UPDATER, mockSupply.address, percentageProviderMock.address], {from: ADDRESS_UPDATER});
      await mockFlareDaemon.trigger();
      const nowTs = await time.latest() as BN;
      // A day passes...
      await time.increaseTo(nowTs.addn(86400));
      // Act
      await mockFlareDaemon.trigger();
      // Assert
      const expectedAuthorizedIncentiveCycle1 = Math.floor(incentiveForTimeSlot / 30);
      const expectedAuthorizedIncentiveCycle2 = Math.floor((incentiveForTimeSlot - expectedAuthorizedIncentiveCycle1) / 29);
      const expectedAuthorizedIncentive = expectedAuthorizedIncentiveCycle1 + expectedAuthorizedIncentiveCycle2;
      const { 0: actualAuthorizedIncentive } = await incentivePool.getTotals();
      // Check authorized incentive across time slots (only 1 time slot tho)
      assert.equal(actualAuthorizedIncentive.toNumber(), expectedAuthorizedIncentive);
      // Compute authorized incentive total for cycle 2, each service
      const expectedAuthorizedIncentiveCycle2Service1 =
        Math.floor(expectedAuthorizedIncentiveCycle1 * 0.3) +
        Math.floor(expectedAuthorizedIncentiveCycle2 * 0.3);
      const expectedAuthorizedIncentiveCycle2Service2 =
        expectedAuthorizedIncentive -
        expectedAuthorizedIncentiveCycle2Service1;
      const incentivePoolRewardServices = await incentivePool.getRewardServices() as any;
      // Check authorized incentive for first reward service
      assert.equal(incentivePoolRewardServices[0].authorizedIncentiveWei, expectedAuthorizedIncentiveCycle2Service1);
      // Check authorized incentive for the second reward service
      assert.equal(incentivePoolRewardServices[1].authorizedIncentiveWei, expectedAuthorizedIncentiveCycle2Service2);
    });

    it("Should authorize incentive on rewarding service contract", async () => {
      // Assemble
      // Set up one sharing percentage
      const sharingPercentages = [];
      const rewardingServiceContract = await MockContract.new();
      sharingPercentages[0] = { incentivePoolReceiver: rewardingServiceContract.address, percentBips: 10000 };
      const percentageProviderMock = await IncentivePoolAllocationMock.new(sharingPercentages, incentiveBips);
      await incentivePool.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.SUPPLY, Contracts.INCENTIVE_POOL_ALLOCATION]),
        [ADDRESS_UPDATER, mockSupply.address, percentageProviderMock.address], {from: ADDRESS_UPDATER});
      // Act
      await mockFlareDaemon.trigger();
      // Assert
      const expectedAuthorizedIncentive = Math.floor(incentiveForTimeSlot / 30);
      const setDailyAuthorizedIncentive = mockIncentivePoolReceiverInstance.contract.methods.setDailyAuthorizedIncentive(expectedAuthorizedIncentive).encodeABI();
      const invocationCount = await rewardingServiceContract.invocationCountForCalldata.call(setDailyAuthorizedIncentive);
      assert.equal(invocationCount.toNumber(), 1);
    });

    it("Should init new time slot even if more than 60 days (2 time slots) has passed since last flare daemon trigger", async () => {
      // Assemble
      await mockFlareDaemon.trigger(); // init first time slot
      expect((await incentivePool.getCurrentTimeSlotId()).toNumber()).to.equals(0);
      // Act
      await time.increase(2 * 30 * 24 * 60 * 60);
      // Assert
      await mockFlareDaemon.trigger(); // no revert - second time slot initialized
      expect((await incentivePool.getCurrentTimeSlotId()).toNumber()).to.equals(1);
    });

    it("Should revert if initialize the new time slot fails", async () => {
      const getTimeSlotPercentageBips = incentivePoolAllocation.contract.methods.getTimeSlotPercentageBips().encodeABI();
      // const getTimeSlotPercentageBips = web3.utils.sha3("getTimeSlotPercentageBips()")!.slice(0, 10);
      await mockIncentivePoolAllocation.givenMethodRevertWithMessage(getTimeSlotPercentageBips, "err");

      await expectRevert(mockFlareDaemon.trigger(), "err");
    });

    it("Should revert for a initialize the new time slot catch statement without a message", async () => {
      const getTimeSlotPercentageBips = incentivePoolAllocation.contract.methods.getTimeSlotPercentageBips().encodeABI();
      // const getTimeSlotPercentageBips = web3.utils.sha3("getTimeSlotPercentageBips()")!.slice(0, 10);
      await mockIncentivePoolAllocation.givenMethodRunOutOfGas(getTimeSlotPercentageBips);

      await expectRevert(mockFlareDaemon.trigger(), "unknown error. getTimeSlotPercentageBips");
    });

  });

  describe("topup", async () => {
    it("Should not topup incentive if no sharing percentages", async () => {
      // Assemble
      // Act
      await mockFlareDaemon.trigger();
      // Assert
      const { 1: topup } = await incentivePool.getTotals();
      assert.equal(topup.toNumber(), 0);
    });

    it("Should require topup factor greater than 1 (x100) if using daily authorized", async () => {
      // Assemble
      // Act
      const setPromise = incentivePool.setTopupConfiguration((await MockContract.new()).address, TopupType.FACTOROFDAILYAUTHORIZED, 100);
      // Require
      await expectRevert(setPromise, ERR_TOPUP_LOW);
    });

    it("Should disregard topup factor if using allauthorized", async () => {
      // Assemble
      // Act
      await incentivePool.setTopupConfiguration((await MockContract.new()).address, TopupType.ALLAUTHORIZED, 100);
      // Require

    });

    it("Should request incentive to topup - first cycle, 2 sharing percentages, by factor type (default)", async () => {
      // Assemble
      // Set up two sharing percentages
      const sharingPercentages = [];
      const incentivePoolReceiver0 = await MockContract.new();
      const incentivePoolReceiver1 = await MockContract.new();
      sharingPercentages[0] = { incentivePoolReceiver: incentivePoolReceiver0.address, percentBips: 3000 };
      sharingPercentages[1] = { incentivePoolReceiver: incentivePoolReceiver1.address, percentBips: 7000 };
      const percentageProviderMock = await IncentivePoolAllocationMock.new(sharingPercentages, incentiveBips);
      await incentivePool.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.SUPPLY, Contracts.INCENTIVE_POOL_ALLOCATION]),
        [ADDRESS_UPDATER, mockSupply.address, percentageProviderMock.address], {from: ADDRESS_UPDATER});
      // Act
      const response = await mockFlareDaemon.trigger();
      // Assert
      const expectedAuthorizedIncentive = Math.floor(incentiveForTimeSlot / 30);
      // This should cap at one days authorization...not the factor
      const expectedTopupService0 = Math.floor(expectedAuthorizedIncentive * 0.3);
      const expectedTopupService1 = expectedAuthorizedIncentive - expectedTopupService0;
      const incentivePoolRewardServices = await incentivePool.getRewardServices() as any;
      // Check topup incentive for first reward service
      assert.equal(incentivePoolRewardServices[0].incentivePoolTopupRequestedWei, expectedTopupService0);
      await expectEvent.inTransaction(response.tx, incentivePool, REWARDSERVICETOPUPCOMPUTED_EVENT, { incentivePoolReceiver: incentivePoolReceiver0.address, amountWei: expectedTopupService0.toString() });
      // Check topup incentive for the second reward service
      assert.equal(incentivePoolRewardServices[1].incentivePoolTopupRequestedWei, expectedTopupService1);
      await expectEvent.inTransaction(response.tx, incentivePool, REWARDSERVICETOPUPCOMPUTED_EVENT, { incentivePoolReceiver: incentivePoolReceiver1.address, amountWei: expectedTopupService1.toString() });
      await expectEvent.inTransaction(response.tx, incentivePool, TOPUPREQUESTED_EVENT, { amountWei: (expectedTopupService0 + expectedTopupService1).toString() });
    });

    it("Should request incentive to topup - second cycle, 2 sharing percentages, by factor type (default)", async () => {
      // Assemble
      // Set up two sharing percentages
      const sharingPercentages = [];
      const receiver1 = await MockContract.new();
      const receiver2 = await MockContract.new();
      sharingPercentages[0] = { incentivePoolReceiver: receiver1.address, percentBips: 3000 };
      sharingPercentages[1] = { incentivePoolReceiver: receiver2.address, percentBips: 7000 };
      const percentageProviderMock = await IncentivePoolAllocationMock.new(sharingPercentages, incentiveBips);
      await incentivePool.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.SUPPLY, Contracts.INCENTIVE_POOL_ALLOCATION]),
        [ADDRESS_UPDATER, mockSupply.address, percentageProviderMock.address], {from: ADDRESS_UPDATER});
      await mockFlareDaemon.trigger();
      const expectedAuthorizedIncentive = Math.floor(incentiveForTimeSlot / 30);
      const expectedTopupService = Math.floor(expectedAuthorizedIncentive * 0.3);
      await receiver1.givenMethodReturnUint(getExpectedBalance, expectedTopupService);
      await receiver2.givenMethodReturnUint(getExpectedBalance, expectedAuthorizedIncentive - expectedTopupService);
      const nowTs = await time.latest() as BN;
      // A day passes...
      await time.increaseTo(nowTs.addn(86400));
      // Act
      await mockFlareDaemon.trigger();
      // Assert
      const expectedAuthorizedIncentiveCycle1 = Math.floor(incentiveForTimeSlot / 30);
      const expectedAuthorizedIncentiveCycle2 = Math.floor((incentiveForTimeSlot - expectedAuthorizedIncentiveCycle1) / 29);
      const expectedAuthorizedIncentiveCycle2Service1 = Math.floor(expectedAuthorizedIncentiveCycle2 * 0.3);
      const expectedAuthorizedIncentiveCycle2Service2 = expectedAuthorizedIncentiveCycle2 - expectedAuthorizedIncentiveCycle2Service1;
      const expectedTopupService1 = Math.floor(expectedAuthorizedIncentiveCycle2Service1 * 1.2);
      const expectedTopupService2 = Math.floor(expectedAuthorizedIncentiveCycle2Service2 * 1.2);
      const incentivePoolRewardServices = await incentivePool.getRewardServices() as any;
      // Check topup incentive for first reward service
      assert.equal(incentivePoolRewardServices[0].incentivePoolTopupRequestedWei, expectedTopupService1);
      // Check topup incentive for the second reward service
      assert.equal(incentivePoolRewardServices[1].incentivePoolTopupRequestedWei, expectedTopupService2);
    });

    it("Should request incentive to topup - second cycle, 2 sharing percentages, by non default factor type", async () => {
      // Assemble
      // Set up two sharing percentages
      const sharingPercentages = [];
      const receiver1 = await MockContract.new();
      const receiver2 = await MockContract.new();
      sharingPercentages[0] = { incentivePoolReceiver: receiver1.address, percentBips: 3000 };
      sharingPercentages[1] = { incentivePoolReceiver: receiver2.address, percentBips: 7000 };
      const percentageProviderMock = await IncentivePoolAllocationMock.new(sharingPercentages, incentiveBips);
      await incentivePool.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.SUPPLY, Contracts.INCENTIVE_POOL_ALLOCATION]),
        [ADDRESS_UPDATER, mockSupply.address, percentageProviderMock.address], {from: ADDRESS_UPDATER});
      await incentivePool.setTopupConfiguration(receiver1.address, TopupType.FACTOROFDAILYAUTHORIZED, 120);
      await incentivePool.setTopupConfiguration(receiver2.address, TopupType.FACTOROFDAILYAUTHORIZED, 110);
      await mockFlareDaemon.trigger();
      const expectedAuthorizedIncentive = Math.floor(incentiveForTimeSlot / 30);
      const expectedTopupService = Math.floor(expectedAuthorizedIncentive * 0.3);
      await receiver1.givenMethodReturnUint(getExpectedBalance, expectedTopupService);
      await receiver2.givenMethodReturnUint(getExpectedBalance, expectedAuthorizedIncentive - expectedTopupService);
      const nowTs = await time.latest() as BN;
      // A day passes...
      await time.increaseTo(nowTs.addn(86400));
      // Act
      await mockFlareDaemon.trigger();
      // Assert
      const expectedAuthorizedIncentiveCycle1 = Math.floor(incentiveForTimeSlot / 30);
      const expectedAuthorizedIncentiveCycle2 = Math.floor((incentiveForTimeSlot - expectedAuthorizedIncentiveCycle1) / 29);
      const expectedAuthorizedIncentiveCycle2Service1 = Math.floor(expectedAuthorizedIncentiveCycle2 * 0.3);
      const expectedAuthorizedIncentiveCycle2Service2 = expectedAuthorizedIncentiveCycle2 - expectedAuthorizedIncentiveCycle2Service1;
      const expectedTopupService1 = Math.floor(expectedAuthorizedIncentiveCycle2Service1 * 1.2);
      const expectedTopupService2 = Math.floor(expectedAuthorizedIncentiveCycle2Service2 * 1.1);
      const incentivePoolRewardServices = await incentivePool.getRewardServices() as any;
      // Check topup incentive for first reward service
      assert.equal(incentivePoolRewardServices[0].incentivePoolTopupRequestedWei, expectedTopupService1);
      // Check topup incentive for the second reward service
      assert.equal(incentivePoolRewardServices[1].incentivePoolTopupRequestedWei, expectedTopupService2);
    });


    it("Should request incentive to topup - second cycle, 2 sharing percentages, by mixed factor type", async () => {
      // Assemble
      // Set up two sharing percentages
      const sharingPercentages = [];
      const receiver1 = await MockContract.new();
      const receiver2 = await MockContract.new();
      sharingPercentages[0] = { incentivePoolReceiver: receiver1.address, percentBips: 2000 };
      sharingPercentages[1] = { incentivePoolReceiver: receiver2.address, percentBips: 8000 };
      const percentageProviderMock = await IncentivePoolAllocationMock.new(sharingPercentages, incentiveBips);
      await incentivePool.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.SUPPLY, Contracts.INCENTIVE_POOL_ALLOCATION]),
        [ADDRESS_UPDATER, mockSupply.address, percentageProviderMock.address], {from: ADDRESS_UPDATER});
      await incentivePool.setTopupConfiguration(receiver1.address, TopupType.ALLAUTHORIZED, 0);
      await incentivePool.setTopupConfiguration(receiver2.address, TopupType.FACTOROFDAILYAUTHORIZED, 140);
      await mockFlareDaemon.trigger();
      await receiver1.givenMethodRevert(getExpectedBalance);
      await receiver2.givenMethodRunOutOfGas(getExpectedBalance);
      const nowTs = await time.latest() as BN;
      // A day passes...
      await time.increaseTo(nowTs.addn(86400));
      // Act
      await mockFlareDaemon.trigger();
      // Assert
      const expectedAuthorizedIncentiveCycle1 = Math.floor(incentiveForTimeSlot / 30);
      const expectedAuthorizedIncentiveCycle2 = Math.floor((incentiveForTimeSlot - expectedAuthorizedIncentiveCycle1) / 29);
      const expectedAuthorizedIncentiveCycle2Service1 = Math.floor(expectedAuthorizedIncentiveCycle2 * 2000 / 10000);
      const expectedAuthorizedIncentiveCycle2Service2 = expectedAuthorizedIncentiveCycle2 - expectedAuthorizedIncentiveCycle2Service1;
      const expectedTopupService1 = Math.floor(expectedAuthorizedIncentiveCycle2Service1 * 2);
      const expectedTopupService2 = Math.floor(expectedAuthorizedIncentiveCycle2Service2 * 140 / 100);
      const incentivePoolRewardServices = await incentivePool.getRewardServices() as any;
      // Check topup incentive for first reward service
      assert.equal(incentivePoolRewardServices[0].incentivePoolTopupRequestedWei, expectedTopupService1);
      // Check topup incentive for the second reward service
      assert.equal(incentivePoolRewardServices[1].incentivePoolTopupRequestedWei, expectedTopupService2);
    });

    it("Should request incentive to topup - second cycle, 2 sharing percentages, for type all authorized", async () => {
      // Assemble
      // Set up two sharing percentages
      const sharingPercentages = [];
      const serviceReceiver1 = await MockContract.new();
      const serviceReceiver2 = await MockContract.new();
      sharingPercentages[0] = { incentivePoolReceiver: serviceReceiver1.address, percentBips: 3000 };
      sharingPercentages[1] = { incentivePoolReceiver: serviceReceiver2.address, percentBips: 7000 };
      const percentageProviderMock = await IncentivePoolAllocationMock.new(sharingPercentages, incentiveBips);
      await incentivePool.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.SUPPLY, Contracts.INCENTIVE_POOL_ALLOCATION]),
        [ADDRESS_UPDATER, mockSupply.address, percentageProviderMock.address], {from: ADDRESS_UPDATER});
      await incentivePool.setTopupConfiguration(serviceReceiver1.address, TopupType.ALLAUTHORIZED, 0);
      await incentivePool.setTopupConfiguration(serviceReceiver2.address, TopupType.ALLAUTHORIZED, 0);
      await mockFlareDaemon.trigger();
      const nowTs = await time.latest() as BN;
      // A day passes...
      await time.increaseTo(nowTs.addn(86400));
      // Act
      await mockFlareDaemon.trigger();
      // Assert
      const incentivePoolRewardServices = await incentivePool.getRewardServices() as any;
      // Check topup incentive for first reward service
      assert.equal(
        incentivePoolRewardServices[0].incentivePoolTopupRequestedWei,
        incentivePoolRewardServices[0].authorizedIncentiveWei
      );
      // Check topup incentive for the second reward service
      assert.equal(
        incentivePoolRewardServices[1].incentivePoolTopupRequestedWei,
        incentivePoolRewardServices[1].authorizedIncentiveWei
      );
    });

    it("Should not request incentive to topup if receiver has balance (getExpectedBalance method reverts)", async () => {
      // Assemble
      // Set up two sharing percentages
      const sharingPercentages = [];
      const receiver1 = await MockContract.new();
      const receiver2 = await MockContract.new();
      sharingPercentages[0] = { incentivePoolReceiver: receiver1.address, percentBips: 3000 };
      sharingPercentages[1] = { incentivePoolReceiver: receiver2.address, percentBips: 7000 };
      const percentageProviderMock = await IncentivePoolAllocationMock.new(sharingPercentages, incentiveBips);
      await incentivePool.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.SUPPLY, Contracts.INCENTIVE_POOL_ALLOCATION]),
        [ADDRESS_UPDATER, mockSupply.address, percentageProviderMock.address], {from: ADDRESS_UPDATER});
      await mockFlareDaemon.trigger();
      const incentivePoolRewardServices1 = await incentivePool.getRewardServices() as any;
      const expectedAuthorizedIncentive = Math.floor(incentiveForTimeSlot / 30);
      // This should cap at one days authorization...not the factor
      const expectedTopupService0 = Math.floor(expectedAuthorizedIncentive * 0.3);
      const expectedTopupService1 = expectedAuthorizedIncentive - expectedTopupService0;
      // Check topup incentive for first reward service
      assert.equal(incentivePoolRewardServices1[0].incentivePoolTopupRequestedWei, expectedTopupService0);
      // Check topup incentive for the second reward service
      assert.equal(incentivePoolRewardServices1[1].incentivePoolTopupRequestedWei, expectedTopupService1);
      await receiver1.givenMethodRevert(getExpectedBalance);
      await receiver2.givenMethodRevert(getExpectedBalance);
      const nowTs = await time.latest() as BN;
      // A day passes...
      await time.increaseTo(nowTs.addn(86400));
      await web3.eth.sendTransaction({ from: accounts[0], to: receiver1.address, value: toBN(incentiveForTimeSlot) });
      // Act
      await mockFlareDaemon.trigger();
      // Assert
      const expectedAuthorizedIncentiveCycle1 = Math.floor(incentiveForTimeSlot / 30);
      const expectedAuthorizedIncentiveCycle2 = Math.floor((incentiveForTimeSlot - expectedAuthorizedIncentiveCycle1) / 29);
      const expectedAuthorizedIncentiveCycle2Service1 = Math.floor(expectedAuthorizedIncentiveCycle2 * 0.3);
      const expectedAuthorizedIncentiveCycle2Service2 = expectedAuthorizedIncentiveCycle2 - expectedAuthorizedIncentiveCycle2Service1;
      const expectedTopupService2 = Math.floor(expectedAuthorizedIncentiveCycle2Service2 * 1.2);
      const incentivePoolRewardServices2 = await incentivePool.getRewardServices() as any;
      // Check topup incentive for first reward service
      assert.equal(incentivePoolRewardServices2[0].incentivePoolTopupRequestedWei, expectedTopupService0);
      // Check topup incentive for the second reward service
      assert.equal(incentivePoolRewardServices2[1].incentivePoolTopupRequestedWei, expectedTopupService2);
    });

    it("Should request incentive to topup even if receiver has balance (self-destruct funds)", async () => {
      // Assemble
      // Set up two sharing percentages
      const sharingPercentages = [];
      const receiver1 = await MockContract.new();
      const receiver2 = await MockContract.new();
      sharingPercentages[0] = { incentivePoolReceiver: receiver1.address, percentBips: 3000 };
      sharingPercentages[1] = { incentivePoolReceiver: receiver2.address, percentBips: 7000 };
      const percentageProviderMock = await IncentivePoolAllocationMock.new(sharingPercentages, incentiveBips);
      await incentivePool.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.SUPPLY, Contracts.INCENTIVE_POOL_ALLOCATION]),
        [ADDRESS_UPDATER, mockSupply.address, percentageProviderMock.address], {from: ADDRESS_UPDATER});
      await mockFlareDaemon.trigger();
      const incentivePoolRewardServices1 = await incentivePool.getRewardServices() as any;
      const expectedAuthorizedIncentive = Math.floor(incentiveForTimeSlot / 30);
      // This should cap at one days authorization...not the factor
      const expectedTopupService0 = Math.floor(expectedAuthorizedIncentive * 0.3);
      const expectedTopupService1 = expectedAuthorizedIncentive - expectedTopupService0;
      // Check topup incentive for first reward service
      assert.equal(incentivePoolRewardServices1[0].incentivePoolTopupRequestedWei, expectedTopupService0);
      // Check topup incentive for the second reward service
      assert.equal(incentivePoolRewardServices1[1].incentivePoolTopupRequestedWei, expectedTopupService1);
      await receiver1.givenMethodReturnUint(getExpectedBalance, expectedTopupService0);
      await receiver2.givenMethodReturnUint(getExpectedBalance, expectedTopupService1);
      const nowTs = await time.latest() as BN;
      // A day passes...
      await time.increaseTo(nowTs.addn(86400));
      await web3.eth.sendTransaction({ from: accounts[0], to: receiver1.address, value: toBN(incentiveForTimeSlot) });
      // Act
      await mockFlareDaemon.trigger();
      // Assert
      const expectedAuthorizedIncentiveCycle1 = Math.floor(incentiveForTimeSlot / 30);
      const expectedAuthorizedIncentiveCycle2 = Math.floor((incentiveForTimeSlot - expectedAuthorizedIncentiveCycle1) / 29);
      const expectedAuthorizedIncentiveCycle2Service1 = Math.floor(expectedAuthorizedIncentiveCycle2 * 0.3);
      const expectedAuthorizedIncentiveCycle2Service2 = expectedAuthorizedIncentiveCycle2 - expectedAuthorizedIncentiveCycle2Service1;
      const expectedTopupService0_2 = Math.floor(expectedAuthorizedIncentiveCycle2Service1 * 1.2);
      const expectedTopupService1_2 = Math.floor(expectedAuthorizedIncentiveCycle2Service2 * 1.2);
      const incentivePoolRewardServices2 = await incentivePool.getRewardServices() as any;
      // Check topup incentive for first reward service
      assert.equal(incentivePoolRewardServices2[0].incentivePoolTopupRequestedWei, expectedTopupService0_2);
      // Check topup incentive for the second reward service
      assert.equal(incentivePoolRewardServices2[1].incentivePoolTopupRequestedWei, expectedTopupService1_2);
    });

    it("Should not request incentive to topup if stopped", async () => {
      // Assemble
      // Set up two sharing percentages
      const sharingPercentages = [];
      const serviceReceiver1 = await MockContract.new();
      const serviceReceiver2 = await MockContract.new();
      sharingPercentages[0] = { incentivePoolReceiver: serviceReceiver1.address, percentBips: 3000 };
      sharingPercentages[1] = { incentivePoolReceiver: serviceReceiver2.address, percentBips: 7000 };
      const percentageProviderMock = await IncentivePoolAllocationMock.new(sharingPercentages, incentiveBips);
      await incentivePool.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.SUPPLY, Contracts.INCENTIVE_POOL_ALLOCATION]),
        [ADDRESS_UPDATER, mockSupply.address, percentageProviderMock.address], {from: ADDRESS_UPDATER});
      await incentivePool.setTopupConfiguration(serviceReceiver1.address, TopupType.ALLAUTHORIZED, 0);
      await incentivePool.setTopupConfiguration(serviceReceiver2.address, TopupType.ALLAUTHORIZED, 0);
      await mockFlareDaemon.trigger();
      const incentivePoolRewardServices1 = await incentivePool.getRewardServices() as any;
      const expectedAuthorizedIncentive = Math.floor(incentiveForTimeSlot / 30);
      // This should cap at one days authorization...not the factor
      const expectedTopupService0 = Math.floor(expectedAuthorizedIncentive * 0.3);
      const expectedTopupService1 = expectedAuthorizedIncentive - expectedTopupService0;
      // Check topup incentive for first reward service
      assert.equal(incentivePoolRewardServices1[0].incentivePoolTopupRequestedWei, expectedTopupService0);
      // Check topup incentive for the second reward service
      assert.equal(incentivePoolRewardServices1[1].incentivePoolTopupRequestedWei, expectedTopupService1);
      const nowTs = await time.latest() as BN;
      // A day passes...
      await time.increaseTo(nowTs.addn(86400));
      // Act
      await incentivePool.stop();
      await mockFlareDaemon.trigger();
      // Assert
      assert.isTrue(await incentivePool.stopped());
      const incentivePoolRewardServices = await incentivePool.getRewardServices() as any;
      // Check topup incentive for first reward service
      assert.equal(incentivePoolRewardServices[0].incentivePoolTopupRequestedWei, expectedTopupService0);
      // Check topup incentive for the second reward service
      assert.equal(incentivePoolRewardServices1[1].incentivePoolTopupRequestedWei, expectedTopupService1);
      // Check reported locked funds
      const {
        0: lockedFunds, 1: incentivePoolAuthorized, 2: claimed
      } = await incentivePool.getTokenPoolSupplyData()
      const { 2: receivedTopup } = await incentivePool.getTotals();
      assert.equal(receivedTopup.toNumber(), expectedTopupService0 + expectedTopupService1);
      assert.equal(lockedFunds.toString(), receivedTopup.toString());
      assert.equal(incentivePoolAuthorized.toString(), "0");
      assert.equal(claimed.toString(), receivedTopup.toString());
    });

    it("Should revert if topup factor is less than 100 and topup type is FACTOROFDAILYAUTHORIZED", async() => {
      const receiver = await MockContract.new();
      const tx = incentivePool.setTopupConfiguration(receiver.address, TopupType.FACTOROFDAILYAUTHORIZED, 10);
      await expectRevert(tx, ERR_TOPUP_LOW);
    });

    it("Should return next expected incentive topup timestamp", async() => {
      // Incentive was not yet authorized
      let nextExpectedTopup0 = await incentivePool.contract.methods.getNextExpectedTopupTs().call({ from: accounts[0] });
      await incentivePool.getNextExpectedTopupTs();
      expect(nextExpectedTopup0).to.equals(DAY.toString());

      // Authorize incentive
      await mockFlareDaemon.trigger();
      let block = await web3.eth.getBlockNumber();
      let blockTs = (await web3.eth.getBlock(block)).timestamp as number;
      let nextExpectedTopup = await incentivePool.contract.methods.getNextExpectedTopupTs().call({ from: accounts[0] });
      await incentivePool.getNextExpectedTopupTs();
      expect(nextExpectedTopup).to.equals((blockTs + DAY).toString());

      // Only half a day passed. It is not yet a time to authorize new incentive.
      const nowTs = await time.latest() as BN;
      await time.increaseTo(nowTs.addn(0.5 * DAY));
      await mockFlareDaemon.trigger();
      let nextExpectedTopup1 = await incentivePool.contract.methods.getNextExpectedTopupTs().call({ from: accounts[0] });
      await incentivePool.getNextExpectedTopupTs();
      expect(nextExpectedTopup1).to.equals((blockTs + DAY).toString());
    });

  });

  describe("pull funds", async () => {
    it("Should pull funds after a topup request is calculated", async () => {
      // Assemble
      // Set up one sharing percentage
      const sharingPercentages = [];
      const rewardingServiceContract = await MockContract.new();
      sharingPercentages[0] = { incentivePoolReceiver: rewardingServiceContract.address, percentBips: 10000 };
      const percentageProviderMock = await IncentivePoolAllocationMock.new(sharingPercentages, incentiveBips);
      await incentivePool.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.SUPPLY, Contracts.INCENTIVE_POOL_ALLOCATION]),
        [ADDRESS_UPDATER, mockSupply.address, percentageProviderMock.address], {from: ADDRESS_UPDATER});

      const treasuryBalanceBefore = BN(await web3.eth.getBalance(incentivePoolTreasury.address));

      // Act
      await mockFlareDaemon.trigger();
      // Assert
      const expectedRequestedIncentive = Math.floor(incentiveForTimeSlot / 30);
      const treasuryBalanceAfter = BN(await web3.eth.getBalance(incentivePoolTreasury.address));
      assert.equal(treasuryBalanceBefore.sub(treasuryBalanceAfter).toString(), expectedRequestedIncentive.toString());
    });

    it("Should receive toped up incentive - first cycle, 2 sharing percentages, by factor type (default)", async () => {
      // Assemble
      // Set up two sharing percentages
      const sharingPercentages = [];
      const incentiveReceiver0 = await MockContract.new();
      const incentiveReceiver1 = await MockContract.new();
      sharingPercentages[0] = { incentivePoolReceiver: incentiveReceiver0.address, percentBips: 3000 };
      sharingPercentages[1] = { incentivePoolReceiver: incentiveReceiver1.address, percentBips: 7000 };
      const percentageProviderMock = await IncentivePoolAllocationMock.new(sharingPercentages, incentiveBips);
      await incentivePool.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.SUPPLY, Contracts.INCENTIVE_POOL_ALLOCATION]),
        [ADDRESS_UPDATER, mockSupply.address, percentageProviderMock.address], {from: ADDRESS_UPDATER});
      // Prime topup request buckets
      const treasuryBalanceBefore = BN(await web3.eth.getBalance(incentivePoolTreasury.address));
      const response = await mockFlareDaemon.trigger();
      const treasuryBalanceAfter = BN(await web3.eth.getBalance(incentivePoolTreasury.address));
      const { 1: topup } = await incentivePool.getTotals();
      // Act

      // Assert
      const expectedReceivedIncentive = Math.floor(incentiveForTimeSlot / 30);
      // This should cap at one days authorization...not the factor
      const expectedTopupService0 = Math.floor(expectedReceivedIncentive * 0.3);
      const expectedTopupService1 = expectedReceivedIncentive - expectedTopupService0;
      const incentivePoolRewardServices = await incentivePool.getRewardServices() as any;
      // Check topup incentive for first reward service
      assert.equal(incentivePoolRewardServices[0].incentivePoolTopupDistributedWei, expectedTopupService0);
      await expectEvent.inTransaction(response.tx, incentivePool, REWARDSERVICETOPUPREQUESTRECEIVED_EVENT, { incentivePoolReceiver: incentiveReceiver0.address, amountWei: expectedTopupService0.toString() });
      // Check topup incentive for the second reward service
      assert.equal(incentivePoolRewardServices[1].incentivePoolTopupDistributedWei, expectedTopupService1);
      await expectEvent.inTransaction(response.tx, incentivePool, REWARDSERVICETOPUPREQUESTRECEIVED_EVENT, { incentivePoolReceiver: incentiveReceiver1.address, amountWei: expectedTopupService1.toString() });

      // Running sum should be correct
      const { 2: receivedTopup } = await incentivePool.getTotals();
      assert.equal(receivedTopup.toNumber(), expectedTopupService0 + expectedTopupService1);

      // Check that the treasury balance is correct
      assert.equal(treasuryBalanceBefore.sub(treasuryBalanceAfter).toString(), topup.toString());
    });

    it("Should request and receive reduced topup - max pull limit", async () => {
      // Assemble
      const supply = (await incentivePoolTreasury.maxPullRequestWei()).muln(120 * 30);
      const incentiveForTimeSlot = supply.muln(incentiveBips).divn(10000 * 12);
      const maxPullLimit = await incentivePoolTreasury.maxPullRequestWei();
      assert.equal(maxPullLimit.toString(), incentiveForTimeSlot.divn(30).toString());
      const getInflatableBalance = web3.utils.sha3("getInflatableBalance()")!.slice(0, 10); // first 4 bytes is function selector
      const getTimeSlotPercentageBips = web3.utils.sha3("getTimeSlotPercentageBips()")!.slice(0, 10);
      await mockSupply.givenMethodReturnUint(getInflatableBalance, supply);
      await mockIncentivePoolAllocation.givenMethodReturnUint(getTimeSlotPercentageBips, incentiveBips);
      const suicidalMock = await SuicidalMock.new(incentivePoolTreasury.address);
      await web3.eth.sendTransaction({ from: accounts[0], to: suicidalMock.address, value: supply });
      await suicidalMock.die();
      // Set up two sharing percentages
      const sharingPercentages = [];
      const incentivePoolReceiver0 = await MockContract.new();
      const incentivePoolReceiver1 = await MockContract.new();
      sharingPercentages[0] = { incentivePoolReceiver: incentivePoolReceiver0.address, percentBips: 3000 };
      sharingPercentages[1] = { incentivePoolReceiver: incentivePoolReceiver1.address, percentBips: 7000 };
      const percentageProviderMock = await IncentivePoolAllocationMock.new(sharingPercentages, incentiveBips);
      await incentivePool.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.SUPPLY, Contracts.INCENTIVE_POOL_ALLOCATION]),
        [ADDRESS_UPDATER, mockSupply.address, percentageProviderMock.address], {from: ADDRESS_UPDATER});
      // Prime topup request buckets
      const response = await mockFlareDaemon.trigger();
      // Assert
      const expectedReceivedIncentive = incentiveForTimeSlot.divn(30);
      // This should cap at one days authorization...not the factor
      const expectedTopupService0 = expectedReceivedIncentive.muln(30).divn(100);
      const expectedTopupService1 = expectedReceivedIncentive.sub(expectedTopupService0);
      const rewardServicesState = await incentivePool.getRewardServices() as any;
      // Check topup incentivePool for first reward service
      assert.equal(rewardServicesState[0].incentivePoolTopupDistributedWei, expectedTopupService0);
      await expectEvent.inTransaction(response.tx, incentivePool, REWARDSERVICETOPUPREQUESTRECEIVED_EVENT, { incentivePoolReceiver: incentivePoolReceiver0.address, amountWei: expectedTopupService0.toString() });
      // Check topup incentivePool for the second reward service
      assert.equal(rewardServicesState[1].incentivePoolTopupDistributedWei, expectedTopupService1);
      await expectEvent.inTransaction(response.tx, incentivePool, REWARDSERVICETOPUPREQUESTRECEIVED_EVENT, { incentivePoolReceiver: incentivePoolReceiver1.address, amountWei: expectedTopupService1.toString() });
      // Running sum should be correct
      const { 2: receivedTopup } = await incentivePool.getTotals();
      assert.equal(receivedTopup.toString(), expectedTopupService0.add(expectedTopupService1).toString());

      await incentivePoolReceiver0.givenMethodReturnUint(getExpectedBalance, expectedTopupService0);
      await incentivePoolReceiver1.givenMethodReturnUint(getExpectedBalance, expectedTopupService1);
      // second day
      const incentivePoolReceiver2 = await MockContract.new();
      sharingPercentages[0] = { incentivePoolReceiver: incentivePoolReceiver0.address, percentBips: 3000 };
      sharingPercentages[1] = { incentivePoolReceiver: incentivePoolReceiver2.address, percentBips: 7000 };
      const percentageProviderMock2 = await IncentivePoolAllocationMock.new(sharingPercentages, incentiveBips);
      await incentivePool.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.SUPPLY, Contracts.INCENTIVE_POOL_ALLOCATION]),
        [ADDRESS_UPDATER, mockSupply.address, percentageProviderMock2.address], {from: ADDRESS_UPDATER});

      const nowTs = await time.latest() as BN;
      await time.increaseTo(nowTs.addn(86400));
      const response2 = await mockFlareDaemon.trigger();
      const { 1: topup2 } = await incentivePool.getTotals();

      const expectedAuthorizedIncentiveCycle1 = incentiveForTimeSlot.divn(30);
      const expectedAuthorizedIncentiveCycle2 = incentiveForTimeSlot.sub(expectedAuthorizedIncentiveCycle1).divn(29);
      const expectedAuthorizedIncentiveCycle2Service1 = expectedAuthorizedIncentiveCycle2.muln(30).divn(100);
      const expectedAuthorizedIncentiveCycle2Service3 = expectedAuthorizedIncentiveCycle2.sub(expectedAuthorizedIncentiveCycle2Service1);
      const expectedTopupService0_2 = expectedAuthorizedIncentiveCycle2Service1.muln(120).divn(100).sub(expectedTopupService0);
      const expectedTopupService2_2 = expectedAuthorizedIncentiveCycle2Service3;

      // Running sum should be correct
      const { 2: receivedTopup_2 } = await incentivePool.getTotals();
      assert.equal(receivedTopup_2.toString(), expectedTopupService0.add(expectedTopupService1).add(expectedTopupService0_2).add(expectedTopupService2_2).toString());
      const rewardServicesState_2 = await incentivePool.getRewardServices() as any;
      // Check topup incentivePool for first reward service
      assert.equal(rewardServicesState_2[0].incentivePoolTopupDistributedWei, expectedTopupService0.add(expectedTopupService0_2));
      await expectEvent.inTransaction(response2.tx, incentivePool, REWARDSERVICETOPUPREQUESTRECEIVED_EVENT, { incentivePoolReceiver: incentivePoolReceiver0.address, amountWei: expectedTopupService0_2.toString() });
      // Check topup incentivePool for the second reward service
      assert.equal(rewardServicesState_2[1].incentivePoolTopupDistributedWei, expectedTopupService1);
      // Check topup incentivePool for the third reward service
      assert.equal(rewardServicesState_2[2].incentivePoolTopupDistributedWei, expectedTopupService2_2);
      await expectEvent.inTransaction(response2.tx, incentivePool, REWARDSERVICETOPUPREQUESTRECEIVED_EVENT, { incentivePoolReceiver: incentivePoolReceiver2.address, amountWei: expectedTopupService2_2.toString() });

      // Act
      // change topup factor
      await incentivePool.setTopupConfiguration(incentivePoolReceiver0.address, TopupType.ALLAUTHORIZED, 0);
      await incentivePool.setTopupConfiguration(incentivePoolReceiver1.address, TopupType.ALLAUTHORIZED, 0);
      await incentivePool.setTopupConfiguration(incentivePoolReceiver2.address, TopupType.ALLAUTHORIZED, 0);

      // third day
      await time.increaseTo(nowTs.addn(2 * 86400));
      const response3 = await mockFlareDaemon.trigger();
      const { 1: topup3 } = await incentivePool.getTotals();

      // Assert
      assert.equal(topup3.sub(topup2).toString(), maxPullLimit.toString());
      const expectedAuthorizedIncentiveCycle3 = incentiveForTimeSlot.sub(expectedAuthorizedIncentiveCycle1).sub(expectedAuthorizedIncentiveCycle2).divn(28);
      const expectedAuthorizedIncentiveCycle3Service1 = expectedAuthorizedIncentiveCycle3.muln(30).divn(100);
      const expectedAuthorizedIncentiveCycle3Service3 = expectedAuthorizedIncentiveCycle3.sub(expectedAuthorizedIncentiveCycle3Service1);
      // This should cap at max pull
      const calculatedTopup = expectedAuthorizedIncentiveCycle1.add(expectedAuthorizedIncentiveCycle2).add(expectedAuthorizedIncentiveCycle3).sub(receivedTopup_2);
      assert(calculatedTopup.gt(maxPullLimit));
      const calculatedTopupService0_3 = expectedAuthorizedIncentiveCycle3Service1.add(expectedAuthorizedIncentiveCycle2Service1).sub(expectedTopupService0_2);
      const expectedTopupService0_3 = calculatedTopupService0_3.sub(calculatedTopupService0_3.mul(calculatedTopup.sub(maxPullLimit)).div(calculatedTopup).addn(1));
      const expectedTopupService2_3 = maxPullLimit.sub(expectedTopupService0_3);
      const rewardServicesState_3 = await incentivePool.getRewardServices() as any;
      // Check topup incentivePool for first reward service
      assert.equal(rewardServicesState_3[0].incentivePoolTopupDistributedWei, expectedTopupService0_3.add(expectedTopupService0_2).add(expectedTopupService0));
      await expectEvent.inTransaction(response3.tx, incentivePool, IncentivePoolRewardServiceDailyAuthorizedIncentiveComputed_EVENT, { incentivePoolReceiver: incentivePoolReceiver0.address, amountWei: expectedAuthorizedIncentiveCycle3Service1.toString() });
      await expectEvent.inTransaction(response3.tx, incentivePool, REWARDSERVICETOPUPREQUESTRECEIVED_EVENT, { incentivePoolReceiver: incentivePoolReceiver0.address, amountWei: expectedTopupService0_3.toString() });
      // Check topup incentivePool for the second reward service
      assert.equal(rewardServicesState_3[1].incentivePoolTopupDistributedWei, expectedTopupService1);
      await expectEvent.inTransaction(response3.tx, incentivePool, REWARDSERVICETOPUPREQUESTRECEIVED_EVENT, { incentivePoolReceiver: incentivePoolReceiver1.address, amountWei: "0" });
      // Check topup incentivePool for the third reward service
      assert.equal(rewardServicesState_3[2].incentivePoolTopupDistributedWei, expectedTopupService2_3.add(expectedTopupService2_2));
      await expectEvent.inTransaction(response3.tx, incentivePool, IncentivePoolRewardServiceDailyAuthorizedIncentiveComputed_EVENT, { incentivePoolReceiver: incentivePoolReceiver2.address, amountWei: expectedAuthorizedIncentiveCycle3Service3.toString() });
      await expectEvent.inTransaction(response3.tx, incentivePool, REWARDSERVICETOPUPREQUESTRECEIVED_EVENT, { incentivePoolReceiver: incentivePoolReceiver2.address, amountWei: expectedTopupService2_3.toString() });

      // Running sum should be correct
      const { 2: receivedTopup_3 } = await incentivePool.getTotals();
      assert.equal(receivedTopup_3.toString(), expectedTopupService0.add(expectedTopupService1).add(expectedTopupService0_2).add(expectedTopupService2_2).add(expectedTopupService0_3).add(expectedTopupService2_3).toString());
    });

    it("Should receive full topup even if authorized in previous time slot", async () => {
      // Assemble
      // Set up two sharing percentages
      const sharingPercentages = [];
      const incentiveReceiver0 = await MockContract.new();
      const incentiveReceiver1 = await MockContract.new();
      sharingPercentages[0] = { incentivePoolReceiver: incentiveReceiver0.address, percentBips: 3000 };
      sharingPercentages[1] = { incentivePoolReceiver: incentiveReceiver1.address, percentBips: 7000 };
      const percentageProviderMock = await IncentivePoolAllocationMock.new(sharingPercentages, incentiveBips);
      await incentivePool.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.SUPPLY, Contracts.INCENTIVE_POOL_ALLOCATION]),
        [ADDRESS_UPDATER, mockSupply.address, percentageProviderMock.address], {from: ADDRESS_UPDATER});
      // Prime topup request buckets
      const treasuryBalanceBefore = BN(await web3.eth.getBalance(incentivePoolTreasury.address));
      const response = await mockFlareDaemon.trigger();
      const treasuryBalanceAfter = BN(await web3.eth.getBalance(incentivePoolTreasury.address));
      const { 1: topup } = await incentivePool.getTotals();
      // Assert
      // Check that the treasury balance is correct
      const expectedReceivedIncentive = Math.floor(incentiveForTimeSlot / 30);
      assert.equal(expectedReceivedIncentive.toString(), topup.toString());
      assert.equal(treasuryBalanceBefore.sub(treasuryBalanceAfter).toString(), topup.toString());
      // This should cap at one days authorization...not the factor
      const expectedTopupService0 = Math.floor(expectedReceivedIncentive * 0.3);
      const expectedTopupService1 = expectedReceivedIncentive - expectedTopupService0;
      const rewardServicesState = await incentivePool.getRewardServices() as any;
      // Check topup incentive for first reward service
      assert.equal(rewardServicesState[0].incentivePoolTopupDistributedWei, expectedTopupService0);
      await expectEvent.inTransaction(response.tx, incentivePool, REWARDSERVICETOPUPREQUESTRECEIVED_EVENT, { incentivePoolReceiver: incentiveReceiver0.address, amountWei: expectedTopupService0.toString() });
      // Check topup incentive for the second reward service
      assert.equal(rewardServicesState[1].incentivePoolTopupDistributedWei, expectedTopupService1);
      await expectEvent.inTransaction(response.tx, incentivePool, REWARDSERVICETOPUPREQUESTRECEIVED_EVENT, { incentivePoolReceiver: incentiveReceiver1.address, amountWei: expectedTopupService1.toString() });
      // Running sum should be correct
      const { 2: receivedTopup } = await incentivePool.getTotals();
      assert.equal(receivedTopup.toNumber(), expectedTopupService0 + expectedTopupService1);

      await incentiveReceiver0.givenMethodReturnUint(getExpectedBalance, expectedTopupService0);
      await incentiveReceiver1.givenMethodReturnUint(getExpectedBalance, expectedTopupService1);
      // second day
      const nowTs = await time.latest() as BN;
      // A day passes...
      await time.increaseTo(nowTs.addn(86400));
      const response2 = await mockFlareDaemon.trigger();

      const expectedAuthorizedIncentiveCycle1 = Math.floor(incentiveForTimeSlot / 30);
      const expectedAuthorizedIncentiveCycle2 = Math.floor((incentiveForTimeSlot - expectedAuthorizedIncentiveCycle1) / 29);
      const expectedAuthorizedIncentiveCycle2Service1 = Math.floor(expectedAuthorizedIncentiveCycle2 * 0.3);
      const expectedAuthorizedIncentiveCycle2Service2 = expectedAuthorizedIncentiveCycle2 - expectedAuthorizedIncentiveCycle2Service1;
      const expectedTopupService0_2 = Math.floor(expectedAuthorizedIncentiveCycle2Service1 * 1.2) - expectedTopupService0;
      const expectedTopupService1_2 = Math.floor(expectedAuthorizedIncentiveCycle2Service2 * 1.2) - expectedTopupService1;

      // Running sum should be correct
      const { 2: receivedTopup_2 } = await incentivePool.getTotals();
      assert.equal(receivedTopup_2.toNumber(), expectedTopupService0 + expectedTopupService1 + expectedTopupService0_2 + expectedTopupService1_2);
      const rewardServicesState_2 = await incentivePool.getRewardServices() as any;
      // Check topup incentive for first reward service
      assert.equal(rewardServicesState_2[0].incentivePoolTopupDistributedWei, expectedTopupService0 + expectedTopupService0_2);
      await expectEvent.inTransaction(response2.tx, incentivePool, REWARDSERVICETOPUPREQUESTRECEIVED_EVENT, { incentivePoolReceiver: incentiveReceiver0.address, amountWei: expectedTopupService0_2.toString() });
      // Check topup incentive for the second reward service
      assert.equal(rewardServicesState_2[1].incentivePoolTopupDistributedWei, expectedTopupService1 + expectedTopupService1_2);
      await expectEvent.inTransaction(response2.tx, incentivePool, REWARDSERVICETOPUPREQUESTRECEIVED_EVENT, { incentivePoolReceiver: incentiveReceiver1.address, amountWei: expectedTopupService1_2.toString() });

      // Act
      // change topup factor
      await incentivePool.setTopupConfiguration(incentiveReceiver0.address, TopupType.ALLAUTHORIZED, 0);
      await incentivePool.setTopupConfiguration(incentiveReceiver1.address, TopupType.ALLAUTHORIZED, 0);
      // a month passes...
      await time.increaseTo((await incentivePool.getCurrentTimeSlot()).endTimeStamp);
      await time.advanceBlock();
      const response3 = await mockFlareDaemon.trigger();

      // 2 months minus what was already authorized
      const incentiveForTimeSlot2 = Math.floor((supply - expectedAuthorizedIncentiveCycle1 - expectedAuthorizedIncentiveCycle2) * incentiveFactor / 12);
      const expectedAuthorizedIncentive_1 = Math.floor((incentiveForTimeSlot - expectedAuthorizedIncentiveCycle1 - expectedAuthorizedIncentiveCycle2 + incentiveForTimeSlot2) / 30);
      // Assert
      const expectedAuthorizedService0_3 = Math.floor(expectedAuthorizedIncentive_1 * 0.3);
      const expectedAuthorizedService1_3 = expectedAuthorizedIncentive_1 - expectedAuthorizedService0_3;
      // This should cap at all days authorization...not the daily one
      const expectedTopupService0_3 = expectedAuthorizedService0_3 + expectedAuthorizedIncentiveCycle2Service1 - expectedTopupService0_2;
      const expectedTopupService1_3 = expectedAuthorizedService1_3 + expectedAuthorizedIncentiveCycle2Service2 - expectedTopupService1_2;
      const rewardServicesState_3 = await incentivePool.getRewardServices() as any;
      // Check topup incentive for first reward service
      assert.equal(rewardServicesState_3[0].incentivePoolTopupDistributedWei, expectedTopupService0_3 + expectedTopupService0_2 + expectedTopupService0);
      await expectEvent.inTransaction(response3.tx, incentivePool, IncentivePoolRewardServiceDailyAuthorizedIncentiveComputed_EVENT, { incentivePoolReceiver: incentiveReceiver0.address, amountWei: expectedAuthorizedService0_3.toString() });
      await expectEvent.inTransaction(response3.tx, incentivePool, REWARDSERVICETOPUPREQUESTRECEIVED_EVENT, { incentivePoolReceiver: incentiveReceiver0.address, amountWei: expectedTopupService0_3.toString() });
      // Check topup incentive for the second reward service
      assert.equal(rewardServicesState_3[1].incentivePoolTopupDistributedWei, expectedTopupService1_3 + expectedTopupService1_2 + expectedTopupService1);
      await expectEvent.inTransaction(response3.tx, incentivePool, IncentivePoolRewardServiceDailyAuthorizedIncentiveComputed_EVENT, { incentivePoolReceiver: incentiveReceiver1.address, amountWei: expectedAuthorizedService1_3.toString() });
      await expectEvent.inTransaction(response3.tx, incentivePool, REWARDSERVICETOPUPREQUESTRECEIVED_EVENT, { incentivePoolReceiver: incentiveReceiver1.address, amountWei: expectedTopupService1_3.toString() });
      // Running sum should be correct
      const { 2: receivedTopup_3 } = await incentivePool.getTotals();
      assert.equal(receivedTopup_3.toNumber(), expectedTopupService0 + expectedTopupService1 + expectedTopupService0_2 + expectedTopupService1_2 + expectedTopupService0_3 + expectedTopupService1_3);
    });
  });

  describe("funding", async () => {

    it("Should not reward before start time", async () => {
      // Assemble
      // We must create non default incentive pool, since default has rewardEpoch at 0

      await time.advanceBlock();
      const latest = await time.latest();

      incentivePool = await IncentivePool.new(
        accounts[0],
        mockFlareDaemon.address,
        ADDRESS_UPDATER,
        incentivePoolTreasury.address,
        latest.toNumber() + 2 * 86400 // Set time sometime after now, but at least two days to trigger anything if not exiting preemptively
      )

      const tx = await incentivePool.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.SUPPLY, Contracts.INCENTIVE_POOL_ALLOCATION]),
        [ADDRESS_UPDATER, mockSupply.address, mockIncentivePoolAllocation.address], {from: ADDRESS_UPDATER});
      await mockFlareDaemon.registerToDaemonize(incentivePool.address);

      // Act
      await mockFlareDaemon.trigger();
      // Assert
      // It should return directly and not change lastAuthorizationTs
      const lastTs = await incentivePool.lastAuthorizationTs();
      assert.equal(lastTs.toNumber(), 0);
      expectEvent(tx, SUPPLYSET_EVENT, { oldSupply: constants.ZERO_ADDRESS, newSupply: mockSupply.address });
    });

    it("Should fund toped up incentivePool - first cycle, 2 sharing percentages, by factor type (default)", async () => {
      // Assemble
      // Set up two sharing percentages
      const sharingPercentages = [];
      const rewardingServiceContract0 = await IncentivePoolReceiverMock.new(ADDRESS_UPDATER);
      const rewardingServiceContract1 = await IncentivePoolReceiverMock.new(ADDRESS_UPDATER);
      await rewardingServiceContract0.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INCENTIVE_POOL]),
        [ADDRESS_UPDATER, incentivePool.address], {from: ADDRESS_UPDATER});
      await rewardingServiceContract1.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INCENTIVE_POOL]),
        [ADDRESS_UPDATER, incentivePool.address], {from: ADDRESS_UPDATER});
      sharingPercentages[0] = { incentivePoolReceiver: rewardingServiceContract0.address, percentBips: 3000 };
      sharingPercentages[1] = { incentivePoolReceiver: rewardingServiceContract1.address, percentBips: 7000 };
      const percentageProviderMock = await IncentivePoolAllocationMock.new(sharingPercentages, incentiveBips);
      await incentivePool.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.SUPPLY, Contracts.INCENTIVE_POOL_ALLOCATION]),
        [ADDRESS_UPDATER, mockSupply.address, percentageProviderMock.address], {from: ADDRESS_UPDATER});
      // Prime topup request buckets
      await mockFlareDaemon.trigger();
      const { 1: topup } = await incentivePool.getTotals();
      // Act

      // Assert
      const expectedIncentiveFunded = Math.floor(incentiveForTimeSlot / 30);
      // This should cap at one days authorization...not the factor
      const expectedTopupService0 = Math.floor(expectedIncentiveFunded * 0.3);
      const expectedTopupService1 = expectedIncentiveFunded - expectedTopupService0;
      const incentivePoolRewardServices = await incentivePool.getRewardServices() as any;
      // Check topup incentivePool for first reward service
      assert.equal(incentivePoolRewardServices[0].incentivePoolTopupDistributedWei, expectedTopupService0);
      // Check topup incentivePool for the second reward service
      assert.equal(incentivePoolRewardServices[1].incentivePoolTopupDistributedWei, expectedTopupService1);
      // Running sum should be correct
      const { 2: receivedTopup } = await incentivePool.getTotals();
      assert.equal(receivedTopup.toNumber(), expectedTopupService0 + expectedTopupService1);
      // Check that target reward service contracts got the native token they are due
      assert.equal((await web3.eth.getBalance(rewardingServiceContract0.address)), expectedTopupService0.toString());
      assert.equal((await web3.eth.getBalance(rewardingServiceContract1.address)), expectedTopupService1.toString());

      const {
        0: lockedFunds, 1: incentivePoolAuthorized, 2: claimed
      } = await incentivePool.getTokenPoolSupplyData()

      assert.equal(lockedFunds.toString(), BN(supply).toString());
      assert.equal(incentivePoolAuthorized.toString(), "0");
      assert.equal(claimed.toString(), receivedTopup.toString());
    });

    it("Should balance when receiving self-destruct amount between daemonize calls", async () => {
      // Assemble
      // Set up two sharing percentages
      const sharingPercentages = [];
      const rewardingServiceContract0 = await IncentivePoolReceiverMock.new(ADDRESS_UPDATER);
      await rewardingServiceContract0.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INCENTIVE_POOL]),
        [ADDRESS_UPDATER, incentivePool.address], {from: ADDRESS_UPDATER});
      sharingPercentages[0] = { incentivePoolReceiver: rewardingServiceContract0.address, percentBips: 10000 };
      const percentageProviderMock = await IncentivePoolAllocationMock.new(sharingPercentages, incentiveBips);
      await incentivePool.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.SUPPLY, Contracts.INCENTIVE_POOL_ALLOCATION]),
        [ADDRESS_UPDATER, mockSupply.address, percentageProviderMock.address], {from: ADDRESS_UPDATER});
      // Prime topup request buckets
      await mockFlareDaemon.trigger();
      // Act
      // Self destruct with some native
      const suicidalMock = await SuicidalMock.new(incentivePool.address);
      // Give suicidal some native token
      await web3.eth.sendTransaction({ from: accounts[0], to: suicidalMock.address, value: toBN(5) });
      // Attacker dies
      await suicidalMock.die();

      const nowTs = await time.latest() as BN;
      // A day passes...
      await time.increaseTo(nowTs.addn(86400 * 2));

      await mockFlareDaemon.trigger();
    });

    it("Should record timestamp of the block where daemonize started in rewardEpochStartedTs when rewards started", async () => {
      // Assemble
      await incentivePool.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.SUPPLY, Contracts.INCENTIVE_POOL_ALLOCATION]),
        [ADDRESS_UPDATER, mockSupply.address, mockIncentivePoolAllocation.address], {from: ADDRESS_UPDATER});
      await time.advanceBlock();
      const rewardTime = (await time.latest()).addn(86400); // Initiate daemonize some time after the reward start time
      await time.increaseTo(rewardTime);
      // Act
      await mockFlareDaemon.trigger();
      // Assert
      const lastTs = (await incentivePool.rewardEpochStartedTs()).toNumber();

      assert.isTrue(lastTs <= rewardTime.toNumber() + 5 && lastTs >= rewardTime.toNumber()); // CI is SLOW. Allow for some slop.
    });

  });

  describe("helper methods", async () => {
    it("Should get a time slot by index", async () => {
      // Assemble
      await mockFlareDaemon.trigger();
      // Act
      const { recognizedIncentiveWei } = await incentivePool.getTimeSlot(0);
      // Assert
      assert.equal(recognizedIncentiveWei, BN(incentiveForTimeSlot));
    });

    it("Should set IncentivePoolAllocation", async () => {
      // Assemble
      const newMockIncentivePoolAllocation = await MockContract.new();

      // Act
      await incentivePool.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.SUPPLY, Contracts.INCENTIVE_POOL_ALLOCATION]),
        [ADDRESS_UPDATER, mockSupply.address, newMockIncentivePoolAllocation.address], {from: ADDRESS_UPDATER});

      // Assert
      assert.equal((await incentivePool.incentivePoolAllocation()), newMockIncentivePoolAllocation.address);
    });

    it("Should reject IncentivePoolAllocation change if not from address updater", async () => {
      // Assemble
      const newMockIncentivePoolAllocation = await MockContract.new();

      // Act
      const changePromise = incentivePool.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.SUPPLY, Contracts.INCENTIVE_POOL_ALLOCATION]),
        [ADDRESS_UPDATER, mockSupply.address, newMockIncentivePoolAllocation.address], {from: accounts[2]});

      // Assert
      await expectRevert(changePromise, "only address updater");
    });

    it("Should reject IncentivePoolAllocation change with 0 address", async () => {
      // Assemble

      // Act
      const changePromise = incentivePool.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.SUPPLY, Contracts.INCENTIVE_POOL]),
        [ADDRESS_UPDATER, mockSupply.address, constants.ZERO_ADDRESS], {from: ADDRESS_UPDATER});

      // Assert
      await expectRevert(changePromise, "address zero");

    });

    it("Should reject supply change if not from governed", async () => {
      // Assemble
      const newMockSupply = await MockContract.new();

      // Act
      const changePromise = incentivePool.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.SUPPLY]),
        [ADDRESS_UPDATER, newMockSupply.address], {from: accounts[2]});

      // Assert
      await expectRevert(changePromise, "only address updater");
      assert.equal((await incentivePool.supply()), mockSupply.address);
    });

    it("Should reject supply with 0 address", async () => {
      // Assemble

      // Act
      const changePromise = incentivePool.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.SUPPLY]),
        [ADDRESS_UPDATER, constants.ZERO_ADDRESS], {from: ADDRESS_UPDATER});

      // Assert
      await expectRevert(changePromise, "address zero");
      assert.equal((await incentivePool.supply()), mockSupply.address);
    });

    it("Should not allow topup configuration change if not from governance", async () => {
      // Assemble
      // Act
      const setPromise = incentivePool.setTopupConfiguration((await MockContract.new()).address, TopupType.ALLAUTHORIZED, 100, { from: accounts[2] });
      // Require
      await expectRevert(setPromise, ONLY_GOVERNANCE_MSG);
    });

    it("Should not allow calling stop if not from governance", async () => {
      // Assemble
      // Act
      const stopPromise = incentivePool.stop({ from: accounts[2] });
      // Require
      await expectRevert(stopPromise, ONLY_GOVERNANCE_MSG);
    });

    it("Should not allow topup configuration change with 0 address", async () => {
      // Assemble
      // Act
      const setPromise = incentivePool.setTopupConfiguration(constants.ZERO_ADDRESS, TopupType.ALLAUTHORIZED, 100);
      // Require
      await expectRevert(setPromise, ERR_IS_ZERO);
    });

    it("Should set and retrieve topup configuration", async () => {
      // This will be changed in the future to only return values for valid incentive requests
      // Assemble
      const mockContract1 = await MockContract.new();
      const t1Type = TopupType.ALLAUTHORIZED;
      const t1Factor = 0;
      const mockContract2 = await MockContract.new();
      const t2Type = TopupType.ALLAUTHORIZED;
      const t2Factor = 10;
      const t2TypeFinal = TopupType.ALLAUTHORIZED;
      const t2FactorFinal = 300;
      const mockContract3 = await MockContract.new();

      // Act
      await incentivePool.setTopupConfiguration(mockContract1.address, t1Type, t1Factor);
      // Assert
      const t1Result = await incentivePool.getTopupConfiguration(mockContract1.address);
      assert.equal(t1Result.configured, true);
      assert.equal(t1Result.topupType, BN(t1Type));
      assert.equal(t1Result.topupFactorX100, BN(t1Factor));
      // t2 and 3 should be default
      const t2ResultDefault = await incentivePool.getTopupConfiguration(mockContract2.address);
      assert.equal(t2ResultDefault.configured, false);
      assert.equal(t2ResultDefault.topupType, BN(TopupType.FACTOROFDAILYAUTHORIZED));
      assert.equal(t2ResultDefault.topupFactorX100, BN(DEFAULT_TOPUP_FACTOR_X100));

      const t3Result = await incentivePool.getTopupConfiguration(mockContract3.address);
      assert.equal(t3Result.configured, false);
      assert.equal(t3Result.topupType, BN(TopupType.FACTOROFDAILYAUTHORIZED));
      assert.equal(t3Result.topupFactorX100, BN(DEFAULT_TOPUP_FACTOR_X100));

      // Adding another should not change previous
      // Act
      await incentivePool.setTopupConfiguration(mockContract2.address, t2Type, t2Factor);
      const t1Result2 = await incentivePool.getTopupConfiguration(mockContract1.address);
      assert.equal(t1Result2.configured, true);
      assert.equal(t1Result2.topupType, BN(t1Type));
      assert.equal(t1Result2.topupFactorX100, BN(t1Factor));
      const t2Result = await incentivePool.getTopupConfiguration(mockContract2.address);
      assert.equal(t2Result.configured, true);
      assert.equal(t2Result.topupType, BN(t2Type));
      assert.equal(t2Result.topupFactorX100, BN(t2Factor));
      const t3Result2 = await incentivePool.getTopupConfiguration(mockContract3.address);
      assert.equal(t3Result2.configured, false);
      assert.equal(t3Result2.topupType, BN(TopupType.FACTOROFDAILYAUTHORIZED));
      assert.equal(t3Result2.topupFactorX100, BN(DEFAULT_TOPUP_FACTOR_X100));

      // Can update multiple times
      await incentivePool.setTopupConfiguration(mockContract2.address, t2TypeFinal, t2FactorFinal);
      const t1Result3 = await incentivePool.getTopupConfiguration(mockContract1.address);
      assert.equal(t1Result3.configured, true);
      assert.equal(t1Result3.topupType, BN(t1Type));
      assert.equal(t1Result3.topupFactorX100, BN(t1Factor));
      const t2ResultFinal = await incentivePool.getTopupConfiguration(mockContract2.address);
      assert.equal(t2ResultFinal.configured, true);
      assert.equal(t2ResultFinal.topupType, BN(t2TypeFinal));
      assert.equal(t2ResultFinal.topupFactorX100, BN(t2FactorFinal));
      const t3Result3 = await incentivePool.getTopupConfiguration(mockContract3.address);
      assert.equal(t3Result3.configured, false);
      assert.equal(t3Result3.topupType, BN(TopupType.FACTOROFDAILYAUTHORIZED));
      assert.equal(t3Result3.topupFactorX100, BN(DEFAULT_TOPUP_FACTOR_X100));

    });

    it("Should return contract name", async () => {
      expect(await incentivePool.getContractName()).to.equals(Contracts.INCENTIVE_POOL);
    });

  });

  // there is no fallback mode in IncentivePool
  describe("fallback mode", async () => {
    it("Should not switch to fallback mode", async () => {
      let switchTo = await mockFlareDaemon.contract.methods.fallbackTest(incentivePool.address).call();
      let result = switchTo.slice(64, 66); // last byte
      let sw = Boolean(parseInt(result, 16));
      assert(!sw);
    });
  });

});
