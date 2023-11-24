/**
 * End-to-end system test running on hardhat. Assumes hardhat is running in node mode, that the deploy
 * has already been done, and that contract json file has been feed into stdin.
 */
import { expectEvent, expectRevert, time } from '@openzeppelin/test-helpers';
import { Contracts } from "../../../deployment/scripts/Contracts";
import {
  FlareDaemonContract, FlareDaemonInstance, FtsoContract, FtsoInstance, FtsoManagerContract,
  FtsoManagerInstance, FtsoRegistryInstance, FtsoRewardManagerContract, FtsoRewardManagerInstance,
  PriceSubmitterContract, PriceSubmitterInstance, SuicidalMockContract, SuicidalMockInstance, SupplyContract,
  SupplyInstance, VoterWhitelisterContract, VoterWhitelisterInstance, WNatContract, WNatInstance
} from "../../../typechain-truffle";
import { moveToFinalizeStart, moveToRevealStart } from "../../utils/FTSO-test-utils";
import { PriceInfo } from '../../utils/PriceInfo';
import { getRewardTotals, moveToRewardFinalizeStart } from "../../utils/RewardManagerTestUtils";
import { getRandom, submitHash } from '../../utils/test-helpers';

const getTestFile = require('../../utils/constants').getTestFile;
const BN = web3.utils.toBN;
const calcGasCost = require('../../utils/eth').calcGasCost;

let contracts: Contracts;
let FlareDaemon: FlareDaemonContract;
let flareDaemon: FlareDaemonInstance;
let FtsoRewardManager: FtsoRewardManagerContract;
let ftsoRewardManager: FtsoRewardManagerInstance;
let FtsoManager: FtsoManagerContract;
let ftsoManager: FtsoManagerInstance;
let PriceSubmitter: PriceSubmitterContract;
let priceSubmiter: PriceSubmitterInstance;
let WNat: WNatContract;
let wNAT: WNatInstance;
let Supply: SupplyContract;
let supply: SupplyInstance;
let Ftso: FtsoContract;
let ftsoFltc: FtsoInstance;
let ftsoFxdg: FtsoInstance;
let ftsoFxrp: FtsoInstance;
let ftsoWnat: FtsoInstance;
let ftsoFdgb: FtsoInstance;
let ftsoFada: FtsoInstance;
let ftsoFalgo: FtsoInstance;
let ftsoFbch: FtsoInstance;
let firstPriceEpochStartTs: BN;
let priceEpochDurationSeconds: BN;
let revealEpochDurationSeconds: BN;
let rewardEpochDurationSeconds: BN;
let rewardExpiryOffsetSeconds: number;
let rewardEpochsStartTs: BN;
let SuicidalMock: SuicidalMockContract;
let suicidalMock: SuicidalMockInstance;
let registry: FtsoRegistryInstance;
let VoterWhitelister: VoterWhitelisterContract;
let voterWhitelister: VoterWhitelisterInstance;
let ftsos: FtsoInstance[];
let p1: string;
let p2: string;
let p3: string;
let d1: string;
let d2: string;
let submitters: string[];
let ftsoIndices: BN[] = [];
let priceSeries: number[][];
let firstPriceEpoch: number = -1;
let firstRewardEpochId: number = -1;

export function preparePrice(price: number) {
  // Assume 5 decimals
  return Math.floor(price * 10 ** 5);
};

