import { constants, expectEvent, expectRevert, time } from '@openzeppelin/test-helpers';
import { Address } from 'hardhat-deploy/dist/types';
import { Contracts } from '../../../../deployment/scripts/Contracts';
import {
  ClaimSetupManagerInstance, CloneFactoryMockInstance, DelegationAccountInstance, FtsoManagerContract, FtsoManagerInstance,
  FtsoManagerMockContract, FtsoManagerMockInstance, FtsoRewardManagerContract, FtsoRewardManagerInstance, GovernanceVotePowerInstance, InflationMockInstance, WNatInstance
} from "../../../../typechain-truffle";
import { calcGasCost } from '../../../utils/eth';
import { compareArrays, compareNumberArrays, encodeContractNames, toBN } from '../../../utils/test-helpers';
import { setDefaultVPContract } from "../../../utils/token-test-helpers";

let wNat: WNatInstance;
let governanceVP: GovernanceVotePowerInstance;
let claimSetupManager: ClaimSetupManagerInstance;
let libraryContract: DelegationAccountInstance;
let delegationAccount1: DelegationAccountInstance;
let delAcc1Address: Address;
let delegationAccount2: DelegationAccountInstance;
let delAcc2Address: Address;
let delAcc3Address: Address;

let ftsoRewardManager: FtsoRewardManagerInstance;
let ftsoManagerInterface: FtsoManagerInstance;
let startTs: BN;
let mockFtsoManager: FtsoManagerMockInstance;
let mockInflation: InflationMockInstance;
let ADDRESS_UPDATER: string;
let INFLATION_ADDRESS: string;
let cloneFactoryMock: CloneFactoryMockInstance;

const getTestFile = require('../../../utils/constants').getTestFile;

const WNat = artifacts.require("WNat");
const MockContract = artifacts.require("MockContract");
const ClaimSetupManager = artifacts.require("ClaimSetupManager");
const DelegationAccount = artifacts.require("DelegationAccount");
const MockFtsoManager = artifacts.require("FtsoManagerMock") as FtsoManagerMockContract;
const FtsoRewardManager = artifacts.require("FtsoRewardManager") as FtsoRewardManagerContract;
const DataProviderFee = artifacts.require("DataProviderFee" as any);
const FtsoManager = artifacts.require("FtsoManager") as FtsoManagerContract;
const FtsoManagement = artifacts.require("FtsoManagement");
const InflationMock = artifacts.require("InflationMock");
const GovernanceVotePower = artifacts.require("GovernanceVotePower");
const SuicidalMock = artifacts.require("SuicidalMock");
const CloneFactoryMock = artifacts.require("CloneFactoryMock");
const ERC20Mock = artifacts.require("ERC20Mock");
const SetClaimExecutorsMock = artifacts.require("SetClaimExecutorsMock");

const PRICE_EPOCH_DURATION_S = 120;   // 2 minutes
const REVEAL_EPOCH_DURATION_S = 30;
const REWARD_EPOCH_DURATION_S = 2 * 24 * 60 * 60; // 2 days
const VOTE_POWER_BOUNDARY_FRACTION = 7;

const BURN_ADDRESS = "0x000000000000000000000000000000000000dEaD";

export async function distributeRewards(
  accounts: Truffle.Accounts,
  startTs: BN,
  currentRewardEpoch: number = 0,
  sendNats: boolean = true
) {
  let votePowerBlock = await web3.eth.getBlockNumber();
  // Assemble
  if (sendNats) {
      // give reward manager some nat to distribute...proxied through mock inflation
      await mockInflation.receiveInflation({ value: "2000000" });
  }

  // Price epochs remaining is 5040 (7 days worth at 2 minute price epochs)

  // Trigger price epoch finalization
  await mockFtsoManager.distributeRewardsCall(
      [accounts[40], accounts[50]],
      [25, 75],
      100,
      0,
      accounts[6],
      PRICE_EPOCH_DURATION_S,
      currentRewardEpoch,
      startTs.addn((currentRewardEpoch * REWARD_EPOCH_DURATION_S) + PRICE_EPOCH_DURATION_S - 1),
      votePowerBlock
  );

  await time.increaseTo((await time.latest()).addn(PRICE_EPOCH_DURATION_S));

  // Let's do another price epoch
  await mockFtsoManager.distributeRewardsCall(
      [accounts[40], accounts[50]],
      [25, 75],
      100,
      1,
      accounts[6],
      PRICE_EPOCH_DURATION_S,
      currentRewardEpoch,
      startTs.addn((currentRewardEpoch * REWARD_EPOCH_DURATION_S) + (PRICE_EPOCH_DURATION_S * 2) - 1),
      votePowerBlock
  );

  const getRewardEpochVotePowerBlock = ftsoManagerInterface.contract.methods.getRewardEpochVotePowerBlock(currentRewardEpoch).encodeABI();
  const getRewardEpochVotePowerBlockReturn = web3.eth.abi.encodeParameter('uint256', votePowerBlock);
  await mockFtsoManager.givenMethodReturn(getRewardEpochVotePowerBlock, getRewardEpochVotePowerBlockReturn);
}

export async function expireRewardEpoch(rewardEpoch: number, ftsoRewardManager: FtsoRewardManagerInstance, deployer: string) {
  let currentFtsoManagerAddress = await ftsoRewardManager.ftsoManager();
  await ftsoRewardManager.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.CLAIM_SETUP_MANAGER]),
      [ADDRESS_UPDATER, mockInflation.address, deployer, wNat.address, claimSetupManager.address], {from: ADDRESS_UPDATER});
  await ftsoRewardManager.closeExpiredRewardEpoch(rewardEpoch);
  await ftsoRewardManager.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.CLAIM_SETUP_MANAGER]),
      [ADDRESS_UPDATER, mockInflation.address, currentFtsoManagerAddress, wNat.address, claimSetupManager.address], {from: ADDRESS_UPDATER});
}

