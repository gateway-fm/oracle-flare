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
  FtsoRewardManagerInstance,
  PriceSubmitterContract,
  PriceSubmitterInstance,
  SuicidalMockContract,
  SuicidalMockInstance,
  SupplyContract,
  SupplyInstance, VoterWhitelisterContract, VoterWhitelisterInstance, WNatContract,
  WNatInstance
} from "../../../typechain-truffle";
import { moveToFinalizeStart, moveToRevealStart } from "../../utils/FTSO-test-utils";
import { PriceInfo } from '../../utils/PriceInfo';
import { moveToRewardFinalizeStart } from "../../utils/RewardManagerTestUtils";
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

async function submitALLRevealandFinalizeEpoch(submitters: string[], ftsos: FtsoInstance[], ftsoIndices: BN[], priceSeries: number[][], pricePerRewardEpoch: number): Promise<{firstPriceEpoch: number, firstRewardEpochId: number}> {
  let latestPriceEpoch:number = 0;
  for(let j = 0; j < pricePerRewardEpoch; j++){
    let submitterPrices: PriceInfo[][] = [];
    for (let i = 0; i < submitters.length; i++) {
      let priceInfo = await submitPricePriceSubmitter(ftsos, ftsoIndices, priceSubmiter, priceSeries[i], submitters[i]);
      submitterPrices.push(priceInfo!);
    }  
    latestPriceEpoch = parseInt(submitterPrices[0][0]!.epochId!);
  
    console.log(`Initializing price epoch for reveal ${latestPriceEpoch}`);
    await flareDaemon.trigger({ gas: 40_000_000 });
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

  return {firstPriceEpoch: latestPriceEpoch, firstRewardEpochId: rewardEpochId.toNumber()}
}

async function submitRevealAndFinalizeRewardEpoch(submitters: string[], ftsos: FtsoInstance[], ftsoIndices: BN[], priceSeries: number[][]): Promise<{firstPriceEpoch: number, firstRewardEpochId: number}> {
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

      return {firstPriceEpoch: testPriceEpoch, firstRewardEpochId: rewardEpochId.toNumber()}
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

async function skipTimeRewardEpochs(n: number){
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

async function topupRewardMannager(amount:BN, account: string) {
  if (amount.gt(BN(0))) {
    // It is, so let's pretend to be the validator and self-destruct what was asked for into the daemon.
    // Give suicidal some native token
    let suicidalMock = await SuicidalMock.new(flareDaemon.address);
    await web3.eth.sendTransaction({ from: account, to: suicidalMock.address, value: amount });
    await suicidalMock.die();
  } else {
    assert(false, "Flare Daemon balance was not increased properly");
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
    ftsoFdgb = await Ftso.at(contracts.getContractAddress(Contracts.FTSO_DGB));

    // Set the ftso epoch configuration parameters (from a random ftso) so we can time travel
    firstPriceEpochStartTs = (await ftsoWnat.getPriceEpochConfiguration())[0];
    priceEpochDurationSeconds = (await ftsoWnat.getPriceEpochConfiguration())[1];
    revealEpochDurationSeconds = (await ftsoWnat.getPriceEpochConfiguration())[2];

    // Set the ftso manager configuration parameters for time travel
    rewardEpochDurationSeconds = (await ftsoManager.getRewardEpochConfiguration())[1];
    rewardEpochsStartTs = (await ftsoManager.getRewardEpochConfiguration())[0];

    // Log for gas testing
    console.log("Make sure endToEndHardhat.json in deployments/chain-config is setup in a way you want your testing to be done");
    console.log("If you change some parameters in chain-config file please don't commit them");
    
    console.log(`Duration of reward epoch : ${rewardEpochDurationSeconds.toString(10)}`);

    // Set up the suicidal mock contract so we can conjure NAT into the daemon by self-destruction
    SuicidalMock = artifacts.require("SuicidalMock");
    suicidalMock = await SuicidalMock.new(flareDaemon.address);

    const FtsoRegistry = artifacts.require("FtsoRegistry");
    registry = await FtsoRegistry.at(contracts.getContractAddress(Contracts.FTSO_REGISTRY));

  });

  it("Should delegate, price submit, reveal, earn, and claim ftso rewards", async () => {
    const timeZero = await time.latest() as BN;

    // Parameters
    const numberOfPriceEpochs = 12
    const rewardEpochCountTesting = 1

    // Assemble
    // Define delegators
    let d1 = accounts[5];
    let d2 = accounts[6];
    let d3 = accounts[7];
    let d4 = accounts[8];
    let d5 = accounts[9];
    let d6 = accounts[10];


    // Define price providers
    let p1 = accounts[25];
    let p2 = accounts[26];
    let p3 = accounts[27];
    let p4 = accounts[28];
    let p5 = accounts[29];
    let p6 = accounts[30];
    let p7 = accounts[31];

    const allAccounts = [d1,d2,d3,d4,d5,d6,p1,p2,p3,p4]
    // const delegators = [d1,d2,d3,d4]
    const delegators = [d1,d2,d3,d4,d5,d6]

    // Mint some WNAT for each delegator and price provider
    const someNAT = web3.utils.toWei(BN(3000000000));
    const someNATSmall = web3.utils.toWei(BN(300000));
    const someMoreNATSmall = web3.utils.toWei(BN(3000000));
    await wNAT.deposit({ from: d1, value: someNATSmall });
    await wNAT.deposit({ from: d2, value: someNATSmall });
    await wNAT.deposit({ from: d3, value: someMoreNATSmall });
    await wNAT.deposit({ from: d4, value: someMoreNATSmall });
    await wNAT.deposit({ from: d5, value: someNATSmall });
    await wNAT.deposit({ from: d6, value: someNATSmall });

    await wNAT.deposit({ from: p1, value: someNAT });
    await wNAT.deposit({ from: p2, value: someNAT });
    await wNAT.deposit({ from: p3, value: someNAT });
    await wNAT.deposit({ from: p4, value: someNAT });

    // Delegator delegates vote power
    // await wNAT.delegate(p1, 2500, { from: d1 });
    await wNAT.delegate(p1, 5000, { from: d1 });
    await wNAT.delegate(p1, 5000, { from: d2 });
    await wNAT.delegate(p2, 5000, { from: d2 });
    await wNAT.delegate(p3, 5000, { from: d3 });
    await wNAT.delegate(p4, 10000, { from: d4 });

    // additional delegations
    await wNAT.delegate(p1, 5000, { from: d5 });
    await wNAT.delegate(p2, 5000, { from: d5 });
    await wNAT.delegate(p3, 5000, { from: d6 });
    await wNAT.delegate(p4, 5000, { from: d6 });

    // Prime the daemon to establish vote power block.
    await flareDaemon.trigger({ gas: 2_000_000 });

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
    await ftsoRewardManager.enableClaims({from: await ftsoRewardManager.governance()});
    

    assert((await wNAT.votePowerOfAt(p1, votePowerBlock)).gt(BN(0)), "Vote power of p1 must be > 0")
    assert((await wNAT.votePowerOfAt(p2, votePowerBlock)).gt(BN(0)), "Vote power of p2 must be > 0")
    assert((await wNAT.votePowerOfAt(p3, votePowerBlock)).gt(BN(0)), "Vote power of p3 must be > 0")
    assert((await wNAT.votePowerOfAt(p4, votePowerBlock)).gt(BN(0)), "Vote power of p4 must be > 0")
    
    let natPrices = [0.45, 0.45, 0.40, 0.50];  // 0 and 1
    let xrpPrices = [1.40, 1.50, 1.40, 1.60];  // 0 and 2
    let ltcPrices = [330, 320, 340, 330];      // 0 and 3
    let xdgPrices = [0.40, 0.45, 0.45, 0.50];  // 1 and 2
    let adaPrices = [1.70, 1.90, 1.80, 1.80];  // 1 and 3
    let dgbPrices = [0.05, 0.10, 0.15, 0.10];  // 2 and 3
    let ftsos = [ftsoWnat, ftsoFxrp, ftsoFltc, ftsoFxdg, ftsoFada, ftsoFdgb];
    let ftsoIndices = [];

    for(let ftso of ftsos){
      ftsoIndices.push(await registry.getFtsoIndex( await ftso.symbol()));
    }

    let pricesMatrix = [natPrices, xrpPrices, ltcPrices, xdgPrices, adaPrices, dgbPrices];
    // transpose
    let priceSeries = pricesMatrix[0].map((_, colIndex) => pricesMatrix.map(row => row[colIndex]));
    let submitters = [p1, p2, p3, p4];

    // whitelist submitters
    for (let i = 0; i < submitters.length; i++) {
      await voterWhitelister.requestFullVoterWhitelisting(submitters[i]);
    }

    //finalaze 1
    let result = await submitRevealAndFinalizeRewardEpoch(submitters, ftsos, ftsoIndices, priceSeries);

    ///////////
    //// FIRST
    ///////////

    // topup
    let daily_mint_req = await flareDaemon.totalMintingRequestedWei();
    await topupRewardMannager(daily_mint_req, accounts[0]);
    
    // There should be a balance to claim within reward manager at this point
    assert(BN(await web3.eth.getBalance(ftsoRewardManager.address)) > BN(0), "No reward manager balance. Did you forget to mint some?");
    

    let startRewardEpochID = (await ftsoManager.getCurrentRewardEpoch()).toNumber();
    for(let kk = 0; kk < rewardEpochCountTesting; kk++){
      await submitALLRevealandFinalizeEpoch(submitters, ftsos, ftsoIndices, priceSeries, numberOfPriceEpochs);
      // result = await submitRevealAndFinalizeRewardEpoch(submitters, ftsos, ftsoIndices, priceSeries);
    }
    let endRewardEpochID = (await ftsoManager.getCurrentRewardEpoch()).toNumber();
    
    let awarded_rewards = [BN(0),BN(0),BN(0),BN(0),BN(0)]
    let txCosts = []
    let txGasUsed = []
    let txCosts_pp = []
    let txGasUsed_pp = []
    // Get the opening balances
    let accountsOpeningBalances = [
      BN(await web3.eth.getBalance(p1)),
      BN(await web3.eth.getBalance(p2)),
      BN(await web3.eth.getBalance(p3)),
      BN(await web3.eth.getBalance(d1)),
      BN(await web3.eth.getBalance(d2))]

    console.log("Start epoch ");
    console.log(startRewardEpochID);
    console.log("End epoch ");
    console.log(endRewardEpochID);

    let ExhaustRewardEpochs = []
    for (let rwd_epochId = startRewardEpochID; rwd_epochId < endRewardEpochID; rwd_epochId++){
      ExhaustRewardEpochs.push(rwd_epochId)
    }
    console.log("Claiming for reward epochs");
    console.log(ExhaustRewardEpochs);

    // kip one to make sure we can claim
    await skipTimeRewardEpochs(1)

    // Price providers
    for(let acc_index = 0; acc_index < submitters.length; acc_index++){
      console.log(`Claiming reward for acc ${acc_index}`);
      let rwMnBalance = BN(await web3.eth.getBalance(ftsoRewardManager.address));
      console.log(`Balance on reward manager is ${rwMnBalance.toString(10)}`);  
      try {
        const tx = await ftsoRewardManager.claimReward(submitters[acc_index], ExhaustRewardEpochs, { from: submitters[acc_index] });
        console.log(tx.receipt.cumulativeGasUsed);
        txGasUsed_pp.push(tx.receipt.cumulativeGasUsed);
        txCosts_pp.push(await calcGasCost(tx));
      } catch (e: unknown) {
        // spewClaimError(`Account ${acc_index}`, e);
      }
      let endRwMnBalance = BN(await web3.eth.getBalance(ftsoRewardManager.address));
      awarded_rewards[acc_index] = rwMnBalance.sub(endRwMnBalance);
    }
    

    // Delegators
    for(let acc_index = 0; acc_index < delegators.length; acc_index++){
      console.log(`Claiming reward for acc ${acc_index}`);
      let rwMnBalance = BN(await web3.eth.getBalance(ftsoRewardManager.address));
      console.log(`Balance on reward manager is ${rwMnBalance.toString(10)}`);  
      try {
        const tx = await ftsoRewardManager.claimReward(delegators[acc_index], ExhaustRewardEpochs, { from: delegators[acc_index] });
        console.log(tx.receipt.cumulativeGasUsed);
        txGasUsed.push(tx.receipt.cumulativeGasUsed);
        txCosts.push(await calcGasCost(tx));
      } catch (e: unknown) {
        // spewClaimError(`Account ${acc_index}`, e);
      }
      let endRwMnBalance = BN(await web3.eth.getBalance(ftsoRewardManager.address));
      awarded_rewards[acc_index] = rwMnBalance.sub(endRwMnBalance);
    }

    let rwMnBalance = BN(await web3.eth.getBalance(ftsoRewardManager.address));
      console.log(`Balance on reward manager is ${rwMnBalance.toString(10)}`);  


    // Make sure that account 1, 2, 3 got new balances and 4 and 5 got reverted (two low balance)

    console.log("Tax cost per delegator");
    console.log(txCosts.map((a) => a.toString(10)));
    
    console.log("Tax amount per claim for delegator");
    console.log(txGasUsed);

    console.log("Tax cost per price provider");
    console.log(txCosts_pp.map((a) => a.toString(10)));
    
    console.log("Tax amount per claim for price provider");
    console.log(txGasUsed_pp);

  });
});