export async function submitPricePriceSubmitter(ftsos: FtsoInstance[], ftsoIndices: BN[], priceSubmitter: PriceSubmitterInstance, prices: number[], by: string): Promise<PriceInfo[] | undefined> {
  if (!ftsos || !prices || ftsos.length != prices.length) throw Error("Lists of ftsos and prices illegal or do not match")
  let epochId = ((await ftsos[0].getCurrentEpochId()) as BN).toString();
  let preparedPrices: number[] = [];
  let priceInfos: PriceInfo[] = [];
  for (let i = 0; i < ftsos.length; i++) {
    let price = prices[i]
    let preparedPrice = preparePrice(price);
    preparedPrices.push(preparedPrice);
  }

  // console.log(`Submitting prices ${preparedPrices} by ${by} for epoch ${epochId}`);
  // await priceSubmitter.submitPriceHash(hash!, {from: by});
  const random = getRandom();
  const hash = submitHash(ftsoIndices, preparedPrices, random, by);
  await priceSubmitter.submitHash(epochId, hash, { from: by })
  for (let i = 0; i < ftsos.length; i++) {
    const priceInfo = new PriceInfo(epochId, preparedPrices[i], random);
    priceInfo.moveToNextStatus();
    priceInfos.push(priceInfo);
  }
  return priceInfos
};

export async function revealPricePriceSubmitter(ftsos: FtsoInstance[], ftsoIndices: BN[], priceSubmitter: PriceSubmitterInstance, priceInfos: PriceInfo[], by: string): Promise<void> {
  if (!ftsos || !priceInfos || ftsos.length == 0 || ftsos.length != priceInfos.length) throw Error("Lists of ftsos and priceInfos illegal or they do not match")
  let epochId = priceInfos[0].epochId;

  if (priceInfos.some(priceInfo => !priceInfo.isSubmitted())) throw Error("Some price infos not submitted");
  priceInfos.forEach(priceInfo => {
    priceInfo.moveToNextStatus();
  })
  // console.log(`Revealing price by ${by} for epoch ${epochId}`);
  let tx = await priceSubmitter.revealPrices(
    epochId,
    ftsoIndices,
    priceInfos.map(priceInfo => priceInfo.priceSubmitted),
    priceInfos[0].random,
    { from: by }
  )
  expectEvent(tx, "PricesRevealed");
};

export async function submitRevealMultipleRewardAndFinalizeEpoch(submitters: string[], ftsos: FtsoInstance[], ftsoIndices: BN[], priceSeries: number[][], pricePerRewardEpoch: number): Promise<{ firstPriceEpoch: number, firstRewardEpochId: number }> {
  let latestPriceEpoch: number = 0;
  for (let j = 0; j < pricePerRewardEpoch; j++) {
    let submitterPrices: PriceInfo[][] = [];
    for (let i = 0; i < submitters.length; i++) {
      let priceInfo = await submitPricePriceSubmitter(ftsos, ftsoIndices, priceSubmiter, priceSeries[i], submitters[i]);
      submitterPrices.push(priceInfo!);
    }
    latestPriceEpoch = parseInt(submitterPrices[0][0]!.epochId!);

    console.log(`Initializing price epoch for reveal ${latestPriceEpoch}`);
    await flareDaemon.trigger({ gas: 40_000_000 });

    // Time travel to reveal period
    await moveToRevealStart(firstPriceEpochStartTs.toNumber(), priceEpochDurationSeconds.toNumber(), latestPriceEpoch);

    // Reveal prices
    for (let i = 0; i < submitterPrices.length; i++) {
      await revealPricePriceSubmitter(ftsos, ftsoIndices, priceSubmiter, submitterPrices[i]!, submitters[i]);
    }
    // Time travel to price epoch finalization -> using ~3.2M gas
    await moveToFinalizeStart(
      firstPriceEpochStartTs.toNumber(),
      priceEpochDurationSeconds.toNumber(),
      revealEpochDurationSeconds.toNumber(),
      latestPriceEpoch);
    console.log(`Finalizing price for epoch ${latestPriceEpoch}`);
    await flareDaemon.trigger({ gas: 40_000_000 });
  }

  // Time travel to reward epoch finalization
  const rewardEpochId = await ftsoManager.getCurrentRewardEpoch();
  try {
    await moveToRewardFinalizeStart(
      rewardEpochsStartTs.toNumber(),
      rewardEpochDurationSeconds.toNumber(),
      rewardEpochId.toNumber());
  } catch {
    console.log("No time skipping to finalize reward epoch");
  }
  console.log(`Finalizing reward epoch ${rewardEpochId.toNumber()}`);
  await flareDaemon.trigger({ gas: 40_000_000 });

  return { firstPriceEpoch: latestPriceEpoch, firstRewardEpochId: rewardEpochId.toNumber() }
}

