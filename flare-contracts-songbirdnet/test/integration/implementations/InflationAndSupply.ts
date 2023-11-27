import { constants, time } from "@openzeppelin/test-helpers";
import { Contracts } from "../../../deployment/scripts/Contracts";
import { 
  FlareDaemonMockInstance,
  InflationInstance,
  SupplyInstance, 
  FtsoRewardManagerInstance, 
  PercentageProviderMockInstance, 
  MockContractInstance} from "../../../typechain-truffle";
import { getRewardTotals } from "../../utils/RewardManagerTestUtils";
import { encodeContractNames } from "../../utils/test-helpers";

const getTestFile = require('../../utils/constants').getTestFile;
const cliProgress = require('cli-progress');

const Inflation = artifacts.require("Inflation");
const MockContract = artifacts.require("MockContract");
const PercentageProviderMock = artifacts.require("PercentageProviderMock");
const FlareDaemonMock = artifacts.require("FlareDaemonMock");
const FtsoRewardManager = artifacts.require("FtsoRewardManager");
const DataProviderFee = artifacts.require("DataProviderFee" as any);
const Supply = artifacts.require("Supply");

const BN = web3.utils.toBN;

contract(`Inflation.sol and Supply.sol; ${getTestFile(__filename)}; Inflation and Supply integration tests`, async accounts => {
  // contains a fresh contract set for each test
  let mockInflationPercentageProvider: PercentageProviderMockInstance;
  let inflation: InflationInstance;
  let mockFlareDaemon: FlareDaemonMockInstance;
  let supply: SupplyInstance;
  let ftsoRewardManager: FtsoRewardManagerInstance;
  let mockClaimSetupManager: MockContractInstance;
  const initialGenesisAmountWei = BN(15000000000).mul(BN(10).pow(BN(18)));
  const foundationSupplyWei = BN(9000000000).mul(BN(10).pow(BN(18)));
  const circulatingSupply = initialGenesisAmountWei.sub(foundationSupplyWei);
  const inflationBips = 1000;

  before(async () => {
    FtsoRewardManager.link(await DataProviderFee.new() as any);
  });
  
  beforeEach(async() => {
    const ADDRESS_UPDATER = accounts[16];
    mockFlareDaemon = await FlareDaemonMock.new();

    // Set up the ftsoRewardManager
    ftsoRewardManager = await FtsoRewardManager.new(
      accounts[0],
      ADDRESS_UPDATER,
      constants.ZERO_ADDRESS,
      3,
      0
    );

    // Set up mock inflation percentage provider
    // Set up mock one sharing percentage provider for 100%
    const sharingPercentages = [];
    sharingPercentages[0] = {inflationReceiver: ftsoRewardManager.address, percentBips: 10000};
    mockInflationPercentageProvider = await PercentageProviderMock.new(sharingPercentages, inflationBips);
    mockClaimSetupManager = await MockContract.new();
    
    // Set up inflation...inflation sharing percentage provider will be reset.
    inflation = await Inflation.new(
      accounts[0],
      mockFlareDaemon.address,
      ADDRESS_UPDATER,
      0
    );

    // Wire up supply contract
    supply = await Supply.new(
      accounts[0],
      ADDRESS_UPDATER,
      initialGenesisAmountWei,
      foundationSupplyWei,
      [ftsoRewardManager.address],
      [],
      constants.ZERO_ADDRESS
    );

    // Tell supply about inflation
    await supply.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION]),
      [ADDRESS_UPDATER, inflation.address], {from: ADDRESS_UPDATER});
    // Tell inflation about supply
    await inflation.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.SUPPLY, Contracts.INFLATION_ALLOCATION]),
      [ADDRESS_UPDATER, supply.address, mockInflationPercentageProvider.address], {from: ADDRESS_UPDATER});
    // Register inflation to mock daemon contract so we can trigger inflation
    await mockFlareDaemon.registerToDaemonize(inflation.address);
    // Tell ftso reward manager about inflation
    await ftsoRewardManager.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.CLAIM_SETUP_MANAGER]),
      [ADDRESS_UPDATER, inflation.address, (await MockContract.new()).address, (await MockContract.new()).address, mockClaimSetupManager.address], {from: ADDRESS_UPDATER});
    // enable claiming
    await ftsoRewardManager.enableClaims();

  });

  describe("daily roll", async() => {
    it("Should authorize first day inflation and not update inflatable balance on supply", async() => {
      // Assemble
      const expectedInflationAuthorizedWei = circulatingSupply.mul(BN(inflationBips)).div(BN(10000)).divn(12).div(BN(30));

      // Act
      await mockFlareDaemon.trigger();

      // Assert
      // Supply should have a new authorized inflation and the same inflatable balance (nothing was claimed yet)
      const inflatableBalance = await supply.getInflatableBalance();
      const totalInflationAuthorizedWei = await supply.totalInflationAuthorizedWei();
      assert.equal(inflatableBalance.toString(), circulatingSupply.toString());
      assert.equal(totalInflationAuthorizedWei.toString(), expectedInflationAuthorizedWei.toString());
    });

    it("Should authorize first and second day inflation and not update inflatable balance on supply", async() => {
      // Assemble
      const totalInflationAuthorizedWei1 = circulatingSupply.mul(BN(inflationBips)).div(BN(10000)).divn(12).div(BN(30));
      // Double declining balance calculation
      const totalInflationAuthorizedWei2 = circulatingSupply.mul(BN(inflationBips)).div(BN(10000)).divn(12).sub(totalInflationAuthorizedWei1).div(BN(29));
      // Total inflation authorized over two periods
      const expectedInflationAuthorizedWei = totalInflationAuthorizedWei1.add(totalInflationAuthorizedWei2);
      // Force a block in order to get most up to date time
      await time.advanceBlock();
      // Get the timestamp for the just mined block
      const startTs = await time.latest();
      // First day
      await mockFlareDaemon.trigger();
      // Act
      // Advance time to next day
      await time.increaseTo(startTs.addn(86400));
      // Mine at least a block
      await time.advanceBlock();
      await mockFlareDaemon.trigger();
      // Assert
      // Supply should have a new authorized inflation and the same inflatable balance (nothing was claimed yet)
      const inflatableBalance = await supply.getInflatableBalance();
      const totalInflationAuthorizedWei = await supply.totalInflationAuthorizedWei();
      assert.equal(inflatableBalance.toString(), circulatingSupply.toString());
      assert.equal(totalInflationAuthorizedWei.toString(), expectedInflationAuthorizedWei.toString());
    });
  });

  describe("monthly roll", async() => {
    it("Should recognize inflation in 2nd month, not update inflatable balance on supply, and issue new daily authorized", async() => {
      // Assemble
      const firstMonthInflationAuthorized = circulatingSupply.mul(BN(inflationBips)).div(BN(10000)).divn(12);
      const firstDayMonth2InflationAuthorized = circulatingSupply.mul(BN(inflationBips)).div(BN(10000)).divn(12).div(BN(30));
      // Total inflation authorized over 1 month + 1 day
      const expectedInflationAuthorizedWei = firstMonthInflationAuthorized.add(firstDayMonth2InflationAuthorized);

      let firstTimeSlotStart: BN = BN(0);
      let firstTimeSlot: any = null;

      // Act
      // Force a block in order to get most up to date time
      await time.advanceBlock();
      // Entertain ourselves...
      const progressBar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
      progressBar.start(30, 0);
      for (let i = 0; i < 31; i++) {
        // Advance time to next day if not day 0
        if (i != 0) {
          await time.increase(86400);
        }
        // Pulse inflation for that day by calling daemon
        await mockFlareDaemon.trigger();
        progressBar.update(i);
        if(i == 0){
          firstTimeSlot = await inflation.getCurrentTimeSlot();
          firstTimeSlotStart = BN(firstTimeSlot.startTimeStamp.toString());
        }
      }
      progressBar.stop();

      const secondTimeSlot = await inflation.getCurrentTimeSlot();

      // New time slot should be initialized
      assert.isTrue(firstTimeSlotStart.lt(BN(secondTimeSlot.startTimeStamp.toString())));
      // Should recognize more inflation
      assert.equal(
        secondTimeSlot.recognizedInflationWei.toString(), 
        circulatingSupply.mul(BN(inflationBips)).div(BN(10000)).divn(12).toString()) // 10 percent of initial

      assert.equal(
        ((await getRewardTotals(ftsoRewardManager)).dailyAuthorizedInflation).toString(), 
        firstDayMonth2InflationAuthorized.toString()) 


      // Assert
      // Supply should have a new authorized inflation and the same inflatable balance (nothing was claimed yet)
      const inflatableBalance = await supply.getInflatableBalance();
      const totalInflationAuthorizedWei = await supply.totalInflationAuthorizedWei();
      assert.equal(inflatableBalance.toString(), circulatingSupply.toString());
      assert.equal(totalInflationAuthorizedWei.toString(), expectedInflationAuthorizedWei.toString());   
    });

  });
});
