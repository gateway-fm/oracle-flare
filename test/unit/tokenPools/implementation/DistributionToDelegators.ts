import { constants, expectEvent, expectRevert, time } from '@openzeppelin/test-helpers';
import { Contracts } from "../../../../deployment/scripts/Contracts";
import { ClaimSetupManagerInstance, DistributionToDelegatorsInstance, DistributionTreasuryInstance, MockContractInstance, SupplyInstance, WNatInstance } from "../../../../typechain-truffle";
import { GOVERNANCE_GENESIS_ADDRESS } from "../../../utils/constants";
import { calcGasCost } from '../../../utils/eth';
import { encodeContractNames, toBN } from "../../../utils/test-helpers";

const getTestFile = require('../../../utils/constants').getTestFile;

const BN = web3.utils.toBN;

const ClaimSetupManager = artifacts.require("ClaimSetupManager");
const DelegationAccount = artifacts.require("DelegationAccount");
const DistributionTreasury = artifacts.require("DistributionTreasury");
const DistributionToDelegators = artifacts.require("DistributionToDelegators");
const MockContract = artifacts.require("MockContract");
const SuicidalMock = artifacts.require("SuicidalMock");
const WNat = artifacts.require("WNat");
const Supply = artifacts.require("Supply");
const GasConsumer = artifacts.require("GasConsumer2");

const ERR_ONLY_GOVERNANCE = "only governance";
const ERR_ADDRESS_ZERO = "address zero";
const ERR_BALANCE_TOO_LOW = "balance too low";
const ERR_IN_THE_PAST = "in the past";
const ERR_OPT_OUT = "already opted out";
const ERR_NOT_OPT_OUT = "not opted out"
const ERR_NOT_STARTED = "not started";
const ERR_ALREADY_FINISHED = "already finished";
const ERR_MONTH_EXPIRED = "month expired";
const ERR_MONTH_NOT_CLAIMABLE = "month not claimable";
const ERR_MONTH_NOT_CLAIMABLE_YET = "month not claimable yet";
const ERR_NO_MONTH_CLAIMABLE = "no month claimable";
const ERR_WRONG_START_TIMESTAMP = "wrong start timestamp";
const ERR_ALREADY_STARTED = "already started";
const ERR_TREASURY_ONLY = "treasury only";
const ERR_OWNER_OR_EXECUTOR_ONLY = "only owner or executor";
const ERR_RECIPIENT_NOT_ALLOWED = "recipient not allowed";
const ERR_STOPPED = "stopped";
const ERR_NOT_STOPPED = "not stopped";
const ERR_SENDING_FUNDS_BACK = "sending funds back failed";

let priceSubmitterMock: MockContractInstance;
let wNatMock: MockContractInstance;
let supply: SupplyInstance;
let claimSetupManager: ClaimSetupManagerInstance;
let wNatInterface: WNatInstance;
let distributionTreasury: DistributionTreasuryInstance;
let distribution: DistributionToDelegatorsInstance;
let FLARE_DAEMON: string;
let ADDRESS_UPDATER: string;
let INFLATION_ADDRESS: string;

async function bestowClaimableBalance(balance: BN) {
  // Give the distribution contract the native token required to be in balance with entitlements
  // Our subversive attacker will be suiciding some native token into flareDaemon
  const suicidalMock = await SuicidalMock.new(distributionTreasury.address);
  // Give suicidal some native token
  await web3.eth.sendTransaction({ from: GOVERNANCE_GENESIS_ADDRESS, to: suicidalMock.address, value: balance });
  // Attacker dies
  await suicidalMock.die();
}

// WARNING: using givenMethodReturn instead of givenCalldataReturn may cause problems
async function setMockBalances(startBlockNumber: number, numberOfBlocks: number, addresses: string[], wNatBalances: number[]) {
  const len = addresses.length;
  assert(len == wNatBalances.length, "addresses length does not match wNatBalances length");

  for (let block = startBlockNumber; block < startBlockNumber + numberOfBlocks; block++) {
    let totalSupply = 0;
    for (let i = 0; i < len; i++) {
      const balanceOfAt = wNatInterface.contract.methods.balanceOfAt(addresses[i], block).encodeABI();
      const balanceOfAtReturn = web3.eth.abi.encodeParameter('uint256', wNatBalances[i]);
      await wNatMock.givenCalldataReturn(balanceOfAt, balanceOfAtReturn);
      totalSupply += wNatBalances[i];
    }

    const totalSupplyAt = wNatInterface.contract.methods.totalSupplyAt(block).encodeABI();
    const totalSupplyAtReturn = web3.eth.abi.encodeParameter('uint256', totalSupply);
    await wNatMock.givenCalldataReturn(totalSupplyAt, totalSupplyAtReturn);
  }
}

async function createSomeBlocksAndProceed(now: BN, proceedDays: number) {
  for (let i = 1; i <= proceedDays; i++) {
    await distribution.daemonize({from: FLARE_DAEMON});
    for (let j = 0; j < 10; j++) {
      await time.increase(6000);
    }
    await time.increaseTo(now.addn(i * 86400));
  }
  await distribution.daemonize({from: FLARE_DAEMON});
}