export async function travelToAndSetNewRewardEpoch(newRewardEpoch: number, startTs: BN, ftsoRewardManager: FtsoRewardManagerInstance, deployer: string, closeAsYouGo = false) {
  // What reward epoch are we on based on current block time, given our startTs?
  const currentRewardEpoch = (await time.latest()).sub(startTs).div(toBN(REWARD_EPOCH_DURATION_S)).toNumber();
  for (let rewardEpoch = currentRewardEpoch; rewardEpoch < newRewardEpoch; rewardEpoch++) {
      // Time travel through each daily cycle as we work our way through to the next
      // reward epoch.
      for (let dailyCycle = 0; dailyCycle < (REWARD_EPOCH_DURATION_S / 86400); dailyCycle++) {
          try {
              await time.increaseTo(startTs.addn((rewardEpoch * REWARD_EPOCH_DURATION_S) + (dailyCycle * 86400)));
              await mockInflation.setDailyAuthorizedInflation(2000000);
          } catch (e) {
              if (e instanceof Error && e.message.includes("to a moment in the past")) {
                  // Assume that if this is being done in the past, then it does not need to be done again.
                  // So just skip.          
              } else {
                  throw e;
              }
          }
      }
      // Travel to reach next reward epoch
      await time.increaseTo(startTs.addn((rewardEpoch + 1) * REWARD_EPOCH_DURATION_S + 1));
      // workaround for modifiers due to mock
      if (closeAsYouGo) {
          await expireRewardEpoch(rewardEpoch, ftsoRewardManager, deployer);            
      }
      await mockInflation.setDailyAuthorizedInflation(2000000);
  }
  // Fake Trigger reward epoch finalization
  const getCurrentRewardEpoch = ftsoManagerInterface.contract.methods.getCurrentRewardEpoch().encodeABI();
  const getCurrentRewardEpochReturn = web3.eth.abi.encodeParameter('uint256', newRewardEpoch);
  await mockFtsoManager.givenMethodReturn(getCurrentRewardEpoch, getCurrentRewardEpochReturn);
}