export async function submitRevealAndFinalizeRewardEpoch(submitters: string[], ftsos: FtsoInstance[], ftsoIndices: BN[], priceSeries: number[][]): Promise<{ firstPriceEpoch: number, firstRewardEpochId: number }> {
  let submitterPrices: PriceInfo[][] = [];

  for (let i = 0; i < submitters.length; i++) {
    let priceInfo = await submitPricePriceSubmitter(ftsos, ftsoIndices, priceSubmiter, priceSeries[i], submitters[i]);
    submitterPrices.push(priceInfo!);
  }

  let testPriceEpoch = parseInt(submitterPrices[0][0]!.epochId!);

  console.log(`Initializing price epoch for reveal ${testPriceEpoch}`);
  await flareDaemon.trigger({ gas: 40_000_000 });

  // Time travel to reveal period
  await moveToRevealStart(firstPriceEpochStartTs.toNumber(), priceEpochDurationSeconds.toNumber(), testPriceEpoch);

  // Reveal prices
  for (let i = 0; i < submitterPrices.length; i++) {
    await revealPricePriceSubmitter(ftsos, ftsoIndices, priceSubmiter, submitterPrices[i]!, submitters[i]);
  }

  // Time travel to price epoch finalization -> using ~3.2M gas
  await moveToFinalizeStart(
    firstPriceEpochStartTs.toNumber(),
    priceEpochDurationSeconds.toNumber(),
    revealEpochDurationSeconds.toNumber(),
    testPriceEpoch);

  console.log(`Finalizing price for epoch ${testPriceEpoch}`);
  await flareDaemon.trigger({ gas: 40_000_000 });

  // Time travel to reward epoch finalization
  const rewardEpochId = await ftsoManager.getCurrentRewardEpoch();
  await moveToRewardFinalizeStart(
    rewardEpochsStartTs.toNumber(),
    rewardEpochDurationSeconds.toNumber(),
    rewardEpochId.toNumber());
  console.log(`Finalizing reward epoch ${rewardEpochId.toNumber()}`);
  await flareDaemon.trigger({ gas: 40_000_000 });

  return { firstPriceEpoch: testPriceEpoch, firstRewardEpochId: rewardEpochId.toNumber() }
}


export function spewClaimError(account: string, e: unknown) {
  if (e instanceof Error) {
    if (e.message.includes("no rewards")) {
      console.log(`${account} has no reward to claim.`);
    } else {
      console.log(`Reward claiming failed for ${account}. Error was:`);
      console.log(e);
    }
  } else {
    console.log(`Reward claiming failed for ${account}. Error was:`);
    console.log(e);
  }
}

export async function transferWithSuicide(amount: BN, from: string, to: string) {
  if (amount.gt(BN(0))) {
    suicidalMock = await SuicidalMock.new(to);
    await web3.eth.sendTransaction({ from: from, to: suicidalMock.address, value: amount });
    await suicidalMock.die();
  } else {
    assert(false, `${to} balance was not increased properly`);
  }
}

export async function FinalizeRewardEpochs(n: number) {
  for (let i = 0; i < n; i++) {
    const rewardEpochId = await ftsoManager.getCurrentRewardEpoch();
    await moveToRewardFinalizeStart(
      rewardEpochsStartTs.toNumber(),
      rewardEpochDurationSeconds.toNumber(),
      rewardEpochId.toNumber());
    console.log(`Finalizing reward epoch ${rewardEpochId.toNumber()}`);
    await flareDaemon.trigger({ gas: 40_000_000 });
  }
}

/**
 * Test to see if minting faucet will topup reward manager native token balance at next topup interval.
 */
