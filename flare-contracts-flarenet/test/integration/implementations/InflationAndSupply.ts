import { constants, time } from "@openzeppelin/test-helpers";
import { Contracts } from "../../../deployment/scripts/Contracts";
import { 
  FlareDaemonMockInstance,
  InflationInstance,
  EscrowInstance, 
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
const Escrow = artifacts.require("Escrow");

const BN = web3.utils.toBN;

contract(`Inflation.sol and Supply.sol and Escrow.sol; ${getTestFile(__filename)}; Inflation and Supply integration tests`, async accounts => {
  // contains a fresh contract set for each test
  let mockInflationPercentageProvider: PercentageProviderMockInstance;
  let inflation: InflationInstance;
  let mockFlareDaemon: FlareDaemonMockInstance;
  let supply: SupplyInstance;
  let ftsoRewardManager: FtsoRewardManagerInstance;
  let mockClaimSetupManager: MockContractInstance;
  let escrow: EscrowInstance;
  const initialGenesisAmountWei = BN(15000000000).mul(BN(10).pow(BN(18)));
  const foundationSupplyWei = BN(2250000000).mul(BN(10).pow(BN(18)));
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
      [ftsoRewardManager.address]
    );

    // Wire up escrow contract
    const latestStart = (await time.latest()).addn(10 * 24 * 60 * 60); // in 10 days
    escrow = await Escrow.new(accounts[0], ADDRESS_UPDATER, latestStart);

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
    // tell escrow about WNat contract
    await escrow.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.WNAT]),
      [ADDRESS_UPDATER, (await MockContract.new()).address], {from: ADDRESS_UPDATER});
    // enable claiming
    await ftsoRewardManager.enableClaims();
    await supply.addTokenPool(escrow.address, 0, {from: accounts[0]});

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

      let firstAnnumStart: BN = BN(0);
      let firstAnnum: any = null;

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
          firstAnnum = await inflation.getCurrentAnnum();
          firstAnnumStart = BN(firstAnnum.startTimeStamp.toString());
        }
      }
      progressBar.stop();

      const secondAnnum = await inflation.getCurrentAnnum();

      // New annum should be initialized
      assert.isTrue(firstAnnumStart.lt(BN(secondAnnum.startTimeStamp.toString())));
      // Should recognize more inflation
      assert.equal(
        secondAnnum.recognizedInflationWei.toString(), 
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

    it("Should continue rolling and update according to claiming schedule from escrow contract", async() => {
      const base_amount = BN(10).pow(BN(9)).muln(100)
      const lockedAmount1 = BN(85).mul(base_amount).div(BN(100));
      await escrow.lock({from: accounts[1], value: lockedAmount1});
      const lockedAmount2 = lockedAmount1.muln(2);
      await escrow.lock({from: accounts[2], value: lockedAmount2});
      const lockedAmount3 = lockedAmount1.muln(3);
      await escrow.lock({from: accounts[3], value: lockedAmount3});

      const fullLockedAmount = lockedAmount1.add(lockedAmount2).add(lockedAmount3);

      // Assemble
      const firstMonthInflationAuthorized = circulatingSupply.sub(fullLockedAmount).mul(BN(inflationBips)).div(BN(10000)).divn(12);

      // After first month it will recognize locked amounts
      const firstDayMonth2InflationAuthorized = circulatingSupply.sub(fullLockedAmount).mul(BN(inflationBips)).div(BN(10000)).divn(12).div(BN(30));
      // Total inflation authorized over 1 month + 1 day
      const expectedInflationAuthorizedWei = firstMonthInflationAuthorized.add(firstDayMonth2InflationAuthorized).addn(0);

      let firstAnnumStart: BN = BN(0);
      let firstAnnum: any = null;
      
      // Act
      // Force a block in order to get most up to date time
      await time.advanceBlock();
      const now = (await time.latest()).addn(10);
      await escrow.setClaimingStartTs(now, {from: accounts[0]});
      await time.increaseTo(now.addn(24*60*60*30));
      await time.advanceBlock();

      // Wait one month
      for (let i = 0; i < 31; i++) {
        // Advance time to next day if not day 0
        if (i != 0) {
          await time.increase(86400);
        }
        // Pulse inflation for that day by calling daemon
        await mockFlareDaemon.trigger();
        if(i == 0){
          firstAnnum = await inflation.getCurrentAnnum();
          firstAnnumStart = BN(firstAnnum.startTimeStamp.toString());
        }
      }
      const secondAnnum = await inflation.getCurrentAnnum();
      
      // New annum should be initialized
      assert.isTrue(firstAnnumStart.lt(BN(secondAnnum.startTimeStamp.toString())));
      // Should recognize more inflation
      assert.equal(
        secondAnnum.recognizedInflationWei.toString(), 
        circulatingSupply.sub(fullLockedAmount).mul(BN(inflationBips)).div(BN(10000)).divn(12).toString()) // 10 percent of initial ()

      assert.equal(
        ((await getRewardTotals(ftsoRewardManager)).dailyAuthorizedInflation).toString(), 
        firstDayMonth2InflationAuthorized.toString()) 


      // Assert
      // Supply should have a new authorized inflation and the same inflatable balance (nothing was claimed yet)
      const inflatableBalance = await supply.getInflatableBalance();
      const totalInflationAuthorizedWei = await supply.totalInflationAuthorizedWei();
      assert.equal(inflatableBalance.toString(), circulatingSupply.sub(fullLockedAmount).toString());
      assert.equal(totalInflationAuthorizedWei.toString(), expectedInflationAuthorizedWei.toString());   

      // Claim from some of the accounts
      await time.advanceBlock();
      const now2 = await time.latest()

      await escrow.claim({from: accounts[1]});
      await escrow.claim({from: accounts[3]});

      const claimed1 = (await escrow.lockedAmounts(accounts[1]))[1];
      const claimed3 = (await escrow.lockedAmounts(accounts[3]))[1];
      assert.equal(base_amount.muln(1).muln(237*2).divn(10000).toString(), claimed1.toString());
      assert.equal(base_amount.muln(3).muln(237*2).divn(10000).toString(), claimed3.toString());

      // Wait one month
      for (let i = 0; i < 31; i++) {
        // Advance time to next day if not day 0
        if (i != 0) {
          await time.increase(86400);
        }
        // Pulse inflation for that day by calling daemon
        await mockFlareDaemon.trigger();
      }

      const thirdAnnum = await inflation.getCurrentAnnum();
      
      // New annum should be initialized
      assert.isTrue(BN(secondAnnum.startTimeStamp.toString()).lt(BN(thirdAnnum.startTimeStamp.toString())));
      // Should recognize more inflation
      assert.equal(
        thirdAnnum.recognizedInflationWei.toString(), 
        circulatingSupply.sub(fullLockedAmount).add(claimed1).add(claimed3).mul(BN(inflationBips)).div(BN(10000)).divn(12).toString()
        )
         // recognized in annum3 (smaller base with some claims)

      assert.equal(
        ((await getRewardTotals(ftsoRewardManager)).dailyAuthorizedInflation).toString(), 
        (circulatingSupply.sub(fullLockedAmount).add(claimed1).add(claimed3).mul(BN(inflationBips)).div(BN(10000)).divn(12).divn(30)).toString()) 

      const month3InflationAuthorized = circulatingSupply.sub(fullLockedAmount).add(claimed1).add(claimed3).mul(BN(inflationBips)).div(BN(10000)).divn(12).divn(30);
      // Assert
      // Supply should have a new authorized inflation and the same inflatable balance
      const inflatableBalance2 = await supply.getInflatableBalance();
      const totalInflationAuthorizedWei2 = await supply.totalInflationAuthorizedWei();
      assert.equal(inflatableBalance2.toString(), circulatingSupply.sub(fullLockedAmount).add(claimed1).add(claimed3).toString());
      assert.equal(
        totalInflationAuthorizedWei2.toString(), 
        firstMonthInflationAuthorized.muln(2).add(month3InflationAuthorized).toString()
      );   
    });
  });
});