contract(`ClaimSetupManager.sol; ${getTestFile(__filename)}; Claim setup manager unit tests`, async accounts => {
  const EXECUTOR_MIN_FEE = "0";
  const EXECUTOR_MAX_FEE = "500";
  const EXECUTOR_REGISTER_FEE = "100";
  ADDRESS_UPDATER = accounts[16];
  const GOVERNANCE_ADDRESS = accounts[0];
  INFLATION_ADDRESS = accounts[17];

  before(async () => {
    FtsoManager.link(await FtsoManagement.new() as any);
    FtsoRewardManager.link(await DataProviderFee.new() as any);
  });

  beforeEach(async () => {
    wNat = await WNat.new(accounts[0], "Wrapped NAT", "WNAT");
    await setDefaultVPContract(wNat, accounts[0]);

    const pChainStakeMirror = await MockContract.new();
    governanceVP = await GovernanceVotePower.new(wNat.address, pChainStakeMirror.address);
    await wNat.setGovernanceVotePower(governanceVP.address);

    // ftso reward manager
    mockFtsoManager = await MockFtsoManager.new();
    mockInflation = await InflationMock.new();

    ftsoRewardManager = await FtsoRewardManager.new(
        accounts[0],
        ADDRESS_UPDATER,
        constants.ZERO_ADDRESS,
        3,
        0
    );

    await mockInflation.setInflationReceiver(ftsoRewardManager.address);

    // Get the timestamp for the just mined block
    startTs = await time.latest();

    ftsoManagerInterface = await FtsoManager.new(
        accounts[0],
        accounts[0],
        ADDRESS_UPDATER,
        constants.ZERO_ADDRESS,
        startTs,
        PRICE_EPOCH_DURATION_S,
        REVEAL_EPOCH_DURATION_S,
        startTs.addn(REVEAL_EPOCH_DURATION_S),
        REWARD_EPOCH_DURATION_S,
        VOTE_POWER_BOUNDARY_FRACTION
    );

    await setDefaultVPContract(wNat, accounts[0]);

    // deploy clone factory
    claimSetupManager = await ClaimSetupManager.new(
      accounts[0],
      ADDRESS_UPDATER,
      3,
      EXECUTOR_MIN_FEE,
      EXECUTOR_MAX_FEE,
      EXECUTOR_REGISTER_FEE
    )

    await ftsoRewardManager.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.CLAIM_SETUP_MANAGER]),
        [ADDRESS_UPDATER, mockInflation.address, mockFtsoManager.address, wNat.address, claimSetupManager.address], {from: ADDRESS_UPDATER});
    await ftsoRewardManager.enableClaims();
    
    // set the daily authorized inflation...this proxies call to ftso reward manager
    await mockInflation.setDailyAuthorizedInflation(2000000);
    
    await mockFtsoManager.setRewardManager(ftsoRewardManager.address);

    await ftsoRewardManager.activate();

    expect(await claimSetupManager.wNat()).to.equals(constants.ZERO_ADDRESS);
    await claimSetupManager.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_MANAGER, Contracts.WNAT]),
        [ADDRESS_UPDATER, mockFtsoManager.address, wNat.address], {from: ADDRESS_UPDATER});
    expect(await claimSetupManager.wNat()).to.equals(wNat.address);

    // deploy library contract
    libraryContract = await DelegationAccount.new();


    let create = claimSetupManager.enableDelegationAccount({ from: accounts[1] });
    await expectRevert(create, "library address not set yet");

    let setLibrary = await claimSetupManager.setLibraryAddress(libraryContract.address);
    expectEvent(setLibrary, "SetLibraryAddress", { libraryAddress: libraryContract.address});

    let create1 = await claimSetupManager.enableDelegationAccount({ from: accounts[1] });
    delAcc1Address = await claimSetupManager.accountToDelegationAccount(accounts[1]);
    delegationAccount1 = await DelegationAccount.at(delAcc1Address);
    expectEvent(create1, "DelegationAccountCreated", { delegationAccount: delAcc1Address, owner: accounts[1]} );
    await expectEvent.inTransaction(create1.tx, delegationAccount1, "Initialize", { owner: accounts[1], 
      manager: claimSetupManager.address });

    let create2 = await claimSetupManager.enableDelegationAccount({ from: accounts[2] }); 
    delAcc2Address = await claimSetupManager.accountToDelegationAccount(accounts[2]);
    delegationAccount2 = await DelegationAccount.at(delAcc2Address);
    expectEvent(create2, "DelegationAccountCreated", { delegationAccount: delAcc2Address, owner: accounts[2]} );

    let create3 = await claimSetupManager.enableDelegationAccount({ from: accounts[3] }); 
    delAcc3Address = await claimSetupManager.accountToDelegationAccount(accounts[3]);
    expectEvent(create3, "DelegationAccountCreated", { delegationAccount: delAcc3Address, owner: accounts[3]} );
  });

  it("Should revert if zero/invalid value/address", async() => {
    await expectRevert(ClaimSetupManager.new(GOVERNANCE_ADDRESS, ADDRESS_UPDATER, 0, 10, 12, 10), "value zero");
    await expectRevert(ClaimSetupManager.new(GOVERNANCE_ADDRESS, ADDRESS_UPDATER, 10, 10, 15, 0), "value zero");
    await expectRevert(ClaimSetupManager.new(GOVERNANCE_ADDRESS, ADDRESS_UPDATER, 10, 10, 10, 15), "invalid max fee value");

    await expectRevert(claimSetupManager.setMaxFeeValueWei(0, {from: GOVERNANCE_ADDRESS}), "invalid max fee value");
    await expectRevert(claimSetupManager.setMinFeeValueWei(10000, {from: GOVERNANCE_ADDRESS}), "invalid min fee value");
    await expectRevert(claimSetupManager.setRegisterExecutorFeeValueWei(0, {from: GOVERNANCE_ADDRESS}), "value zero");
    await expectRevert(claimSetupManager.setLibraryAddress(constants.ZERO_ADDRESS, {from: GOVERNANCE_ADDRESS}), "address zero");
  });

  it("Should update fees", async() => {
    expect((await claimSetupManager.maxFeeValueWei()).toString()).to.be.equal(EXECUTOR_MAX_FEE);
    expect((await claimSetupManager.registerExecutorFeeValueWei()).toString()).to.be.equal(EXECUTOR_REGISTER_FEE);
    let setMaxFee = await claimSetupManager.setMaxFeeValueWei(10000, { from: GOVERNANCE_ADDRESS });
    expectEvent(setMaxFee, "MaxFeeSet", { maxFeeValueWei: toBN(10000) });
    let setExecutorFee = await claimSetupManager.setRegisterExecutorFeeValueWei(5000, { from: GOVERNANCE_ADDRESS });
    expectEvent(setExecutorFee, "RegisterExecutorFeeSet", { registerExecutorFeeValueWei: toBN(5000) });
    expect((await claimSetupManager.maxFeeValueWei()).toString()).to.be.equal("10000");
    expect((await claimSetupManager.registerExecutorFeeValueWei()).toString()).to.be.equal("5000");
  });

  it("Should revert if not from governance", async() => {
    await expectRevert(claimSetupManager.setLibraryAddress(libraryContract.address, { from: accounts[1] }), "only governance");
    await expectRevert(claimSetupManager.setMaxFeeValueWei(10, { from: accounts[1] }), "only governance");
    await expectRevert(claimSetupManager.setRegisterExecutorFeeValueWei(10, { from: accounts[1] }), "only governance");
  });

  it("Should be correct owner address", async() => {
    let owner1 = await delegationAccount1.owner();
    expect(owner1).to.equals(accounts[1]);

    let owner2 = await delegationAccount2.owner();
    expect(owner2).to.equals(accounts[2]);
  });

  it("Should wrap transferred tokens and then withdraw it", async()=> {
    // console.log(await web3.eth.getBalance(accounts[1]));
    expect((await web3.eth.getBalance(delAcc1Address)).toString()).to.equals("0");
    expect((await wNat.balanceOf(delAcc1Address)).toString()).to.equals("0");
    
    // transfer 100 NAT to delegation account contract
    await web3.eth.sendTransaction({from: accounts[1], to: delAcc1Address, value: 100 });
    expect((await web3.eth.getBalance(delAcc1Address)).toString()).to.equals("0");
    expect((await wNat.balanceOf(delAcc1Address)).toString()).to.equals("100");
    expect((await wNat.balanceOf(accounts[1])).toString()).to.equals("0");
    
    let tx = await claimSetupManager.withdraw(80, { from:accounts[1] });
    expect((await wNat.balanceOf(delAcc1Address)).toString()).to.equals("20");
    expect((await wNat.balanceOf(accounts[1])).toString()).to.equals("80");
    await expectEvent.inTransaction(tx.tx, delegationAccount1, "WithdrawToOwner", { amount: toBN(80) });

    const mockWNAT = await MockContract.new();
    const current = wNat.contract.methods.transfer(accounts[1], 10).encodeABI();
    await mockWNAT.givenMethodReturnBool(current, false);

    let update = claimSetupManager.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_MANAGER, Contracts.WNAT]),
      [ADDRESS_UPDATER, mockFtsoManager.address, mockWNAT.address], {from: ADDRESS_UPDATER}
    );
    // let tx1 = claimSetupManager.withdraw(10, { from:accounts[1] });
    await expectRevert(update, "wrong wNat address");
  });

  it("Should be able to register as executor, update fee value and unregister", async () => {
    const executor = accounts[4];
    const info1 = await claimSetupManager.getExecutorInfo(executor);
    expect(info1[0]).to.be.false;
    expect(info1[1].toString()).to.be.equal("0");
    let changes = await claimSetupManager.getExecutorScheduledFeeValueChanges(executor);
    compareNumberArrays(changes[0], []);
    compareNumberArrays(changes[1], []);
    compareArrays(changes[2], []);

    await expectRevert(claimSetupManager.updateExecutorFeeValue(10, {from: executor}), "not registered");
    await expectRevert(claimSetupManager.registerExecutor(10, { from: executor, value: "1"}), "invalid executor fee value");
    await expectRevert(claimSetupManager.registerExecutor(1000, { from: executor, value: EXECUTOR_REGISTER_FEE}), "invalid fee value");
    const register = await claimSetupManager.registerExecutor(10, { from: executor, value: EXECUTOR_REGISTER_FEE});
    await expectRevert(claimSetupManager.registerExecutor(10, { from: executor, value: EXECUTOR_REGISTER_FEE}), "already registered");
    expectEvent(register, "ExecutorRegistered", {executor: executor});
    expectEvent(register, "ClaimExecutorFeeValueChanged", {executor: executor, validFromRewardEpoch: "0", feeValueWei: "10"});
    let registeredExecutors = await claimSetupManager.getRegisteredExecutors(0, 10);
    compareArrays(registeredExecutors[0], [executor]);
    expect(registeredExecutors[1].toString()).to.be.equal("1");
    changes = await claimSetupManager.getExecutorScheduledFeeValueChanges(executor);
    compareNumberArrays(changes[0], []);
    compareNumberArrays(changes[1], []);
    compareArrays(changes[2], []);

    const update = await claimSetupManager.updateExecutorFeeValue(500, {from: executor});
    expectEvent(update, "ClaimExecutorFeeValueChanged", {executor: executor, validFromRewardEpoch: "3", feeValueWei: "500"});
    expect((await claimSetupManager.getExecutorCurrentFeeValue(executor)).toString()).to.be.equal("10");
    const info2 = await claimSetupManager.getExecutorInfo(executor);
    expect(info2[0]).to.be.true;
    expect(info2[1].toString()).to.be.equal("10");

    await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);
    const update2 = await claimSetupManager.updateExecutorFeeValue(200, {from: executor});
    expectEvent(update2, "ClaimExecutorFeeValueChanged", {executor: executor, validFromRewardEpoch: "4", feeValueWei: "200"});
    expect((await claimSetupManager.getExecutorCurrentFeeValue(executor)).toString()).to.be.equal("10");

    await travelToAndSetNewRewardEpoch(2, startTs, ftsoRewardManager, accounts[0]);
    const update3 = await claimSetupManager.updateExecutorFeeValue(300, {from: executor});
    expectEvent(update3, "ClaimExecutorFeeValueChanged", {executor: executor, validFromRewardEpoch: "5", feeValueWei: "300"});
    const update4 = await claimSetupManager.updateExecutorFeeValue(100, {from: executor});
    expectEvent(update4, "ClaimExecutorFeeValueChanged", {executor: executor, validFromRewardEpoch: "5", feeValueWei: "100"});
    expect((await claimSetupManager.getExecutorCurrentFeeValue(executor)).toString()).to.be.equal("10");
    
    changes = await claimSetupManager.getExecutorScheduledFeeValueChanges(executor);
    compareNumberArrays(changes[0], [500, 200, 100]);
    compareNumberArrays(changes[1], [3, 4, 5]);
    compareArrays(changes[2], [true, true, false]);

    await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);
    await expectRevert(claimSetupManager.updateExecutorFeeValue(300, {from: executor}), "fee can not be updated");

    await travelToAndSetNewRewardEpoch(3, startTs, ftsoRewardManager, accounts[0]);
    changes = await claimSetupManager.getExecutorScheduledFeeValueChanges(executor);
    compareNumberArrays(changes[0], [200, 100]);
    compareNumberArrays(changes[1], [4, 5]);
    compareArrays(changes[2], [true, true]);
    await expectRevert(claimSetupManager.updateExecutorFeeValue(1000, {from: executor}), "invalid fee value");
    const unregister = await claimSetupManager.unregisterExecutor({from: executor});
    expectEvent(unregister, "ClaimExecutorFeeValueChanged", {executor: executor, validFromRewardEpoch: "6", feeValueWei: "0"});
    expectEvent(unregister, "ExecutorUnregistered", {executor: executor, validFromRewardEpoch: "6"});
    expect((await claimSetupManager.getExecutorCurrentFeeValue(executor)).toString()).to.be.equal("500");
    await expectRevert(claimSetupManager.unregisterExecutor({from: executor}), "not registered")
    changes = await claimSetupManager.getExecutorScheduledFeeValueChanges(executor);
    compareNumberArrays(changes[0], [200, 100, 0]);
    compareNumberArrays(changes[1], [4, 5, 6]);
    compareArrays(changes[2], [true, true, false]);
    registeredExecutors = await claimSetupManager.getRegisteredExecutors(0, 10);
    compareArrays(registeredExecutors[0], []);
    expect(registeredExecutors[1].toString()).to.be.equal("0");
    const info3 = await claimSetupManager.getExecutorInfo(executor);
    expect(info3[0]).to.be.false;
    expect(info3[1].toString()).to.be.equal("500");

    await expectRevert(claimSetupManager.getExecutorFeeValue(executor, 100, {from: executor}), "invalid reward epoch");
    expect((await claimSetupManager.getExecutorFeeValue(executor, 0)).toString()).to.be.equal("10");

    await travelToAndSetNewRewardEpoch(4, startTs, ftsoRewardManager, accounts[0]);
    expect((await claimSetupManager.getExecutorCurrentFeeValue(executor)).toString()).to.be.equal("200");
    
    await travelToAndSetNewRewardEpoch(5, startTs, ftsoRewardManager, accounts[0]);
    expect((await claimSetupManager.getExecutorCurrentFeeValue(executor)).toString()).to.be.equal("100");
    const info4 = await claimSetupManager.getExecutorInfo(executor);
    expect(info4[0]).to.be.false;
    expect(info4[1].toString()).to.be.equal("100");

    const burnAddressOpeningBalance = toBN(await web3.eth.getBalance(BURN_ADDRESS));
    const register2 = await claimSetupManager.registerExecutor(10, { from: executor, value: EXECUTOR_REGISTER_FEE});
    const burnAddressClosigBalance = toBN(await web3.eth.getBalance(BURN_ADDRESS));
    expectEvent(register2, "ExecutorRegistered", {executor: executor});
    expectEvent(register2, "ClaimExecutorFeeValueChanged", {executor: executor, validFromRewardEpoch: "8", feeValueWei: "10"});
    expect(burnAddressClosigBalance.sub(burnAddressOpeningBalance).toString()).to.be.equal(EXECUTOR_REGISTER_FEE);

    await travelToAndSetNewRewardEpoch(6, startTs, ftsoRewardManager, accounts[0]);
    expect((await claimSetupManager.getExecutorCurrentFeeValue(executor)).toString()).to.be.equal("0");
    const info5 = await claimSetupManager.getExecutorInfo(executor);
    expect(info5[0]).to.be.true;
    expect(info5[1].toString()).to.be.equal("0");

    await travelToAndSetNewRewardEpoch(7, startTs, ftsoRewardManager, accounts[0]);
    expect((await claimSetupManager.getExecutorCurrentFeeValue(executor)).toString()).to.be.equal("0");

    await travelToAndSetNewRewardEpoch(8, startTs, ftsoRewardManager, accounts[0]);
    expect((await claimSetupManager.getExecutorCurrentFeeValue(executor)).toString()).to.be.equal("10");
    const info6 = await claimSetupManager.getExecutorInfo(executor);
    expect(info6[0]).to.be.true;
    expect(info6[1].toString()).to.be.equal("10");
  });

  it("Should be able to register and unregister multiple executors", async () => {
    await claimSetupManager.registerExecutor(10, { value: EXECUTOR_REGISTER_FEE, from: accounts[6] });
    await claimSetupManager.registerExecutor(10, { value: EXECUTOR_REGISTER_FEE, from: accounts[7] });
    await claimSetupManager.registerExecutor(10, { value: EXECUTOR_REGISTER_FEE, from: accounts[8] });
    let registeredExecutors = await claimSetupManager.getRegisteredExecutors(0, 10);
    compareArrays(registeredExecutors[0], [accounts[6], accounts[7], accounts[8]]);
    expect(registeredExecutors[1].toString()).to.be.equal("3");

    await claimSetupManager.unregisterExecutor({ from: accounts[6] });
    registeredExecutors = await claimSetupManager.getRegisteredExecutors(0, 10);
    compareArrays(registeredExecutors[0], [accounts[8], accounts[7]]);
    expect(registeredExecutors[1].toString()).to.be.equal("2");

    await claimSetupManager.registerExecutor(10, { value: EXECUTOR_REGISTER_FEE, from: accounts[9] });
    registeredExecutors = await claimSetupManager.getRegisteredExecutors(0, 10);
    compareArrays(registeredExecutors[0], [accounts[8], accounts[7], accounts[9]]);
    expect(registeredExecutors[1].toString()).to.be.equal("3");

    await claimSetupManager.unregisterExecutor({ from: accounts[8] });
    registeredExecutors = await claimSetupManager.getRegisteredExecutors(0, 10);
    compareArrays(registeredExecutors[0], [accounts[9], accounts[7]]);
    expect(registeredExecutors[1].toString()).to.be.equal("2");
  });

  it("Should be able to set and remove executors", async () => {
    const tx = await claimSetupManager.setClaimExecutors([accounts[5], accounts[6]], { from: accounts[1] });
    expectEvent(tx, "ClaimExecutorsChanged", {owner: accounts[1], executors: [accounts[5], accounts[6]]});
    compareArrays(await claimSetupManager.claimExecutors(accounts[1]), [accounts[5], accounts[6]]);

    const tx2 = await claimSetupManager.setClaimExecutors([accounts[5]], { from: accounts[1], value: "100" });
    expectEvent(tx2, "ClaimExecutorsChanged", {owner: accounts[1], executors: [accounts[5]]});
    expectEvent(tx2, "SetExecutorsExcessAmountRefunded", { owner: accounts[1], excessAmount: toBN(100) });
    compareArrays(await claimSetupManager.claimExecutors(accounts[1]), [accounts[5]]);

    await claimSetupManager.registerExecutor(10, { value: EXECUTOR_REGISTER_FEE, from: accounts[6] });

    const setClaimExecutorsMock = await SetClaimExecutorsMock.new(claimSetupManager.address);
    await expectRevert(setClaimExecutorsMock.setClaimExecutors([accounts[6]], { from: accounts[1], value: "100" }), "transfer failed")

    // transfer some funds to claim setup manager
    const suicidalMock = await SuicidalMock.new(claimSetupManager.address);
    await web3.eth.sendTransaction({ from: accounts[0], to: suicidalMock.address, value: 100 });
    await suicidalMock.die();

    await expectRevert(claimSetupManager.setClaimExecutors([accounts[6]], { from: accounts[1] }), "invalid executor fee value");
    expect((await wNat.balanceOf(accounts[6])).toString()).to.be.equal("0");
    const openingBalance = toBN(await web3.eth.getBalance(accounts[1]));
    const openingBalance6 = toBN(await web3.eth.getBalance(accounts[6]));
    const tx3 = await claimSetupManager.setClaimExecutors([accounts[6]], { from: accounts[1], value: "100" });
    const closingBalance = toBN(await web3.eth.getBalance(accounts[1]));
    const closingBalance6 = toBN(await web3.eth.getBalance(accounts[6]));
    expectEvent(tx3, "ClaimExecutorsChanged", {owner: accounts[1], executors: [accounts[6]]});
    compareArrays(await claimSetupManager.claimExecutors(accounts[1]), [accounts[6]]);
    expect(closingBalance6.sub(openingBalance6).toString()).to.be.equal("10");
    const gasCost = await calcGasCost(tx3);
    expect(openingBalance.sub(closingBalance).sub(gasCost).toString()).to.be.equal("10");

    const tx4 = await claimSetupManager.setClaimExecutors([], { from: accounts[1] });
    expectEvent(tx4, "ClaimExecutorsChanged", {owner: accounts[1], executors: []});
    compareArrays(await claimSetupManager.claimExecutors(accounts[1]), []);
  });

  it("Should delegate and revoke delegation", async() => {
    // "deposit" some wnats
    await web3.eth.sendTransaction({from: accounts[1], to: delAcc1Address, value: 100 });

    // delegate some wnats to ac40 an ac50
    let delegate = await claimSetupManager.delegate(accounts[40], 5000, { from: accounts[1] });
    await claimSetupManager.delegate(accounts[50], 5000, { from: accounts[1] });
    await expectEvent.inTransaction(delegate.tx, delegationAccount1, "DelegateFtso", { to: accounts[40], bips: toBN(5000) });

    let delegates = await wNat.delegatesOf(delAcc1Address);
    expect(delegates[0][0]).to.equals(accounts[40]);
    expect(delegates[1][0].toString()).to.equals("5000");
    expect(delegates[0][1]).to.equals(accounts[50]);
    expect(delegates[1][1].toString()).to.equals("5000");

    const blockNumber = await web3.eth.getBlockNumber();
    await time.advanceBlock();
    const vpBefore = await wNat.votePowerOfAt(accounts[40], blockNumber);
    const tx = await claimSetupManager.revokeDelegationAt(accounts[40], blockNumber, { from: accounts[1] });
    const vpAfter = await wNat.votePowerOfAt(accounts[40], blockNumber);
    await expectEvent.inTransaction(tx.tx, delegationAccount1, "RevokeFtso", { to: accounts[40], blockNumber: toBN(blockNumber) })

    expect(vpBefore.gtn(0)).is.true;
    expect(vpAfter.eqn(0)).is.true;
  });

  it("Should batch delegate", async() => {
    async function checkDelegations(from: string, expectDelegates: string[], expectBips: number[]) {
      const { 0: delegates, 1: bips } = await wNat.delegatesOf(from);
      compareArrays(delegates, expectDelegates);
      compareArrays(bips.map(x => Number(x)), expectBips);
    }
    async function checkDelegationsAt(from: string, expectDelegates: string[], expectBips: number[], at: number) {
      const { 0: delegates, 1: bips } = await wNat.delegatesOfAt(from, at);
      compareArrays(delegates, expectDelegates);
      compareArrays(bips.map(x => Number(x)), expectBips);
    }
    // Assemble
    await web3.eth.sendTransaction({from: accounts[1], to: delAcc1Address, value: 100 });
    // batch delegate to empty
    const tx = await claimSetupManager.batchDelegate([accounts[2], accounts[3]], [3000, 5000], { from: accounts[1] });
    const blk1 = await web3.eth.getBlockNumber();
    await expectEvent.inTransaction(tx.tx, delegationAccount1, "UndelegateAllFtso");
    await expectEvent.inTransaction(tx.tx, delegationAccount1, "DelegateFtso", { to: accounts[2], bips: toBN(3000) });
    await expectEvent.inTransaction(tx.tx, delegationAccount1, "DelegateFtso", { to: accounts[3], bips: toBN(5000) });
    await checkDelegations(delAcc1Address, [accounts[2], accounts[3]], [3000, 5000]);
    // redelegate all
    await claimSetupManager.batchDelegate([accounts[4], accounts[5]], [2000, 4000], { from: accounts[1] });
    const blk2 = await web3.eth.getBlockNumber();
    await checkDelegations(delAcc1Address, [accounts[4], accounts[5]], [2000, 4000]);
    // redelegate to one delegator
    await claimSetupManager.batchDelegate([accounts[6]], [5000], { from: accounts[1] });
    const blk3 = await web3.eth.getBlockNumber();
    await checkDelegations(delAcc1Address, [accounts[6]], [5000]);
    // undelegate via batchDelegation
    await claimSetupManager.batchDelegate([], [], { from: accounts[1] });
    const blk4 = await web3.eth.getBlockNumber();
    await checkDelegations(delAcc1Address, [], []);
    // batch delegate to empty again
    await claimSetupManager.batchDelegate([accounts[8], accounts[9]], [1000, 2000], { from: accounts[1] });
    const blk5 = await web3.eth.getBlockNumber();
    await checkDelegations(delAcc1Address, [accounts[8], accounts[9]], [1000, 2000]);
    // historical delegations should be correct
    await checkDelegationsAt(delAcc1Address, [accounts[2], accounts[3]], [3000, 5000], blk1);
    await checkDelegationsAt(delAcc1Address, [accounts[4], accounts[5]], [2000, 4000], blk2);
    await checkDelegationsAt(delAcc1Address, [accounts[6]], [5000], blk3);
    await checkDelegationsAt(delAcc1Address, [], [], blk4);
    await checkDelegationsAt(delAcc1Address, [accounts[8], accounts[9]], [1000, 2000], blk5);
  });

  it("Should delegate and undelegate", async() => {
    // "deposit" some wnats
    await web3.eth.sendTransaction({from: accounts[1], to: delAcc1Address, value: 100 });

    // delegate some wnats to ac40 an ac50
    let delegate = await claimSetupManager.delegate(accounts[40], 5000, { from: accounts[1] });
    await claimSetupManager.delegate(accounts[50], 5000, { from: accounts[1] });
    await expectEvent.inTransaction(delegate.tx, delegationAccount1, "DelegateFtso", { to: accounts[40], bips: toBN(5000) });

    let delegates = await wNat.delegatesOf(delAcc1Address);
    expect(delegates[0][0]).to.equals(accounts[40]);
    expect(delegates[1][0].toString()).to.equals("5000");
    expect(delegates[0][1]).to.equals(accounts[50]);
    expect(delegates[1][1].toString()).to.equals("5000");

    await distributeRewards(accounts, startTs);
    await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);
    
    //undelegate
    let undelegate = await claimSetupManager.undelegateAll({ from: accounts[1] });
    let del = await wNat.delegatesOf(delAcc1Address);
    expect(del[2].toString()).to.equals("0");
    await expectEvent.inTransaction(undelegate.tx, delegationAccount1, "UndelegateAllFtso", { });
  });

  it("Should revert if not manager", async() => {
    let tx1 = delegationAccount1.delegate(wNat.address, accounts[40], 5000, { from: accounts[3] });
    await expectRevert(tx1, "only manager");
  });

  it("Should delegate governance vote power", async() => {
    await web3.eth.sendTransaction({from: accounts[1], to: delAcc1Address, value: 100 });
    expect((await governanceVP.getVotes(delAcc1Address)).toString()).to.equals("100");
    await wNat.deposit({ from: accounts[2], value: "20" });
    expect((await governanceVP.getVotes(accounts[2])).toString()).to.equals("20");

    let delegate = await claimSetupManager.delegateGovernance(accounts[2], { from: accounts[1] });
    await expectEvent.inTransaction(delegate.tx, delegationAccount1, "DelegateGovernance",
     { to: accounts[2] }
    );
    expect((await governanceVP.getVotes(delAcc1Address)).toString()).to.equals("0");
    expect((await governanceVP.getVotes(accounts[2])).toString()).to.equals("120");

    expect(await governanceVP.getDelegateOfAtNow(delAcc1Address)).to.equal(accounts[2]);

    let undelegate = await claimSetupManager.undelegateGovernance({ from: accounts[1] });
    await expectEvent.inTransaction(undelegate.tx, delegationAccount1, "UndelegateGovernance", {});
  });

  it("Should not allow to initialize twice", async() => {
    await expectRevert(delegationAccount1.initialize(accounts[8], claimSetupManager.address),
    "owner already set");
  });

  it("Should not initialize if owner is zero address", async() => {
    let delegationAccount = await DelegationAccount.new();
    let tx = delegationAccount.initialize(constants.ZERO_ADDRESS, claimSetupManager.address);
    await expectRevert(tx, "owner address zero");
  });

  it("Should check if contract is clone", async() => {
    cloneFactoryMock = await CloneFactoryMock.new();
    let tx = await cloneFactoryMock.isClonePublic(libraryContract.address, delegationAccount1.address);
    expect(tx).to.equals(true);
  });

  it("Should enable transfers of ERC tokens", async() =>{
    const tokenMock = await MockContract.new()
    const token = await ERC20Mock.new("XTOK", "XToken");
    
    // Arguments are irrelvant
    const transferMethod = token.contract.methods.transfer(accounts[99], 0).encodeABI()
    await tokenMock.givenMethodReturnBool(transferMethod, false);
    await expectRevert(claimSetupManager.transferExternalToken(tokenMock.address, 70, {from: accounts[1]}), "SafeERC20: ERC20 operation did not succeed");
    await tokenMock.givenMethodReturnBool(transferMethod, true);

    // Should allow transfer
    let transfer = await claimSetupManager.transferExternalToken(tokenMock.address, 70, {from: accounts[1]});
    await expectEvent.inTransaction(transfer.tx, delegationAccount1, "ExternalTokenTransferred", { token: tokenMock.address, amount: toBN(70) });

    // Should call exactly once
    const invocationCount = await tokenMock.invocationCountForMethod.call(transferMethod)
    assert.equal("1", invocationCount.toString())
  });

  it("Should enable transfers of ERC tokens2", async() =>{
    const token = await ERC20Mock.new("XTOK", "XToken");
    // Mint tokens
    await token.mintAmount(delegationAccount1.address, 100);
    assert.equal((await token.balanceOf(delegationAccount1.address)).toString(), "100");
    // Should allow transfer
    await claimSetupManager.transferExternalToken(token.address, 70, {from: accounts[1]});

    assert.equal((await token.balanceOf(delegationAccount1.address)).toString(), "30");
    assert.equal((await token.balanceOf(accounts[1])).toString(), "70");

  });

  it("Should not allow wnat transfer", async() =>{
    // Should not allow transfer
    const tx = claimSetupManager.transferExternalToken(wNat.address, 70, {from: accounts[1]});
    await expectRevert(tx, "Transfer from wNat not allowed");
  });

  it("Should fail if calling non existing contract", async() =>{
    const tx = claimSetupManager.transferExternalToken(accounts[3], 70, {from: accounts[1]});
    await expectRevert(tx, "Address: call to non-contract");
  });

  it("Should fail if calling non conforming contract", async() =>{
    const tx = claimSetupManager.transferExternalToken(ftsoRewardManager.address, 70, {from: accounts[1]});
    await expectRevert(tx, "SafeERC20: low-level call failed");
  });

  it("Should not update wNat if address changes", async() => {
    expect(await claimSetupManager.wNat()).to.equals(wNat.address);

    let wNat2 = await WNat.new(accounts[0], "Wrapped NAT 2", "WNAT2");
    let setAddresses = claimSetupManager.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_MANAGER, Contracts.WNAT]),
      [ADDRESS_UPDATER, mockFtsoManager.address, wNat2.address], {from: ADDRESS_UPDATER});
    await expectRevert(setAddresses, "wrong wNat address");
    expect(await claimSetupManager.wNat()).to.equals(wNat.address);
  })

  it("Should get delegation account data and disable delegation account", async() => {
    let data = await claimSetupManager.getDelegationAccountData(accounts[1]);
    expect(data[0]).to.equals(delAcc1Address);
    expect(data[1]).to.equals(true);

    let disable1 = await claimSetupManager.disableDelegationAccount( { from: accounts[1] });
    expectEvent(disable1, "DelegationAccountUpdated", { owner: accounts[1], delegationAccount: delAcc1Address, enabled: false });
    let data1 = await claimSetupManager.getDelegationAccountData(accounts[1]);
    expect(data1[0]).to.equals(delAcc1Address);
    expect(data1[1]).to.equals(false);
  })

  it("Should get auto claim addresses and executor fee", async() => {
    let executor = accounts[6]; 
    await claimSetupManager.registerExecutor(10, { value: EXECUTOR_REGISTER_FEE, from: executor });
    await claimSetupManager.setClaimExecutors([executor], { from: accounts[1], value: "10" });
    let tx1 = claimSetupManager.getAutoClaimAddressesAndExecutorFee(accounts[6], [accounts[1], accounts[2]]);
    await expectRevert(tx1, "only owner or executor");

    await claimSetupManager.setClaimExecutors([executor], { from: accounts[2], value: "10" });
    await claimSetupManager.setClaimExecutors([executor], { from: accounts[3], value: "10" });
    await claimSetupManager.disableDelegationAccount({ from: accounts[3] });
    let tx2 = await claimSetupManager.getAutoClaimAddressesAndExecutorFee(accounts[6], [accounts[1], accounts[2], accounts[3]]);
    expect(tx2[0][0]).to.equals(delAcc1Address);
    expect(tx2[0][1]).to.equals(delAcc2Address);
    expect(tx2[0][2]).to.equals(accounts[3]);
    expect(tx2[1].toNumber()).to.equals(10);
  })

  it("Should check if executor can claim for owners", async() => {
    let executor = accounts[6]; 
    await claimSetupManager.registerExecutor(10, { value: EXECUTOR_REGISTER_FEE, from: executor });
    await claimSetupManager.setClaimExecutors([executor], { from: accounts[1], value: "10" });
    expect(await claimSetupManager.isClaimExecutor(accounts[1], executor)).to.equals(true);
    expect(await claimSetupManager.isClaimExecutor(accounts[2], executor)).to.equals(false);
  });

  it("Should pay fee for new executors only", async() => {
    let executor = accounts[6];
    let executor2 = accounts[7];
    let executor3 = accounts[8];
    await claimSetupManager.registerExecutor(10, { value: EXECUTOR_REGISTER_FEE, from: executor });
    await claimSetupManager.registerExecutor(5, { value: EXECUTOR_REGISTER_FEE, from: executor3 });
    await claimSetupManager.setClaimExecutors([executor], { from: accounts[1], value: "10" });
    expect(await claimSetupManager.isClaimExecutor(accounts[1], executor)).to.equals(true);
    expect(await claimSetupManager.isClaimExecutor(accounts[2], executor)).to.equals(false);
    await claimSetupManager.setClaimExecutors([executor, executor2], { from: accounts[1] });
    expect(await claimSetupManager.isClaimExecutor(accounts[1], executor)).to.equals(true);
    expect(await claimSetupManager.isClaimExecutor(accounts[1], executor2)).to.equals(true);
    await claimSetupManager.setClaimExecutors([executor, executor2, executor3], { from: accounts[1], value: "5" });
    expect(await claimSetupManager.isClaimExecutor(accounts[1], executor)).to.equals(true);
    expect(await claimSetupManager.isClaimExecutor(accounts[1], executor2)).to.equals(true);
    expect(await claimSetupManager.isClaimExecutor(accounts[1], executor3)).to.equals(true);
    await claimSetupManager.setClaimExecutors([executor2], { from: accounts[1] });
    expect(await claimSetupManager.isClaimExecutor(accounts[1], executor)).to.equals(false);
    expect(await claimSetupManager.isClaimExecutor(accounts[1], executor2)).to.equals(true);
    expect(await claimSetupManager.isClaimExecutor(accounts[1], executor3)).to.equals(false);
    await expectRevert(claimSetupManager.setClaimExecutors([executor, executor2, executor3], { from: accounts[1], value: "14" }), "transfer failed");
    await claimSetupManager.setClaimExecutors([executor, executor2, executor3], { from: accounts[1], value: "15" });
    expect(await claimSetupManager.isClaimExecutor(accounts[1], executor)).to.equals(true);
    expect(await claimSetupManager.isClaimExecutor(accounts[1], executor2)).to.equals(true);
    expect(await claimSetupManager.isClaimExecutor(accounts[1], executor3)).to.equals(true);
  });

  it("Should revert when trying to disable delegation account that does not exist", async() => {
    let tx = claimSetupManager.disableDelegationAccount( { from: accounts[8] });
    await expectRevert(tx, "no delegation account");
  })

  it("Should revert when trying to delegate and delegation account does not exist", async() => {
    let tx = claimSetupManager.delegate(accounts[8], 10000, { from: accounts[8] });
    await expectRevert(tx, "Transaction reverted: function call to a non-contract account");
  })

  it("Should not register executor if wrong fee", async() => {
    let executor = accounts[6]; 
    await claimSetupManager.registerExecutor(10, { value: EXECUTOR_REGISTER_FEE, from: executor });
    await claimSetupManager.setMinFeeValueWei(50, { from: GOVERNANCE_ADDRESS });
    let update = claimSetupManager.updateExecutorFeeValue(20, { from: executor });
    await expectRevert(update, "invalid fee value");
    let register = claimSetupManager.registerExecutor(20, { value: EXECUTOR_REGISTER_FEE, from: accounts[7] });
    await expectRevert(register, "invalid fee value");
  });

});