contract(`RewardManager.sol; ${getTestFile(__filename)}; Delegation, price submission, and claiming system tests`, async accounts => {


  before(async () => {
    // Get contract addresses of deployed contracts
    contracts = new Contracts();
    await contracts.deserialize(process.stdin);

    // Wire up needed contracts
    FlareDaemon = artifacts.require("FlareDaemon");
    flareDaemon = await FlareDaemon.at(contracts.getContractAddress(Contracts.FLARE_DAEMON));
    FtsoRewardManager = artifacts.require("FtsoRewardManager");
    ftsoRewardManager = await FtsoRewardManager.at(contracts.getContractAddress(Contracts.FTSO_REWARD_MANAGER));
    FtsoManager = artifacts.require("FtsoManager");
    ftsoManager = await FtsoManager.at(contracts.getContractAddress(Contracts.FTSO_MANAGER));
    PriceSubmitter = artifacts.require("PriceSubmitter");
    priceSubmiter = await PriceSubmitter.at(contracts.getContractAddress(Contracts.PRICE_SUBMITTER));
    VoterWhitelister = artifacts.require("VoterWhitelister");
    voterWhitelister = await VoterWhitelister.at(contracts.getContractAddress(Contracts.VOTER_WHITELISTER));

    WNat = artifacts.require("WNat");
    wNAT = await WNat.at(contracts.getContractAddress(Contracts.WNAT));
    Supply = artifacts.require("Supply");
    supply = await Supply.at(contracts.getContractAddress(Contracts.SUPPLY));
    Ftso = artifacts.require("Ftso");
    ftsoWnat = await Ftso.at(contracts.getContractAddress(Contracts.FTSO_WNAT));
    ftsoFxrp = await Ftso.at(contracts.getContractAddress(Contracts.FTSO_XRP));
    ftsoFltc = await Ftso.at(contracts.getContractAddress(Contracts.FTSO_LTC));
    ftsoFxdg = await Ftso.at(contracts.getContractAddress(Contracts.FTSO_DOGE));
    ftsoFada = await Ftso.at(contracts.getContractAddress(Contracts.FTSO_ADA));
    ftsoFalgo = await Ftso.at(contracts.getContractAddress(Contracts.FTSO_ALGO));
    ftsoFbch = await Ftso.at(contracts.getContractAddress(Contracts.FTSO_BCH));
    ftsoFdgb = await Ftso.at(contracts.getContractAddress(Contracts.FTSO_DGB));

    // Set the ftso epoch configuration parameters (from a random ftso) so we can time travel
    firstPriceEpochStartTs = (await ftsoWnat.getPriceEpochConfiguration())[0];
    priceEpochDurationSeconds = (await ftsoWnat.getPriceEpochConfiguration())[1];
    revealEpochDurationSeconds = (await ftsoWnat.getPriceEpochConfiguration())[2];

    // Set the ftso manager configuration parameters for time travel
    rewardEpochsStartTs = (await ftsoManager.getRewardEpochConfiguration())[0];
    rewardEpochDurationSeconds = (await ftsoManager.getRewardEpochConfiguration())[1];

    // Set up the suicidal mock contract so we can conjure NAT into the daemon by self-destruction
    SuicidalMock = artifacts.require("SuicidalMock");
    suicidalMock = await SuicidalMock.new(flareDaemon.address);

    const FtsoRegistry = artifacts.require("FtsoRegistry");
    registry = await FtsoRegistry.at(contracts.getContractAddress(Contracts.FTSO_REGISTRY));

  });

  // it("Should delegate, price submit, reveal, earn, and claim ftso rewards", async () => {
  it("Should delegate ", async () => {
    // Assemble
    // Define delegators
    d1 = accounts[5];
    d2 = accounts[6];
    // Define price providers
    p1 = accounts[7];
    p2 = accounts[8];
    p3 = accounts[9];

    // Mint some WNAT for each delegator and price provider
    const someNAT = web3.utils.toWei(BN(3000000000));
    await wNAT.deposit({ from: d1, value: someNAT });
    await wNAT.deposit({ from: d2, value: someNAT });
    await wNAT.deposit({ from: p1, value: someNAT });
    await wNAT.deposit({ from: p2, value: someNAT });
    await wNAT.deposit({ from: p3, value: someNAT });

    // Delegator delegates vote power
    await wNAT.delegate(p1, 2500, { from: d1 });
    await wNAT.delegate(p2, 5000, { from: d1 });
    await wNAT.delegateExplicit(p1, 1_000_000_000, { from: d2 });
    await wNAT.delegateExplicit(p2, 1_000_000_000, { from: d2 });
    await wNAT.delegateExplicit(p3, 1_000_000_000, { from: d2 });

    // Prime the daemon to establish vote power block.
    await flareDaemon.trigger({ gas: 2_000_000 });
  });

  it("Should establish vote power and mint ", async () => {

    // Supply contract - inflatable balance should not be updated (nothing was claimed yet)
    const initialGenesisAmountWei = await supply.initialGenesisAmountWei();
    const totalFoundationSupplyWei = (await supply.totalExcludedSupplyWei()).sub(await supply.distributedExcludedSupplyWei());
    const totalLockedWei = await supply.totalLockedWei();
    const totalInflationAuthorizedWei = await supply.totalInflationAuthorizedWei();
    const inflatableBalanceWei = await supply.getInflatableBalance();
    assert(initialGenesisAmountWei.sub(totalFoundationSupplyWei).sub(totalLockedWei).eq(inflatableBalanceWei) && totalInflationAuthorizedWei.gtn(0), "Authorized inflation not distributed...");

    // A minting request should be pending...
    const mintingRequestWei = await flareDaemon.totalMintingRequestedWei();
    if (mintingRequestWei.gt(BN(0))) {
      // It is, so let's pretend to be the validator and self-destruct what was asked for into the daemon.
      // Give suicidal some native token
      await web3.eth.sendTransaction({ from: accounts[0], to: suicidalMock.address, value: mintingRequestWei });
      await suicidalMock.die();
    } else {
      assert(false, "No minting request made. Claiming is not going to work too well...");
    }

    // Verify that rewards epoch did not start yet
    await expectRevert.unspecified(ftsoManager.getRewardEpochData(0))

    // Jump to reward epoch start
    await time.increaseTo(rewardEpochsStartTs.sub(BN(1)));
    await time.advanceBlock();
    await time.increaseTo(rewardEpochsStartTs.add(BN(1))); // sometimes we get a glitch

    await flareDaemon.trigger({ gas: 2_000_000 }); // initialize reward epoch - also start of new price epoch
    let firstRewardEpoch = await ftsoManager.getRewardEpochData(0);
    let votePowerBlock = firstRewardEpoch.votepowerBlock;
    await ftsoRewardManager.enableClaims({ from: await ftsoRewardManager.governance() });

    assert((await wNAT.votePowerOfAt(p1, votePowerBlock)).gt(BN(0)), "Vote power of p1 must be > 0")
    assert((await wNAT.votePowerOfAt(p2, votePowerBlock)).gt(BN(0)), "Vote power of p2 must be > 0")
    assert((await wNAT.votePowerOfAt(p3, votePowerBlock)).gt(BN(0)), "Vote power of p3 must be > 0")

  });

  it("Should prepare FTSOs and whitelist", async () => {

    let natPrices = [0.35, 0.40, 0.50];
    let xrpPrices = [1.40, 1.50, 1.55];
    let ltcPrices = [320, 340, 350];
    let xdgPrices = [0.37, 0.45, 0.48];
    let adaPrices = [1.84, 1.90, 1.91];
    let algoPrices = [1.00, 1.33, 1.35];
    let bchPrices = [1100, 1203, 1210];
    let dgbPrices = [0.08, 0.11, 0.13];
    ftsos = [ftsoWnat, ftsoFxrp, ftsoFltc, ftsoFxdg, ftsoFada, ftsoFalgo, ftsoFbch, ftsoFdgb];

    // get the indices of all ftsos
    for (let ftso of ftsos) {
      ftsoIndices.push(await registry.getFtsoIndex(await ftso.symbol()));
    }

    let pricesMatrix = [natPrices, xrpPrices, ltcPrices, xdgPrices, adaPrices, algoPrices, bchPrices, dgbPrices];
    // transpose
    priceSeries = pricesMatrix[0].map((_, colIndex) => pricesMatrix.map(row => row[colIndex]));
    submitters = [p1, p2, p3];

    // whitelist submitters
    for (let i = 0; i < submitters.length; i++) {
      await voterWhitelister.requestFullVoterWhitelisting(submitters[i]);
    }

  });

  it("Should submit prices for first price epoch and claim for first reward epoch", async () => {
    rewardExpiryOffsetSeconds = (await ftsoManager.getRewardExpiryOffsetSeconds()).toNumber();

    // get the first reward
    while ((await web3.eth.getBlock(await web3.eth.getBlockNumber())).timestamp as number < rewardEpochsStartTs.toNumber() + rewardExpiryOffsetSeconds) {
      let result = await submitRevealAndFinalizeRewardEpoch(submitters, ftsos, ftsoIndices, priceSeries);
      if (firstPriceEpoch < 0 && firstRewardEpochId < 0) {
        firstPriceEpoch = result.firstPriceEpoch;
        firstRewardEpochId = result.firstRewardEpochId;
        break
      }
    }

    // There should be a balance to claim within reward manager at this point
    assert(BN(await web3.eth.getBalance(ftsoRewardManager.address)) > BN(0), "No reward manager balance. Did you forget to mint some?");

    // TODO: Check ftso prices if they are correct

    // Rewards should now be claimable 
    // Get the opening balances
    const p1OpeningBalance = BN(await web3.eth.getBalance(p1));
    const p2OpeningBalance = BN(await web3.eth.getBalance(p2));
    const p3OpeningBalance = BN(await web3.eth.getBalance(p3));
    const d1OpeningBalance = BN(await web3.eth.getBalance(d1));
    const d2OpeningBalance = BN(await web3.eth.getBalance(d2));


    // Act
    // Claim rewards
    const rewardEpochs = [];
    rewardEpochs[0] = firstRewardEpochId;
    // for(let ind = 0; ind < 24; ind++){
    //   rewardEpochs[ind] = ind;
    // }

    console.log(`Claiming rewards for reward epoch ${firstRewardEpochId}`);

    let gasCost = BN(0);
    try {
      const tx = await ftsoRewardManager.claimReward(p1, rewardEpochs, { from: p1 });
      gasCost = gasCost.add(await calcGasCost(tx));
    } catch (e: unknown) {
      spewClaimError("p1", e);
    }
    try {
      const tx = await ftsoRewardManager.claimReward(p2, rewardEpochs, { from: p2 });
      gasCost = gasCost.add(await calcGasCost(tx));
    } catch (e: unknown) {
      spewClaimError("p2", e);
    }
    try {
      const tx = await ftsoRewardManager.claimReward(p3, rewardEpochs, { from: p3 });
      gasCost = gasCost.add(await calcGasCost(tx));
    } catch (e: unknown) {
      spewClaimError("p3", e);
    }
    try {
      const tx = await ftsoRewardManager.claimReward(d1, rewardEpochs, { from: d1 });
      gasCost = gasCost.add(await calcGasCost(tx));
    } catch (e: unknown) {
      spewClaimError("d1", e);
    }
    try {
      const tx = await ftsoRewardManager.claimRewardFromDataProviders(d2, rewardEpochs, [p1, p2, p3], { from: d2 });
      gasCost = gasCost.add(await calcGasCost(tx));
    } catch (e: unknown) {
      spewClaimError("d2", e);
    }

    // Assert
    // Get the closing balances
    const p1ClosingBalance = BN(await web3.eth.getBalance(p1));
    const p2ClosingBalance = BN(await web3.eth.getBalance(p2));
    const p3ClosingBalance = BN(await web3.eth.getBalance(p3));
    const d1ClosingBalance = BN(await web3.eth.getBalance(d1));
    const d2ClosingBalance = BN(await web3.eth.getBalance(d2));

    // Compute the closing and opening balance differences, and account for gas used
    const computedRewardClaimed =
      p1ClosingBalance.sub(p1OpeningBalance)
        .add(p2ClosingBalance).sub(p2OpeningBalance)
        .add(p3ClosingBalance).sub(p3OpeningBalance)
        .add(d1ClosingBalance).sub(d1OpeningBalance)
        .add(d2ClosingBalance).sub(d2OpeningBalance)
        .add(gasCost);

    // Compute what we should have distributed for one price epoch
    const almostFullDaySec = BN(3600 * 24 - 1);
    // Get the daily inflation authorized on ftso reward manager
    const totals = await getRewardTotals(ftsoRewardManager);
    const dailyAuthorizedInflation = totals.dailyAuthorizedInflation;
    const authorizedInflationTimestamp = totals.lastInflationAuthorizationReceivedTs;

    // use the same formula as in ftso reward manager to calculate claimable value
    const dailyPeriodEndTs = authorizedInflationTimestamp.add(almostFullDaySec);
    const priceEpochEndTime = BN(firstPriceEpochStartTs.toNumber() + (firstPriceEpoch + 1) * priceEpochDurationSeconds.toNumber() - 1);
    const shouldaClaimed = dailyAuthorizedInflation.div(
      (dailyPeriodEndTs.sub(priceEpochEndTime)).div(priceEpochDurationSeconds).add(BN(1))
    );

    // After all that, one little test...
    assert(shouldaClaimed.eq(computedRewardClaimed), `should have claimed ${shouldaClaimed} but actually claimed ${computedRewardClaimed}`);

  });

  it("Should expire first reward epoch and ensure not claimable", async () => {

    // make another report
    await submitRevealAndFinalizeRewardEpoch(submitters, ftsos, ftsoIndices, priceSeries);
    await submitRevealAndFinalizeRewardEpoch(submitters, ftsos, ftsoIndices, priceSeries);

    // make sure to expire reward epoch
    while ((await web3.eth.getBlock(await web3.eth.getBlockNumber())).timestamp as number < rewardEpochsStartTs.toNumber() + rewardExpiryOffsetSeconds) {
      await FinalizeRewardEpochs(1);
    }

    // Time travel to next reward epoch finalization
    const rewardEpochId = await ftsoManager.getCurrentRewardEpoch();
    await moveToRewardFinalizeStart(
      rewardEpochsStartTs.toNumber(),
      rewardEpochDurationSeconds.toNumber(),
      rewardEpochId.toNumber());
    console.log(`Finalizing reward epoch ${rewardEpochId.toNumber()}`);
    await flareDaemon.trigger({ gas: 40_000_000 });

    const rewardEpochToExpireNext = (await ftsoRewardManager.getRewardEpochToExpireNext()).toNumber();
    console.log("Reward epoch to expire next: " + rewardEpochToExpireNext);
    assert(rewardEpochToExpireNext == 1, 'wrong reward epoch to expire next');
    assert((await wNAT.cleanupBlockNumber()).eq(await ftsoManager.getRewardEpochVotePowerBlock(rewardEpochToExpireNext)), 'wrong clean-up block set');

    // should return not claimable for expired and future reward epochs
    assert((await ftsoRewardManager.getStateOfRewards(p1, firstRewardEpochId, { from: p1 }))[3] == false);
    assert((await ftsoRewardManager.getStateOfRewards(p1, 500, { from: p1 }))[3] == false);

    // make sure that other rewards are still claimable
    assert((await ftsoRewardManager.claimReward.call(p2, [firstRewardEpochId + 1], { from: p2 })).gt(BN(0)));
    assert((await ftsoRewardManager.claimRewardFromDataProviders.call(d2, [firstRewardEpochId + 1], [p1, p2, p3], { from: d2 })).gt(BN(0)));

    await submitRevealAndFinalizeRewardEpoch(submitters, ftsos, ftsoIndices, priceSeries);
  });
});
