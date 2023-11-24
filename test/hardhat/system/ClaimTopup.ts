/**
 * End-to-end system test running on hardhat. Assumes hardhat is running in node mode, that the deploy
 * has already been done, and that contract json file has been feed into stdin.
 */
import { expectEvent, expectRevert, time } from '@openzeppelin/test-helpers';
import { Contracts } from "../../../deployment/scripts/Contracts";
import {
  FlareDaemonContract,
  FlareDaemonInstance,
  FtsoContract,
  FtsoInstance,
  FtsoManagerContract,
  FtsoManagerInstance, FtsoRegistryInstance, FtsoRewardManagerContract,
  FtsoRewardManagerInstance, InflationContract,
  InflationInstance, PriceSubmitterContract,
  PriceSubmitterInstance,
  SuicidalMockContract,
  SuicidalMockInstance,
  SupplyContract,
  SupplyInstance, VoterWhitelisterContract, VoterWhitelisterInstance, WNatContract,
  WNatInstance
} from "../../../typechain-truffle";
import { moveToFinalizeStart, moveToRevealStart } from "../../utils/FTSO-test-utils";
import { PriceInfo } from '../../utils/PriceInfo';
import { getRewardTotals, moveToRewardFinalizeStart } from "../../utils/RewardManagerTestUtils";
import { getRandom, submitHash, toBN } from '../../utils/test-helpers';

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
let rewardEpochsStartTs: BN;
let SuicidalMock: SuicidalMockContract;
let suicidalMock: SuicidalMockInstance;
let registry: FtsoRegistryInstance;
let VoterWhitelister: VoterWhitelisterContract;
let voterWhitelister: VoterWhitelisterInstance;
let Inflation: InflationContract;
let inflation: InflationInstance;

function preparePrice(price: number) {
  // Assume 5 decimals
  return Math.floor(price * 10 ** 5);
};

async function submitPricePriceSubmitter(ftsos: FtsoInstance[], ftsoIndices: BN[], priceSubmitter: PriceSubmitterInstance, prices: number[], by: string): Promise<PriceInfo[] | undefined> {
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
  const random = await getRandom();
  const hash = submitHash(ftsoIndices, preparedPrices, random, by);
  await priceSubmitter.submitHash(epochId, hash, { from: by })
  for (let i = 0; i < ftsos.length; i++) {
    const priceInfo = new PriceInfo(epochId, preparedPrices[i], random);
    priceInfo.moveToNextStatus();
    priceInfos.push(priceInfo);
  }
  return priceInfos
};

