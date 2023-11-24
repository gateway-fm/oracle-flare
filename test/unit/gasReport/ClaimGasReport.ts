import { Address } from 'hardhat-deploy/dist/types';
import {
  WNatInstance,
  MockContractInstance,
  ClaimSetupManagerInstance,
  DelegationAccountInstance,
  InflationMockInstance,
  FtsoRewardManagerInstance,
  FtsoManagerInstance,
  FtsoRewardManagerContract,
  FtsoManagerContract,
  FtsoRegistryInstance,
  VoterWhitelisterInstance,
  CleanupBlockNumberManagerInstance,
  FtsoInstance,
  GovernanceVotePowerInstance,
  FtsoRegistryProxyInstance
} from "../../../typechain-truffle";
import { toBN, encodeContractNames, compareNumberArrays, compareArrays } from '../../utils/test-helpers';
import { setDefaultVPContract } from "../../utils/token-test-helpers";
import { expectRevert, expectEvent, time, constants } from '@openzeppelin/test-helpers';
import { Contracts } from '../../../deployment/scripts/Contracts';
import { GOVERNANCE_GENESIS_ADDRESS, getTestFile, defaultPriceEpochCyclicBufferSize } from "../../utils/constants";
import { setDefaultGovernanceParameters } from "../../utils/FtsoManager-test-utils";
import { createMockSupplyContract } from "../../utils/FTSO-test-utils";

let wNat: WNatInstance;
let claimSetupManager: ClaimSetupManagerInstance;
let libraryContract: DelegationAccountInstance;
let ftsoRegistry: FtsoRegistryInstance;
let mockVoterWhitelister: MockContractInstance;
let ftsoRewardManager: FtsoRewardManagerInstance;
let ftsoManager: FtsoManagerInstance;
let startTs: BN;
let mockInflation: InflationMockInstance;
let ADDRESS_UPDATER: string;
let mockPriceSubmitter: MockContractInstance;
let distribution: MockContractInstance;
let mockFtso: MockContractInstance;
let ftsoInterface: FtsoInstance;
let governanceVP: GovernanceVotePowerInstance;

let mockSupply: MockContractInstance;
let mockCleanupBlockNumberManager: MockContractInstance;
let ftsoRegistryProxy: FtsoRegistryProxyInstance;
let registry: FtsoRegistryInstance;

const WNat = artifacts.require("WNat");
const MockContract = artifacts.require("MockContract");
const ClaimSetupManager = artifacts.require("ClaimSetupManager");
const DelegationAccount = artifacts.require("DelegationAccount");
const FtsoRewardManager = artifacts.require("FtsoRewardManager") as FtsoRewardManagerContract;
const DataProviderFee = artifacts.require("DataProviderFee" as any);
const FtsoManager = artifacts.require("FtsoManager") as FtsoManagerContract;
const FtsoManagement = artifacts.require("FtsoManagement");
const InflationMock = artifacts.require("InflationMock");
const FtsoRegistry = artifacts.require("FtsoRegistry");
const Ftso = artifacts.require("Ftso");
const GovernanceVotePower = artifacts.require("GovernanceVotePower");
const FtsoRegistryProxy = artifacts.require("FtsoRegistryProxy");

const PRICE_EPOCH_DURATION_S = 120;   // 2 minutes
const REVEAL_EPOCH_DURATION_S = 30;
const REWARD_EPOCH_DURATION_S = 2 * 24 * 60 * 60; // 2 days
const VOTE_POWER_BOUNDARY_FRACTION = 7;

const BN = web3.utils.toBN;

