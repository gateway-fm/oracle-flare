import {
  FlareDaemonInstance,
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
const FlareDaemon = artifacts.require("FlareDaemon");
const SuicidalMock = artifacts.require("SuicidalMock");
const IncentivePoolAllocation = artifacts.require("IncentivePoolAllocation");

// This library has a lot of unit tests, so it seems, that we should be able to use it for 
// timestamp conversion
const DateTimeContract = artifacts.require("BokkyPooBahsDateTimeContract");

const ERR_TOPUP_LOW = "topup low";
const ERR_TOPUP_HIGH = "topup high";
const ONLY_GOVERNANCE_MSG = "only governance";
const ERR_IS_ZERO = "address is 0";
const ERR_TREASURY_ONLY = "treasury only";

const INCENTIVEAUTHORIZED_EVENT = "IncentiveAuthorized";
const ANNUM_INITIALIZED_EVENT = "NewAnnumInitialized";
const TOPUPREQUESTED_EVENT = "TopupRequested";
const REWARDSERVICETOPUPCOMPUTED_EVENT = "IncentivePoolRewardServiceTopupComputed";
const REWARDSERVICEDAILYAUTHORIZEDINCENTIVECOMPUTED_EVENT = "IncentivePoolRewardServiceDailyAuthorizedIncentiveComputed";
const SUPPLYSET_EVENT = "SupplySet";

const REWARDSERVICETOPUPREQUESTRECEIVED_EVENT = "IncentivePoolRewardServiceTopupRequestReceived";
const DAY = 60 * 60 * 24;

enum TopupType { FACTOROFDAILYAUTHORIZED, ALLAUTHORIZED }

const DEFAULT_TOPUP_FACTOR_X100 = 120;

const BN = web3.utils.toBN;


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
  let mockFlareDaemonInterface: FlareDaemonInstance;
  let startTs: BN;
  let dateTimeContract: BokkyPooBahsDateTimeContractInstance;
  const supply = 1000000;
  const incentiveBips = 1000;
  const incentiveFactor = incentiveBips / 10000;
  const incentiveForAnnum = Math.floor(supply * incentiveFactor / 12);

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
    mockIncentivePoolReceiverInstance = await IncentivePoolReceiverMock.new();

    mockFlareDaemon = await FlareDaemonMock.new();
    mockFlareDaemonInterface = await FlareDaemon.new();
    // Force a block in order to get most up to date time
    await time.advanceBlock();
    // Get the timestamp for the just mined block
    startTs = await time.latest();

    const getInflatableBalance = web3.utils.sha3("getInflatableBalance()")!.slice(0, 10); // first 4 bytes is function selector
    const getAnnualPercentageBips = web3.utils.sha3("getAnnualPercentageBips()")!.slice(0, 10);
    await mockSupply.givenMethodReturnUint(getInflatableBalance, supply);
    await mockIncentivePoolAllocation.givenMethodReturnUint(getAnnualPercentageBips, incentiveBips);

    incentivePoolTreasury = await IncentivePoolTreasury.new()
    await incentivePoolTreasury.initialiseFixedAddress()

    incentivePool = await IncentivePool.new(
      accounts[0],
      mockFlareDaemon.address,
      ADDRESS_UPDATER,
      incentivePoolTreasury.address,
      startTs
    )
    await incentivePoolTreasury.setIncentivePoolContract(incentivePool.address, {from : GOVERNANCE_GENESIS_ADDRESS});

    // Send funds to treasury
    const suicidalMock = await SuicidalMock.new(incentivePoolTreasury.address);
    await web3.eth.sendTransaction({ from: accounts[0], to: suicidalMock.address, value: toBN(supply) });
    await suicidalMock.die();

    incentivePoolAllocation = await IncentivePoolAllocation.new(
      accounts[0],
      ADDRESS_UPDATER,
      [3, 2, 1]
    )

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
      const treasuryBalanceBefore = BN(await web3.eth.getBalance(incentivePoolTreasury.address));
      await mockFlareDaemon.trigger();
      const treasuryBalanceAfter = BN(await web3.eth.getBalance(incentivePoolTreasury.address));
      // Assert
      const { 4: recognizedIncentive } = await incentivePool.getTotals();
      assert.equal(recognizedIncentive.toNumber(), incentiveForAnnum);
    });

    it("Should revert sending founds if not treasury contract", async () => {
      // Assemble
      // Act
      const res = web3.eth.sendTransaction({ from: accounts[0], to: incentivePool.address, value: 500 });
      // Assert
      await expectRevert(res, ERR_TREASURY_ONLY)
    });

    it("Should initialize the annum", async () => {
      // Assemble
      // Assume blockchain start time is 1/1 (not a leap year)
      // Act
      const response = await mockFlareDaemon.trigger();
      const nowTs = await time.latest() as BN;
      const newAnnum = await incentivePool.getCurrentAnnum();

      // Assert
      const {
        0: recognizedIncentive,
        1: startTimeStamp,
        2: endTimeStamp } = await incentivePool.getCurrentAnnum() as any;
      
      assert.equal(startTimeStamp, nowTs.toNumber());
      assert.equal(endTimeStamp, nowTs.addn((30 * 86400) - 1).toNumber());
      assert.equal(recognizedIncentive, incentiveForAnnum);

      await expectEvent.inTransaction(response.tx, incentivePool, ANNUM_INITIALIZED_EVENT, {
        startTimeStamp: newAnnum.startTimeStamp,
        endTimeStamp: newAnnum.endTimeStamp,
        inflatableSupplyWei: toBN(supply),
        recognizedIncentiveWei: newAnnum.recognizedIncentiveWei,
        totalAuthorizedIncentiveWei: newAnnum.incentivePoolRewardServices.totalAuthorizedIncentiveWei,
        totalIncentiveTopupRequestedWei: newAnnum.incentivePoolRewardServices.totalIncentiveTopupRequestedWei,
        totalIncentiveTopupReceivedWei: newAnnum.incentivePoolRewardServices.totalIncentiveTopupReceivedWei,
        totalIncentiveTopupWithdrawnWei: newAnnum.incentivePoolRewardServices.totalIncentiveTopupWithdrawnWei,
      });
    });
  });

  describe("recognize", async () => {
    it("Should recognize new annum when year rolls over", async () => {
      // Assume blockchain start time is 1/1 (not a leap year)
      // next year is also not a leap year...
      // Assemble
      await mockFlareDaemon.trigger();
      const nowTs = await time.latest() as BN;
      // A month passes...
      await time.increaseTo(nowTs.addn((30 * 86400)));
      // Act
      const response = await mockFlareDaemon.trigger();
      const newAnnum = await incentivePool.getCurrentAnnum();
      // Assert
      const { 4: recognizedIncentive } = await incentivePool.getTotals();
      // We should have twice the recognized incentive accumulated...
      assert.equal(recognizedIncentive.toNumber(), incentiveForAnnum * 2);

      await expectEvent.inTransaction(response.tx, incentivePool, ANNUM_INITIALIZED_EVENT, {
        startTimeStamp: newAnnum.startTimeStamp,
        endTimeStamp: newAnnum.endTimeStamp,
        inflatableSupplyWei: toBN(supply),
        recognizedIncentiveWei: newAnnum.recognizedIncentiveWei,
        totalAuthorizedIncentiveWei: newAnnum.incentivePoolRewardServices.totalAuthorizedIncentiveWei,
        totalIncentiveTopupRequestedWei: newAnnum.incentivePoolRewardServices.totalIncentiveTopupRequestedWei,
        totalIncentiveTopupReceivedWei: newAnnum.incentivePoolRewardServices.totalIncentiveTopupReceivedWei,
        totalIncentiveTopupWithdrawnWei: newAnnum.incentivePoolRewardServices.totalIncentiveTopupWithdrawnWei,
      });
    });
  });

  describe("annums lengths", async () => {
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

    it("Counting annum length", async () => {
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
        2: endTimeStamp } = await incentivePool.getCurrentAnnum() as any;
      // Assert
      // Check that start and end timestamp are actually 30 days appart -1 sec as designed
      assert.equal(endTimeStamp - startTimeStamp, 30 * 24 * 60 * 60 - 1);
    });

    it("Counting annum length starting from date not in leap year " +
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
          2: endTimeStamp } = await incentivePool.getCurrentAnnum() as any;
        // Assert
        assert.equal(endTimeStamp - startTimeStamp, 30 * 24 * 60 * 60 - 1);
      });

    it("Counting annum length starting on 28/2 not in leap year " +
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
          2: endTimeStamp } = await incentivePool.getCurrentAnnum() as any;
        // Assert
        assert.equal(endTimeStamp - startTimeStamp, 30 * 24 * 60 * 60 - 1);
      });

    it("Counting annum length starting from date in leap year " +
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
          2: endTimeStamp } = await incentivePool.getCurrentAnnum() as any;
        // Assert
        assert.equal(endTimeStamp - startTimeStamp, 30 * 24 * 60 * 60 - 1);
      });

    it("Counting annum length starting on 29/2 in a leap year", async () => {
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
        2: endTimeStamp } = await incentivePool.getCurrentAnnum() as any;
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
      const expectedAuthorizedIncentive = Math.floor(incentiveForAnnum / 30);
      const { 0: actualAuthorizedIncentive } = await incentivePool.getTotals();
      assert.equal(actualAuthorizedIncentive.toNumber(), expectedAuthorizedIncentive);
      await expectEvent.inTransaction(response.tx, incentivePool, INCENTIVEAUTHORIZED_EVENT, { amountWei: expectedAuthorizedIncentive.toString() });
      await expectEvent.inTransaction(response.tx, incentivePool, REWARDSERVICEDAILYAUTHORIZEDINCENTIVECOMPUTED_EVENT, { incentivePoolReceiver: incentiveReceiver.address, amountWei: expectedAuthorizedIncentive.toString() });
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
      const expectedAuthorizedIncentive = Math.floor(incentiveForAnnum / 30);
      const { 0: actualAuthorizedIncentive } = await incentivePool.getTotals();
      // Check authorized incentive across annums (only 1 annum tho)
      assert.equal(actualAuthorizedIncentive.toNumber(), expectedAuthorizedIncentive);
      const {
        3: incentivePoolRewardServices } = await incentivePool.getCurrentAnnum() as any;
      // Check authorized incentive total for current annum
      assert.equal(incentivePoolRewardServices.totalAuthorizedIncentiveWei, expectedAuthorizedIncentive);
      // Check authorized incentive for first reward service
      assert.equal(incentivePoolRewardServices.incentivePoolRewardServices[0].authorizedIncentiveWei, Math.floor(expectedAuthorizedIncentive * 0.3));
      // Check authorized incentive for the second reward service
      assert.equal(incentivePoolRewardServices.incentivePoolRewardServices[1].authorizedIncentiveWei, expectedAuthorizedIncentive - Math.floor(expectedAuthorizedIncentive * 0.3));
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
      const expectedAuthorizedIncentive = Math.floor(incentiveForAnnum / 30);
      const { 0: actualAuthorizedIncentive } = await incentivePool.getTotals();
      // Check authorized incentive across annums (only 1 annum tho)
      assert.equal(actualAuthorizedIncentive.toNumber(), expectedAuthorizedIncentive);
      const {
        3: incentivePoolRewardServices } = await incentivePool.getCurrentAnnum() as any;
      // Check authorized incentive total for current annum
      assert.equal(incentivePoolRewardServices.totalAuthorizedIncentiveWei, expectedAuthorizedIncentive);
      // Check authorized incentive for first reward service
      assert.equal(incentivePoolRewardServices.incentivePoolRewardServices[0].authorizedIncentiveWei, Math.floor(expectedAuthorizedIncentive * 0.3333));
      // Check authorized incentive for second reward service
      assert.equal(incentivePoolRewardServices.incentivePoolRewardServices[1].authorizedIncentiveWei, Math.floor(expectedAuthorizedIncentive * 0.3334));
      // Check authorized incentive for the third reward service
      assert.equal(incentivePoolRewardServices.incentivePoolRewardServices[2].authorizedIncentiveWei, expectedAuthorizedIncentive - Math.floor(expectedAuthorizedIncentive * 0.3334) - Math.floor(expectedAuthorizedIncentive * 0.3333));
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
      const expectedAuthorizedIncentiveCycle1 = Math.floor(incentiveForAnnum / 30);
      const expectedAuthorizedIncentiveCycle2 = Math.floor((incentiveForAnnum - expectedAuthorizedIncentiveCycle1) / 29);
      const expectedAuthorizedIncentive = expectedAuthorizedIncentiveCycle1 + expectedAuthorizedIncentiveCycle2;
      const { 0: actualAuthorizedIncentive } = await incentivePool.getTotals();
      // Check authorized incentive across annums (only 1 annum tho)
      assert.equal(actualAuthorizedIncentive.toNumber(), expectedAuthorizedIncentive);
      // Compute authorized incentive total for cycle 2, each service
      const expectedAuthorizedIncentiveCycle2Service1 =
        Math.floor(expectedAuthorizedIncentiveCycle1 * 0.3) +
        Math.floor(expectedAuthorizedIncentiveCycle2 * 0.3);
      const expectedAuthorizedIncentiveCycle2Service2 =
        expectedAuthorizedIncentive -
        expectedAuthorizedIncentiveCycle2Service1;
      const {
        3: incentivePoolRewardServices } = await incentivePool.getCurrentAnnum() as any;
      // Check authorized incentive total for current annum
      assert.equal(incentivePoolRewardServices.totalAuthorizedIncentiveWei, expectedAuthorizedIncentive);
      // Check authorized incentive for first reward service
      assert.equal(incentivePoolRewardServices.incentivePoolRewardServices[0].authorizedIncentiveWei, expectedAuthorizedIncentiveCycle2Service1);
      // Check authorized incentive for the second reward service
      assert.equal(incentivePoolRewardServices.incentivePoolRewardServices[1].authorizedIncentiveWei, expectedAuthorizedIncentiveCycle2Service2);
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
      const expectedAuthorizedIncentive = Math.floor(incentiveForAnnum / 30);
      const setDailyAuthorizedIncentive = mockIncentivePoolReceiverInstance.contract.methods.setDailyAuthorizedIncentive(expectedAuthorizedIncentive).encodeABI();
      const invocationCount = await rewardingServiceContract.invocationCountForCalldata.call(setDailyAuthorizedIncentive);
      assert.equal(invocationCount.toNumber(), 1);
    });

    it("Should revert if initialize the new annum fails", async () => {
      const getAnnualPercentageBips = incentivePoolAllocation.contract.methods.getAnnualPercentageBips().encodeABI();
      // const getAnnualPercentageBips = web3.utils.sha3("getAnnualPercentageBips()")!.slice(0, 10);
      await mockIncentivePoolAllocation.givenMethodRevertWithMessage(getAnnualPercentageBips, "err");

      await expectRevert(mockFlareDaemon.trigger(), "err");
    });

    it("Should revert for a initialize the new annum catch statement without a message", async () => {
      const getAnnualPercentageBips = incentivePoolAllocation.contract.methods.getAnnualPercentageBips().encodeABI();
      // const getAnnualPercentageBips = web3.utils.sha3("getAnnualPercentageBips()")!.slice(0, 10);
      await mockIncentivePoolAllocation.givenMethodRunOutOfGas(getAnnualPercentageBips);

      await expectRevert(mockFlareDaemon.trigger(), "unknown error. getAnnualPercentageBips");
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

    it("Should require topup factor less than or equal to 4 (x100) if using daily authorized", async () => {
      // Assemble
      // Act
      const setPromise = incentivePool.setTopupConfiguration((await MockContract.new()).address, TopupType.FACTOROFDAILYAUTHORIZED, 401);
      // Require
      await expectRevert(setPromise, ERR_TOPUP_HIGH);
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
      const expectedAuthorizedIncentive = Math.floor(incentiveForAnnum / 30);
      // This should cap at one days authorization...not the factor
      const expectedTopupService0 = Math.floor(expectedAuthorizedIncentive * 0.3);
      const expectedTopupService1 = expectedAuthorizedIncentive - expectedTopupService0;
      const {
        3: incentivePoolRewardServices } = await incentivePool.getCurrentAnnum() as any;
      // Check topup incentive for first reward service
      assert.equal(incentivePoolRewardServices.incentivePoolRewardServices[0].incentivePoolTopupRequestedWei, expectedTopupService0);
      await expectEvent.inTransaction(response.tx, incentivePool, REWARDSERVICETOPUPCOMPUTED_EVENT, { incentivePoolReceiver: incentivePoolReceiver0.address, amountWei: expectedTopupService0.toString() });
      // Check topup incentive for the second reward service
      assert.equal(incentivePoolRewardServices.incentivePoolRewardServices[1].incentivePoolTopupRequestedWei, expectedTopupService1);
      await expectEvent.inTransaction(response.tx, incentivePool, REWARDSERVICETOPUPCOMPUTED_EVENT, { incentivePoolReceiver: incentivePoolReceiver1.address, amountWei: expectedTopupService1.toString() });
      await expectEvent.inTransaction(response.tx, incentivePool, TOPUPREQUESTED_EVENT, { amountWei: (expectedTopupService0 + expectedTopupService1).toString() });
    });

    it("Should request incentive to topup - second cycle, 2 sharing percentages, by factor type (default)", async () => {
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
      const expectedAuthorizedIncentiveCycle1 = Math.floor(incentiveForAnnum / 30);
      const expectedAuthorizedIncentiveCycle2 = Math.floor((incentiveForAnnum - expectedAuthorizedIncentiveCycle1) / 29);
      const expectedAuthorizedIncentiveCycle2Service1 = Math.floor(expectedAuthorizedIncentiveCycle2 * 0.3);
      const expectedAuthorizedIncentiveCycle2Service2 = expectedAuthorizedIncentiveCycle2 - expectedAuthorizedIncentiveCycle2Service1;
      const expectedTopupService1 = Math.floor(expectedAuthorizedIncentiveCycle2Service1 * 1.2);
      const expectedTopupService2 = Math.floor(expectedAuthorizedIncentiveCycle2Service2 * 1.2);
      const {
        3: incentivePoolRewardServices } = await incentivePool.getCurrentAnnum() as any;
      // Check topup incentive for first reward service
      assert.equal(incentivePoolRewardServices.incentivePoolRewardServices[0].incentivePoolTopupRequestedWei, expectedTopupService1);
      // Check topup incentive for the second reward service
      assert.equal(incentivePoolRewardServices.incentivePoolRewardServices[1].incentivePoolTopupRequestedWei, expectedTopupService2);
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
      const nowTs = await time.latest() as BN;
      // A day passes...
      await time.increaseTo(nowTs.addn(86400));
      // Act
      await mockFlareDaemon.trigger();
      // Assert
      const expectedAuthorizedIncentiveCycle1 = Math.floor(incentiveForAnnum / 30);
      const expectedAuthorizedIncentiveCycle2 = Math.floor((incentiveForAnnum - expectedAuthorizedIncentiveCycle1) / 29);
      const expectedAuthorizedIncentiveCycle2Service1 = Math.floor(expectedAuthorizedIncentiveCycle2 * 0.3);
      const expectedAuthorizedIncentiveCycle2Service2 = expectedAuthorizedIncentiveCycle2 - expectedAuthorizedIncentiveCycle2Service1;
      const expectedTopupService1 = Math.floor(expectedAuthorizedIncentiveCycle2Service1 * 1.2);
      const expectedTopupService2 = Math.floor(expectedAuthorizedIncentiveCycle2Service2 * 1.1);
      const {
        3: incentivePoolRewardServices } = await incentivePool.getCurrentAnnum() as any;
      // Check topup incentive for first reward service
      assert.equal(incentivePoolRewardServices.incentivePoolRewardServices[0].incentivePoolTopupRequestedWei, expectedTopupService1);
      // Check topup incentive for the second reward service
      assert.equal(incentivePoolRewardServices.incentivePoolRewardServices[1].incentivePoolTopupRequestedWei, expectedTopupService2);
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
      const nowTs = await time.latest() as BN;
      // A day passes...
      await time.increaseTo(nowTs.addn(86400));
      // Act
      await mockFlareDaemon.trigger();
      // Assert
      const expectedAuthorizedIncentiveCycle1 = Math.floor(incentiveForAnnum / 30);
      const expectedAuthorizedIncentiveCycle2 = Math.floor((incentiveForAnnum - expectedAuthorizedIncentiveCycle1) / 29);
      const expectedAuthorizedIncentiveCycle2Service1 = Math.floor(expectedAuthorizedIncentiveCycle2 * 2000 / 10000);
      const expectedAuthorizedIncentiveCycle2Service2 = expectedAuthorizedIncentiveCycle2 - expectedAuthorizedIncentiveCycle2Service1;
      const expectedTopupService1 = Math.floor(expectedAuthorizedIncentiveCycle2Service1 * 2);
      const expectedTopupService2 = Math.floor(expectedAuthorizedIncentiveCycle2Service2 * 140 / 100);
      const {
        3: incentivePoolRewardServices } = await incentivePool.getCurrentAnnum() as any;
      // Check topup incentive for first reward service
      assert.equal(incentivePoolRewardServices.incentivePoolRewardServices[0].incentivePoolTopupRequestedWei, expectedTopupService1);
      // Check topup incentive for the second reward service
      assert.equal(incentivePoolRewardServices.incentivePoolRewardServices[1].incentivePoolTopupRequestedWei, expectedTopupService2);
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
      const {
        3: incentivePoolRewardServices } = await incentivePool.getCurrentAnnum() as any;
      // Check topup incentive for first reward service
      assert.equal(
        incentivePoolRewardServices.incentivePoolRewardServices[0].incentivePoolTopupRequestedWei,
        incentivePoolRewardServices.incentivePoolRewardServices[0].authorizedIncentiveWei
      );
      // Check topup incentive for the second reward service
      assert.equal(
        incentivePoolRewardServices.incentivePoolRewardServices[1].incentivePoolTopupRequestedWei,
        incentivePoolRewardServices.incentivePoolRewardServices[1].authorizedIncentiveWei
      );
    });

    it("Should not request incentive to topup if receiver has balance", async () => {
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
      const {
        3: incentivePoolRewardServices1 } = await incentivePool.getCurrentAnnum() as any;
      const expectedAuthorizedIncentive = Math.floor(incentiveForAnnum / 30);
      // This should cap at one days authorization...not the factor
      const expectedTopupService0 = Math.floor(expectedAuthorizedIncentive * 0.3);
      const expectedTopupService1 = expectedAuthorizedIncentive - expectedTopupService0;
      // Check topup incentive for first reward service
      assert.equal(incentivePoolRewardServices1.incentivePoolRewardServices[0].incentivePoolTopupRequestedWei, expectedTopupService0);
      // Check topup incentive for the second reward service
      assert.equal(incentivePoolRewardServices1.incentivePoolRewardServices[1].incentivePoolTopupRequestedWei, expectedTopupService1);
      const nowTs = await time.latest() as BN;
      // A day passes...
      await time.increaseTo(nowTs.addn(86400));
      await web3.eth.sendTransaction({ from: accounts[0], to: receiver1.address, value: toBN(incentiveForAnnum) });
      // Act
      await mockFlareDaemon.trigger();
      // Assert
      const expectedAuthorizedIncentiveCycle1 = Math.floor(incentiveForAnnum / 30);
      const expectedAuthorizedIncentiveCycle2 = Math.floor((incentiveForAnnum - expectedAuthorizedIncentiveCycle1) / 29);
      const expectedAuthorizedIncentiveCycle2Service1 = Math.floor(expectedAuthorizedIncentiveCycle2 * 0.3);
      const expectedAuthorizedIncentiveCycle2Service2 = expectedAuthorizedIncentiveCycle2 - expectedAuthorizedIncentiveCycle2Service1;
      const expectedTopupService2 = Math.floor(expectedAuthorizedIncentiveCycle2Service2 * 1.2);
      const {
        3: incentivePoolRewardServices2 } = await incentivePool.getCurrentAnnum() as any;
      // Check topup incentive for first reward service
      assert.equal(incentivePoolRewardServices2.incentivePoolRewardServices[0].incentivePoolTopupRequestedWei, expectedTopupService0);
      // Check topup incentive for the second reward service
      assert.equal(incentivePoolRewardServices2.incentivePoolRewardServices[1].incentivePoolTopupRequestedWei, expectedTopupService2);
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

  describe("minting", async () => {
    it("Should request minting after a topup request is calculated", async () => {
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
      const expectedRequestedIncentive = Math.floor(incentiveForAnnum / 30);
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
      const { 1: toMint } = await incentivePool.getTotals();
      // Act
      
      // Assert
      const expectedReceivedIncentive = Math.floor(incentiveForAnnum / 30);
      // This should cap at one days authorization...not the factor
      const expectedTopupService0 = Math.floor(expectedReceivedIncentive * 0.3);
      const expectedTopupService1 = expectedReceivedIncentive - expectedTopupService0;
      const { 3: incentivePoolRewardServices } = await incentivePool.getCurrentAnnum() as any;
      // Check topup incentive for first reward service
      assert.equal(incentivePoolRewardServices.incentivePoolRewardServices[0].incentivePoolTopupReceivedWei, expectedTopupService0);
      await expectEvent.inTransaction(response.tx, incentivePool, REWARDSERVICETOPUPREQUESTRECEIVED_EVENT, { incentivePoolReceiver: incentiveReceiver0.address, amountWei: expectedTopupService0.toString() });
      // Check topup incentive for the second reward service
      assert.equal(incentivePoolRewardServices.incentivePoolRewardServices[1].incentivePoolTopupReceivedWei, expectedTopupService1);
      await expectEvent.inTransaction(response.tx, incentivePool, REWARDSERVICETOPUPREQUESTRECEIVED_EVENT, { incentivePoolReceiver: incentiveReceiver1.address, amountWei: expectedTopupService1.toString() });

      // Running sum should be correct
      const { 2: receivedTopup } = await incentivePool.getTotals();
      assert.equal(receivedTopup.toNumber(), expectedTopupService0 + expectedTopupService1);
     
      // Check that the treasury balance is correct
      assert.equal(treasuryBalanceBefore.sub(treasuryBalanceAfter).toString(), toMint.toString());
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
      const rewardingServiceContract0 = await IncentivePoolReceiverMock.new();
      const rewardingServiceContract1 = await IncentivePoolReceiverMock.new();
      sharingPercentages[0] = { incentivePoolReceiver: rewardingServiceContract0.address, percentBips: 3000 };
      sharingPercentages[1] = { incentivePoolReceiver: rewardingServiceContract1.address, percentBips: 7000 };
      const percentageProviderMock = await IncentivePoolAllocationMock.new(sharingPercentages, incentiveBips);
      await incentivePool.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.SUPPLY, Contracts.INCENTIVE_POOL_ALLOCATION]),
        [ADDRESS_UPDATER, mockSupply.address, percentageProviderMock.address], {from: ADDRESS_UPDATER});
      // Prime topup request buckets
      await mockFlareDaemon.trigger();
      const { 1: toMint } = await incentivePool.getTotals();
      // Act

      // Assert
      const expectedIncentiveFunded = Math.floor(incentiveForAnnum / 30);
      // This should cap at one days authorization...not the factor
      const expectedTopupService0 = Math.floor(expectedIncentiveFunded * 0.3);
      const expectedTopupService1 = expectedIncentiveFunded - expectedTopupService0;
      const {
        3: incentivePoolRewardServices } = await incentivePool.getCurrentAnnum() as any;
      // Check topup incentivePool for first reward service
      assert.equal(incentivePoolRewardServices.incentivePoolRewardServices[0].incentivePoolTopupWithdrawnWei, expectedTopupService0);
      // Check topup incentivePool for the second reward service
      assert.equal(incentivePoolRewardServices.incentivePoolRewardServices[1].incentivePoolTopupWithdrawnWei, expectedTopupService1);
      // Running sum should be correct
      const { 3: incentivePoolWithdrawn } = await incentivePool.getTotals();
      assert.equal(incentivePoolWithdrawn.toNumber(), expectedTopupService0 + expectedTopupService1);
      // Check that target reward service contracts got the native token they are due
      assert.equal((await web3.eth.getBalance(rewardingServiceContract0.address)), expectedTopupService0.toString());
      assert.equal((await web3.eth.getBalance(rewardingServiceContract1.address)), expectedTopupService1.toString());
    
      const {
        0: lockedFunds, 1: inflationAuthorized, 2: claimed
      } = await incentivePool.getTokenPoolSupplyData()

      assert.equal(lockedFunds.toString(), BN(supply).toString());
      assert.equal(inflationAuthorized.toString(), "0");
      assert.equal(claimed.toString(), incentivePoolWithdrawn.toString());
    
    
    });

    it("Should balance when receiving self-destruct amount between daemonize calls", async () => {
      // Assemble
      // Set up two sharing percentages
      const sharingPercentages = [];
      const rewardingServiceContract0 = await IncentivePoolReceiverMock.new();
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
    it("Should get an annum by index", async () => {
      // Assemble
      await mockFlareDaemon.trigger();
      // Act
      const { recognizedIncentiveWei } = await incentivePool.getAnnum(0);
      // Assert
      assert.equal(recognizedIncentiveWei, BN(incentiveForAnnum));
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
      const t1Result = await incentivePool.getTopupConfiguration.call(mockContract1.address);
      assert.equal(t1Result.configured, true);
      assert.equal(t1Result.topupType, BN(t1Type));
      assert.equal(t1Result.topupFactorX100, BN(t1Factor));
      // t2 and 3 should be default
      const t2ResultDefault = await incentivePool.getTopupConfiguration.call(mockContract2.address);
      assert.equal(t2ResultDefault.configured, true);
      assert.equal(t2ResultDefault.topupType, BN(TopupType.FACTOROFDAILYAUTHORIZED));
      assert.equal(t2ResultDefault.topupFactorX100, BN(DEFAULT_TOPUP_FACTOR_X100));

      const t3Result = await incentivePool.getTopupConfiguration.call(mockContract3.address);
      assert.equal(t3Result.configured, true);
      assert.equal(t3Result.topupType, BN(TopupType.FACTOROFDAILYAUTHORIZED));
      assert.equal(t3Result.topupFactorX100, BN(DEFAULT_TOPUP_FACTOR_X100));

      // Adding another should not change previous
      // Act
      await incentivePool.setTopupConfiguration(mockContract2.address, t2Type, t2Factor);
      const t1Result2 = await incentivePool.getTopupConfiguration.call(mockContract1.address);
      assert.equal(t1Result2.configured, true);
      assert.equal(t1Result2.topupType, BN(t1Type));
      assert.equal(t1Result2.topupFactorX100, BN(t1Factor));
      const t2Result = await incentivePool.getTopupConfiguration.call(mockContract2.address);
      assert.equal(t2Result.configured, true);
      assert.equal(t2Result.topupType, BN(t2Type));
      assert.equal(t2Result.topupFactorX100, BN(t2Factor));
      const t3Result2 = await incentivePool.getTopupConfiguration.call(mockContract3.address);
      assert.equal(t3Result2.configured, true);
      assert.equal(t3Result2.topupType, BN(TopupType.FACTOROFDAILYAUTHORIZED));
      assert.equal(t3Result2.topupFactorX100, BN(DEFAULT_TOPUP_FACTOR_X100));

      // Can update multiple times
      await incentivePool.setTopupConfiguration(mockContract2.address, t2TypeFinal, t2FactorFinal);
      const t1Result3 = await incentivePool.getTopupConfiguration.call(mockContract1.address);
      assert.equal(t1Result3.configured, true);
      assert.equal(t1Result3.topupType, BN(t1Type));
      assert.equal(t1Result3.topupFactorX100, BN(t1Factor));
      const t2ResultFinal = await incentivePool.getTopupConfiguration.call(mockContract2.address);
      assert.equal(t2ResultFinal.configured, true);
      assert.equal(t2ResultFinal.topupType, BN(t2TypeFinal));
      assert.equal(t2ResultFinal.topupFactorX100, BN(t2FactorFinal));
      const t3Result3 = await incentivePool.getTopupConfiguration.call(mockContract3.address);
      assert.equal(t3Result3.configured, true);
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