contract(`DistributionToDelegators.sol; ${getTestFile(__filename)}; DistributionToDelegators unit tests`, async accounts => {
  const GOVERNANCE_ADDRESS = accounts[10];
  FLARE_DAEMON = accounts[15];
  ADDRESS_UPDATER = accounts[16];
  INFLATION_ADDRESS = accounts[17];
  const totalEntitlementWei = toBN(100000);
  let latestStart: BN;


  beforeEach(async () => {
    wNatInterface = await WNat.new(accounts[0], "Wrapped NAT", "WNAT");
    priceSubmitterMock = await MockContract.new();
    wNatMock = await MockContract.new();
    supply = await Supply.new(GOVERNANCE_ADDRESS, ADDRESS_UPDATER, 10000000, 9000000, []);
    claimSetupManager = await ClaimSetupManager.new(GOVERNANCE_ADDRESS, ADDRESS_UPDATER, 3, 0, 100, 1000);
    const delegationAccount = await DelegationAccount.new()
    const ftsoManagerMock = await MockContract.new();
    await claimSetupManager.setLibraryAddress(delegationAccount.address, { from: GOVERNANCE_ADDRESS });
    distributionTreasury = await DistributionTreasury.new(GOVERNANCE_GENESIS_ADDRESS);
    await bestowClaimableBalance(totalEntitlementWei);
    latestStart = (await time.latest()).addn(10 * 24 * 60 * 60); // in 10 days
    distribution = await DistributionToDelegators.new(GOVERNANCE_ADDRESS, FLARE_DAEMON, ADDRESS_UPDATER, distributionTreasury.address, totalEntitlementWei, latestStart);
    // set distribution contract
    await distributionTreasury.setDistributionContract( distribution.address, {from: GOVERNANCE_GENESIS_ADDRESS});

    await distribution.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.WNAT, Contracts.SUPPLY, Contracts.CLAIM_SETUP_MANAGER, Contracts.PRICE_SUBMITTER, Contracts.COMBINED_NAT]),
      [ADDRESS_UPDATER, wNatMock.address, supply.address, claimSetupManager.address, priceSubmitterMock.address, wNatMock.address], {from: ADDRESS_UPDATER});

    await claimSetupManager.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.WNAT, Contracts.FTSO_MANAGER]),
      [ADDRESS_UPDATER, wNatMock.address, ftsoManagerMock.address], {from: ADDRESS_UPDATER});

    await supply.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION]),
      [ADDRESS_UPDATER, INFLATION_ADDRESS], {from: ADDRESS_UPDATER});

    await supply.addTokenPool(distribution.address, totalEntitlementWei, {from: GOVERNANCE_ADDRESS});
  });

  describe("Basic", async () => {

    it("Should revert if treasury contract zero", async () => {
      // Assemble
      // Act
      const distributionPromise = DistributionToDelegators.new(GOVERNANCE_ADDRESS, FLARE_DAEMON, ADDRESS_UPDATER, constants.ZERO_ADDRESS, totalEntitlementWei, latestStart);
      // Assert
      await expectRevert(distributionPromise, ERR_ADDRESS_ZERO);
    });

    it("Should revert if latest start time in the past", async () => {
      // Assemble
      // Act
      const distributionPromise = DistributionToDelegators.new(GOVERNANCE_ADDRESS, FLARE_DAEMON, ADDRESS_UPDATER, distributionTreasury.address, totalEntitlementWei, (await time.latest()).subn(5));
      // Assert
      await expectRevert(distributionPromise, ERR_IN_THE_PAST);
    });

    it("Should revert sending founds if not treasury contract", async () => {
      // Assemble
      // Act
      const res = web3.eth.sendTransaction({ from: accounts[0], to: distribution.address, value: 500 });
      // Assert
      await expectRevert(res, ERR_TREASURY_ONLY)
    });

    it("Should only opt out once", async () => {
      // Assemble
      // Act
      // Assert
      const optOutTx = await distribution.optOutOfAirdrop({from: accounts[2]});
      expectEvent(optOutTx, "AccountOptOut", {theAccount: accounts[2], confirmed: false});
      const optOutPromise1 = distribution.optOutOfAirdrop({from: accounts[2]});
      await expectRevert(optOutPromise1, ERR_OPT_OUT);
      const confirmOptOutTx = await distribution.confirmOptOutOfAirdrop([accounts[2]], {from: GOVERNANCE_ADDRESS});
      expectEvent(confirmOptOutTx, "AccountOptOut", {theAccount: accounts[2], confirmed: true});
      const confirmOptOutPromise1 = distribution.confirmOptOutOfAirdrop([accounts[2]], {from: GOVERNANCE_ADDRESS});
      await expectRevert(confirmOptOutPromise1, ERR_OPT_OUT);
      const optOutPromise2 = distribution.optOutOfAirdrop({from: accounts[2]});
      await expectRevert(optOutPromise2, ERR_OPT_OUT);
    });

    it("Should not confirm opt out if user has not opted out", async () => {
      // Assemble
      // Act
      const confirmOptOutPromise1 = distribution.confirmOptOutOfAirdrop([accounts[2]], {from: GOVERNANCE_ADDRESS});
      // Assert
      await expectRevert(confirmOptOutPromise1, ERR_NOT_OPT_OUT);
    });

    it("Should not confirm opt out if not from governance", async () => {
      // Assemble
      // Act
      const confirmOptOutPromise1 = distribution.confirmOptOutOfAirdrop([accounts[2]], {from: accounts[1]});
      // Assert
      await expectRevert(confirmOptOutPromise1, ERR_ONLY_GOVERNANCE);
    });

    it("Should not stop distribution if not from governance", async () => {
      // Assemble
      // Act
      const stopPromise = distribution.stop({from: accounts[1]});
      // Assert
      await expectRevert(stopPromise, ERR_ONLY_GOVERNANCE);
    });

    it("Should not send funds back to treasury if not from governance", async () => {
      // Assemble
      // Act
      const sendFundsBackToTreasuryPromise = distribution.sendFundsBackToTreasury({from: accounts[1]});
      // Assert
      await expectRevert(sendFundsBackToTreasuryPromise, ERR_ONLY_GOVERNANCE);
    });

    it("Should not send funds back to treasury if not stopped", async () => {
      // Assemble
      // Act
      const sendFundsBackToTreasuryPromise = distribution.sendFundsBackToTreasury({from: GOVERNANCE_ADDRESS});
      // Assert
      await expectRevert(sendFundsBackToTreasuryPromise, ERR_NOT_STOPPED);
    });

    it("Should revert at sending funds back to treasury if distribution already changed", async () => {
      // Assemble
      await distribution.stop({from: GOVERNANCE_ADDRESS});
      await distributionTreasury.setDistributionContract(accounts[100], {from: GOVERNANCE_GENESIS_ADDRESS});
      // Act
      const sendFundsBackToTreasuryPromise = distribution.sendFundsBackToTreasury({from: GOVERNANCE_ADDRESS});
      // Assert
      await expectRevert(sendFundsBackToTreasuryPromise, ERR_SENDING_FUNDS_BACK);
    });

    it("Should switch use good random flag", async () => {
      // Assemble
      // Act
      await distribution.setUseGoodRandom(true, 1, {from: GOVERNANCE_ADDRESS});
      // Assert
      assert.isTrue(await distribution.useGoodRandom());
      assert.equal((await distribution.maxWaitForGoodRandomSeconds()).toNumber(), 1);
    });

    it("Should switch use good random flag 2", async () => {
      // Assemble
      await distribution.setUseGoodRandom(true, 1, {from: GOVERNANCE_ADDRESS});
      // Act
      await distribution.setUseGoodRandom(false, 0, {from: GOVERNANCE_ADDRESS});
      // Assert
      assert.isFalse(await distribution.useGoodRandom());
      assert.equal((await distribution.maxWaitForGoodRandomSeconds()).toNumber(), 0);
    });

    it("Should revert switch to good random if invalid parameters", async () => {
      // Assemble
      // Act
      // Assert
      await expectRevert(distribution.setUseGoodRandom(true, 0, {from: GOVERNANCE_ADDRESS}), "invalid parameters");
      await expectRevert(distribution.setUseGoodRandom(true, 7 * 24 * 3600 + 1, {from: GOVERNANCE_ADDRESS}), "invalid parameters"); // 7 days max
      await expectRevert(distribution.setUseGoodRandom(false, 1, {from: GOVERNANCE_ADDRESS}), "invalid parameters");
    });

    it("Should not switch to good random if not from governance", async () => {
      // Assemble
      // Act
      const setUseGoodRandomPromise = distribution.setUseGoodRandom(true, 1, {from: accounts[1]});
      // Assert
      await expectRevert(setUseGoodRandomPromise, ERR_ONLY_GOVERNANCE);
      assert.isFalse(await distribution.useGoodRandom());
    });

    it("Should add executors", async() => {
      // Assemble
      // Act
      await claimSetupManager.setClaimExecutors([accounts[2], accounts[3]], { from: accounts[1] });
      // Assert
      const executors = await claimSetupManager.claimExecutors(accounts[1]);
      expect(executors[0]).to.equals(accounts[2]);
      expect(executors[1]).to.equals(accounts[3]);
      expect(executors.length).to.equals(2);
    });

    it("Should remove executors", async() => {
      // Assemble
      await claimSetupManager.setClaimExecutors([accounts[2]], { from: accounts[1] });
      // Act
      await claimSetupManager.setClaimExecutors([], { from: accounts[1] });
      // Assert
      const executors = await claimSetupManager.claimExecutors(accounts[1]);
      expect(executors.length).to.equals(0);
    });

    it("Should add recipients", async() => {
      // Assemble
      // Act
      await claimSetupManager.setAllowedClaimRecipients([accounts[2], accounts[3]], { from: accounts[1] });
      // Assert
      const recipients = await claimSetupManager.allowedClaimRecipients(accounts[1]);
      expect(recipients[0]).to.equals(accounts[2]);
      expect(recipients[1]).to.equals(accounts[3]);
      expect(recipients.length).to.equals(2);
    });

    it("Should remove recipients", async() => {
      // Assemble
      await claimSetupManager.setAllowedClaimRecipients([accounts[2]], { from: accounts[1] });
      // Act
      await claimSetupManager.setAllowedClaimRecipients([], { from: accounts[1] });
      // Assert
      const recipients = await claimSetupManager.allowedClaimRecipients(accounts[1]);
      expect(recipients.length).to.equals(0);
    });
  });

  describe("Claiming", async () => {

    it("Should not be able to claim anything before day 0", async () => {
      // Assemble
      await time.advanceBlock();
      const start = (await time.latest()).addn(10);
      await distribution.setEntitlementStart(start, {from: GOVERNANCE_ADDRESS});
      // Act
      const claimableTx = distribution.getClaimableAmount(0);
      const claimableOfTx = distribution.getClaimableAmountOf(accounts[0], 0);
      const claimTx = distribution.claim(accounts[0], accounts[0], 0, false);
      const claimAutoTx = distribution.autoClaim([accounts[0]], 0);
      // Assert
      await expectRevert(claimableTx, ERR_NOT_STARTED);
      await expectRevert(claimableOfTx, ERR_NOT_STARTED);
      await expectRevert(claimTx, ERR_NOT_STARTED);
      await expectRevert(claimAutoTx, ERR_NOT_STARTED);
    });

    it("Should not be able to claim anything from month >= 36", async () => {
      // Assemble
      await time.advanceBlock();
      const start = (await time.latest()).addn(1);
      await distribution.setEntitlementStart(start, {from: GOVERNANCE_ADDRESS});
      await time.increase(1);
      // Act
      // Assert
      const claimableTx = distribution.getClaimableAmount(36);
      await expectRevert(claimableTx, ERR_MONTH_NOT_CLAIMABLE);
      const claimTx = distribution.claim(accounts[0], accounts[0], 36, false);
      await expectRevert(claimTx, ERR_MONTH_NOT_CLAIMABLE);
    });

    it("Should not be able to claim anything if stopped", async () => {
      // Assemble
      await time.advanceBlock();
      const start = (await time.latest()).addn(1);
      await distribution.setEntitlementStart(start, {from: GOVERNANCE_ADDRESS});
      await createSomeBlocksAndProceed(start, 30);
      // Act
      await distribution.stop({from: GOVERNANCE_ADDRESS});
      const claimTx = distribution.claim(accounts[0], accounts[0], 0, false);
      const claimAutoTx = distribution.autoClaim([accounts[0]], 0);
      // Assert
      await expectRevert(claimTx, ERR_STOPPED);
      await expectRevert(claimAutoTx, ERR_STOPPED);
    });

    it("Should not be able to claim anything on day 0", async () => {
      // Assemble
      await time.advanceBlock();
      const start = (await time.latest()).addn(1);
      await distribution.setEntitlementStart(start, {from: GOVERNANCE_ADDRESS});
      await time.increase(1);
      // Act
      // Assert
      const claimableTx = distribution.getClaimableAmount(0);
      await expectRevert(claimableTx, ERR_MONTH_NOT_CLAIMABLE_YET);
      const claimTx = distribution.claim(accounts[0], accounts[0], 0, false);
      await expectRevert(claimTx, ERR_MONTH_NOT_CLAIMABLE_YET);
    });

    it("Should correctly return claimable months", async () => {
      // Assemble
      await time.advanceBlock();
      const start = (await time.latest()).addn(1);
      await distribution.setEntitlementStart(start, {from: GOVERNANCE_ADDRESS});
      await createSomeBlocksAndProceed(await time.latest(), 29);
      await time.increaseTo(start.addn(86400 * 30 + 500));
      // Act
      // Assert
      await expectRevert(distribution.getClaimableMonths(), ERR_NO_MONTH_CLAIMABLE);
      await distribution.daemonize({from: FLARE_DAEMON});
      const { 0: startMonth, 1: endMonth } = await distribution.getClaimableMonths();
      assert.equal(startMonth.toNumber(), 0);
      assert.equal(endMonth.toNumber(), 0);

      for (let i = 1; i < 36; i++) {
        await createSomeBlocksAndProceed(await time.latest(), 30);
        const { 0: startMonth1, 1: endMonth1 } = await distribution.getClaimableMonths();
        assert.equal(startMonth1.toNumber(), i - 1);
        assert.equal(endMonth1.toNumber(), i);

        const cleanupBlockNumber = (await distribution.startBlockNumber(i - 1)).toNumber() + 1;
        const cleanupBlockNumberWnat = wNatInterface.contract.methods.cleanupBlockNumber().encodeABI();
        await wNatMock.givenCalldataReturnUint(cleanupBlockNumberWnat, cleanupBlockNumber);
      }
      await createSomeBlocksAndProceed(await time.latest(), 30);
      const { 0: startMonth2, 1: endMonth2 } = await distribution.getClaimableMonths();
      assert.equal(startMonth2.toNumber(), 35);
      assert.equal(endMonth2.toNumber(), 35);

      await createSomeBlocksAndProceed(await time.latest(), 30);
      const cleanupBlockNumber = (await distribution.startBlockNumber(35)).toNumber() + 1;
      const cleanupBlockNumberWnat = wNatInterface.contract.methods.cleanupBlockNumber().encodeABI();
      await wNatMock.givenCalldataReturnUint(cleanupBlockNumberWnat, cleanupBlockNumber);
      await expectRevert(distribution.getClaimableMonths(), ERR_ALREADY_FINISHED);
    });

    it("Should be able to claim 2.37% after day 30 on private or personal delegation account", async () => {
      let gasConsumer = await GasConsumer.new(3);
      // Assemble
      const days = 30;
      const addresses = [accounts[1], accounts[2], accounts[3]];
      const wNatBalances1 = [500, 2000, 1500];
      const wNatBalances2 = [600, 1800, 2000];
      const wNatBalances3 = [1000, 800, 2100];
      const numberOfBlocks = 12 * (days - 7);
      const startBlockNumber = (await time.latestBlock()).toNumber() + numberOfBlocks * (addresses.length + 1) + 2 + 7 * 12;
      await setMockBalances(startBlockNumber, numberOfBlocks / 3, addresses, wNatBalances1);
      await setMockBalances(startBlockNumber + numberOfBlocks / 3, numberOfBlocks / 3, addresses, wNatBalances2);
      await setMockBalances(startBlockNumber + 2 * numberOfBlocks / 3, numberOfBlocks / 3, addresses, wNatBalances3);
      const start = (await time.latest()).addn(1);
      await distribution.setEntitlementStart(start, {from: GOVERNANCE_ADDRESS});
      await createSomeBlocksAndProceed(start, days);
      // Act
      const claimable1 = await distribution.getClaimableAmount(0, {from: accounts[1]});
      const startBalance5 = toBN(await web3.eth.getBalance(accounts[5]));
      const claim = distribution.claim(accounts[1], gasConsumer.address, 0, false, {from: accounts[1]});
      await expectRevert(claim, "claim failed")
      const claimTx1 = await distribution.claim(accounts[1], accounts[5], 0, false, {from: accounts[1]});
      const endBalance5 = toBN(await web3.eth.getBalance(accounts[5]));

      const executor = accounts[55];
      await claimSetupManager.setClaimExecutors([executor], { from: accounts[2] });
      const claimable2 = await distribution.getClaimableAmount(0, {from: accounts[2]});
      const startBalance6 = toBN(await web3.eth.getBalance(accounts[2]));
      await expectRevert(distribution.claim(accounts[2], accounts[50], 0, false, { from: accounts[8] }), ERR_OWNER_OR_EXECUTOR_ONLY);
      await expectRevert(distribution.claim(accounts[2], accounts[50], 0, false, { from: executor }), ERR_RECIPIENT_NOT_ALLOWED);
      const claimTx2 = await distribution.claim(accounts[2], accounts[2], 0, false, {from: executor});
      const endBalance6 = toBN(await web3.eth.getBalance(accounts[2]));

      await claimSetupManager.setClaimExecutors([executor], { from: accounts[3] });
      await claimSetupManager.enableDelegationAccount({ from: accounts[3] });
      const accountToDelegationAccount = await claimSetupManager.accountToDelegationAccount(accounts[3]);
      await expectRevert(distribution.claim(accounts[3], accountToDelegationAccount, 0, false, { from: accounts[2] }), ERR_OWNER_OR_EXECUTOR_ONLY);

      const claimable3 = await distribution.getClaimableAmount(0, {from: accounts[3]});
      const startBalance7 = toBN(await web3.eth.getBalance(wNatMock.address));
      const claimTx3 = await distribution.claim(accounts[3], accountToDelegationAccount, 0, false, { from: executor })
      const endBalance7 = toBN(await web3.eth.getBalance(wNatMock.address));
      // Assert
      assert.equal(claimable1.toNumber(), totalEntitlementWei.muln(237).divn(8500).muln(500 + 600 + 1000).divn(500 + 600 + 1000 + 2000 + 1800 + 800 + 1500 + 2000 + 2100).toNumber());
      expectEvent(claimTx1, "AccountClaimed", {whoClaimed: accounts[1], sentTo: accounts[5], month: toBN(0), amountWei: claimable1});
      expect(endBalance5.sub(startBalance5).toNumber()).to.equals(claimable1.toNumber());
      assert.equal(claimable2.toNumber(), totalEntitlementWei.muln(237).divn(8500).sub(claimable1).muln(2000 + 1800 + 800).divn(2000 + 1800 + 800 + 1500 + 2000 + 2100).toNumber());
      expectEvent(claimTx2, "AccountClaimed", {whoClaimed: accounts[2], sentTo: accounts[2], month: toBN(0), amountWei: claimable2});
      expect(endBalance6.sub(startBalance6).toNumber()).to.equals(claimable2.toNumber());
      assert.equal(claimable3.toNumber(), totalEntitlementWei.muln(237).divn(8500).sub(claimable1).sub(claimable2).toNumber());
      expectEvent(claimTx3, "AccountClaimed", {whoClaimed: accounts[3], sentTo: accountToDelegationAccount, month: toBN(0), amountWei: claimable3});
      expect(endBalance7.sub(startBalance7).toNumber()).to.equals(claimable3.toNumber());
      expect((await distribution.startBlockNumber(0)).toNumber()).to.equals(startBlockNumber);
      expect((await distribution.endBlockNumber(0)).toNumber()).to.equals(startBlockNumber + numberOfBlocks);
      expect((await distribution.totalClaimedWei()).toNumber()).to.equals(claimable1.add(claimable2).add(claimable3).toNumber());
      expect((await distribution.totalClaimedWei()).toNumber()).to.equals((await distribution.totalAvailableAmount(0)).toNumber());
      expect((await distribution.totalUnclaimedAmount(0)).toNumber()).to.equals(0);
      expect((await distribution.totalUnclaimedWeight(0)).toNumber()).to.equals(0);
    });

    it("Should be able to claim 2.37% after day 30 and a good random", async () => {
      // Assemble
      const getCurrentRandomWithQuality = web3.utils.sha3("getCurrentRandomWithQuality()")!.slice(0, 10); // first 4 bytes is function selector
      const getCurrentRandomWithQualityReturn = web3.eth.abi.encodeParameters(
        ['uint256', 'bool'],
        [0, false]);
      await priceSubmitterMock.givenMethodReturn(getCurrentRandomWithQuality, getCurrentRandomWithQualityReturn);
      await distribution.setUseGoodRandom(true, 50, {from: GOVERNANCE_ADDRESS});
      const days = 30;
      const addresses = [accounts[1], accounts[2], accounts[3]];
      const wNatBalances1 = [500, 2000, 1500];
      const wNatBalances2 = [600, 1800, 2000];
      const wNatBalances3 = [1000, 800, 2100];
      const numberOfBlocks = 12 * (days - 7);
      const startBlockNumber = (await time.latestBlock()).toNumber() + numberOfBlocks * (addresses.length + 1) + 2 + 7 * 12;
      await setMockBalances(startBlockNumber, numberOfBlocks / 3, addresses, wNatBalances1);
      await setMockBalances(startBlockNumber + numberOfBlocks / 3, numberOfBlocks / 3, addresses, wNatBalances2);
      await setMockBalances(startBlockNumber + 2 * numberOfBlocks / 3, numberOfBlocks / 3, addresses, wNatBalances3);
      const start = (await time.latest()).addn(1);
      await distribution.setEntitlementStart(start, {from: GOVERNANCE_ADDRESS});
      await createSomeBlocksAndProceed(start, days);
      const waitingSinceTs = (await time.latest()).toNumber();
      assert.equal((await distribution.waitingForGoodRandomSinceTs()).toNumber(), waitingSinceTs);

      await expectRevert(distribution.getClaimableAmount(0, {from: accounts[1]}), ERR_MONTH_NOT_CLAIMABLE_YET);
      await expectRevert(distribution.claim(accounts[1], accounts[5], 0, false, {from: accounts[1]}), ERR_MONTH_NOT_CLAIMABLE_YET);

      await distribution.daemonize({from: FLARE_DAEMON});
      assert.equal((await distribution.waitingForGoodRandomSinceTs()).toNumber(), waitingSinceTs);

      await expectRevert(distribution.getClaimableAmount(0, {from: accounts[1]}), ERR_MONTH_NOT_CLAIMABLE_YET);
      await expectRevert(distribution.claim(accounts[1], accounts[5], 0, false, {from: accounts[1]}), ERR_MONTH_NOT_CLAIMABLE_YET);

      const getCurrentRandomWithQualityReturn2 = web3.eth.abi.encodeParameters(
        ['uint256', 'bool'],
        [0, true]);
      await priceSubmitterMock.givenMethodReturn(getCurrentRandomWithQuality, getCurrentRandomWithQualityReturn2);
      await distribution.daemonize({from: FLARE_DAEMON});
      assert.equal((await distribution.waitingForGoodRandomSinceTs()).toNumber(), 0);

      // Act
      const claimable1 = await distribution.getClaimableAmount(0, {from: accounts[1]});
      const startBalance5 = toBN(await web3.eth.getBalance(accounts[5]));
      const claimTx1 = await distribution.claim(accounts[1], accounts[5], 0, false, {from: accounts[1]});
      const endBalance5 = toBN(await web3.eth.getBalance(accounts[5]));

      const executor = accounts[55];
      await claimSetupManager.setClaimExecutors([executor], { from: accounts[2] });
      const claimable2 = await distribution.getClaimableAmount(0, {from: accounts[2]});
      const startBalance6 = toBN(await web3.eth.getBalance(accounts[2]));
      await expectRevert(distribution.claim(accounts[2], accounts[50], 0, false, { from: accounts[8] }), ERR_OWNER_OR_EXECUTOR_ONLY);
      await expectRevert(distribution.claim(accounts[2], accounts[50], 0, false, { from: executor }), ERR_RECIPIENT_NOT_ALLOWED);
      const claimTx2 = await distribution.claim(accounts[2], accounts[2], 0, false, {from: executor});
      const endBalance6 = toBN(await web3.eth.getBalance(accounts[2]));

      await claimSetupManager.setClaimExecutors([executor], { from: accounts[3] });
      await claimSetupManager.enableDelegationAccount({ from: accounts[3] });
      const accountToDelegationAccount = await claimSetupManager.accountToDelegationAccount(accounts[3]);
      await expectRevert(distribution.claim(accounts[3], accountToDelegationAccount, 0, false, { from: accounts[2] }), ERR_OWNER_OR_EXECUTOR_ONLY);

      const claimable3 = await distribution.getClaimableAmount(0, {from: accounts[3]});
      const startBalance7 = toBN(await web3.eth.getBalance(wNatMock.address));
      const claimTx3 = await distribution.claim(accounts[3], accountToDelegationAccount, 0, false, { from: executor })
      const endBalance7 = toBN(await web3.eth.getBalance(wNatMock.address));
      // Assert
      assert.equal(claimable1.toNumber(), totalEntitlementWei.muln(237).divn(8500).muln(500 + 600 + 1000).divn(500 + 600 + 1000 + 2000 + 1800 + 800 + 1500 + 2000 + 2100).toNumber());
      expectEvent(claimTx1, "AccountClaimed", {whoClaimed: accounts[1], sentTo: accounts[5], month: toBN(0), amountWei: claimable1});
      expect(endBalance5.sub(startBalance5).toNumber()).to.equals(claimable1.toNumber());
      assert.equal(claimable2.toNumber(), totalEntitlementWei.muln(237).divn(8500).sub(claimable1).muln(2000 + 1800 + 800).divn(2000 + 1800 + 800 + 1500 + 2000 + 2100).toNumber());
      expectEvent(claimTx2, "AccountClaimed", {whoClaimed: accounts[2], sentTo: accounts[2], month: toBN(0), amountWei: claimable2});
      expect(endBalance6.sub(startBalance6).toNumber()).to.equals(claimable2.toNumber());
      assert.equal(claimable3.toNumber(), totalEntitlementWei.muln(237).divn(8500).sub(claimable1).sub(claimable2).toNumber());
      expectEvent(claimTx3, "AccountClaimed", {whoClaimed: accounts[3], sentTo: accountToDelegationAccount, month: toBN(0), amountWei: claimable3});
      expect(endBalance7.sub(startBalance7).toNumber()).to.equals(claimable3.toNumber());
      expect((await distribution.startBlockNumber(0)).toNumber()).to.equals(startBlockNumber);
      expect((await distribution.endBlockNumber(0)).toNumber()).to.equals(startBlockNumber + numberOfBlocks);
      expect((await distribution.totalClaimedWei()).toNumber()).to.equals(claimable1.add(claimable2).add(claimable3).toNumber());
      expect((await distribution.totalClaimedWei()).toNumber()).to.equals((await distribution.totalAvailableAmount(0)).toNumber());
      expect((await distribution.totalUnclaimedAmount(0)).toNumber()).to.equals(0);
      expect((await distribution.totalUnclaimedWeight(0)).toNumber()).to.equals(0);
    });

    it("Should be able to claim 2.37% after day 30 and wait time even if no good random", async () => {
      // Assemble
      const getCurrentRandomWithQuality = web3.utils.sha3("getCurrentRandomWithQuality()")!.slice(0, 10); // first 4 bytes is function selector
      const getCurrentRandomWithQualityReturn = web3.eth.abi.encodeParameters(
        ['uint256', 'bool'],
        [0, false]);
      await priceSubmitterMock.givenMethodReturn(getCurrentRandomWithQuality, getCurrentRandomWithQualityReturn);
      await distribution.setUseGoodRandom(true, 50, {from: GOVERNANCE_ADDRESS});
      const days = 30;
      const addresses = [accounts[1], accounts[2], accounts[3]];
      const wNatBalances1 = [500, 2000, 1500];
      const wNatBalances2 = [600, 1800, 2000];
      const wNatBalances3 = [1000, 800, 2100];
      const numberOfBlocks = 12 * (days - 7);
      const startBlockNumber = (await time.latestBlock()).toNumber() + numberOfBlocks * (addresses.length + 1) + 2 + 7 * 12;
      await setMockBalances(startBlockNumber, numberOfBlocks / 3, addresses, wNatBalances1);
      await setMockBalances(startBlockNumber + numberOfBlocks / 3, numberOfBlocks / 3, addresses, wNatBalances2);
      await setMockBalances(startBlockNumber + 2 * numberOfBlocks / 3, numberOfBlocks / 3, addresses, wNatBalances3);
      const start = (await time.latest()).addn(1);
      await distribution.setEntitlementStart(start, {from: GOVERNANCE_ADDRESS});
      await createSomeBlocksAndProceed(start, days);
      const waitingSinceTs = (await time.latest()).toNumber();
      assert.equal((await distribution.waitingForGoodRandomSinceTs()).toNumber(), waitingSinceTs);

      await expectRevert(distribution.getClaimableAmount(0, {from: accounts[1]}), ERR_MONTH_NOT_CLAIMABLE_YET);
      await expectRevert(distribution.claim(accounts[1], accounts[5], 0, false, {from: accounts[1]}), ERR_MONTH_NOT_CLAIMABLE_YET);

      await distribution.daemonize({from: FLARE_DAEMON});
      assert.equal((await distribution.waitingForGoodRandomSinceTs()).toNumber(), waitingSinceTs);

      await expectRevert(distribution.getClaimableAmount(0, {from: accounts[1]}), ERR_MONTH_NOT_CLAIMABLE_YET);
      await expectRevert(distribution.claim(accounts[1], accounts[5], 0, false, {from: accounts[1]}), ERR_MONTH_NOT_CLAIMABLE_YET);

      for (let i = 0; i < 50; i++) {
        await distribution.daemonize({from: FLARE_DAEMON});
      }
      assert.equal((await distribution.waitingForGoodRandomSinceTs()).toNumber(), 0);

      // Act
      const claimable1 = await distribution.getClaimableAmount(0, {from: accounts[1]});
      const startBalance5 = toBN(await web3.eth.getBalance(accounts[5]));
      const claimTx1 = await distribution.claim(accounts[1], accounts[5], 0, false, {from: accounts[1]});
      const endBalance5 = toBN(await web3.eth.getBalance(accounts[5]));

      const executor = accounts[55];
      await claimSetupManager.setClaimExecutors([executor], { from: accounts[2] });
      const claimable2 = await distribution.getClaimableAmount(0, {from: accounts[2]});
      const startBalance6 = toBN(await web3.eth.getBalance(accounts[2]));
      await expectRevert(distribution.claim(accounts[2], accounts[50], 0, false, { from: accounts[8] }), ERR_OWNER_OR_EXECUTOR_ONLY);
      await expectRevert(distribution.claim(accounts[2], accounts[50], 0, false, { from: executor }), ERR_RECIPIENT_NOT_ALLOWED);
      const claimTx2 = await distribution.claim(accounts[2], accounts[2], 0, false, {from: executor});
      const endBalance6 = toBN(await web3.eth.getBalance(accounts[2]));

      await claimSetupManager.setClaimExecutors([executor], { from: accounts[3] });
      await claimSetupManager.enableDelegationAccount({ from: accounts[3] });
      const accountToDelegationAccount = await claimSetupManager.accountToDelegationAccount(accounts[3]);
      await expectRevert(distribution.claim(accounts[3], accountToDelegationAccount, 0, false, { from: accounts[2] }), ERR_OWNER_OR_EXECUTOR_ONLY);

      const claimable3 = await distribution.getClaimableAmount(0, {from: accounts[3]});
      const startBalance7 = toBN(await web3.eth.getBalance(wNatMock.address));
      const claimTx3 = await distribution.claim(accounts[3], accountToDelegationAccount, 0, false, { from: executor })
      const endBalance7 = toBN(await web3.eth.getBalance(wNatMock.address));
      // Assert
      assert.equal(claimable1.toNumber(), totalEntitlementWei.muln(237).divn(8500).muln(500 + 600 + 1000).divn(500 + 600 + 1000 + 2000 + 1800 + 800 + 1500 + 2000 + 2100).toNumber());
      expectEvent(claimTx1, "AccountClaimed", {whoClaimed: accounts[1], sentTo: accounts[5], month: toBN(0), amountWei: claimable1});
      expect(endBalance5.sub(startBalance5).toNumber()).to.equals(claimable1.toNumber());
      assert.equal(claimable2.toNumber(), totalEntitlementWei.muln(237).divn(8500).sub(claimable1).muln(2000 + 1800 + 800).divn(2000 + 1800 + 800 + 1500 + 2000 + 2100).toNumber());
      expectEvent(claimTx2, "AccountClaimed", {whoClaimed: accounts[2], sentTo: accounts[2], month: toBN(0), amountWei: claimable2});
      expect(endBalance6.sub(startBalance6).toNumber()).to.equals(claimable2.toNumber());
      assert.equal(claimable3.toNumber(), totalEntitlementWei.muln(237).divn(8500).sub(claimable1).sub(claimable2).toNumber());
      expectEvent(claimTx3, "AccountClaimed", {whoClaimed: accounts[3], sentTo: accountToDelegationAccount, month: toBN(0), amountWei: claimable3});
      expect(endBalance7.sub(startBalance7).toNumber()).to.equals(claimable3.toNumber());
      expect((await distribution.startBlockNumber(0)).toNumber()).to.equals(startBlockNumber);
      expect((await distribution.endBlockNumber(0)).toNumber()).to.equals(startBlockNumber + numberOfBlocks);
      expect((await distribution.totalClaimedWei()).toNumber()).to.equals(claimable1.add(claimable2).add(claimable3).toNumber());
      expect((await distribution.totalClaimedWei()).toNumber()).to.equals((await distribution.totalAvailableAmount(0)).toNumber());
      expect((await distribution.totalUnclaimedAmount(0)).toNumber()).to.equals(0);
      expect((await distribution.totalUnclaimedWeight(0)).toNumber()).to.equals(0);
    });

    it("Should not be able to claim twice", async () => {
      // Assemble
      const days = 30;
      const balanceOfAt = web3.utils.sha3("balanceOfAt(address,uint256)")!.slice(0, 10); // first 4 bytes is function selector
      const balanceOfAtReturn = web3.eth.abi.encodeParameter('uint256', 500);
      await wNatMock.givenMethodReturn(balanceOfAt, balanceOfAtReturn);

      const totalSupplyAt = web3.utils.sha3("totalSupplyAt(uint256)")!.slice(0, 10); // first 4 bytes is function selector
      const totalSupplyAtReturn = web3.eth.abi.encodeParameter('uint256', 1500);
      await wNatMock.givenMethodReturn(totalSupplyAt, totalSupplyAtReturn);
      const start = (await time.latest()).addn(1);
      await distribution.setEntitlementStart(start, {from: GOVERNANCE_ADDRESS});
      await createSomeBlocksAndProceed(start, days);
      await distribution.daemonize({from: FLARE_DAEMON});
      const claimable0 = await distribution.getClaimableAmount(0, {from: accounts[1]});
      expect(claimable0.toNumber()).to.be.gt(0);

      await createSomeBlocksAndProceed(await time.latest(), days);
      await distribution.daemonize({from: FLARE_DAEMON});
      const claimable1 = await distribution.getClaimableAmount(1, {from: accounts[1]});
      expect(claimable1.toNumber()).to.be.gt(0);

      await createSomeBlocksAndProceed(await time.latest(), days);
      await distribution.daemonize({from: FLARE_DAEMON});
      const claimable2 = await distribution.getClaimableAmount(2, {from: accounts[1]});
      expect(claimable2.toNumber()).to.be.gt(0);

      // Act
      const startBalance5 = toBN(await web3.eth.getBalance(accounts[5]));
      await distribution.claim(accounts[1], accounts[5], 2, false, {from: accounts[1]});
      const endBalance5 = toBN(await web3.eth.getBalance(accounts[5]));

      // Assert
      expect(endBalance5.sub(startBalance5).toNumber()).to.equals(claimable0.add(claimable1).add(claimable2).toNumber());
      expect((await distribution.nextClaimableMonth(accounts[1])).toNumber()).equals(3);
      await distribution.claim(accounts[1], accounts[5], 0, false, {from: accounts[1]});
      expect((await distribution.nextClaimableMonth(accounts[1])).toNumber()).equals(3);

      await distribution.claim(accounts[1], accounts[5], 2, false, {from: accounts[1]});
      const endBalance = toBN(await web3.eth.getBalance(accounts[5]));
      expect(endBalance.sub(endBalance5).toNumber()).to.equals(0);
      expect((await distribution.nextClaimableMonth(accounts[1])).toNumber()).equals(3);
    });

    it("Should not be able to claim after opt out - others can still claim or wrap 2.37% after day 30", async () => {
      // Assemble
      const optOutTx = await distribution.optOutOfAirdrop({from: accounts[2]});
      expectEvent(optOutTx, "AccountOptOut", {theAccount: accounts[2], confirmed: false});
      const confirmOptOutTx = await distribution.confirmOptOutOfAirdrop([accounts[2]], {from: GOVERNANCE_ADDRESS});
      expectEvent(confirmOptOutTx, "AccountOptOut", {theAccount: accounts[2], confirmed: true});
      const days = 30;
      const addresses = [accounts[1], accounts[2], accounts[3]];
      const wNatBalances = [500, 2000, 1500];
      const numberOfBlocks = 12 * days;
      const startBlockNumber = (await time.latestBlock()).toNumber() + numberOfBlocks * (addresses.length + 1) + 4;
      await setMockBalances(startBlockNumber, numberOfBlocks, addresses, wNatBalances);
      await time.advanceBlock();
      const start = (await time.latest()).addn(1);
      await distribution.setEntitlementStart(start, {from: GOVERNANCE_ADDRESS});
      await createSomeBlocksAndProceed(start, days);
      // Act
      const executor = accounts[55];
      await claimSetupManager.setClaimExecutors([executor], { from: accounts[3] });
      await claimSetupManager.setAllowedClaimRecipients([accounts[7]], { from: accounts[3] });
      const claimable1 = await distribution.getClaimableAmount(0, {from: accounts[1]});
      const startBalance5 = toBN(await web3.eth.getBalance(accounts[5]));
      const claimTx1 = await distribution.claim(accounts[1], accounts[5], 0, false, {from: accounts[1]});
      const endBalance5 = toBN(await web3.eth.getBalance(accounts[5]));
      const claimable1_after = await distribution.getClaimableAmountOf(accounts[1], 0);
      const claimable4_1 = await distribution.getClaimableAmountOf(accounts[4], 0);
      const claimTx4 = await distribution.claim(accounts[4], accounts[6], 0, true, {from: accounts[4]});
      const claimable3 = await distribution.getClaimableAmount(0, {from: accounts[3]});
      const claimTx3_1 = await distribution.claim(accounts[3], accounts[7], 0, true, {from: executor});
      const claimable3_after = await distribution.getClaimableAmountOf(accounts[3], 0, {from: accounts[3]});
      const claimable4_2 = await distribution.getClaimableAmountOf(accounts[4], 0);
      const claimTx3_2 = await distribution.claim(accounts[3], accounts[7], 0, false, {from: accounts[3]});
      const claimTx3_3 = await distribution.claim(accounts[3], accounts[7], 0, true, {from: accounts[3]});
      // Assert
      assert.equal(claimable1.toNumber(), totalEntitlementWei.muln(237).divn(8500).muln(500).divn(500 + 1500).toNumber());
      expectEvent(claimTx1, "AccountClaimed", {whoClaimed: accounts[1], sentTo: accounts[5], month: toBN(0), amountWei: claimable1});
      expect(endBalance5.sub(startBalance5).toNumber()).to.equals(claimable1.toNumber());
      assert.equal(claimable1_after.toNumber(), 0);
      assert.equal(claimable4_1.toNumber(), 0);
      expectEvent.notEmitted(claimTx4, "AccountClaimed");
      assert.equal(claimable3.toNumber(), totalEntitlementWei.muln(237).divn(8500).sub(claimable1).toNumber());
      expectEvent(claimTx3_1, "AccountClaimed", {whoClaimed: accounts[3], sentTo: accounts[7], month: toBN(0), amountWei: claimable3});
      const depositTo = wNatInterface.contract.methods.depositTo(accounts[7]).encodeABI();
      const invocationCount1 = await wNatMock.invocationCountForCalldata.call(depositTo);
      assert.equal(invocationCount1.toNumber(), 1);
      expect(await web3.eth.getBalance(wNatMock.address)).to.equals(claimable3.toString());
      assert.equal(claimable3_after.toNumber(), 0);
      assert.equal(claimable4_2.toNumber(), 0);
      expectEvent.notEmitted(claimTx3_2, "AccountClaimed");
      expectEvent.notEmitted(claimTx3_3, "AccountClaimed");
      expect((await distribution.startBlockNumber(0)).toNumber()).to.be.gte(startBlockNumber);
      expect((await distribution.endBlockNumber(0)).toNumber()).to.be.lt(startBlockNumber + numberOfBlocks);
      expect((await distribution.totalClaimedWei()).toNumber()).to.equals(claimable1.add(claimable3).toNumber());
      expect((await distribution.totalClaimedWei()).toNumber()).to.equals((await distribution.totalAvailableAmount(0)).toNumber());
      expect((await distribution.totalUnclaimedAmount(0)).toNumber()).to.equals(0);
      expect((await distribution.totalUnclaimedWeight(0)).toNumber()).to.equals(0);

      const claimRevertPromise = distribution.claim(accounts[2], accounts[6], 0, false, {from: accounts[2]});
      await expectRevert(claimRevertPromise, ERR_OPT_OUT);
    });

    it("Should be able to claim for PDA after opt out", async () => {
      // Assemble
      const optOutTx = await distribution.optOutOfAirdrop({from: accounts[2]});
      expectEvent(optOutTx, "AccountOptOut", {theAccount: accounts[2], confirmed: false});
      const confirmOptOutTx = await distribution.confirmOptOutOfAirdrop([accounts[2]], {from: GOVERNANCE_ADDRESS});
      expectEvent(confirmOptOutTx, "AccountOptOut", {theAccount: accounts[2], confirmed: true});
      await claimSetupManager.enableDelegationAccount({from: accounts[2]});
      const accountToDelegationAccount = await claimSetupManager.accountToDelegationAccount(accounts[2]);
      const days = 30;
      const addresses = [accounts[1], accounts[2], accountToDelegationAccount];
      const wNatBalances = [500, 2000, 1500];
      const numberOfBlocks = 12 * days;
      const startBlockNumber = (await time.latestBlock()).toNumber() + numberOfBlocks * (addresses.length + 1) + 4;
      await setMockBalances(startBlockNumber, numberOfBlocks, addresses, wNatBalances);
      await time.advanceBlock();
      const start = (await time.latest()).addn(1);
      await distribution.setEntitlementStart(start, {from: GOVERNANCE_ADDRESS});
      await createSomeBlocksAndProceed(start, days);
      // Act
      const claimable1 = await distribution.getClaimableAmount(0, {from: accounts[1]});
      const startBalance5 = toBN(await web3.eth.getBalance(accounts[5]));
      const claimTx1 = await distribution.claim(accounts[1], accounts[5], 0, false, {from: accounts[1]});
      const endBalance5 = toBN(await web3.eth.getBalance(accounts[5]));
      const claimable1_after = await distribution.getClaimableAmountOf(accounts[1], 0);
      const claimable4_1 = await distribution.getClaimableAmountOf(accounts[4], 0);
      const claimTx4 = await distribution.claim(accounts[4], accounts[6], 0, true, {from: accounts[4]});
      const claimable3 = await distribution.getClaimableAmountOf(accountToDelegationAccount, 0, {from: accounts[2]});
      const claimTx3_1 = await distribution.claim(accountToDelegationAccount, accounts[7], 0, true, {from: accounts[2]});
      const claimable3_after = await distribution.getClaimableAmountOf(accountToDelegationAccount, 0, {from: accounts[2]});
      const claimable4_2 = await distribution.getClaimableAmountOf(accounts[4], 0);
      const claimTx3_2 = await distribution.claim(accountToDelegationAccount, accounts[7], 0, false, {from: accounts[2]});
      const claimTx3_3 = await distribution.claim(accountToDelegationAccount, accounts[7], 0, true, {from: accounts[2]});
      // Assert
      assert.equal(claimable1.toNumber(), totalEntitlementWei.muln(237).divn(8500).muln(500).divn(500 + 1500).toNumber());
      expectEvent(claimTx1, "AccountClaimed", {whoClaimed: accounts[1], sentTo: accounts[5], month: toBN(0), amountWei: claimable1});
      expect(endBalance5.sub(startBalance5).toNumber()).to.equals(claimable1.toNumber());
      assert.equal(claimable1_after.toNumber(), 0);
      assert.equal(claimable4_1.toNumber(), 0);
      expectEvent.notEmitted(claimTx4, "AccountClaimed");
      assert.equal(claimable3.toNumber(), totalEntitlementWei.muln(237).divn(8500).sub(claimable1).toNumber());
      expectEvent(claimTx3_1, "AccountClaimed", {whoClaimed: accountToDelegationAccount, sentTo: accounts[7], month: toBN(0), amountWei: claimable3});
      const depositTo = wNatInterface.contract.methods.depositTo(accounts[7]).encodeABI();
      const invocationCount1 = await wNatMock.invocationCountForCalldata.call(depositTo);
      assert.equal(invocationCount1.toNumber(), 1);
      expect(await web3.eth.getBalance(wNatMock.address)).to.equals(claimable3.toString());
      assert.equal(claimable3_after.toNumber(), 0);
      assert.equal(claimable4_2.toNumber(), 0);
      expectEvent.notEmitted(claimTx3_2, "AccountClaimed");
      expectEvent.notEmitted(claimTx3_3, "AccountClaimed");
      expect((await distribution.startBlockNumber(0)).toNumber()).to.be.gte(startBlockNumber);
      expect((await distribution.endBlockNumber(0)).toNumber()).to.be.lt(startBlockNumber + numberOfBlocks);
      expect((await distribution.totalClaimedWei()).toNumber()).to.equals(claimable1.add(claimable3).toNumber());
      expect((await distribution.totalClaimedWei()).toNumber()).to.equals((await distribution.totalAvailableAmount(0)).toNumber());
      expect((await distribution.totalUnclaimedAmount(0)).toNumber()).to.equals(0);
      expect((await distribution.totalUnclaimedWeight(0)).toNumber()).to.equals(0);

      const claimRevertPromise = distribution.claim(accounts[2], accounts[6], 0, false, {from: accounts[2]});
      await expectRevert(claimRevertPromise, ERR_OPT_OUT);
    });

    it("Should be able to auto-claim for multiple owners with or without PDA", async () => {
      // Assemble
      const executor = accounts[55];
      await claimSetupManager.registerExecutor(1, {from: executor, value: toBN(1000)});
      const optOutTx = await distribution.optOutOfAirdrop({from: accounts[3]});
      expectEvent(optOutTx, "AccountOptOut", {theAccount: accounts[3], confirmed: false});
      const confirmOptOutTx = await distribution.confirmOptOutOfAirdrop([accounts[3]], {from: GOVERNANCE_ADDRESS});
      expectEvent(confirmOptOutTx, "AccountOptOut", {theAccount: accounts[3], confirmed: true});
      await claimSetupManager.setClaimExecutors([executor], {from: accounts[1], value: toBN(1)});
      await claimSetupManager.setAutoClaiming([executor], true, {from: accounts[2], value: toBN(1)});
      await claimSetupManager.setAutoClaiming([executor], true, {from: accounts[3], value: toBN(1)});
      const accountToDelegationAccount2 = await claimSetupManager.accountToDelegationAccount(accounts[2]);
      const accountToDelegationAccount3 = await claimSetupManager.accountToDelegationAccount(accounts[3]);
      const days = 30;
      const addresses = [accounts[1], accounts[2], accountToDelegationAccount2, accounts[3], accountToDelegationAccount3];
      const wNatBalances = [600, 2100, 1500, 2500, 900];
      const numberOfBlocks = 12 * days;
      const startBlockNumber = (await time.latestBlock()).toNumber() + numberOfBlocks * (addresses.length + 1) + 4;
      await setMockBalances(startBlockNumber, numberOfBlocks, addresses, wNatBalances);
      await time.advanceBlock();
      const start = (await time.latest()).addn(1);
      await distribution.setEntitlementStart(start, {from: GOVERNANCE_ADDRESS});
      await createSomeBlocksAndProceed(start, days);
      // Act
      const claimable1 = await distribution.getClaimableAmountOf(accounts[1], 0);
      const claimable2 = await distribution.getClaimableAmountOf(accounts[2], 0);
      const claimable2pda = await distribution.getClaimableAmountOf(accountToDelegationAccount2, 0);
      const claimable3pda = await distribution.getClaimableAmountOf(accountToDelegationAccount3, 0);
      const startBalance = toBN(await web3.eth.getBalance(wNatMock.address));
      const executorOpeningBalance = toBN(await web3.eth.getBalance(executor));
      const claimTx = await distribution.autoClaim([accounts[1], accounts[2], accounts[3]], 0, {from: executor}) as any;
      const executorClosingBalance = toBN(await web3.eth.getBalance(executor));
      const endBalance = toBN(await web3.eth.getBalance(wNatMock.address));
      // Assert
      assert.equal(claimable1.toNumber(), totalEntitlementWei.muln(237).divn(8500).muln(600).divn(5100).toNumber());
      assert.equal(claimable2.toNumber(), totalEntitlementWei.muln(237).divn(8500).muln(2100).divn(5100).toNumber());
      assert.equal(claimable2pda.toNumber(), totalEntitlementWei.muln(237).divn(8500).muln(1500).divn(5100).toNumber());
      assert.equal(claimable3pda.toNumber(), totalEntitlementWei.muln(237).divn(8500).muln(900).divn(5100).toNumber());
      expect(claimTx.logs[0].event).to.equals("AccountClaimed");
      expect(claimTx.logs[0].args.whoClaimed).to.equals(accounts[1]);
      expect(claimTx.logs[0].args.sentTo).to.equals(accounts[1]);
      expect(claimTx.logs[0].args.month.toNumber()).to.equals(0);
      expect(claimTx.logs[0].args.amountWei.toNumber()).to.equals(claimable1.toNumber());
      expect(claimTx.logs[1].event).to.equals("AccountClaimed");
      expect(claimTx.logs[1].args.whoClaimed).to.equals(accounts[2]);
      expect(claimTx.logs[1].args.sentTo).to.equals(accountToDelegationAccount2);
      expect(claimTx.logs[1].args.month.toNumber()).to.equals(0);
      expect(claimTx.logs[1].args.amountWei.toNumber()).to.equals(claimable2.toNumber());
      expect(claimTx.logs[2].event).to.equals("AccountClaimed");
      expect(claimTx.logs[2].args.whoClaimed).to.equals(accountToDelegationAccount2);
      expect(claimTx.logs[2].args.sentTo).to.equals(accountToDelegationAccount2);
      expect(claimTx.logs[2].args.month.toNumber()).to.equals(0);
      expect(claimTx.logs[2].args.amountWei.toNumber()).to.equals(claimable2pda.toNumber());
      expect(claimTx.logs[3].event).to.equals("AccountClaimed");
      expect(claimTx.logs[3].args.whoClaimed).to.equals(accountToDelegationAccount3);
      expect(claimTx.logs[3].args.sentTo).to.equals(accountToDelegationAccount3);
      expect(claimTx.logs[3].args.month.toNumber()).to.equals(0);
      expect(claimTx.logs[3].args.amountWei.toNumber()).to.equals(claimable3pda.toNumber());
      const totalClaimed = claimable1.add(claimable2).add(claimable2pda).add(claimable3pda);
      expect(endBalance.sub(startBalance).toNumber()).to.equals(totalClaimed.subn(3).toNumber());
      const depositTo1 = wNatInterface.contract.methods.depositTo(accounts[1]).encodeABI();
      const invocationCount1 = await wNatMock.invocationCountForCalldata.call(depositTo1);
      assert.equal(invocationCount1.toNumber(), 1);
      const depositTo2pda = wNatInterface.contract.methods.depositTo(accountToDelegationAccount2).encodeABI();
      const invocationCount2pda = await wNatMock.invocationCountForCalldata.call(depositTo2pda);
      assert.equal(invocationCount2pda.toNumber(), 1);
      const depositTo3pda = wNatInterface.contract.methods.depositTo(accountToDelegationAccount3).encodeABI();
      const invocationCount3pda = await wNatMock.invocationCountForCalldata.call(depositTo3pda);
      assert.equal(invocationCount3pda.toNumber(), 1);
      expect((await distribution.startBlockNumber(0)).toNumber()).to.be.gte(startBlockNumber);
      expect((await distribution.endBlockNumber(0)).toNumber()).to.be.lt(startBlockNumber + numberOfBlocks);
      expect((await distribution.totalClaimedWei()).toNumber()).to.equals(totalClaimed.toNumber());
      expect((await distribution.totalClaimedWei()).toNumber()).to.equals((await distribution.totalAvailableAmount(0)).toNumber());
      expect((await distribution.totalUnclaimedAmount(0)).toNumber()).to.equals(0);
      expect((await distribution.totalUnclaimedWeight(0)).toNumber()).to.equals(0);
      const gasCost = await calcGasCost(claimTx);
      expect(executorClosingBalance.add(gasCost).sub(executorOpeningBalance).toString()).to.be.equal("3");

      const claimRevertPromise = distribution.claim(accounts[3], accounts[6], 0, false, {from: accounts[3]});
      await expectRevert(claimRevertPromise, ERR_OPT_OUT);
    });

    it("Should burn unclaimed rewards after block expiration period", async () => {
      // Assemble
      const days = 30;
      const addresses = [accounts[1], accounts[2], accounts[3]];
      const wNatBalances = [500, 2000, 1500];
      const numberOfBlocks = 12 * days;
      const startBlockNumber = (await time.latestBlock()).toNumber() + numberOfBlocks * (addresses.length + 1) + 4;
      await setMockBalances(startBlockNumber, numberOfBlocks, addresses, wNatBalances);
      await time.advanceBlock();
      const start = (await time.latest()).addn(1);
      await distribution.setEntitlementStart(start, {from: GOVERNANCE_ADDRESS});
      await createSomeBlocksAndProceed(start, days);

      const { 0: allocatedWei1, 1: inflationWei1, 2: claimedWei1 } = await distribution.getTokenPoolSupplyData();
      // Assert
      assert.equal(allocatedWei1.toString(10), totalEntitlementWei.toString());
      assert.equal(inflationWei1.toString(10), "0");
      assert.equal(claimedWei1.toString(10), "0");

      // Act
      await claimSetupManager.enableDelegationAccount({ from: accounts[1] });
      const accountToDelegationAccount = await claimSetupManager.accountToDelegationAccount(accounts[1]);
      const claimable = await distribution.getClaimableAmount(0, {from: accounts[1]});
      expect((await distribution.nextClaimableMonth(accounts[1])).toNumber()).to.equals(0);
      const startBalance = toBN(await web3.eth.getBalance(wNatMock.address));
      const claimTx = await distribution.claim(accounts[1], accountToDelegationAccount, 0, false, { from: accounts[1] })
      const endBalance = toBN(await web3.eth.getBalance(wNatMock.address));
      expect((await distribution.nextClaimableMonth(accounts[1])).toNumber()).to.equals(1);
      assert.equal(claimable.toNumber(), totalEntitlementWei.muln(237).divn(8500).muln(500).divn(500 + 2000 + 1500).toNumber());
      expectEvent(claimTx, "AccountClaimed", {whoClaimed: accounts[1], sentTo: accountToDelegationAccount, month: toBN(0), amountWei: claimable});
      expect(endBalance.sub(startBalance).toNumber()).to.equals(claimable.toNumber());

      expect((await distribution.startBlockNumber(0)).toNumber()).to.be.gte(startBlockNumber);
      expect((await distribution.endBlockNumber(0)).toNumber()).to.be.lt(startBlockNumber + numberOfBlocks);

      const { 0: allocatedWei2, 1: inflationWei2, 2: claimedWei2 } = await distribution.getTokenPoolSupplyData();
      assert.equal(allocatedWei2.toString(10), totalEntitlementWei.toString());
      assert.equal(inflationWei2.toString(10), "0");
      assert.equal(claimedWei2.toString(10), claimable.toString());

      const monthToExpireNext1 = await distribution.getMonthToExpireNext();
      expect(monthToExpireNext1.toNumber()).to.equals(0);
      await createSomeBlocksAndProceed(await time.latest(), days);

      const monthToExpireNext2 = await distribution.getMonthToExpireNext();
      expect(monthToExpireNext2.toNumber()).to.equals(0);
      await createSomeBlocksAndProceed(await time.latest(), days);

      const cleanupBlockNumber = (await distribution.startBlockNumber(0)).toNumber() + 1;
      const cleanupBlockNumberWnat = wNatInterface.contract.methods.cleanupBlockNumber().encodeABI();
      await wNatMock.givenCalldataReturnUint(cleanupBlockNumberWnat, cleanupBlockNumber);
      const monthToExpireNext3 = await distribution.getMonthToExpireNext();
      expect(monthToExpireNext3.toNumber()).to.equals(1);
      const claimPromise1 = distribution.claim(accounts[2], accounts[6], 0, false, {from: accounts[2]});
      await expectRevert(claimPromise1, ERR_MONTH_EXPIRED);
      expect((await distribution.nextClaimableMonth(accounts[2])).toNumber()).to.equals(1);

      const burnAddress = await supply.burnAddress();
      const startBalanceBurn = toBN(await web3.eth.getBalance(burnAddress));
      await distribution.daemonize({from: FLARE_DAEMON});
      const endBalanceBurn = toBN(await web3.eth.getBalance(burnAddress));
      const monthToExpireNext4 = await distribution.getMonthToExpireNext();
      expect(monthToExpireNext4.toNumber()).to.equals(1);
      const claimPromise2 = distribution.claim(accounts[2], accounts[6], 0, false, {from: accounts[2]});
      await expectRevert(claimPromise2, ERR_MONTH_EXPIRED);

      const { 0: allocatedWei3, 1: inflationWei3, 2: claimedWei3 } = await distribution.getTokenPoolSupplyData();
      assert.equal(allocatedWei3.toString(10), totalEntitlementWei.toString());
      assert.equal(inflationWei3.toString(10), "0");
      assert.equal(claimedWei3.toString(10), totalEntitlementWei.muln(237).divn(8500).toString());
      expect((await distribution.totalClaimedWei()).toNumber()).to.equals(claimable.toNumber());
      expect((await distribution.totalBurnedWei()).toNumber()).to.equals(totalEntitlementWei.muln(237).divn(8500).sub(claimable).toNumber());
      expect((endBalanceBurn.sub(startBalanceBurn)).toNumber()).to.equals(totalEntitlementWei.muln(237).divn(8500).sub(claimable).toNumber());
      expect((await distribution.totalAvailableAmount(0)).toNumber()).to.equals(totalEntitlementWei.muln(237).divn(8500).toNumber());
      expect((await distribution.totalDistributableAmount()).toNumber()).to.equals(totalEntitlementWei.muln(237 * 3).divn(8500).toNumber());
    });

    it("Should not pull funds if stopped, but expiration should still work", async () => {
      // Assemble
      const days = 30;
      await time.advanceBlock();
      const start = (await time.latest()).addn(1);
      await distribution.setEntitlementStart(start, {from: GOVERNANCE_ADDRESS});
      await createSomeBlocksAndProceed(start, days);

      const monthToExpireNext1 = await distribution.getMonthToExpireNext();
      expect(monthToExpireNext1.toNumber()).to.equals(0);
      await createSomeBlocksAndProceed(await time.latest(), days);

      const monthToExpireNext2 = await distribution.getMonthToExpireNext();
      expect(monthToExpireNext2.toNumber()).to.equals(0);
      await createSomeBlocksAndProceed(await time.latest(), days);

      const cleanupBlockNumber = (await distribution.startBlockNumber(0)).toNumber() + 1;
      const cleanupBlockNumberWnat = wNatInterface.contract.methods.cleanupBlockNumber().encodeABI();
      await wNatMock.givenCalldataReturnUint(cleanupBlockNumberWnat, cleanupBlockNumber);

      await distribution.daemonize({from: FLARE_DAEMON});
      await supply.updateCirculatingSupply({from: INFLATION_ADDRESS});
      const monthToExpireNext3 = await distribution.getMonthToExpireNext();
      expect(monthToExpireNext3.toNumber()).to.equals(1);
      await distribution.daemonize({from: FLARE_DAEMON});
      await supply.updateCirculatingSupply({from: INFLATION_ADDRESS});

      const { 0: allocatedWei, 2: claimedWei } = await distribution.getTokenPoolSupplyData();
      const circulatingSupply = await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber());
      const inflatableBalance = await supply.getInflatableBalance();
      assert.equal(allocatedWei.toString(10), totalEntitlementWei.toString());
      assert.equal(claimedWei.toNumber(), totalEntitlementWei.muln(237).divn(8500).toNumber());
      assert.equal((await supply.distributedExcludedSupplyWei()).toString(10), totalEntitlementWei.toString());
      await distribution.stop({from: GOVERNANCE_ADDRESS});
      const distributableAmount = totalEntitlementWei.muln(237 * 3).divn(8500);
      const { 0: allocatedWei2 } = await distribution.getTokenPoolSupplyData();
      assert.equal(allocatedWei2.toString(10), distributableAmount.toString());
      await distribution.daemonize({from: FLARE_DAEMON});
      await supply.updateCirculatingSupply({from: INFLATION_ADDRESS});
      const { 0: allocatedWei3 } = await distribution.getTokenPoolSupplyData();
      const circulatingSupply2 = await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber());
      const inflatableBalance2 = await supply.getInflatableBalance();
      assert.equal(allocatedWei3.toString(10), distributableAmount.toString());
      assert.equal((await supply.distributedExcludedSupplyWei()).toString(10), distributableAmount.toString());
      assert.equal(circulatingSupply2.toNumber(), circulatingSupply.toNumber());
      assert.equal(inflatableBalance2.toNumber(), inflatableBalance.toNumber());

      for (let i = 1; i <= 36; i++) {
        const currentMonth = await distribution.getCurrentMonth();
        expect(currentMonth.toNumber()).to.equals(i + 2);
        const monthToExpireNext = await distribution.getMonthToExpireNext();
        expect(monthToExpireNext.toNumber()).to.equals(i);
        if (i < 3) {
          const {0: startMonth, 1: endMonth} = await distribution.getClaimableMonths();
          assert.equal(startMonth.toNumber(), i);
          assert.equal(endMonth.toNumber(), 2);
        } else {
          await expectRevert(distribution.getClaimableMonths(), ERR_ALREADY_FINISHED);
        }
        await createSomeBlocksAndProceed(await time.latest(), days);

        expect((await distribution.nextClaimableMonth(accounts[1])).toNumber()).to.equals(i);

        const cleanupBlockNumber = (await distribution.startBlockNumber(i)).toNumber() + 1;
        const cleanupBlockNumberWnat = wNatInterface.contract.methods.cleanupBlockNumber().encodeABI();
        await wNatMock.givenCalldataReturnUint(cleanupBlockNumberWnat, cleanupBlockNumber);
      }

      await distribution.daemonize({from: FLARE_DAEMON});
      await supply.updateCirculatingSupply({from: INFLATION_ADDRESS});
      const monthToExpireNext4 = await distribution.getMonthToExpireNext();
      expect(monthToExpireNext4.toNumber()).to.equals(36);
      await expectRevert(distribution.getClaimableMonths(), ERR_ALREADY_FINISHED);
      expect((await distribution.totalBurnedWei()).toNumber()).to.equals(distributableAmount.toNumber());
      expect((await distribution.totalDistributableAmount()).toNumber()).to.equals(distributableAmount.toNumber());
      expect((await distribution.nextClaimableMonth(accounts[1])).toNumber()).to.equals(36);
    });

    it("Should send funds back to treasury", async () => {
      // Assemble
      const days = 30;
      await time.advanceBlock();
      const start = (await time.latest()).addn(1);
      await distribution.setEntitlementStart(start, {from: GOVERNANCE_ADDRESS});
      await createSomeBlocksAndProceed(start, days);

      const monthToExpireNext1 = await distribution.getMonthToExpireNext();
      expect(monthToExpireNext1.toNumber()).to.equals(0);
      await createSomeBlocksAndProceed(await time.latest(), days);

      const monthToExpireNext2 = await distribution.getMonthToExpireNext();
      expect(monthToExpireNext2.toNumber()).to.equals(0);
      await createSomeBlocksAndProceed(await time.latest(), days);

      const cleanupBlockNumber = (await distribution.startBlockNumber(0)).toNumber() + 1;
      const cleanupBlockNumberWnat = wNatInterface.contract.methods.cleanupBlockNumber().encodeABI();
      await wNatMock.givenCalldataReturnUint(cleanupBlockNumberWnat, cleanupBlockNumber);

      await distribution.daemonize({from: FLARE_DAEMON});
      await supply.updateCirculatingSupply({from: INFLATION_ADDRESS});
      const monthToExpireNext3 = await distribution.getMonthToExpireNext();
      expect(monthToExpireNext3.toNumber()).to.equals(1);
      await distribution.daemonize({from: FLARE_DAEMON});
      await supply.updateCirculatingSupply({from: INFLATION_ADDRESS});

      const { 0: allocatedWei, 2: burnedWei } = await distribution.getTokenPoolSupplyData();
      const circulatingSupply = await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber());
      const inflatableBalance = await supply.getInflatableBalance();
      assert.equal(allocatedWei.toString(10), totalEntitlementWei.toString());
      assert.equal(burnedWei.toNumber(), totalEntitlementWei.muln(237).divn(8500).toNumber());
      assert.equal((await supply.distributedExcludedSupplyWei()).toString(10), totalEntitlementWei.toString());
      await distribution.stop({from: GOVERNANCE_ADDRESS});

      const distributableAmount = totalEntitlementWei.muln(237 * 3).divn(8500);
      const { 0: allocatedWei2 } = await distribution.getTokenPoolSupplyData();
      assert.equal(allocatedWei2.toString(10), distributableAmount.toString());
      await distribution.daemonize({from: FLARE_DAEMON});
      await supply.updateCirculatingSupply({from: INFLATION_ADDRESS});
      const { 0: allocatedWei3 } = await distribution.getTokenPoolSupplyData();
      const circulatingSupply2 = await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber());
      const inflatableBalance2 = await supply.getInflatableBalance();
      assert.equal(allocatedWei3.toString(10), distributableAmount.toString());
      assert.equal((await supply.distributedExcludedSupplyWei()).toString(10), distributableAmount.toString());
      assert.equal(circulatingSupply2.toNumber(), circulatingSupply.toNumber());
      assert.equal(inflatableBalance2.toNumber(), inflatableBalance.toNumber());

      const startBalance = toBN(await web3.eth.getBalance(distributionTreasury.address));
      await distribution.sendFundsBackToTreasury({from: GOVERNANCE_ADDRESS});
      const endBalance = toBN(await web3.eth.getBalance(distributionTreasury.address));
      assert.equal(endBalance.toString(), totalEntitlementWei.sub(burnedWei).toString());
      assert.equal(endBalance.sub(startBalance).toString(), distributableAmount.sub(burnedWei).toString());
      await distribution.daemonize({from: FLARE_DAEMON});
      await supply.updateCirculatingSupply({from: INFLATION_ADDRESS});
      const { 0: allocatedWei4 } = await distribution.getTokenPoolSupplyData();
      const circulatingSupply3 = await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber());
      const inflatableBalance3 = await supply.getInflatableBalance();
      assert.equal(allocatedWei4.toString(10), burnedWei.toString());
      assert.equal((await supply.distributedExcludedSupplyWei()).toString(10), burnedWei.toString());
      assert.equal(circulatingSupply3.toNumber(), circulatingSupply.toNumber());
      assert.equal(inflatableBalance3.toNumber(), inflatableBalance.toNumber());

      for (let i = 1; i <= 36; i++) {
        const currentMonth = await distribution.getCurrentMonth();
        expect(currentMonth.toNumber()).to.equals(i + 2);
        const monthToExpireNext = await distribution.getMonthToExpireNext();
        expect(monthToExpireNext.toNumber()).to.equals(i);
        if (i < 3) {
          const {0: startMonth, 1: endMonth} = await distribution.getClaimableMonths();
          assert.equal(startMonth.toNumber(), i);
          assert.equal(endMonth.toNumber(), 2);
        } else {
          await expectRevert(distribution.getClaimableMonths(), ERR_ALREADY_FINISHED);
        }
        await createSomeBlocksAndProceed(await time.latest(), days);

        expect((await distribution.nextClaimableMonth(accounts[1])).toNumber()).to.equals(i);

        const cleanupBlockNumber = (await distribution.startBlockNumber(i)).toNumber() + 1;
        const cleanupBlockNumberWnat = wNatInterface.contract.methods.cleanupBlockNumber().encodeABI();
        await wNatMock.givenCalldataReturnUint(cleanupBlockNumberWnat, cleanupBlockNumber);
      }

      await distribution.daemonize({from: FLARE_DAEMON});
      await supply.updateCirculatingSupply({from: INFLATION_ADDRESS});
      const monthToExpireNext4 = await distribution.getMonthToExpireNext();
      expect(monthToExpireNext4.toNumber()).to.equals(36);
      await expectRevert(distribution.getClaimableMonths(), ERR_ALREADY_FINISHED);
      expect((await distribution.totalBurnedWei()).toNumber()).to.equals(burnedWei.toNumber());
      expect((await distribution.totalDistributableAmount()).toNumber()).to.equals(distributableAmount.toNumber());
      expect((await distribution.nextClaimableMonth(accounts[1])).toNumber()).to.equals(36);
    });
  });

  describe("entitlement startup", async () => {

    it("Should start entitlement", async () => {
      // Assemble
      // Act
      const now = (await time.latest()).addn(1);
      await distribution.setEntitlementStart(now, {from: GOVERNANCE_ADDRESS});
      // Assert
      const entitlementStartTs = await distribution.entitlementStartTs();
      assert(entitlementStartTs.eq(now));
    });

    it("Should emit entitlement start event", async () => {
      // Assemble
      // Act
      const now = (await time.latest()).addn(1);
      const startEvent = await distribution.setEntitlementStart(now, {from: GOVERNANCE_ADDRESS});
      // Assert
      const entitlementStartTs = await distribution.entitlementStartTs();
      assert(entitlementStartTs.eq(now));
      expectEvent(startEvent, "EntitlementStart", {entitlementStartTs: now});
    });

    it("Should update total entitlement wei", async () => {
      // Assemble
      const additionalWei = BN(1500);
      const totalEntitlementWeiOld = await distribution.totalEntitlementWei();
      await bestowClaimableBalance(additionalWei);
      // Act
      await distribution.updateTotalEntitlementWei({ from: GOVERNANCE_ADDRESS });
      const totalEntitlementWeiNew = await distribution.totalEntitlementWei();
      // Assert
      assert(totalEntitlementWei.eq(totalEntitlementWeiOld));
      assert(totalEntitlementWei.add(additionalWei).eq(totalEntitlementWeiNew));
    });

    it("Should allow total entitlement wei to be updated even if already started", async () => {
      // Assemble
      const additionalWei = BN(1500);
      const start = (await time.latest()).addn(1);
      await distribution.setEntitlementStart(start, {from: GOVERNANCE_ADDRESS});
      const entitlementStartTs = await distribution.entitlementStartTs();
      assert(entitlementStartTs.eq(start));
      // Act
      await bestowClaimableBalance(additionalWei);
      await distribution.updateTotalEntitlementWei({ from: GOVERNANCE_ADDRESS });
      const totalEntitlementWeiNew = await distribution.totalEntitlementWei();
      // Assert
      assert(totalEntitlementWei.add(additionalWei).eq(totalEntitlementWeiNew));
    });

    it("Should not update total entitlement wei if not from governance", async () => {
      // Assemble
      // Act
      const updateTotalEntitlementWeiPromise = distribution.updateTotalEntitlementWei({from: accounts[1]});
      // Assert
      await expectRevert(updateTotalEntitlementWeiPromise, ERR_ONLY_GOVERNANCE);
    });

    it("Should not start entitlement if not from governance", async () => {
      // Assemble
      // Act
      const now = (await time.latest()).addn(1);
      let start_promise = distribution.setEntitlementStart(now, { from: accounts[1] });
      // Assert
      await expectRevert(start_promise, ERR_ONLY_GOVERNANCE);
    });

    it("Should not allow entitlement start to be pushed more than two weeks in the past", async () => {
      // Assemble
      const start = (await time.latest()).addn(100);
      await distribution.setEntitlementStart(start, {from: GOVERNANCE_ADDRESS});
      const entitlementStartTs = await distribution.entitlementStartTs();
      assert(entitlementStartTs.eq(start));
      // Act
      const before = (await time.latest()).subn(2*7*24*60*60 + 1);
      const restart_promise = distribution.setEntitlementStart(before, {from: GOVERNANCE_ADDRESS});
      // Assert
      await expectRevert(restart_promise, ERR_WRONG_START_TIMESTAMP);
    });

    it("Should allow entitlement start to be pushed in the future", async () => {
      // Assemble
      const start = (await time.latest()).addn(100);
      await distribution.setEntitlementStart(start, {from: GOVERNANCE_ADDRESS});
      const entitlementStartTs = await distribution.entitlementStartTs();
      assert(entitlementStartTs.eq(start));
      // Act
      const later = start.addn(60 * 60 * 24 * 5);
      await distribution.setEntitlementStart(later, {from: GOVERNANCE_ADDRESS});
      // Assert
      const entitlementStartTs2 = await distribution.entitlementStartTs();
      assert(entitlementStartTs2.eq(later));
    });

    it("Should not allow entitlement start to be pushed in the future if already started", async () => {
      // Assemble
      const start = (await time.latest()).addn(1);
      await distribution.setEntitlementStart(start, {from: GOVERNANCE_ADDRESS});
      const entitlementStartTs = await distribution.entitlementStartTs();
      assert(entitlementStartTs.eq(start));
      // Act
      const later = start.addn(60 * 60 * 24 * 5);
      const restart_promise = distribution.setEntitlementStart(later, {from: GOVERNANCE_ADDRESS});
      // Assert
      await expectRevert(restart_promise, ERR_ALREADY_STARTED);
    });

    it("Should not allow entitlement start to be pushed to far in the future", async () => {
      // Assemble
      const start = (await time.latest()).addn(100);
      await distribution.setEntitlementStart(start, {from: GOVERNANCE_ADDRESS});
      const entitlementStartTs = await distribution.entitlementStartTs();
      assert(entitlementStartTs.eq(start));
      // Act
      const later = start.addn(60 * 60 * 24 * 10);
      const restart_promise = distribution.setEntitlementStart(later, {from: GOVERNANCE_ADDRESS});
      // Assert
      await expectRevert(restart_promise, ERR_WRONG_START_TIMESTAMP);
    });

    it("Should not allow entitlement to start more than two weeks in the past", async () => {
      // Assemble
      const start = (await time.latest()).subn(2*7*24*60*60 + 1);
      // Act
      const in_the_past_promise = distribution.setEntitlementStart(start, {from: GOVERNANCE_ADDRESS});
      // Assert
      await expectRevert(in_the_past_promise, ERR_WRONG_START_TIMESTAMP);
    });
  });
});