contract(`ClaimSetupManager.sol; ${getTestFile(__filename)}; Claim setup manager unit tests`, async accounts => {
  const EXECUTOR_MIN_FEE = "0";
  const EXECUTOR_MAX_FEE = "1";
  const EXECUTOR_REGISTER_FEE = "1";
  ADDRESS_UPDATER = accounts[16];

  before(async () => {
    FtsoManager.link(await FtsoManagement.new() as any);
    FtsoRewardManager.link(await DataProviderFee.new() as any);
  });


  async function pdaClaimingGasBenchmarking(num: number, enabled: boolean, executorFee: number, delegators: number = 1, delegatorsPDA: number = 1) {
    // deposit some wNats
    for (let i = 11; i < num + 11; i++) {
      await wNat.deposit({ from: accounts[i], value: "100" });
      if (delegators == 1) {
        await wNat.delegate(accounts[1], 10000, { from: accounts[i] });
      }
      else if (delegators == 2) {
        await wNat.delegate(accounts[1], 5000, { from: accounts[i] });
        await wNat.delegate(accounts[2], 5000, { from: accounts[i] });
      }
      if (enabled) {
        await claimSetupManager.enableDelegationAccount({ from: accounts[i] });
        let pda = await claimSetupManager.accountToDelegationAccount(accounts[i]);
        await web3.eth.sendTransaction({ from: accounts[i], to: pda, value: 100 });
        if (delegatorsPDA == 1) {
          await claimSetupManager.delegate(accounts[2], 10000, { from: accounts[i] });
        }
        else if (delegatorsPDA == 2) {
          await claimSetupManager.delegate(accounts[2], 5000, { from: accounts[i] });
          await claimSetupManager.delegate(accounts[1], 5000, { from: accounts[i] });
        }
      }
    }

    // Assemble
    // stub ftso finalizer
    const finalizePriceEpoch = ftsoInterface.contract.methods.finalizePriceEpoch(0, true).encodeABI();
    const finalizePriceEpochReturn = web3.eth.abi.encodeParameters(
      ['address[]', 'uint256[]', 'uint256'],
      [[accounts[1], accounts[2]], [25, 75], 100]);
    await mockFtso.givenMethodReturn(finalizePriceEpoch, finalizePriceEpochReturn);
    // Stub accounting system to make it balance with RM contract

    // give reward manager some nat to distribute
    await mockInflation.receiveInflation({ value: "2000000" });

    await setDefaultGovernanceParameters(ftsoManager);
    // add fakey ftso
    await ftsoManager.addFtso(mockFtso.address, { from: accounts[0] });
    // activte ftso manager
    await ftsoManager.activate();
    // Time travel to price epoch initialization time
    await time.increaseTo(startTs.addn(REVEAL_EPOCH_DURATION_S + 160));
    await ftsoManager.daemonize(); // initialize reward epoch
    await ftsoRewardManager.enableClaims();
    // Trigger price epoch initialization
    await ftsoManager.daemonize();
    // Time travel to price epoch finalization time
    await time.increaseTo(startTs.addn(PRICE_EPOCH_DURATION_S + REVEAL_EPOCH_DURATION_S + 160));
    // Trigger price epoch finalization
    await ftsoManager.daemonize();
    // Trigger another price epoch initialization
    await ftsoManager.daemonize();
    // Time travel to reward epoch finalization time
    await time.increaseTo(startTs.addn(REWARD_EPOCH_DURATION_S + REVEAL_EPOCH_DURATION_S + 160));
    // Trigger price epoch finalization and reward epoch finalization
    await ftsoManager.daemonize();
    await ftsoManager.daemonize();

    ////
    let startTs2 = await time.latest();
    await mockInflation.setDailyAuthorizedInflation(BN(2000000));
    await mockInflation.receiveInflation({ value: "2000000" });
    await time.increaseTo(startTs2.addn(REVEAL_EPOCH_DURATION_S + 160));
    await ftsoManager.daemonize(); // initialize reward epoch
    // Trigger price epoch initialization
    await ftsoManager.daemonize();
    // Time travel to price epoch finalization time
    await time.increaseTo(startTs2.addn(PRICE_EPOCH_DURATION_S + REVEAL_EPOCH_DURATION_S + 160));
    // Trigger price epoch finalization
    await ftsoManager.daemonize();
    // Trigger another price epoch initialization
    await ftsoManager.daemonize();
    // Time travel to reward epoch finalization time
    await time.increaseTo(startTs2.addn(REWARD_EPOCH_DURATION_S + REVEAL_EPOCH_DURATION_S + 160));
    // Trigger price epoch finalization and reward epoch finalization
    await ftsoManager.daemonize();
    await ftsoManager.daemonize();



    await claimSetupManager.registerExecutor(executorFee, { from: accounts[4], value: EXECUTOR_REGISTER_FEE });
    let accs = [];
    let pdas = [];
    for (let i = 11; i < num + 11; i++) {
      await claimSetupManager.setClaimExecutors([accounts[4]], { from: accounts[i], value: toBN(executorFee) });
      let pda = await claimSetupManager.accountToDelegationAccount(accounts[i]);
      accs.push(accounts[i]);
      pdas.push(pda);
    }

    // claim
    let tx = await ftsoRewardManager.autoClaim(accs, 0, { from: accounts[4] })
    let tx1 = await ftsoRewardManager.autoClaim(accs, 1, { from: accounts[4] });
    console.log(`gas used (0): ${tx.receipt.gasUsed}`);
    console.log(`gas used (1): ${tx1.receipt.gasUsed}`);

    // if (enabled) {
    //   console.log((await wNat.balanceOf(pdas[1])).toNumber());
    //   assert.equal((await wNat.balanceOf(pdas[1])).toNumber(), Math.floor(2 * 2000000 / 5040 / num) + 100 - executorFee);
    // }
    // else {
    //   console.log((await wNat.balanceOf(accounts[11])).toNumber());
    //   assert.equal((await wNat.balanceOf(accounts[11])).toNumber(), Math.floor(2 * 2000000 / 5040 * 0.25/ num) + 100 - executorFee);
    // }

    for (let i = 11; i < num + 11; i++) {
      if (enabled) {
        // console.log((await wNat.balanceOf(pdas[i - 11])).toNumber());
        // console.log((await wNat.balanceOf(accounts[i])).toNumber())
        expect((await wNat.balanceOf(pdas[i - 11])).toNumber()).to.be.gt(100);
      }
      else {
        // console.log((await wNat.balanceOf(accounts[i])).toNumber())
        // console.log((await wNat.balanceOf(pdas[i - 11])).toNumber());
        expect((await wNat.balanceOf(accounts[i])).toNumber()).to.be.gt(100);
      }
    }

  }

  beforeEach(async () => {
    distribution = await MockContract.new();

    mockFtso = await MockContract.new();
    ftsoRegistry = await FtsoRegistry.new();
    ftsoRegistryProxy = await FtsoRegistryProxy.new(accounts[0], ftsoRegistry.address);
    registry = await FtsoRegistry.at(ftsoRegistryProxy.address);
    await registry.initialiseRegistry(ADDRESS_UPDATER);
    ftsoInterface = await Ftso.new(
      "NAT",
      5,
      constants.ZERO_ADDRESS as any,
      constants.ZERO_ADDRESS as any,
      constants.ZERO_ADDRESS as any,
      0,
      120,
      60,
      0,
      1e10,
      defaultPriceEpochCyclicBufferSize
    );

    ftsoRewardManager = await FtsoRewardManager.new(
      accounts[0],
      ADDRESS_UPDATER,
      constants.ZERO_ADDRESS,
      3,
      0
    );



    mockPriceSubmitter = await MockContract.new();
    await mockPriceSubmitter.givenMethodReturnUint(
      web3.utils.sha3("addFtso(address)")!.slice(0, 10),
      0
    )
    await mockPriceSubmitter.givenMethodReturnUint(
      web3.utils.sha3("removeFtso(address)")!.slice(0, 10),
      0
    )

    mockVoterWhitelister = await MockContract.new();

    mockSupply = await createMockSupplyContract(accounts[0], 10000);
    mockCleanupBlockNumberManager = await MockContract.new();

    // Get the timestamp for the just mined block
    startTs = await time.latest();
    ftsoManager = await FtsoManager.new(
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

    mockInflation = await InflationMock.new();
    await mockInflation.setInflationReceiver(ftsoRewardManager.address);

    await ftsoManager.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.PRICE_SUBMITTER, Contracts.FTSO_REWARD_MANAGER, Contracts.FTSO_REGISTRY, Contracts.VOTER_WHITELISTER, Contracts.SUPPLY, Contracts.CLEANUP_BLOCK_NUMBER_MANAGER]),
      [ADDRESS_UPDATER, mockPriceSubmitter.address, ftsoRewardManager.address, registry.address, mockVoterWhitelister.address, mockSupply.address, mockCleanupBlockNumberManager.address], { from: ADDRESS_UPDATER });

    await registry.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_MANAGER]),
      [ADDRESS_UPDATER, ftsoManager.address], { from: ADDRESS_UPDATER });


    wNat = await WNat.new(accounts[0], "Wrapped NAT", "WNAT");
    await setDefaultVPContract(wNat, accounts[0]);
    const pChainStakeMirror = await MockContract.new();
    governanceVP = await GovernanceVotePower.new(wNat.address, pChainStakeMirror.address);
    await wNat.setGovernanceVotePower(governanceVP.address);

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
      [ADDRESS_UPDATER, mockInflation.address, ftsoManager.address, wNat.address, claimSetupManager.address], { from: ADDRESS_UPDATER });

    await mockInflation.setDailyAuthorizedInflation(BN(2000000));

    await ftsoRewardManager.activate()

    await claimSetupManager.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.FTSO_REWARD_MANAGER, Contracts.DISTRIBUTION_TO_DELEGATORS]),
      [ADDRESS_UPDATER, ftsoManager.address, wNat.address, ftsoRewardManager.address, distribution.address], { from: ADDRESS_UPDATER });
    // deploy library contract
    libraryContract = await DelegationAccount.new();

    let setLibrary = await claimSetupManager.setLibraryAddress(libraryContract.address);
    expectEvent(setLibrary, "SetLibraryAddress", { libraryAddress: libraryContract.address });
  });

  it("Should claim and wrap to another account", async () => {
    // deposit some wNats
    // await wNat.deposit({ from: accounts[1], value: "100" });
    await wNat.deposit({ from: accounts[11], value: "100" });
    await wNat.deposit({ from: accounts[12], value: "100" });

    await wNat.delegate(accounts[1], 10000, { from: accounts[11] });
    await wNat.delegate(accounts[1], 10000, { from: accounts[12] });

    // Assemble
    // stub ftso finalizer
    const finalizePriceEpoch = ftsoInterface.contract.methods.finalizePriceEpoch(0, true).encodeABI();
    const finalizePriceEpochReturn = web3.eth.abi.encodeParameters(
      ['address[]', 'uint256[]', 'uint256'],
      [[accounts[1], accounts[2]], [25, 75], 100]);
    await mockFtso.givenMethodReturn(finalizePriceEpoch, finalizePriceEpochReturn);
    // Stub accounting system to make it balance with RM contract

    // give reward manager some nat to distribute
    await mockInflation.receiveInflation({ value: "2000000" });

    await setDefaultGovernanceParameters(ftsoManager);
    // add fakey ftso
    await ftsoManager.addFtso(mockFtso.address, { from: accounts[0] });
    // activte ftso manager
    await ftsoManager.activate();
    // Time travel to price epoch initialization time
    await time.increaseTo(startTs.addn(REVEAL_EPOCH_DURATION_S));
    await ftsoManager.daemonize(); // initialize reward epoch
    await ftsoRewardManager.enableClaims();
    // Trigger price epoch initialization
    await ftsoManager.daemonize();
    // Time travel to price epoch finalization time
    await time.increaseTo(startTs.addn(PRICE_EPOCH_DURATION_S + REVEAL_EPOCH_DURATION_S));
    // Trigger price epoch finalization
    await ftsoManager.daemonize();
    // Trigger another price epoch initialization
    await ftsoManager.daemonize();
    // Time travel to reward epoch finalization time
    await time.increaseTo(startTs.addn(REWARD_EPOCH_DURATION_S + REVEAL_EPOCH_DURATION_S));
    // Trigger price epoch finalization and reward epoch finalization
    await ftsoManager.daemonize();
    await ftsoManager.daemonize();


    ////
    let startTs2 = await time.latest();
    await time.increaseTo(startTs2.addn(REVEAL_EPOCH_DURATION_S + 160));
    await ftsoManager.daemonize(); // initialize reward epoch
    // Trigger price epoch initialization
    await ftsoManager.daemonize();
    // Time travel to price epoch finalization time
    await time.increaseTo(startTs2.addn(PRICE_EPOCH_DURATION_S + REVEAL_EPOCH_DURATION_S + 160));
    // Trigger price epoch finalization
    await ftsoManager.daemonize();
    // Trigger another price epoch initialization
    await ftsoManager.daemonize();
    // Time travel to reward epoch finalization time
    await time.increaseTo(startTs2.addn(REWARD_EPOCH_DURATION_S + REVEAL_EPOCH_DURATION_S + 160));
    // Trigger price epoch finalization and reward epoch finalization
    await ftsoManager.daemonize();
    await ftsoManager.daemonize();


    ////
    let startTs3 = await time.latest();
    await time.increaseTo(startTs3.addn(REVEAL_EPOCH_DURATION_S + 160));
    await ftsoManager.daemonize(); // initialize reward epoch
    // Trigger price epoch initialization
    await ftsoManager.daemonize();
    // Time travel to price epoch finalization time
    await time.increaseTo(startTs3.addn(PRICE_EPOCH_DURATION_S + REVEAL_EPOCH_DURATION_S + 160));
    // Trigger price epoch finalization
    await ftsoManager.daemonize();
    // Trigger another price epoch initialization
    await ftsoManager.daemonize();
    // Time travel to reward epoch finalization time
    await time.increaseTo(startTs3.addn(REWARD_EPOCH_DURATION_S + REVEAL_EPOCH_DURATION_S + 160));
    // Trigger price epoch finalization and reward epoch finalization
    await ftsoManager.daemonize();
    await ftsoManager.daemonize();

    // Act
    // Claim reward to a3 - test both 3rd party claim and avoid
    // having to calc gas fees
    let balanceBefore = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
    let txClaim = await ftsoRewardManager.claim(accounts[11], accounts[3], 0, false, { from: accounts[11] });
    // a1 -> a3 claimed should be (2000000 / 720) * 0.25 finalizations = 695
    let balanceAfter = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
    assert.equal(balanceAfter.sub(balanceBefore).toNumber(), 695);
    console.log(`claim reward and send to another account (0): ${txClaim.receipt.gasUsed}`);

    // claim and wrap
    let txClaimWrap = await ftsoRewardManager.claim(accounts[12], accounts[3], 0, true, { from: accounts[12] });
    assert.equal((await wNat.balanceOf(accounts[3])).toNumber(), 695);
    console.log(`claim, wrap reward and send to another account (0): ${txClaimWrap.receipt.gasUsed}`);



    ///// second claim
    // Act
    // Claim reward to a3 - test both 3rd party claim and avoid
    // having to calc gas fees
    let txClaim1 = await ftsoRewardManager.claim(accounts[11], accounts[3], 1, false, { from: accounts[11] });
    console.log(`claim reward and send to another account (1): ${txClaim1.receipt.gasUsed}`);

    // claim and wrap
    let txClaimWrap1 = await ftsoRewardManager.claim(accounts[12], accounts[3], 1, true, { from: accounts[12] });
    console.log(`claim, wrap reward and send to another account (1): ${txClaimWrap1.receipt.gasUsed}`);

    ///// third claim
    // Act
    // Claim reward to a3 - test both 3rd party claim and avoid
    // having to calc gas fees
    let txClaim2 = await ftsoRewardManager.claim(accounts[11], accounts[3], 2, false, { from: accounts[11] });
    console.log(`claim reward and send to another account (2): ${txClaim2.receipt.gasUsed}`);

    // claim and wrap
    let txClaimWrap2 = await ftsoRewardManager.claim(accounts[12], accounts[3], 2, true, { from: accounts[12] });
    console.log(`claim, wrap reward and send to another account (2): ${txClaimWrap2.receipt.gasUsed}`);
  });

  it("Should claim and wrap", async () => {
    // deposit some wNats
    // await wNat.deposit({ from: accounts[1], value: "100" });
    await wNat.deposit({ from: accounts[11], value: "100" });
    await wNat.deposit({ from: accounts[12], value: "100" });

    await wNat.delegate(accounts[1], 10000, { from: accounts[11] });
    await wNat.delegate(accounts[1], 10000, { from: accounts[12] });

    // Assemble
    // stub ftso finalizer
    const finalizePriceEpoch = ftsoInterface.contract.methods.finalizePriceEpoch(0, true).encodeABI();
    const finalizePriceEpochReturn = web3.eth.abi.encodeParameters(
      ['address[]', 'uint256[]', 'uint256'],
      [[accounts[1], accounts[2]], [25, 75], 100]);
    await mockFtso.givenMethodReturn(finalizePriceEpoch, finalizePriceEpochReturn);
    // Stub accounting system to make it balance with RM contract

    // give reward manager some nat to distribute
    await mockInflation.receiveInflation({ value: "2000000" });

    await setDefaultGovernanceParameters(ftsoManager);
    // add fakey ftso
    await ftsoManager.addFtso(mockFtso.address, { from: accounts[0] });
    // activte ftso manager
    await ftsoManager.activate();
    // Time travel to price epoch initialization time
    await time.increaseTo(startTs.addn(REVEAL_EPOCH_DURATION_S));
    await ftsoManager.daemonize(); // initialize reward epoch
    await ftsoRewardManager.enableClaims();
    // Trigger price epoch initialization
    await ftsoManager.daemonize();
    // Time travel to price epoch finalization time
    await time.increaseTo(startTs.addn(PRICE_EPOCH_DURATION_S + REVEAL_EPOCH_DURATION_S));
    // Trigger price epoch finalization
    await ftsoManager.daemonize();
    // Trigger another price epoch initialization
    await ftsoManager.daemonize();
    // Time travel to reward epoch finalization time
    await time.increaseTo(startTs.addn(REWARD_EPOCH_DURATION_S + REVEAL_EPOCH_DURATION_S));
    // Trigger price epoch finalization and reward epoch finalization
    await ftsoManager.daemonize();
    await ftsoManager.daemonize();

    ////
    let startTs2 = await time.latest();
    await time.increaseTo(startTs2.addn(REVEAL_EPOCH_DURATION_S + 160));
    await ftsoManager.daemonize(); // initialize reward epoch
    // Trigger price epoch initialization
    await ftsoManager.daemonize();
    // Time travel to price epoch finalization time
    await time.increaseTo(startTs2.addn(PRICE_EPOCH_DURATION_S + REVEAL_EPOCH_DURATION_S + 160));
    // Trigger price epoch finalization
    await ftsoManager.daemonize();
    // Trigger another price epoch initialization
    await ftsoManager.daemonize();
    // Time travel to reward epoch finalization time
    await time.increaseTo(startTs2.addn(REWARD_EPOCH_DURATION_S + REVEAL_EPOCH_DURATION_S + 160));
    // Trigger price epoch finalization and reward epoch finalization
    await ftsoManager.daemonize();
    await ftsoManager.daemonize();

    ////
    let startTs3 = await time.latest();
    await time.increaseTo(startTs3.addn(REVEAL_EPOCH_DURATION_S + 160));
    await ftsoManager.daemonize(); // initialize reward epoch
    // Trigger price epoch initialization
    await ftsoManager.daemonize();
    // Time travel to price epoch finalization time
    await time.increaseTo(startTs3.addn(PRICE_EPOCH_DURATION_S + REVEAL_EPOCH_DURATION_S + 160));
    // Trigger price epoch finalization
    await ftsoManager.daemonize();
    // Trigger another price epoch initialization
    await ftsoManager.daemonize();
    // Time travel to reward epoch finalization time
    await time.increaseTo(startTs3.addn(REWARD_EPOCH_DURATION_S + REVEAL_EPOCH_DURATION_S + 160));
    // Trigger price epoch finalization and reward epoch finalization
    await ftsoManager.daemonize();
    await ftsoManager.daemonize();

    // Act
    // Claim reward to a3 - test both 3rd party claim and avoid
    // having to calc gas fees
    let txClaim = await ftsoRewardManager.claim(accounts[11], accounts[11], 0, false, { from: accounts[11] });
    // a1 -> a3 claimed should be (2000000 / 720) * 0.25 finalizations = 695
    console.log(`claim reward (0): ${txClaim.receipt.gasUsed}`);

    // claim and wrap
    let txClaimWrap = await ftsoRewardManager.claim(accounts[12], accounts[12], 0, true, { from: accounts[12] });
    assert.equal((await wNat.balanceOf(accounts[12])).toNumber(), 695 + 100);
    console.log(`claim and wrap reward (0): ${txClaimWrap.receipt.gasUsed}`);


    // Act
    // Claim reward to a3 - test both 3rd party claim and avoid
    // having to calc gas fees
    let txClaim1 = await ftsoRewardManager.claim(accounts[11], accounts[11], 1, false, { from: accounts[11] });
    // a1 -> a3 claimed should be (2000000 / 720) * 0.25 finalizations = 695
    console.log(`claim reward (1): ${txClaim1.receipt.gasUsed}`);

    // claim and wrap
    let txClaimWrap1 = await ftsoRewardManager.claim(accounts[12], accounts[12], 1, true, { from: accounts[12] });
    console.log(`claim and wrap reward (1): ${txClaimWrap1.receipt.gasUsed}`);



    // Act
    // Claim reward to a3 - test both 3rd party claim and avoid
    // having to calc gas fees
    let txClaim2 = await ftsoRewardManager.claim(accounts[11], accounts[11], 2, false, { from: accounts[11] });
    // a1 -> a3 claimed should be (2000000 / 720) * 0.25 finalizations = 695
    console.log(`claim reward (2): ${txClaim2.receipt.gasUsed}`);

    // claim and wrap
    let txClaimWrap2 = await ftsoRewardManager.claim(accounts[12], accounts[12], 2, true, { from: accounts[12] });
    console.log(`claim and wrap reward (2): ${txClaimWrap2.receipt.gasUsed}`);
  });

  it("Executor should claim on ftso reward manager", async () => {
    // deposit some wNats
    // await wNat.deposit({ from: accounts[1], value: "100" });
    await wNat.deposit({ from: accounts[11], value: "100" });
    await wNat.deposit({ from: accounts[12], value: "100" });

    await wNat.delegate(accounts[1], 10000, { from: accounts[11] });
    await wNat.delegate(accounts[1], 10000, { from: accounts[12] });

    // Assemble
    // stub ftso finalizer
    const finalizePriceEpoch = ftsoInterface.contract.methods.finalizePriceEpoch(0, true).encodeABI();
    const finalizePriceEpochReturn = web3.eth.abi.encodeParameters(
      ['address[]', 'uint256[]', 'uint256'],
      [[accounts[1], accounts[2]], [25, 75], 100]);
    await mockFtso.givenMethodReturn(finalizePriceEpoch, finalizePriceEpochReturn);
    // Stub accounting system to make it balance with RM contract

    // give reward manager some nat to distribute
    await mockInflation.receiveInflation({ value: "2000000" });

    await setDefaultGovernanceParameters(ftsoManager);
    // add fakey ftso
    await ftsoManager.addFtso(mockFtso.address, { from: accounts[0] });
    // activte ftso manager
    await ftsoManager.activate();
    // Time travel to price epoch initialization time
    await time.increaseTo(startTs.addn(REVEAL_EPOCH_DURATION_S));
    await ftsoManager.daemonize(); // initialize reward epoch
    await ftsoRewardManager.enableClaims();
    // Trigger price epoch initialization
    await ftsoManager.daemonize();
    // Time travel to price epoch finalization time
    await time.increaseTo(startTs.addn(PRICE_EPOCH_DURATION_S + REVEAL_EPOCH_DURATION_S));
    // Trigger price epoch finalization
    await ftsoManager.daemonize();
    // Trigger another price epoch initialization
    await ftsoManager.daemonize();
    // Time travel to reward epoch finalization time
    await time.increaseTo(startTs.addn(REWARD_EPOCH_DURATION_S + REVEAL_EPOCH_DURATION_S));
    // Trigger price epoch finalization and reward epoch finalization
    await ftsoManager.daemonize();
    await ftsoManager.daemonize();

    ///// 
    let startTs2 = await time.latest();
    await time.increaseTo(startTs2.addn(REVEAL_EPOCH_DURATION_S + 160));
    await ftsoManager.daemonize(); // initialize reward epoch
    // Trigger price epoch initialization
    await ftsoManager.daemonize();
    // Time travel to price epoch finalization time
    await time.increaseTo(startTs2.addn(PRICE_EPOCH_DURATION_S + REVEAL_EPOCH_DURATION_S + 160));
    // Trigger price epoch finalization
    await ftsoManager.daemonize();
    // Trigger another price epoch initialization
    await ftsoManager.daemonize();
    // Time travel to reward epoch finalization time
    await time.increaseTo(startTs2.addn(REWARD_EPOCH_DURATION_S + REVEAL_EPOCH_DURATION_S + 160));
    // Trigger price epoch finalization and reward epoch finalization
    await ftsoManager.daemonize();
    await ftsoManager.daemonize();


    await claimSetupManager.setClaimExecutors([accounts[4]], { from: accounts[11] });
    await claimSetupManager.setClaimExecutors([accounts[4]], { from: accounts[12] });

    // Act
    // Claim reward to a3 - test both 3rd party claim and avoid
    // having to calc gas fees
    let txClaim = await ftsoRewardManager.claim(accounts[11], accounts[11], 0, false, { from: accounts[4] });
    // a1 -> a3 claimed should be (2000000 / 720) * 0.25 finalizations = 695
    console.log(`executor claims reward to user (0): ${txClaim.receipt.gasUsed}`);

    // claim and wrap
    let txClaimWrap = await ftsoRewardManager.claim(accounts[12], accounts[12], 0, true, { from: accounts[4] });
    assert.equal((await wNat.balanceOf(accounts[12])).toNumber(), 695 + 100);
    console.log(`executor claims and sends wrapped reward to user (0): ${txClaimWrap.receipt.gasUsed}`);

    // Act
    // Claim reward to a3 - test both 3rd party claim and avoid
    // having to calc gas fees
    let txClaim1 = await ftsoRewardManager.claim(accounts[11], accounts[11], 1, false, { from: accounts[4] });
    console.log(`executor claims reward to user (1): ${txClaim1.receipt.gasUsed}`);

    // claim and wrap
    let txClaimWrap1 = await ftsoRewardManager.claim(accounts[12], accounts[12], 1, true, { from: accounts[4] });
    console.log(`executor claims and sends wrapped reward to user (1): ${txClaimWrap1.receipt.gasUsed}`);
  });


  it("Claim for 1, PDA disabled, no fee, user delegates to 1", async () => {
    await pdaClaimingGasBenchmarking(1, false, 0);
  });

  it("Claim for 1, PDA enabled, no fee, user delegates to 1, PDA does not delegate", async () => {
    await pdaClaimingGasBenchmarking(1, true, 0, 1, 0);
  });


  it("Claim for 2, PDA disabled, no fee, user delegates to 1", async () => {
    await pdaClaimingGasBenchmarking(2, false, 0);
  });

  it("Claim for 2, PDA disabled, with fee, user delegates to 1", async () => {
    await pdaClaimingGasBenchmarking(2, false, 1);
  });

  it("Claim for 2, PDA enabled, with fee, user delegates to 1, pda delegates to 1", async () => {
    await pdaClaimingGasBenchmarking(2, true, 1);
  });

  it("Claim for 2, PDA enabled, with fee, user delegates to 2, pda delegates to 1", async () => {
    await pdaClaimingGasBenchmarking(2, true, 1, 2);
  });

  it("Claim for 2, PDA enabled, with fee, user delegates to 2, pda delegates to 2", async () => {
    await pdaClaimingGasBenchmarking(2, true, 1, 2, 2);
  });


  it("Claim for 4, PDA disabled, no fee, user delegates to 1", async () => {
    await pdaClaimingGasBenchmarking(4, false, 0);
  });

  it("Claim for 4, PDA disabled, with fee, user delegates to 1", async () => {
    await pdaClaimingGasBenchmarking(4, false, 1);
  });

  it("Claim for 4, PDA enabled, with fee, user delegates to 1, pda delegates to 1", async () => {
    await pdaClaimingGasBenchmarking(4, true, 1);
  });

  it("Claim for 4, PDA enabled, with fee, user delegates to 2, pda delegates to 1", async () => {
    await pdaClaimingGasBenchmarking(4, true, 1, 2);
  });

  it("Claim for 4, PDA enabled, with fee, user delegates to 2, pda delegates to 2", async () => {
    await pdaClaimingGasBenchmarking(4, true, 1, 2, 2);
  });


  it("Claim for 20, PDA disabled, no fee, user delegates to 1", async () => {
    await pdaClaimingGasBenchmarking(20, false, 0);
  });

  it("Claim for 20, PDA disabled, with fee, user delegates to 1", async () => {
    await pdaClaimingGasBenchmarking(20, false, 1);
  });

  it("Claim for 20, PDA enabled, with fee, user delegates to 1, pda delegates to 1", async () => {
    await pdaClaimingGasBenchmarking(20, true, 1);
  });

  it("Claim for 20, PDA enabled, with fee, user delegates to 2, pda delegates to 1", async () => {
    await pdaClaimingGasBenchmarking(20, true, 1, 2);
  });

  it("Claim for 20, PDA enabled, with fee, user delegates to 2, pda delegates to 2", async () => {
    await pdaClaimingGasBenchmarking(20, true, 1, 2, 2);
  });

});