async function revealPricePriceSubmitter(ftsos: FtsoInstance[], ftsoIndices: BN[], priceSubmitter: PriceSubmitterInstance, priceInfos: PriceInfo[], by: string): Promise<void> {
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

async function submitRevealMultipleRewardAndFinalizeEpoch(submitters: string[], ftsos: FtsoInstance[], ftsoIndices: BN[], priceSeries: number[][], pricePerRewardEpoch: number): Promise<{ firstPriceEpoch: number, firstRewardEpochId: number }> {
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

async function submitRevealAndFinalizeRewardEpoch(submitters: string[], ftsos: FtsoInstance[], ftsoIndices: BN[], priceSeries: number[][]): Promise<{ firstPriceEpoch: number, firstRewardEpochId: number }> {
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


function spewClaimError(account: string, e: unknown) {
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

async function transferWithSuicide(amount: BN, from: string, to: string) {
  if (amount.gt(BN(0))) {
    suicidalMock = await SuicidalMock.new(to);
    await web3.eth.sendTransaction({ from: from, to: suicidalMock.address, value: amount });
    await suicidalMock.die();
  } else {
    assert(false, `${to} balance was not increased properly`);
  }
}

async function FinalizeRewardEpochs(n: number) {
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
contract(`RewardManager.sol; ${getTestFile(__filename)}; Delegation, price submission, and claiming top-up and over time testing`, async accounts => {
  // Define delegators
  let d1 = accounts[5];
  let d2 = accounts[6];
  let d3 = accounts[10];
  let d4 = accounts[11];
  // Define price providers
  let p1 = accounts[7];
  let p2 = accounts[8];
  let p3 = accounts[9];
  let timeZero: BN;
  let ftsos: FtsoInstance[];
  let ftsoIndices: BN[] = [];
  let priceSeries: number[][];
  let submitters: string[];
  let day1_totalMintingRequestedWei: BN;
  let day2_totalMintingRequestedWei: BN;
  let day3_totalMintingRequestedWei: BN;
  let day4_totalMintingRequestedWei: BN;
  let day5_totalMintingRequestedWei: BN;
  let day6_totalMintingRequestedWei: BN;
  let day7_totalMintingRequestedWei: BN;

  let day1_totalBurnedWei: BN;
  let day2_totalBurnedWei: BN;
  let day3_totalBurnedWei: BN;
  let day4_totalBurnedWei: BN;
  let day5_totalBurnedWei: BN;
  let day6_totalBurnedWei: BN;
  let day7_totalBurnedWei: BN;

  let day1RewardEpochs = 3;
  let day4RewardEpochs = 10;
  let day1_computedRewardClaimed: BN;
  let day4_computedRewardClaimed: BN;

  let day1_dailyAuthorizedInflation: BN;
  let day2_dailyAuthorizedInflation: BN;
  let day3_dailyAuthorizedInflation: BN;
  let day4_dailyAuthorizedInflation: BN;
  let day5_dailyAuthorizedInflation: BN;
  let day6_dailyAuthorizedInflation: BN;
  let day7_dailyAuthorizedInflation: BN;

  let day4_expectedRewardBalance: BN;

  const inflationBips = 500;
  let initialGenesisAmountWei: BN;
  let totalFoundationSupplyWei: BN;
  let totalLockedWei: BN;
  let totalClaimedWei: BN;

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

    Inflation = artifacts.require("Inflation");
    inflation = await Inflation.at(contracts.getContractAddress(Contracts.INFLATION));

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

    // must be 1h long reward epoch 
    assert.equal(rewardEpochDurationSeconds.toString(10), "3600");

    // Set up the suicidal mock contract so we can conjure NAT into the daemon by self-destruction
    SuicidalMock = artifacts.require("SuicidalMock");
    suicidalMock = await SuicidalMock.new(flareDaemon.address);

    const FtsoRegistry = artifacts.require("FtsoRegistry");
    registry = await FtsoRegistry.at(contracts.getContractAddress(Contracts.FTSO_REGISTRY));

    timeZero = await time.latest() as BN;
    // Assemble

    // Mint some WNAT for each delegator and price provider
    const someNAT = web3.utils.toWei(BN(3_000_000_000));
    const lotsOfNAT = web3.utils.toWei(BN(300000000000));
    await wNAT.deposit({ from: d1, value: someNAT });
    await wNAT.deposit({ from: d2, value: someNAT });
    await wNAT.deposit({ from: p1, value: someNAT });
    await wNAT.deposit({ from: p2, value: someNAT });
    await wNAT.deposit({ from: p3, value: someNAT });
    // So we have can delegate later in testing
    await wNAT.deposit({ from: d3, value: lotsOfNAT });
    await wNAT.deposit({ from: d4, value: lotsOfNAT });

    // Delegator delegates vote power
    await wNAT.delegate(p1, 4500, { from: d1 });
    await wNAT.delegate(p2, 5000, { from: d1 });
    await wNAT.delegate(p2, 3333, { from: d2 });
    await wNAT.delegate(p3, 6667, { from: d2 });
    // await wNAT.delegateExplicit(p1, 1_000_000_000, { from: d2 });
    // await wNAT.delegateExplicit(p2, 1_000_000_000, { from: d2 });
    // await wNAT.delegateExplicit(p3, 1_000_000_000, { from: d2 });
    // Prime the daemon to establish vote power block.
    await flareDaemon.trigger({ gas: 40_000_000 });

    // A minting request should be pending...
    day1_totalMintingRequestedWei = await flareDaemon.totalMintingRequestedWei();
    console.log("total minting requested wei: " + day1_totalMintingRequestedWei.toString());
    await transferWithSuicide(day1_totalMintingRequestedWei, accounts[0], flareDaemon.address);

    // Verify that rewards epoch did not start yet
    await expectRevert.unspecified(ftsoManager.getRewardEpochData(0))

    // Jump to reward epoch start
    await time.increaseTo(rewardEpochsStartTs.sub(BN(1)));
    await time.advanceBlock();
    await time.increaseTo(rewardEpochsStartTs.add(BN(1))); // sometimes we get a glitch

    await flareDaemon.trigger({ gas: 40_000_000 }); // initialize reward epoch - also start of new price epoch
    let firstRewardEpoch = await ftsoManager.getRewardEpochData(0);
    let votePowerBlock = firstRewardEpoch.votepowerBlock;
    await ftsoRewardManager.enableClaims({ from: await ftsoRewardManager.governance() });

    // Make sure price providers have vote power
    assert((await wNAT.votePowerOfAt(p1, votePowerBlock)).gt(BN(0)), "Vote power of p1 must be > 0")
    assert((await wNAT.votePowerOfAt(p2, votePowerBlock)).gt(BN(0)), "Vote power of p2 must be > 0")
    assert((await wNAT.votePowerOfAt(p3, votePowerBlock)).gt(BN(0)), "Vote power of p3 must be > 0")

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


  it("Should initialize inflation testing", async () => {

    // Supply contract - inflatable balance should not be updated ()
    initialGenesisAmountWei = await supply.initialGenesisAmountWei();
    totalFoundationSupplyWei = (await supply.totalExcludedSupplyWei()).sub(await supply.distributedExcludedSupplyWei());
    totalLockedWei = await supply.totalLockedWei();
    const totalInflationAuthorizedWei = await supply.totalInflationAuthorizedWei();
    const inflatableBalanceWei = await supply.getInflatableBalance();
    assert(inflatableBalanceWei.eq(initialGenesisAmountWei.sub(totalFoundationSupplyWei).sub(totalLockedWei)) && totalInflationAuthorizedWei.gtn(0), "Authorized inflation not distributed...");

    // Assert
    // Recognized inflation should be correct
    const firstInflationTimeSlot = await inflation.getTimeSlot(0);
    const firstTimeSlotInflationWei = initialGenesisAmountWei.sub(totalFoundationSupplyWei).sub(totalLockedWei).muln(inflationBips).divn(10000).divn(12); // 5 percent of circulating supply (monthly)
    assert.equal(firstInflationTimeSlot.recognizedInflationWei.toString(), firstTimeSlotInflationWei.toString());
  });

  it("Test claiming from reward manager on first day ", async function () {
    // TEST 1
    // Make sure we can claim the reward manager (from delegators and from price providers)

    let firstPriceEpoch: number = -1;
    let firstRewardEpochId: number = -1;

    // Do 3 reward epochs
    for (let i = 0; i < day1RewardEpochs; i++) {
      let result = await submitRevealAndFinalizeRewardEpoch(submitters, ftsos, ftsoIndices, priceSeries);
      if (firstPriceEpoch < 0 && firstRewardEpochId < 0) {
        firstPriceEpoch = result.firstPriceEpoch;
        firstRewardEpochId = result.firstRewardEpochId;
      }
    }

    // There should be a balance to claim within reward manager at this point
    assert(BN(await web3.eth.getBalance(ftsoRewardManager.address)) > BN(0), "No reward manager balance. Did you forget to mint some?");

    // Rewards should now be claimable 
    // Get the opening balances
    const Day1OpeningBalances = [
      BN(await web3.eth.getBalance(p1)),
      BN(await web3.eth.getBalance(p2)),
      BN(await web3.eth.getBalance(p3)),
      BN(await web3.eth.getBalance(d1)),
      BN(await web3.eth.getBalance(d2))
    ];

    // Claim rewards
    const rewardEpochs = [];
    rewardEpochs[0] = firstRewardEpochId;

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
      const tx = await ftsoRewardManager.claimReward(d2, rewardEpochs, { from: d2 });
      gasCost = gasCost.add(await calcGasCost(tx));
    } catch (e: unknown) {
      spewClaimError("d2", e);
    }

    // // Assert
    // Get the closing balances
    const Day1ClosingBalances = [
      BN(await web3.eth.getBalance(p1)),
      BN(await web3.eth.getBalance(p2)),
      BN(await web3.eth.getBalance(p3)),
      BN(await web3.eth.getBalance(d1)),
      BN(await web3.eth.getBalance(d2))
    ];

    // Compute the closing and opening balance differences and add gas used
    day1_computedRewardClaimed =
      Day1ClosingBalances[0].sub(Day1OpeningBalances[0])
        .add(Day1ClosingBalances[1]).sub(Day1OpeningBalances[1])
        .add(Day1ClosingBalances[2]).sub(Day1OpeningBalances[2])
        .add(Day1ClosingBalances[3]).sub(Day1OpeningBalances[3])
        .add(Day1ClosingBalances[4]).sub(Day1OpeningBalances[4])
        .add(gasCost);

    // Compute what we should have distributed for one price epoch
    const almostFullDaySec = BN(3600 * 24 - 1);
    // Get the daily inflation authorized on ftso reward manager
    const totals1 = await getRewardTotals(ftsoRewardManager);
    day1_dailyAuthorizedInflation = totals1.dailyAuthorizedInflation;
    day1_totalBurnedWei = totals1.totalBurnedWei;
    const authorizedInflationTimestamp = totals1.lastInflationAuthorizationReceivedTs;

    // use the same formula as in ftso reward manager to calculate claimable value
    const dailyPeriodEndTs = authorizedInflationTimestamp.add(almostFullDaySec);
    const priceEpochEndTime = BN(firstPriceEpochStartTs.toNumber() + (firstPriceEpoch + 1) * priceEpochDurationSeconds.toNumber() - 1);
    const shouldClaimed = day1_dailyAuthorizedInflation.div(
      (dailyPeriodEndTs.sub(priceEpochEndTime)).div(priceEpochDurationSeconds).add(BN(1))
    );

    // asserts 
    assert(shouldClaimed.eq(day1_computedRewardClaimed), `should have claimed ${shouldClaimed} but actually claimed ${day1_computedRewardClaimed}`);
    console.log('\x1b[32m%s\x1b[0m', 'Reward claiming works');
    totalClaimedWei = day1_computedRewardClaimed;
  });

  it("Test balance on reward manager on first day ", async function () {
    // TEST 2
    // Day 1 reward manager balance is correct

    // Reward manager balance must be total authorized inflation for day 1 - whatever was claimed
    // On day 1 we are capped with already authorized inflation (which is dailyAuthorizedInflation)
    let day1_expectedRewardBalance = day1_dailyAuthorizedInflation.sub(day1_computedRewardClaimed).sub(day1_totalBurnedWei);
    let day1_realRewardBalance = BN(await web3.eth.getBalance(ftsoRewardManager.address));

    // TEST 2 asserts
    assert(day1_expectedRewardBalance.eq(day1_realRewardBalance), `Reward manager balance is expected to be ${day1_expectedRewardBalance.toString(10)} but it is ${day1_realRewardBalance.toString(10)}`)
    console.log('\x1b[32m%s\x1b[0m', "Day 1 balance is correct");
  });

  it("Test top-up on day 2 happens and balance is as expected ", async () => {
    // TEST 3
    // Day 2 reward manager top up happens
    //////////////////////////////////////////
    // Move forward 1 day (by skipping 24 - 1 1h long reward epochs)
    await FinalizeRewardEpochs(24 - day1RewardEpochs);

    // A minting request should be pending...
    day2_totalMintingRequestedWei = await flareDaemon.totalMintingRequestedWei();
    day2_dailyAuthorizedInflation = (await getRewardTotals(ftsoRewardManager)).dailyAuthorizedInflation;
    console.log("total minting requested wei: " + day2_totalMintingRequestedWei.toString());
    await transferWithSuicide(day2_totalMintingRequestedWei.sub(day1_totalMintingRequestedWei), accounts[0], flareDaemon.address);
    await time.advanceBlock();
    await flareDaemon.trigger({ gas: 40_000_000 });
    day2_totalBurnedWei = (await getRewardTotals(ftsoRewardManager)).totalBurnedWei;

    // Reward manager balance must be total authorized inflation for day 2 + for day 1 - whatever was claimed
    let day2_expectedRewardBalance = day2_dailyAuthorizedInflation.add(day1_dailyAuthorizedInflation).sub(day1_computedRewardClaimed).sub(day2_totalBurnedWei.sub(day1_totalBurnedWei));
    let day2_realRewardBalance = BN(await web3.eth.getBalance(ftsoRewardManager.address));

    // TEST 3 asserts
    assert(day2_expectedRewardBalance.eq(day2_realRewardBalance), `Reward manager balance is expected to be ${day2_expectedRewardBalance.toString(10)} but it is ${day2_realRewardBalance.toString(10)}`)
    console.log('\x1b[32m%s\x1b[0m', "Day 2 balance is correct");
  });

  it("Test top-up on day 3 happens and balance is as expected  ", async () => {
    // TEST 4
    // Day 3 reward manager top up on day 3

    // Move forward 1 day 24 1h epochs (to day 3)
    await flareDaemon.trigger({ gas: 40_000_000 });
    await submitRevealAndFinalizeRewardEpoch(submitters, ftsos, ftsoIndices, priceSeries);
    await FinalizeRewardEpochs(23);

    // mint and send balance to flare daemon 
    day3_totalMintingRequestedWei = await flareDaemon.totalMintingRequestedWei();
    day3_dailyAuthorizedInflation = (await getRewardTotals(ftsoRewardManager)).dailyAuthorizedInflation;
    console.log("total minting requested wei: " + day3_totalMintingRequestedWei.toString());
    await transferWithSuicide(day3_totalMintingRequestedWei.sub(day2_totalMintingRequestedWei), accounts[0], flareDaemon.address);
    await time.advanceBlock();
    await flareDaemon.trigger({ gas: 40_000_000 });
    day3_totalBurnedWei = (await getRewardTotals(ftsoRewardManager)).totalBurnedWei;

    // Reward manager balance must be total authorized inflation for day 2 + for day 1 - whatever was claimed
    let day3_expectedRewardBalance = day3_dailyAuthorizedInflation.add(day2_dailyAuthorizedInflation).add(day1_dailyAuthorizedInflation).sub(day1_computedRewardClaimed).sub(day3_totalBurnedWei.sub(day2_totalBurnedWei));
    let day3_realRewardBalance = BN(await web3.eth.getBalance(ftsoRewardManager.address));

    // TEST 4 asserts
    // Make sure rewards on day 3 are correct
    assert(day3_expectedRewardBalance.eq(day3_realRewardBalance), `Reward manager balance is expected to be ${day3_expectedRewardBalance.toString(10)} but it is ${day3_realRewardBalance.toString(10)}`)
    console.log('\x1b[32m%s\x1b[0m', "Day 3 balance is correct");
  });

  it("Test top-up on day 4 happens and balance is as expected  ", async () => {
    // TEST 5
    // Day 4 reward manager top up test

    // Move forward 1 day (24 1h reward epochs) (to day 4)
    await submitRevealAndFinalizeRewardEpoch(submitters, ftsos, ftsoIndices, priceSeries);
    await FinalizeRewardEpochs(23);
    await flareDaemon.trigger({ gas: 40_000_000 });

    day4_totalMintingRequestedWei = await flareDaemon.totalMintingRequestedWei();
    day4_dailyAuthorizedInflation = (await getRewardTotals(ftsoRewardManager)).dailyAuthorizedInflation;
    console.log("total minting requested wei: " + day4_totalMintingRequestedWei.toString());
    await transferWithSuicide(day4_totalMintingRequestedWei.sub(day3_totalMintingRequestedWei), accounts[0], flareDaemon.address);
    await time.advanceBlock();
    await flareDaemon.trigger({ gas: 40_000_000 });
    day4_totalBurnedWei = (await getRewardTotals(ftsoRewardManager)).totalBurnedWei;

    // Reward manager balance must be total authorized inflation (last 3 days worth of inflation)
    day4_expectedRewardBalance = day4_dailyAuthorizedInflation.add(day3_dailyAuthorizedInflation).add(day2_dailyAuthorizedInflation).sub(day4_totalBurnedWei.sub(day3_totalBurnedWei));
    let day4_realRewardBalance = BN(await web3.eth.getBalance(ftsoRewardManager.address));

    // TEST 5 asserts
    assert(day4_expectedRewardBalance.eq(day4_realRewardBalance), `Reward manager balance is expected to be ${day4_expectedRewardBalance.toString(10)} but it is ${day4_realRewardBalance.toString(10)}`)
    console.log('\x1b[32m%s\x1b[0m', "Day 4 opening balance is correct");
  });

  it("Test price submitting, revealing and claiming on day 4  ", async () => {
    // TEST 6
    // Day 4 report some prices and do the claiming

    let day4rewardEpochsArray = []
    for (let i = 0; i < day4RewardEpochs; i++) {
      day4rewardEpochsArray.push((await ftsoManager.getCurrentRewardEpoch()).toNumber());
      await submitRevealAndFinalizeRewardEpoch(submitters, ftsos, ftsoIndices, priceSeries);
    }
    await flareDaemon.trigger({ gas: 40_000_000 });

    // Get the day 4 opening balances
    const Day4OpeningBalances = [
      BN(await web3.eth.getBalance(p1)),
      BN(await web3.eth.getBalance(p2)),
      BN(await web3.eth.getBalance(p3)),
      BN(await web3.eth.getBalance(d1)),
      BN(await web3.eth.getBalance(d2))
    ];

    // Act
    // Claim rewards
    console.log(`Claiming rewards for reward epoch ${day4rewardEpochsArray}`);

    let day4gasCost = BN(0);
    try {
      const tx = await ftsoRewardManager.claimReward(p1, day4rewardEpochsArray, { from: p1 });
      day4gasCost = day4gasCost.add(await calcGasCost(tx));
    } catch (e: unknown) {
      spewClaimError("p1", e);
    }
    try {
      const tx = await ftsoRewardManager.claimReward(p2, day4rewardEpochsArray, { from: p2 });
      day4gasCost = day4gasCost.add(await calcGasCost(tx));
    } catch (e: unknown) {
      spewClaimError("p2", e);
    }
    try {
      const tx = await ftsoRewardManager.claimReward(p3, day4rewardEpochsArray, { from: p3 });
      day4gasCost = day4gasCost.add(await calcGasCost(tx));
    } catch (e: unknown) {
      spewClaimError("p3", e);
    }
    try {
      const tx = await ftsoRewardManager.claimReward(d1, day4rewardEpochsArray, { from: d1 });
      day4gasCost = day4gasCost.add(await calcGasCost(tx));
    } catch (e: unknown) {
      spewClaimError("d1", e);
    }
    try {
      const tx = await ftsoRewardManager.claimReward(d2, day4rewardEpochsArray, { from: d2 });
      day4gasCost = day4gasCost.add(await calcGasCost(tx));
    } catch (e: unknown) {
      spewClaimError("d2", e);
    }

    // Assert
    // Get the closing balances
    const Day4ClosingBalances = [
      BN(await web3.eth.getBalance(p1)),
      BN(await web3.eth.getBalance(p2)),
      BN(await web3.eth.getBalance(p3)),
      BN(await web3.eth.getBalance(d1)),
      BN(await web3.eth.getBalance(d2))
    ];

    // Calculate what what claimed
    day4_computedRewardClaimed = day4gasCost;
    for (let openBalance of Day4ClosingBalances) {
      day4_computedRewardClaimed = day4_computedRewardClaimed.add(openBalance)
    }
    for (let openBalance of Day4OpeningBalances) {
      day4_computedRewardClaimed = day4_computedRewardClaimed.sub(openBalance)
    }

    // Calculate expected reward manager balance
    const expectedNewRMBalance = day4_expectedRewardBalance.sub(day4_computedRewardClaimed);
    const actualNewRMBalance = BN(await web3.eth.getBalance(ftsoRewardManager.address));

    // TEST 6 asserts
    // Make sure reward manager balance was reduced exactly as much as it should be
    assert(expectedNewRMBalance.eq(actualNewRMBalance), `Reward manager balance is expected to be ${expectedNewRMBalance.toString(10)} but it is ${actualNewRMBalance.toString(10)}`)
    console.log('\x1b[32m%s\x1b[0m', "Day 4 Reward manager balance is correct after claiming");
    totalClaimedWei = totalClaimedWei.add(day4_computedRewardClaimed);
  });

  it("Exhaust reward manager with price submitting, revealing and claiming on day 5 onward  ", async () => {
    //console.log("BEFORE ERROR", await flareDaemon.showDaemonizedErrors(0, 100000000));
    // TEST 7
    // Exhaust reward manager so some accounts can't claim
    //////////////////////////////////////////

    // Move forward 1 day (to day 5)
    await flareDaemon.trigger({ gas: 40_000_000 });
    await submitRevealAndFinalizeRewardEpoch(submitters, ftsos, ftsoIndices, priceSeries);
    await FinalizeRewardEpochs(24 - day4RewardEpochs - 2); // one finalize is in submitRevealAndFinalizeRewardEpoch call

    // Prime the daemon to establish vote power block.
    await flareDaemon.trigger({ gas: 40_000_000 });

    // Remember Reward manager opening balance
    const Day5OpeningBalance = BN(await web3.eth.getBalance(ftsoRewardManager.address));
    day5_totalMintingRequestedWei = await flareDaemon.totalMintingRequestedWei();
    day5_dailyAuthorizedInflation = (await getRewardTotals(ftsoRewardManager)).dailyAuthorizedInflation;
    console.log("total minting requested wei: " + day5_totalMintingRequestedWei.toString());
    await transferWithSuicide(day5_totalMintingRequestedWei.sub(day4_totalMintingRequestedWei), accounts[0], flareDaemon.address);
    await time.advanceBlock();
    await flareDaemon.trigger({ gas: 40_000_000 });
    day5_totalBurnedWei = (await getRewardTotals(ftsoRewardManager)).totalBurnedWei;

    // Reward manager balance must be total authorized inflation past 3 days
    let day5_expectedRewardBalance = day5_dailyAuthorizedInflation.add(day4_dailyAuthorizedInflation).add(day3_dailyAuthorizedInflation).sub(day5_totalBurnedWei.sub(day4_totalBurnedWei));
    let day5_realRewardBalance = BN(await web3.eth.getBalance(ftsoRewardManager.address));

    // Make sure its the inflation of last 3 days
    assert(day5_expectedRewardBalance.eq(day5_realRewardBalance), `Reward manager balance is expected to be ${day5_expectedRewardBalance.toString(10)} but it is ${day5_realRewardBalance.toString(10)}`)
    console.log('\x1b[32m%s\x1b[0m', "Day 5 balance is correct");

    // Make sure that we toped up exactly how much was claimed and burned (+ possible inflation differences when moving days)    
    const expectedTopUp = day5_dailyAuthorizedInflation.muln(3).sub(Day5OpeningBalance);
    const claimedAndBurned = day4_computedRewardClaimed.add(day4_totalBurnedWei.sub(day3_totalBurnedWei));
    assert(claimedAndBurned.eq(expectedTopUp), `Claimed and top-up rewards should match, expected ${claimedAndBurned.toString(10)}, actual: ${expectedTopUp.toString(10)}`)
    console.log('\x1b[32m%s\x1b[0m', "Day 5 claims and balances match");

    // We now start claiming and reporting left and right (we wanna exhaust the reward manager)
    for (let i = 1; i <= 4; i++) {
      const RewardEpochsToExhaust = i == 4 ? 23 : 24;  // number of reward epoch we wanna do full reporting
      let ExhaustRewardEpochs = []
      for (let hours = 0; hours < RewardEpochsToExhaust; hours++) {
        ExhaustRewardEpochs.push((await ftsoManager.getCurrentRewardEpoch()).toNumber());
        await submitRevealMultipleRewardAndFinalizeEpoch(submitters, ftsos, ftsoIndices, priceSeries, 2);
      }

      // Prepare some variables to save claiming results to 
      const allAccounts = [p1, p2, p3, d2, d1]
      let awarded_rewards = [BN(0), BN(0), BN(0), BN(0), BN(0)];
      let txCosts = [BN(0), BN(0), BN(0), BN(0), BN(0)];
      let txGasUsed = [BN(0), BN(0), BN(0), BN(0), BN(0)];

      // Get the opening balances
      const accountsOpeningBalances = [
        BN(await web3.eth.getBalance(p1)),
        BN(await web3.eth.getBalance(p2)),
        BN(await web3.eth.getBalance(p3)),
        BN(await web3.eth.getBalance(d2)),
        BN(await web3.eth.getBalance(d1))]

      // Claim for all price providers
      console.log(`Claiming rewards for reward epoch ${ExhaustRewardEpochs}`);

      for (let acc_index = 0; acc_index < allAccounts.length; acc_index++) {
        console.log(`Claiming reward for acc ${acc_index}`);
        let rwMnBalance = BN(await web3.eth.getBalance(ftsoRewardManager.address));
        console.log(`rewardManager Balance: ${rwMnBalance.toString(10)}`);
        let TempReward = BN(0);
        try {
          for (let tempEpoch of ExhaustRewardEpochs) {
            let partReward = (await ftsoRewardManager.getStateOfRewards(allAccounts[acc_index], tempEpoch));
            for (let rew of partReward[1]) {
              TempReward = TempReward.add(rew);
            }
          }
          console.log(`Account can claim:     ${TempReward.toString(10)}`);
        } catch (e: unknown) {
          console.log("Manager Exhausted");
          console.log(e);
        }

        try {
          if (true && acc_index < 5) {
            const tx = await ftsoRewardManager.claimReward(allAccounts[acc_index], ExhaustRewardEpochs, { from: allAccounts[acc_index] });
            txGasUsed[acc_index] = tx.receipt.cumulativeGasUsedok;
            txCosts[acc_index] = await calcGasCost(tx);
            console.log("CLAIMED")
          } else {
            console.log("Skip claim")
          }
        } catch (e: unknown) { console.log("Claim failed for acc " + acc_index) }
        let endRwMnBalance = BN(await web3.eth.getBalance(ftsoRewardManager.address));
        awarded_rewards[acc_index] = rwMnBalance.sub(endRwMnBalance);
        console.log(`Account got claim:     ${awarded_rewards[acc_index].toString(10)}`);
      }
      let rwMnBalance = BN(await web3.eth.getBalance(ftsoRewardManager.address));
      console.log(`rewardManager Balance: ${rwMnBalance.toString(10)}`);

      const accountsClosingBalances = [
        BN(await web3.eth.getBalance(p1)),
        BN(await web3.eth.getBalance(p2)),
        BN(await web3.eth.getBalance(p3)),
        BN(await web3.eth.getBalance(d2)),
        BN(await web3.eth.getBalance(d1))]

      // TEST 7 asserts
      // Make sure that all accounts claimed some rewards
      assert.equal((accountsClosingBalances[0].sub(accountsOpeningBalances[0]).add(txCosts[0])).toString(10), awarded_rewards[0].toString(10));
      assert.equal((accountsClosingBalances[1].sub(accountsOpeningBalances[1]).add(txCosts[1])).toString(10), awarded_rewards[1].toString(10));
      assert.equal((accountsClosingBalances[2].sub(accountsOpeningBalances[2]).add(txCosts[2])).toString(10), awarded_rewards[2].toString(10));
      assert.equal((accountsClosingBalances[3].sub(accountsOpeningBalances[3]).add(txCosts[3])).toString(10), awarded_rewards[3].toString(10));
      assert.equal((accountsClosingBalances[4].sub(accountsOpeningBalances[4]).add(txCosts[4])).toString(10), awarded_rewards[4].toString(10));

      for (let i = 0; i < 5; i++) {
        totalClaimedWei = totalClaimedWei.add(awarded_rewards[i]);
      }
    }

    console.log('\x1b[32m%s\x1b[0m', "Exhausting reward manager balances match");
  });

  it("Topup after exhausting reward manager", async () => {
    // TEST 8
    // Topup reward manager after exhausting it
    //////////////////////////////////////////

    // Check day 6 inflation
    await time.advanceBlock();
    await submitRevealAndFinalizeRewardEpoch(submitters, ftsos, ftsoIndices, priceSeries);
    await FinalizeRewardEpochs(1);
    await flareDaemon.trigger({ gas: 40_000_000 });

    day7_dailyAuthorizedInflation = (await getRewardTotals(ftsoRewardManager)).dailyAuthorizedInflation;

    // A minting request should be pending...
    day7_totalMintingRequestedWei = await flareDaemon.totalMintingRequestedWei();

    // topup should happen here
    await transferWithSuicide(day7_totalMintingRequestedWei.sub(day5_totalMintingRequestedWei), accounts[0], flareDaemon.address);
    await flareDaemon.trigger({ gas: 40_000_000 });
    day7_totalBurnedWei = (await getRewardTotals(ftsoRewardManager)).totalBurnedWei;
    await time.advanceBlock();

    // Reward manager balance must be min of (3 x last authorized inflation value) and (total authorized - total claimed)
    let { 0: foundationAllocatedFundsWei, 1: totalInflationAuthorizedWei, 2: totalClaimedWei } = await ftsoRewardManager.getTokenPoolSupplyData();
    let day7_maxExpectedBalance = totalInflationAuthorizedWei.sub(totalClaimedWei);
    let day7_threeTimesAuthorizedBalance = day7_dailyAuthorizedInflation.muln(3).sub(day7_totalBurnedWei.sub(day5_totalBurnedWei));

    let day7_expectedRewardBalance = day7_maxExpectedBalance.lt(day7_threeTimesAuthorizedBalance) ? day7_maxExpectedBalance : day7_threeTimesAuthorizedBalance;
    let day7_realRewardBalance = BN(await web3.eth.getBalance(ftsoRewardManager.address));

    // TEST 8 asserts
    assert(day7_expectedRewardBalance.eq(day7_realRewardBalance), `Reward manager balance is expected to be ${day7_expectedRewardBalance.toString(10)} but it is ${day7_realRewardBalance.toString(10)}`)
    console.log('\x1b[32m%s\x1b[0m', "Day 6 topup balance is correct");
  });

  it("Wait a month", async () => {
    // After some requests, wait until a month passes
    await time.advanceBlock();

    // Inflation is 30 days long
    const firstInflationTimeSlot = await inflation.getTimeSlot(0);
    console.log(firstInflationTimeSlot.startTimeStamp);
    const firstTimeSlotStart = toBN(firstInflationTimeSlot.startTimeStamp);
    assert(firstTimeSlotStart.add(BN(30 * 24 * 60 * 60 - 1)).eq(toBN(firstInflationTimeSlot.endTimeStamp)));

    const target = toBN(firstInflationTimeSlot.endTimeStamp)

    // Wait for a month
    const difference = BN(24 * 60 * 60)

    while ((await time.latest()).lt(target)) {
      await transferWithSuicide(BN(1_000_000_000_000), accounts[1], flareDaemon.address);
      await time.advanceBlock();
      await time.increase(difference);
      await flareDaemon.trigger({ gas: 40_000_000 });
      await time.advanceBlock();
      console.log((await time.latest()).toString(), (await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber())).toString());
    }

    const secondTimeSlot = await inflation.getCurrentTimeSlot();
    // Should create a new timeSlot
    // Second time slot should start later then the first
    assert.isTrue(firstTimeSlotStart.lt(BN(secondTimeSlot.startTimeStamp.toString())));
    
    // Recognized inflation should be updated
    const totalBurnedWei = (await getRewardTotals(ftsoRewardManager)).totalBurnedWei; // burned amount is part of inflatable balance
    const secondTimeSlotInflationWei = initialGenesisAmountWei.sub(totalFoundationSupplyWei).sub(totalLockedWei).add(totalClaimedWei).add(totalBurnedWei).muln(inflationBips).divn(10000).divn(12); // 5 percent of circulating supply (monthly)
    assert.isTrue(totalClaimedWei.eq((await getRewardTotals(ftsoRewardManager)).totalClaimedWei));
    assert.equal(secondTimeSlot.recognizedInflationWei.toString(), secondTimeSlotInflationWei.toString());
      

    // Check that the next daily authorized amount set on reward manager, after the month-end roll, contains the correct amount.
    assert.equal(
      ((await getRewardTotals(ftsoRewardManager)).dailyAuthorizedInflation).toString(),
      secondTimeSlotInflationWei.divn(30).toString() // 100 percent is shared to reward manager
    )

  });

});
