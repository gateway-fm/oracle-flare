import { BokkyPooBahsDateTimeContractInstance } from "../../../../typechain-truffle";

const getTestFile = require('../../../utils/constants').getTestFile;

const DateTimeContract = artifacts.require("BokkyPooBahsDateTimeContract");

const BN = web3.utils.toBN;

contract(`DateTimeLibrary.sol; ${getTestFile(__filename)}; DateTimeLibrary unit tests`, async accounts => {
  // let BokkyPooBahsDateTimeLibrary: BokkyPooBahsDateTimeLibraryInstance;
  let dateTimeContract: BokkyPooBahsDateTimeContractInstance;

  beforeEach(async() => {
    dateTimeContract = await DateTimeContract.new()
  });

  describe("Timestamp to date method ", async() => { 
    it("Test timestamp to date time", async() => {
      // Assemble
      const timestamp_expected_1 = 1625014923;
      // Act
      const {
        0: year,
        1: month,
        2: day,
        3: hour,
        4: minute,
        5: second
      } = await dateTimeContract.timestampToDateTime(timestamp_expected_1)
      // Assert
      assert.equal(year.toNumber(), 2021);
      assert.equal(month.toNumber(), 6);
      assert.equal(day.toNumber(), 30);
      assert.equal(hour.toNumber(), 1);
      assert.equal(minute.toNumber(), 2);
      assert.equal(second.toNumber(), 3);
    });

    it("Test timestamp to date", async() => {
      // Assemble
      const timestamp_expected_1 = 1625014923;
      // Act
      const {
        0: year,
        1: month,
        2: day
      } = await dateTimeContract.timestampToDate(timestamp_expected_1)
      // Assert
      assert.equal(year.toNumber(), 2021);
      assert.equal(month.toNumber(), 6);
      assert.equal(day.toNumber(), 30);
    });

    it("Test timestamp to datetime leap day", async() => {
      // Assemble
      const timestamp_expected_1 = 4233702042;
      // Act
      const {
        0: year,
        1: month,
        2: day,
        3: hour,
        4: minute,
        5: second
      } = await dateTimeContract.timestampToDateTime(timestamp_expected_1)
      // Assert
      assert.equal(year.toNumber(), 2104);
      assert.equal(month.toNumber(), 2);
      assert.equal(day.toNumber(), 29);
      assert.equal(hour.toNumber(), 4);
      assert.equal(minute.toNumber(), 20);
      assert.equal(second.toNumber(), 42);
    });

    it("Test timestamp to date leap day", async() => {
      // Assemble
      const timestamp_expected_1 = 4233702042;
      // Act
      const {
        0: year,
        1: month,
        2: day
      } = await dateTimeContract.timestampToDate(timestamp_expected_1)
      // Assert
      assert.equal(year.toNumber(), 2104);
      assert.equal(month.toNumber(), 2);
      assert.equal(day.toNumber(), 29);
    });
  });

  describe("Timestamp from date method ", async() => { 
    it("Test timestamp from date", async() => {
      // Assemble
      const timestamp_expected_1 = 1625011200; // 30/6/2021
      const timestamp_expected_2 = 4233686400; // 29/2/2104
      // Act
      const timestamp_1 = await dateTimeContract.timestampFromDate(2021,6,30);
      const timestamp_2 = await dateTimeContract.timestampFromDate(2104,2,29);
      // Assert
      assert.equal(timestamp_1.toNumber(), timestamp_expected_1);
      assert.equal(timestamp_2.toNumber(), timestamp_expected_2);
    });

    it("Test timestamp from datetime", async() => {
      // Assemble
      const timestamp_expected_1 = 1625011200; // 30/6/2021 midnight
      const timestamp_expected_2 = 4233686400; // 29/2/2104 midnight
      const timestamp_expected_3 = 1623750533; // 15/6/2021 9:48:53
      // Act
      const timestamp_1 = await dateTimeContract.timestampFromDateTime(2021,6,30,0,0,0);
      const timestamp_2 = await dateTimeContract.timestampFromDateTime(2104,2,29,0,0,0);
      const timestamp_3 = await dateTimeContract.timestampFromDateTime(2021,6,15,9,48,53);
      // Assert
      assert.equal(timestamp_1.toNumber(), timestamp_expected_1);
      assert.equal(timestamp_2.toNumber(), timestamp_expected_2);
      assert.equal(timestamp_3.toNumber(), timestamp_expected_3);
    });
  });

  describe("Leap year logic", async() => { 
    it("Test leap year timestamps ", async() => {
      // Assemble
      // Devisable by 400
      const timestamp_1 = await dateTimeContract.timestampFromDateTime(2000, 6, 30, 1, 2, 3);
      // Devisable by 100 but not by 400
      const timestamp_2 = await dateTimeContract.timestampFromDateTime(2100, 6, 30, 1, 2, 3);
      const timestamp_3 = await dateTimeContract.timestampFromDateTime(2200, 6, 30, 1, 2, 3);
      const timestamp_4 = await dateTimeContract.timestampFromDateTime(2300, 6, 30, 1, 2, 3);
      // Devisable by 4 but not by 100
      const timestamp_5 = await dateTimeContract.timestampFromDateTime(2104, 6, 30, 1, 2, 3);
      const timestamp_6 = await dateTimeContract.timestampFromDateTime(2016, 6, 30, 1, 2, 3);
      // Not devisable by 4
      const timestamp_7 = await dateTimeContract.timestampFromDateTime(1995, 6, 30, 1, 2, 3);
      const timestamp_8 = await dateTimeContract.timestampFromDateTime(2021, 6, 30, 1, 2, 3);
      
      // Act
      const leap_check_1 = await dateTimeContract.isLeapYear(timestamp_1);
      const leap_check_2 = await dateTimeContract.isLeapYear(timestamp_2);
      const leap_check_3 = await dateTimeContract.isLeapYear(timestamp_3);
      const leap_check_4 = await dateTimeContract.isLeapYear(timestamp_4);
      const leap_check_5 = await dateTimeContract.isLeapYear(timestamp_5);
      const leap_check_6 = await dateTimeContract.isLeapYear(timestamp_6);
      const leap_check_7 = await dateTimeContract.isLeapYear(timestamp_7);
      const leap_check_8 = await dateTimeContract.isLeapYear(timestamp_8);
      
      // Assert
      assert.equal(leap_check_1, true);
      assert.equal(leap_check_2, false);
      assert.equal(leap_check_3, false);
      assert.equal(leap_check_4, false);
      assert.equal(leap_check_5, true);
      assert.equal(leap_check_6, true);
      assert.equal(leap_check_7, false);
      assert.equal(leap_check_8, false);
    });

    it("test leap year years", async() => {
      // Assemble
      const year1 = await dateTimeContract._isLeapYear(2000);
      const year2 = await dateTimeContract._isLeapYear(2100);
      const year3 = await dateTimeContract._isLeapYear(2104);
      // Act
    
      // Assert
      assert.equal(year1, true);
      assert.equal(year2, false);
      assert.equal(year3, true);
    });
    
    it("Should be 366 day annum if starting on Feb 28 of a leap year", async() => {
      // Assemble
      let annumStart = await dateTimeContract.timestampFromDateTime(2000, 2, 28, 1, 2, 3);
      // Act
      let annumEnd = await dateTimeContract.addYears(annumStart, 1);
      // Assert
      assert.equal((await dateTimeContract.diffDays(annumStart, annumEnd)).toNumber(), 366);
    });
  
    it("Should be 365 day annum if starting on Feb 29 of a leap year", async() => {
      // Assemble
      let annumStart = await dateTimeContract.timestampFromDateTime(2000, 2, 29, 0, 0, 0);
      // Act
      let annumEnd = await dateTimeContract.addYears(annumStart, 1);
      // Assert
      assert.equal((await dateTimeContract.diffDays(annumStart, annumEnd)).toNumber(), 365);
    });
  
    it("Should be 365 day annum if starting on Feb 28 of a non-leap year, going into a leap-year", async() => {
      // Assemble
      let annumStart = await dateTimeContract.timestampFromDateTime(1999, 2, 28, 0, 0, 0);
      // Act
      let annumEnd = await dateTimeContract.addYears(annumStart, 1);
      // Assert
      assert.equal((await dateTimeContract.diffDays(annumStart, annumEnd)).toNumber(), 365);
    });
  
    it("Should be 366 day annum if starting on Mar 1 of a non-leap year, going into a leap-year", async() => {
      // Assemble
      let annumStart = await dateTimeContract.timestampFromDateTime(1999, 3, 1, 0, 0, 0);
      // Act
      let annumEnd = await dateTimeContract.addYears(annumStart, 1);
      // Assert
      assert.equal((await dateTimeContract.diffDays(annumStart, annumEnd)).toNumber(), 366);
    });
  
    it("Should be 365 day annum if starting on Mar 1 of a leap year, going into a non-leap-year", async() => {
      // Assemble
      let annumStart = await dateTimeContract.timestampFromDateTime(2000, 3, 1, 0, 0, 0);
      // Act
      let annumEnd = await dateTimeContract.addYears(annumStart, 1);
      // Assert
      assert.equal((await dateTimeContract.diffDays(annumStart, annumEnd)).toNumber(), 365);
    });
  
    it("Should be 731 days if starting on Mar 1 of a non-leap year, going into a leap-year, and then adding another year", async() => {
      // Assemble
      let annumStart = await dateTimeContract.timestampFromDateTime(1999, 3, 1, 0, 0, 0);
      // Act
      // Let's add 2 years over a leap year and see if diffDays has the stuff
      let annumEnd = await dateTimeContract.addYears(annumStart, 1);
      annumEnd = await dateTimeContract.addYears(annumEnd, 1);
      // Assert
      assert.equal((await dateTimeContract.diffDays(annumStart, annumEnd)).toNumber(), 731);
    });
  
    it("Should be February 28 of next year if starting on Feb 29 of a leap year and adding a year", async() => {
      // Assemble
      let annumStart = await dateTimeContract.timestampFromDateTime(2000, 2, 29, 0, 0, 0);
      // Act
      let annumEnd = await dateTimeContract.addYears(annumStart, 1);
      // Assert
      assert.equal((await dateTimeContract.getMonth(annumEnd)).toNumber(), 2);
      assert.equal((await dateTimeContract.getDay(annumEnd)).toNumber(), 28);
    });
  });

  describe("Validate Dates", async() => { 
    it("Should check if date 0 is 01.01.1970 ", async() => {
      // Assemble
      const day_zero = await dateTimeContract._daysFromDate(1970,1,1);
      // Act
    
      // Assert
      assert.equal(day_zero.toNumber(), 0);
    });

    it("Test timestamp from date ", async() => {
      // Assemble
      const timestamp_expected_1 = 1625014923
      const timestamp_1 = await dateTimeContract.timestampFromDateTime(2021, 6, 30, 1, 2, 3);
      // Act
      // Assert
      assert.equal(timestamp_1.toNumber(), timestamp_expected_1);
    });

    it("Test isValidDate and isValidDateTime ", async() => {
      // Assemble
      const date1 = await dateTimeContract.isValidDate(1969, 1, 1);
      const expected1 = false;

      const date2 = await dateTimeContract.isValidDate(1970, 1, 1);
      const expected2 = true;
      const date3 = await dateTimeContract.isValidDate(2000, 2, 29);
      const expected3 = true;
      const date4 = await dateTimeContract.isValidDate(2001, 2, 29);
      const expected4 = false;
      const date5 = await dateTimeContract.isValidDate(2001, 0, 1);
      const expected5 = false;
      const date6 = await dateTimeContract.isValidDate(2001, 1, 0);
      const expected6 = false;

      const date7 = await dateTimeContract.isValidDateTime(2000, 2, 29, 0, 0, 0);
      const expected7 = true;
      const date8 = await dateTimeContract.isValidDateTime(2000, 2, 29, 1, 1, 1);
      const expected8 = true;
      const date9 = await dateTimeContract.isValidDateTime(2000, 2, 29, 23, 1, 1);
      const expected9 = true;
      const date10 = await dateTimeContract.isValidDateTime(2000, 2, 29, 24, 1, 1);
      const expected10 = false;
      const date11 = await dateTimeContract.isValidDateTime(2000, 2, 29, 1, 59, 1);
      const expected11 = true;
      const date12 = await dateTimeContract.isValidDateTime(2000, 2, 29, 1, 60, 1);
      const expected12 = false;
      const date13 = await dateTimeContract.isValidDateTime(2000, 2, 29, 1, 1, 59);
      const expected13 = true;
      const date14 = await dateTimeContract.isValidDateTime(2000, 2, 29, 1, 1, 60);
      const expected14 = false;
      // Act
    
      // Assert
      assert.equal(date1,expected1)
      assert.equal(date2,expected2)
      assert.equal(date3,expected3)
      assert.equal(date4,expected4)
      assert.equal(date5,expected5)
      assert.equal(date6,expected6)
      assert.equal(date7,expected7)
      assert.equal(date8,expected8)
      assert.equal(date9,expected9)
      assert.equal(date10,expected10)
      assert.equal(date11,expected11)
      assert.equal(date12,expected12)
      assert.equal(date13,expected13)
      assert.equal(date14,expected14)
    });
  });

  describe("Week day and Week end", async() => { 
    it("Test isWeekDay on timestamps ", async() => {
      // Assemble
      const timestamp_1 = await dateTimeContract.timestampFromDateTime(2018, 5, 24, 1, 2, 3);
      const timestamp_2 = await dateTimeContract.timestampFromDateTime(2018, 5, 25, 1, 2, 3);
      const timestamp_3 = await dateTimeContract.timestampFromDateTime(2018, 5, 26, 1, 2, 3);
      const timestamp_4 = await dateTimeContract.timestampFromDateTime(2018, 5, 27, 1, 2, 3);
      const timestamp_5 = await dateTimeContract.timestampFromDateTime(2018, 5, 28, 1, 2, 3);
      const timestamp_6 = await dateTimeContract.timestampFromDateTime(2018, 5, 29, 1, 2, 3);
      const timestamp_7 = await dateTimeContract.timestampFromDateTime(2018, 5, 30, 1, 2, 3);
      // Act
      const week_day_check_1 = await dateTimeContract.isWeekDay(timestamp_1);
      const week_day_check_2 = await dateTimeContract.isWeekDay(timestamp_2);
      const week_day_check_3 = await dateTimeContract.isWeekDay(timestamp_3);
      const week_day_check_4 = await dateTimeContract.isWeekDay(timestamp_4);
      const week_day_check_5 = await dateTimeContract.isWeekDay(timestamp_5);
      const week_day_check_6 = await dateTimeContract.isWeekDay(timestamp_6);
      const week_day_check_7 = await dateTimeContract.isWeekDay(timestamp_7);
      // Assert
      assert.equal(week_day_check_1, true);
      assert.equal(week_day_check_2, true);
      assert.equal(week_day_check_3, false);
      assert.equal(week_day_check_4, false);
      assert.equal(week_day_check_5, true);
      assert.equal(week_day_check_6, true);
      assert.equal(week_day_check_7, true);
    });

    it("Test isWeekEnd on timestamps ", async() => {
      // Assemble
      const timestamp_1 = await dateTimeContract.timestampFromDateTime(2018, 5, 24, 1, 2, 3);
      const timestamp_2 = await dateTimeContract.timestampFromDateTime(2018, 5, 25, 1, 2, 3);
      const timestamp_3 = await dateTimeContract.timestampFromDateTime(2018, 5, 26, 1, 2, 3);
      const timestamp_4 = await dateTimeContract.timestampFromDateTime(2018, 5, 27, 1, 2, 3);
      const timestamp_5 = await dateTimeContract.timestampFromDateTime(2018, 5, 28, 1, 2, 3);
      const timestamp_6 = await dateTimeContract.timestampFromDateTime(2018, 5, 29, 1, 2, 3);
      const timestamp_7 = await dateTimeContract.timestampFromDateTime(2018, 5, 30, 1, 2, 3);
      // Act
      const week_day_check_1 = await dateTimeContract.isWeekEnd(timestamp_1);
      const week_day_check_2 = await dateTimeContract.isWeekEnd(timestamp_2);
      const week_day_check_3 = await dateTimeContract.isWeekEnd(timestamp_3);
      const week_day_check_4 = await dateTimeContract.isWeekEnd(timestamp_4);
      const week_day_check_5 = await dateTimeContract.isWeekEnd(timestamp_5);
      const week_day_check_6 = await dateTimeContract.isWeekEnd(timestamp_6);
      const week_day_check_7 = await dateTimeContract.isWeekEnd(timestamp_7);
      // Assert
      assert.equal(week_day_check_1, false);
      assert.equal(week_day_check_2, false);
      assert.equal(week_day_check_3, true);
      assert.equal(week_day_check_4, true);
      assert.equal(week_day_check_5, false);
      assert.equal(week_day_check_6, false);
      assert.equal(week_day_check_7, false);
    });
  });

  describe("Month length", async() => { 
    it("Test month length on timestamps ", async() => {
      // Assemble
      const timestamp_1 = await dateTimeContract.timestampFromDateTime(2000, 1, 24, 1, 2, 3);
      const timestamp_2 = await dateTimeContract.timestampFromDateTime(2000, 2, 24, 1, 2, 3);
      const timestamp_3 = await dateTimeContract.timestampFromDateTime(2001, 2, 24, 1, 2, 3);
      const timestamp_4 = await dateTimeContract.timestampFromDateTime(2000, 3, 24, 1, 2, 3);
      const timestamp_5 = await dateTimeContract.timestampFromDateTime(2000, 4, 24, 1, 2, 3);
      const timestamp_6 = await dateTimeContract.timestampFromDateTime(2000, 5, 24, 1, 2, 3);
      const timestamp_7 = await dateTimeContract.timestampFromDateTime(2000, 6, 24, 1, 2, 3);
      const timestamp_8 = await dateTimeContract.timestampFromDateTime(2000, 7, 24, 1, 2, 3);
      const timestamp_9 = await dateTimeContract.timestampFromDateTime(2000, 8, 24, 1, 2, 3);
      const timestamp_10 = await dateTimeContract.timestampFromDateTime(2000, 9, 24, 1, 2, 3);
      const timestamp_11 = await dateTimeContract.timestampFromDateTime(2000, 10, 24, 1, 2, 3);
      const timestamp_12 = await dateTimeContract.timestampFromDateTime(2000, 11, 24, 1, 2, 3);
      const timestamp_13 = await dateTimeContract.timestampFromDateTime(2000, 12, 24, 1, 2, 3);
      // Act
      const days_in_month_1 = await dateTimeContract.getDaysInMonth(timestamp_1);
      const days_in_month_2 = await dateTimeContract.getDaysInMonth(timestamp_2);
      const days_in_month_3 = await dateTimeContract.getDaysInMonth(timestamp_3);
      const days_in_month_4 = await dateTimeContract.getDaysInMonth(timestamp_4);
      const days_in_month_5 = await dateTimeContract.getDaysInMonth(timestamp_5);
      const days_in_month_6 = await dateTimeContract.getDaysInMonth(timestamp_6);
      const days_in_month_7 = await dateTimeContract.getDaysInMonth(timestamp_7);
      const days_in_month_8 = await dateTimeContract.getDaysInMonth(timestamp_8);
      const days_in_month_9 = await dateTimeContract.getDaysInMonth(timestamp_9);
      const days_in_month_10 = await dateTimeContract.getDaysInMonth(timestamp_10);
      const days_in_month_11 = await dateTimeContract.getDaysInMonth(timestamp_11);
      const days_in_month_12 = await dateTimeContract.getDaysInMonth(timestamp_12);
      const days_in_month_13 = await dateTimeContract.getDaysInMonth(timestamp_13);
      // Assert
      assert.equal(days_in_month_1.toNumber(), 31);
      assert.equal(days_in_month_2.toNumber(), 29);
      assert.equal(days_in_month_3.toNumber(), 28);
      assert.equal(days_in_month_4.toNumber(), 31);
      assert.equal(days_in_month_5.toNumber(), 30);
      assert.equal(days_in_month_6.toNumber(), 31);
      assert.equal(days_in_month_7.toNumber(), 30);
      assert.equal(days_in_month_8.toNumber(), 31);
      assert.equal(days_in_month_9.toNumber(), 31);
      assert.equal(days_in_month_10.toNumber(), 30);
      assert.equal(days_in_month_11.toNumber(), 31);
      assert.equal(days_in_month_12.toNumber(), 30);
      assert.equal(days_in_month_13.toNumber(), 31);
    });

    it("Test month length on dates ", async() => {
      // Assemble
      const days_in_month_1 = await dateTimeContract._getDaysInMonth(2000, 1);
      const days_in_month_2 = await dateTimeContract._getDaysInMonth(2000, 2);
      const days_in_month_3 = await dateTimeContract._getDaysInMonth(2001, 2);
      const days_in_month_4 = await dateTimeContract._getDaysInMonth(2000, 3);
      const days_in_month_5 = await dateTimeContract._getDaysInMonth(2000, 4);
      const days_in_month_6 = await dateTimeContract._getDaysInMonth(2000, 5);
      const days_in_month_7 = await dateTimeContract._getDaysInMonth(2000, 6);
      const days_in_month_8 = await dateTimeContract._getDaysInMonth(2000, 7);
      const days_in_month_9 = await dateTimeContract._getDaysInMonth(2000, 8);
      const days_in_month_10 = await dateTimeContract._getDaysInMonth(2000, 9);
      const days_in_month_11 = await dateTimeContract._getDaysInMonth(2000, 10);
      const days_in_month_12 = await dateTimeContract._getDaysInMonth(2000, 11);
      const days_in_month_13 = await dateTimeContract._getDaysInMonth(2000, 12);
      // Act

      // Assert
      assert.equal(days_in_month_1.toNumber(), 31);
      assert.equal(days_in_month_2.toNumber(), 29);
      assert.equal(days_in_month_3.toNumber(), 28);
      assert.equal(days_in_month_4.toNumber(), 31);
      assert.equal(days_in_month_5.toNumber(), 30);
      assert.equal(days_in_month_6.toNumber(), 31);
      assert.equal(days_in_month_7.toNumber(), 30);
      assert.equal(days_in_month_8.toNumber(), 31);
      assert.equal(days_in_month_9.toNumber(), 31);
      assert.equal(days_in_month_10.toNumber(), 30);
      assert.equal(days_in_month_11.toNumber(), 31);
      assert.equal(days_in_month_12.toNumber(), 30);
      assert.equal(days_in_month_13.toNumber(), 31);
    });    
  });

  describe("Days of week", async() => { 
    it("Test get days of week from timestamps ", async() => {
      // Assemble
      const timestamp_1 = await dateTimeContract.timestampFromDateTime(2018, 5, 21, 1, 2, 3);
      const timestamp_2 = await dateTimeContract.timestampFromDateTime(2018, 5, 24, 1, 2, 3);
      const timestamp_3 = await dateTimeContract.timestampFromDateTime(2018, 5, 26, 1, 2, 3);
      const timestamp_4 = await dateTimeContract.timestampFromDateTime(2018, 5, 27, 1, 2, 3);
      const timestamp_5 = await dateTimeContract.timestampFromDateTime(2021, 6, 30, 1, 2, 3);
      const timestamp_6 = await dateTimeContract.timestampFromDateTime(2024, 2, 29, 1, 2, 3);
      // Act
      const day_of_week_1 = await dateTimeContract.getDayOfWeek(timestamp_1);
      const day_of_week_2 = await dateTimeContract.getDayOfWeek(timestamp_2);
      const day_of_week_3 = await dateTimeContract.getDayOfWeek(timestamp_3);
      const day_of_week_4 = await dateTimeContract.getDayOfWeek(timestamp_4);
      const day_of_week_5 = await dateTimeContract.getDayOfWeek(timestamp_5);
      const day_of_week_6 = await dateTimeContract.getDayOfWeek(timestamp_6);
      // Assert
      assert.equal(day_of_week_1.toNumber(), 1);
      assert.equal(day_of_week_2.toNumber(), 4);
      assert.equal(day_of_week_3.toNumber(), 6);
      assert.equal(day_of_week_4.toNumber(), 7);
      assert.equal(day_of_week_5.toNumber(), 3);
      assert.equal(day_of_week_6.toNumber(), 4);
    });
  });

  describe("Days in year", async() => { 
    it("Test get days in year from timestamps ", async() => {
      // Assemble
      const timestamp_1 = await dateTimeContract.timestampFromDateTime(2000, 5, 21, 1, 2, 3);
      const timestamp_2 = await dateTimeContract.timestampFromDateTime(2004, 5, 24, 1, 2, 3);
      const timestamp_3 = await dateTimeContract.timestampFromDateTime(2021, 5, 26, 1, 2, 3);
      const timestamp_4 = await dateTimeContract.timestampFromDateTime(2024, 5, 27, 1, 2, 3);
      const timestamp_5 = await dateTimeContract.timestampFromDateTime(2043, 6, 30, 1, 2, 3);
      const timestamp_6 = await dateTimeContract.timestampFromDateTime(2100, 2, 29, 1, 2, 3);
      // Act
      const day_of_year_1 = await dateTimeContract.getDaysInYear(timestamp_1);
      const day_of_year_2 = await dateTimeContract.getDaysInYear(timestamp_2);
      const day_of_year_3 = await dateTimeContract.getDaysInYear(timestamp_3);
      const day_of_year_4 = await dateTimeContract.getDaysInYear(timestamp_4);
      const day_of_year_5 = await dateTimeContract.getDaysInYear(timestamp_5);
      const day_of_year_6 = await dateTimeContract.getDaysInYear(timestamp_6);
      // Assert
      assert.equal(day_of_year_1.toNumber(), 366);
      assert.equal(day_of_year_2.toNumber(), 366);
      assert.equal(day_of_year_3.toNumber(), 365);
      assert.equal(day_of_year_4.toNumber(), 366);
      assert.equal(day_of_year_5.toNumber(), 365);
      assert.equal(day_of_year_6.toNumber(), 365);
    });
  });

  describe("Get methods", async() => { 
    let timestamp_1: BN;

    beforeEach(async() => {
      timestamp_1 = await dateTimeContract.timestampFromDateTime(2020, 5, 21, 1, 2, 3);
    });

    it("Test getYear ", async() => {
      // Assemble
      // Act
      const year = await dateTimeContract.getYear(timestamp_1);
      // Assert
      assert.equal(year.toNumber(), 2020);
    });

    it("Test getMonth ", async() => {
      // Assemble
      // Act
      const month = await dateTimeContract.getMonth(timestamp_1);
      // Assert
      assert.equal(month.toNumber(), 5);
    });

    it("Test getDay ", async() => {
      // Assemble
      // Act
      const day = await dateTimeContract.getDay(timestamp_1);
      // Assert
      assert.equal(day.toNumber(), 21);
    });

    it("Test getHour ", async() => {
      // Assemble
      // Act
      const hour = await dateTimeContract.getHour(timestamp_1);
      // Assert
      assert.equal(hour.toNumber(), 1);
    });

    it("Test getMinute ", async() => {
      // Assemble
      // Act
      const minute = await dateTimeContract.getMinute(timestamp_1);
      // Assert
      assert.equal(minute.toNumber(), 2);
    });

    it("Test getSecond ", async() => {
      // Assemble
      // Act
      const second = await dateTimeContract.getSecond(timestamp_1);
      // Assert
      assert.equal(second.toNumber(), 3);
    });
  });

  describe("Add methods", async() => { 
    it("Test addYear ", async() => {
      // Assemble
      const timestamp_1 = await dateTimeContract.timestampFromDateTime(2000, 2, 29, 1, 2, 3);
      const timestamp_2 = await dateTimeContract.timestampFromDateTime(2018, 12, 31, 2, 3, 4); 
      // Act
      const expected_1 = await dateTimeContract.timestampFromDateTime(2003, 2, 28, 1, 2, 3);
      const new_timestamp_1 = await dateTimeContract.addYears(timestamp_1, 3);
      const expected_2 = await dateTimeContract.timestampFromDateTime(2048, 12, 31, 2, 3, 4);
      const new_timestamp_2 = await dateTimeContract.addYears(timestamp_2, 30);
      // Assert
      assert.isTrue(new_timestamp_1.eq(expected_1));
      assert.isTrue(new_timestamp_2.eq(expected_2));
    });

    it("Test addMonth ", async() => {
      // Assemble
      const timestamp_1 = await dateTimeContract.timestampFromDateTime(2000, 1, 31, 1, 2, 3);
      const timestamp_2 = await dateTimeContract.timestampFromDateTime(2018, 12, 1, 2, 3, 4); 
      // Act
      const expected_1 = await dateTimeContract.timestampFromDateTime(2003, 2, 28, 1, 2, 3);
      const new_timestamp_1 = await dateTimeContract.addMonths(timestamp_1, 37);
      const expected_2 = await dateTimeContract.timestampFromDateTime(2049, 2, 1, 2, 3, 4);
      const new_timestamp_2 = await dateTimeContract.addMonths(timestamp_2, 362);
      // Assert
      assert.isTrue(new_timestamp_1.eq(expected_1));
      assert.isTrue(new_timestamp_2.eq(expected_2));
    });

    it("Test addDays ", async() => {
      // Assemble
      const timestamp_1 = await dateTimeContract.timestampFromDateTime(2017, 1, 31, 1, 2, 3);
      const timestamp_2 = await dateTimeContract.timestampFromDateTime(2021, 6, 30, 2, 3, 4); 
      // Act
      const expected_1 = await dateTimeContract.timestampFromDateTime(2119, 11, 5, 1, 2, 3);
      const new_timestamp_1 = await dateTimeContract.addDays(timestamp_1, 37532);
      const expected_2 = await dateTimeContract.timestampFromDateTime(2021, 7, 13, 2, 3, 4);
      const new_timestamp_2 = await dateTimeContract.addDays(timestamp_2, 13);
      // Assert
      assert.isTrue(new_timestamp_1.eq(expected_1));
      assert.isTrue(new_timestamp_2.eq(expected_2));
    });

    it("Test addHours ", async() => {
      // Assemble
      const timestamp_1 = await dateTimeContract.timestampFromDateTime(2017, 1, 31, 1, 2, 3);
      const timestamp_2 = await dateTimeContract.timestampFromDateTime(2021, 6, 30, 2, 3, 4); 
      // Act
      const expected_1 = await dateTimeContract.timestampFromDateTime(2119, 11, 5, 1, 2, 3);
      const new_timestamp_1 = await dateTimeContract.addHours(timestamp_1, 900768);
      const expected_2 = await dateTimeContract.timestampFromDateTime(2021, 6, 30, 15, 3, 4);
      const new_timestamp_2 = await dateTimeContract.addHours(timestamp_2, 13);
      // Assert
      assert.isTrue(new_timestamp_1.eq(expected_1));
      assert.isTrue(new_timestamp_2.eq(expected_2));
    });

    it("Test addMinutes ", async() => {
      // Assemble
      const timestamp_1 = await dateTimeContract.timestampFromDateTime(2017, 1, 31, 1, 2, 3);
      const timestamp_2 = await dateTimeContract.timestampFromDateTime(2021, 6, 30, 2, 3, 4); 
      // Act
      const expected_1 = await dateTimeContract.timestampFromDateTime(2018, 7, 28, 1, 2, 3);
      const new_timestamp_1 = await dateTimeContract.addMinutes(timestamp_1, 781920);
      const expected_2 = await dateTimeContract.timestampFromDateTime(2021, 6, 30, 15, 6, 4);
      const new_timestamp_2 = await dateTimeContract.addMinutes(timestamp_2, 783);
      // Assert
      assert.isTrue(new_timestamp_1.eq(expected_1));
      assert.isTrue(new_timestamp_2.eq(expected_2));
    });

    it("Test addSeconds ", async() => {
      // Assemble
      const timestamp_1 = await dateTimeContract.timestampFromDateTime(2017, 1, 31, 1, 2, 3);
      const timestamp_2 = await dateTimeContract.timestampFromDateTime(2021, 6, 30, 2, 3, 4); 
      // Act
      const expected_1 = await dateTimeContract.timestampFromDateTime(2031, 9, 17, 1, 2, 3);
      const new_timestamp_1 = await dateTimeContract.addSeconds(timestamp_1, 461548800);
      const expected_2 = await dateTimeContract.timestampFromDateTime(2021, 6, 30, 2, 6, 34);
      const new_timestamp_2 = await dateTimeContract.addSeconds(timestamp_2, 210);
      // Assert
      assert.isTrue(new_timestamp_1.eq(expected_1));
      assert.isTrue(new_timestamp_2.eq(expected_2));
    });
  });

  describe("Sub methods", async() => { 
    // it("Test subYear ", async() => {
    //   // Assemble
    //   const timestamp_1 = await dateTimeContract.timestampFromDateTime(2003, 2, 28, 1, 2, 3);
    //   const timestamp_2 = await dateTimeContract.timestampFromDateTime(2048, 12, 31, 2, 3, 4);
    //   const timestamp_3 = await dateTimeContract.timestampFromDateTime(2104, 2, 29, 2, 3, 4);
    //   // Act
    //   const expected_1 = await  dateTimeContract.timestampFromDateTime(2000, 2, 28, 1, 2, 3);
    //   const new_timestamp_1 = await dateTimeContract.subYears(timestamp_1, 3);
    //   const expected_2 = await dateTimeContract.timestampFromDateTime(2018, 12, 31, 2, 3, 4); 
    //   const new_timestamp_2 = await dateTimeContract.subYears(timestamp_2, 30);
    //   const expected_3 = await dateTimeContract.timestampFromDateTime(2103, 2, 28, 2, 3, 4); 
    //   const new_timestamp_3 = await dateTimeContract.subYears(timestamp_3, 1);
    //   // Assert
    //   assert.isTrue(new_timestamp_1.eq(expected_1));
    //   assert.isTrue(new_timestamp_2.eq(expected_2));
    //   assert.isTrue(new_timestamp_3.eq(expected_3));
    // });

    // it("Test subMonths ", async() => {
    //   // Assemble
    //   const timestamp_1 = await dateTimeContract.timestampFromDateTime(2003, 2, 28, 1, 2, 3);
    //   const timestamp_2 = await dateTimeContract.timestampFromDateTime(2049, 2, 1, 2, 3, 4);
    //   const timestamp_3 = await dateTimeContract.timestampFromDateTime(2021, 7, 31, 2, 3, 4);
    //   // Act
    //   const expected_1 = await dateTimeContract.timestampFromDateTime(2000, 1, 28, 1, 2, 3);
    //   const new_timestamp_1 = await dateTimeContract.subMonths(timestamp_1, 37);
    //   const expected_2 = await dateTimeContract.timestampFromDateTime(2018, 12, 1, 2, 3, 4); 
    //   const new_timestamp_2 = await dateTimeContract.subMonths(timestamp_2, 362);
    //   const expected_3 = await dateTimeContract.timestampFromDateTime(2021, 6, 30, 2, 3, 4); 
    //   const new_timestamp_3 = await dateTimeContract.subMonths(timestamp_3, 1);
    //   // Assert
    //   assert.isTrue(new_timestamp_1.eq(expected_1));
    //   assert.isTrue(new_timestamp_2.eq(expected_2));
    //   assert.isTrue(new_timestamp_3.eq(expected_3));
    // });

    it("Test subDays ", async() => {
      // Assemble
      const timestamp_1 = await dateTimeContract.timestampFromDateTime(2119, 11, 5, 1, 2, 3);
      const timestamp_2 = await dateTimeContract.timestampFromDateTime(2021, 7, 13, 2, 3, 4);
      // Act
      const expected_1 = await dateTimeContract.timestampFromDateTime(2017, 1, 31, 1, 2, 3);
      const new_timestamp_1 = await dateTimeContract.subDays(timestamp_1, 37532);
      const expected_2 = await dateTimeContract.timestampFromDateTime(2021, 6, 30, 2, 3, 4); 
      const new_timestamp_2 = await dateTimeContract.subDays(timestamp_2, 13);
      // Assert
      assert.isTrue(new_timestamp_1.eq(expected_1));
      assert.isTrue(new_timestamp_2.eq(expected_2));
    });

    it("Test subHours ", async() => {
      // Assemble
      const timestamp_1 = await dateTimeContract.timestampFromDateTime(2119, 11, 5, 1, 2, 3); 
      const timestamp_2 = await dateTimeContract.timestampFromDateTime(2021, 6, 30, 15, 3, 4);
      // Act
      const expected_1 = await dateTimeContract.timestampFromDateTime(2017, 1, 31, 1, 2, 3);
      const new_timestamp_1 = await dateTimeContract.subHours(timestamp_1, 900768);
      const expected_2 = await dateTimeContract.timestampFromDateTime(2021, 6, 30, 2, 3, 4); 
      const new_timestamp_2 = await dateTimeContract.subHours(timestamp_2, 13);
      // Assert
      assert.isTrue(new_timestamp_1.eq(expected_1));
      assert.isTrue(new_timestamp_2.eq(expected_2));
    });

    it("Test subMinutes ", async() => {
      // Assemble
      const timestamp_1 = await dateTimeContract.timestampFromDateTime(2018, 7, 28, 1, 2, 3);
      const timestamp_2 = await dateTimeContract.timestampFromDateTime(2021, 6, 30, 15, 6, 4);
      // Act
      const expected_1 = await dateTimeContract.timestampFromDateTime(2017, 1, 31, 1, 2, 3);
      const new_timestamp_1 = await dateTimeContract.subMinutes(timestamp_1, 781920);
      const expected_2 = await dateTimeContract.timestampFromDateTime(2021, 6, 30, 2, 3, 4);
      const new_timestamp_2 = await dateTimeContract.subMinutes(timestamp_2, 783);
      // Assert
      assert.isTrue(new_timestamp_1.eq(expected_1));
      assert.isTrue(new_timestamp_2.eq(expected_2));
    });

    it("Test subSeconds ", async() => {
      // Assemble
      const timestamp_1 = await dateTimeContract.timestampFromDateTime(2031, 9, 17, 1, 2, 3);
      const timestamp_2 = await dateTimeContract.timestampFromDateTime(2021, 6, 30, 2, 6, 34);
      // Act
      const expected_1 = await dateTimeContract.timestampFromDateTime(2017, 1, 31, 1, 2, 3);
      const new_timestamp_1 = await dateTimeContract.subSeconds(timestamp_1, 461548800);
      const expected_2 = await dateTimeContract.timestampFromDateTime(2021, 6, 30, 2, 3, 4); 
      const new_timestamp_2 = await dateTimeContract.subSeconds(timestamp_2, 210);
      // Assert
      assert.isTrue(new_timestamp_1.eq(expected_1));
      assert.isTrue(new_timestamp_2.eq(expected_2));
    });
  });

  describe("Diff methods", async() => { 
    let timestamp_1: BN;
    let new_timestamp_1: BN;

    beforeEach(async() => {
      timestamp_1 = await dateTimeContract.timestampFromDateTime(2017, 10, 21, 1, 2, 3);
      new_timestamp_1 = await dateTimeContract.timestampFromDateTime(2019, 7, 18, 4, 5, 6);
    });

    it("Test diffYears ", async() => {
      // Assemble
      // Act
      const diff = await dateTimeContract.diffYears(timestamp_1,new_timestamp_1);
      // Assert
      assert.equal(diff.toNumber(), 2);
    });

    it("Test diffMonths ", async() => {
      // Assemble
      // Act
      const diff = await dateTimeContract.diffMonths(timestamp_1,new_timestamp_1);
      // Assert
      assert.equal(diff.toNumber(), 21);
    });

    it("Test diffDays ", async() => {
      // Assemble
      // Act
      const diff = await dateTimeContract.diffDays(timestamp_1,new_timestamp_1);
      // Assert
      assert.equal(diff.toNumber(), 635);
    });

    it("Test diffHours ", async() => {
      // Assemble
      // Act
      const diff = await dateTimeContract.diffHours(timestamp_1,new_timestamp_1);
      // Assert
      assert.equal(diff.toNumber(), 15243);
    });

    it("Test diffMinutes ", async() => {
      // Assemble
      // Act
      const diff = await dateTimeContract.diffMinutes(timestamp_1,new_timestamp_1);
      // Assert
      assert.equal(diff.toNumber(), 914583);
    });

    it("Test diffSeconds ", async() => {
      // Assemble
      // Act
      const diff = await dateTimeContract.diffSeconds(timestamp_1,new_timestamp_1);
      // Assert
      assert.equal(diff.toNumber(), 54874983);
    });
  });
});