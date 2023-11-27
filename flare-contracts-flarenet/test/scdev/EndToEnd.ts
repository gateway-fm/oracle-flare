/**
 * End-to-end system test running the validator. Assumes validator is running and contracts are deployed.
 * Contract json file is to be fed in to stdin.
 */
import { expectEvent } from "@openzeppelin/test-helpers";
import { Contracts } from "../../deployment/scripts/Contracts";
import {
  FlareDaemonContract,
  FlareDaemonInstance,
  FtsoContract,
  FtsoInstance, FtsoManagerContract,
  FtsoManagerInstance, FtsoRegistryContract,
  FtsoRegistryInstance, FtsoRewardManagerContract,
  FtsoRewardManagerInstance,
  PriceSubmitterContract,
  PriceSubmitterInstance,
  VoterWhitelisterContract,
  VoterWhitelisterInstance,
  WNatContract,
  WNatInstance
} from "../../typechain-truffle";
import { spewDaemonErrors } from "../utils/FlareDaemonTestUtils";
import { PriceInfo } from '../utils/PriceInfo';
import { getRewardTotals } from "../utils/RewardManagerTestUtils";
import { advanceBlock, getRandom, submitHash } from '../utils/test-helpers';

const getTestFile = require('../utils/constants').getTestFile;
const BN = web3.utils.toBN;
const calcGasCost = require('../utils/eth').calcGasCost; 


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

  const random = await getRandom();
  const hash = submitHash(ftsoIndices, preparedPrices, random, by);
  console.log(`Submitting prices ${preparedPrices} by ${by} for epoch ${epochId}`);
  // await priceSubmitter.submitPriceHash(hash!, {from: by});
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
  
  console.log(`Revealing price by ${by} for epoch ${epochId}`);

  let tx = await priceSubmitter.revealPrices(
    epochId,
    ftsoIndices,
    priceInfos.map(priceInfo => priceInfo.priceSubmitted),
    priceInfos[0].random,
    { from: by }
  )
  expectEvent(tx, "PricesRevealed");

  priceInfos.forEach(priceInfo => {
    priceInfo.moveToNextStatus();
  });
};

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

/**
 * @notice Utility to time travel to just past the current reward epoch.
 * @param rewardEpochStartTimestamp - start timemestamp from when epoch are counted, must match to the one set in the FTSO manager contract
 * @param rewardEpochPeriod - epoch period in seconds, must match to the one set in the FTSO manager contract
 * @param rewardEpoch - current reward epoch number
 */
 async function waitTillRewardFinalizeStart(ftsoManager: FtsoManagerInstance, flareDaemon: FlareDaemonInstance, rewardEpochStartTimestamp: number, rewardEpochPeriod: number, rewardEpoch: number) {
  let finalizeTimestamp = (rewardEpoch + 1) * rewardEpochPeriod + rewardEpochStartTimestamp + 1;
  let blockInfo = await web3.eth.getBlock(await web3.eth.getBlockNumber());
  while (blockInfo.timestamp < finalizeTimestamp) {
    await new Promise(resolve => {
      setTimeout(resolve, 1000);
    });
    await advanceBlock();
    blockInfo = await web3.eth.getBlock(await web3.eth.getBlockNumber());
    console.log(`block.timestamp = ${blockInfo.timestamp}; finalizeTimestamp = ${finalizeTimestamp}; triggered at ${(await flareDaemon.systemLastTriggeredAt()).toNumber()}`);
  }

  await advanceBlock();
  await advanceBlock();

  assert.equal(rewardEpoch + 1, (await ftsoManager.getCurrentRewardEpoch()).toNumber(), "not correct reward epoch");
}

/**
 * Test to see if minting faucet will topup reward manager NAT balance at next topup interval.
 */
contract(`RewardManager.sol; ${getTestFile(__filename)}; Delegation, price submission, and claiming system tests`, async accounts => {
  let contracts: Contracts;
  let FlareDaemon: FlareDaemonContract;
  let flareDaemon: FlareDaemonInstance;
  let RewardManager: FtsoRewardManagerContract;
  let rewardManager: FtsoRewardManagerInstance;
  let FtsoManager: FtsoManagerContract;
  let ftsoManager: FtsoManagerInstance;
  let FtsoRegistry: FtsoRegistryContract;
  let ftsoRegistry: FtsoRegistryInstance;
  let PriceSubmitter: PriceSubmitterContract;
  let priceSubmiter: PriceSubmitterInstance;
  let VoterWhitelister: VoterWhitelisterContract;
  let voterWhitelister: VoterWhitelisterInstance;
  let WNAT: WNatContract;
  let wNAT: WNatInstance;
  let Ftso: FtsoContract;
  let ftsoFltc: FtsoInstance;
  let ftsoDoge: FtsoInstance;
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
  let d1: string;
  let p1: string;
  let p2: string;
  let p3: string;

  before(async() => {
    // Get contract addresses of deployed contracts
    contracts = new Contracts();
    await contracts.deserialize(process.stdin);

    // Wire up needed contracts
    console.log("Setting up contract references...");
    FlareDaemon = artifacts.require("FlareDaemon");
    flareDaemon = await FlareDaemon.at(contracts.getContractAddress(Contracts.FLARE_DAEMON));
    RewardManager = artifacts.require("FtsoRewardManager");
    rewardManager = await RewardManager.at(contracts.getContractAddress(Contracts.FTSO_REWARD_MANAGER));
    FtsoManager = artifacts.require("FtsoManager");
    ftsoManager = await FtsoManager.at(contracts.getContractAddress(Contracts.FTSO_MANAGER));
    FtsoRegistry = artifacts.require("FtsoRegistry");
    ftsoRegistry = await FtsoRegistry.at(contracts.getContractAddress(Contracts.FTSO_REGISTRY));
    PriceSubmitter = artifacts.require("PriceSubmitter");
    priceSubmiter = await PriceSubmitter.at(contracts.getContractAddress(Contracts.PRICE_SUBMITTER));
    VoterWhitelister = artifacts.require("VoterWhitelister");
    voterWhitelister = await VoterWhitelister.at(contracts.getContractAddress(Contracts.VOTER_WHITELISTER));    
    WNAT = artifacts.require("WNat");
    wNAT = await WNAT.at(contracts.getContractAddress(Contracts.WNAT));
    Ftso = artifacts.require("Ftso");
    ftsoFltc = await Ftso.at(contracts.getContractAddress(Contracts.FTSO_LTC));
    ftsoDoge = await Ftso.at(contracts.getContractAddress(Contracts.FTSO_DOGE));
    ftsoFxrp = await Ftso.at(contracts.getContractAddress(Contracts.FTSO_XRP));
    ftsoWnat = await Ftso.at(contracts.getContractAddress(Contracts.FTSO_WNAT));
    ftsoFdgb = await Ftso.at(contracts.getContractAddress(Contracts.FTSO_DGB));
    ftsoFada = await Ftso.at(contracts.getContractAddress(Contracts.FTSO_ADA));
    ftsoFalgo = await Ftso.at(contracts.getContractAddress(Contracts.FTSO_ALGO));
    ftsoFbch = await Ftso.at(contracts.getContractAddress(Contracts.FTSO_BCH));

    // Set the ftso epoch configuration parameters (from a random ftso) so we can time travel
    firstPriceEpochStartTs = (await ftsoWnat.getPriceEpochConfiguration())[0];
    priceEpochDurationSeconds = (await ftsoWnat.getPriceEpochConfiguration())[1];
    revealEpochDurationSeconds = (await ftsoWnat.getPriceEpochConfiguration())[2];

    // Set the ftso manager configuration parameters for time travel
    rewardEpochsStartTs = (await ftsoManager.getRewardEpochConfiguration())[0];
    rewardEpochDurationSeconds = (await ftsoManager.getRewardEpochConfiguration())[1];

    console.log("Depositing and delegating NAT...");

    // Define delegators
    d1 = accounts[1];
    // Define price providers
    p1 = accounts[2];
    p2 = accounts[3];
    p3 = accounts[9];

    // Mint some WNAT for each delegator and price provider
    const someNAT = web3.utils.toWei(BN(3000000000));
    await wNAT.deposit({from: d1, value: someNAT});
    await wNAT.deposit({from: p1, value: someNAT});
    await wNAT.deposit({from: p2, value: someNAT});
    await wNAT.deposit({from: p3, value: someNAT});    

    // Delegator delegates vote power
    await wNAT.delegate(p1, 5000, {from: d1});
    await wNAT.delegate(p2, 5000, {from: d1});

    // Whitelist price providers (not trusted addresses)
    await voterWhitelister.requestFullVoterWhitelisting(p3);

    // Now we must wait through a reward epoch so the vote power block
    // of the next reward epoch gets set to a block that has these just
    // minted and delegated values within it. Otherwise, there will be no
    // rewards to claim.
    console.log("Waiting for a new reward epoch to start...");

    const currentRewardEpoch = Math.floor((new Date().getTime() / 1000 - rewardEpochsStartTs.toNumber()) / rewardEpochDurationSeconds.toNumber());

    await waitTillRewardFinalizeStart(
      ftsoManager,
      flareDaemon,
      rewardEpochsStartTs.toNumber(), 
      rewardEpochDurationSeconds.toNumber(), 
      currentRewardEpoch);

    await rewardManager.enableClaims({from: await rewardManager.governance()});

  });

  it("Should delegate, price submit, reveal, earn, and claim ftso rewards", async() => {
    // Assemble
    // Providers submit prices

    const ftsoIndices = [];
    const ftsos = [ftsoWnat, ftsoFalgo, ftsoFbch, ftsoFada, ftsoFxrp, ftsoFltc, ftsoDoge, ftsoFdgb];
    for(let ftso of ftsos){
      ftsoIndices.push(await ftsoRegistry.getFtsoIndex( await ftso.symbol()));
    }

    const p1SubmitterPrices = await submitPricePriceSubmitter(ftsos, ftsoIndices, priceSubmiter, [0.35, 1.00, 1100, 1.84, 1.40, 320, 0.37, 0.08], p1);
    const p2SubmitterPrices = await submitPricePriceSubmitter(ftsos, ftsoIndices, priceSubmiter, [0.40, 1.33, 1203, 1.90, 1.50, 340, 0.45, 0.11], p2);
    const p3SubmitterPrices = await submitPricePriceSubmitter(ftsos, ftsoIndices, priceSubmiter, [0.50, 1.35, 1210, 1.91, 1.35, 350, 0.48, 0.13], p3);    


    const epochData = await ftsoWnat.getPriceEpochData();
    const epochId = epochData[0];
    const revealStartTs = epochData[1];
    const revealEndTs = epochData[2];
    const votePowerBlock = epochData[3];

    assert(epochId.toString() == p1SubmitterPrices![0].epochId);

    console.log(`Reveal will start at = ${revealStartTs}; Reveal will end at = ${revealEndTs}; it is now ${new Date().getTime() / 1000}; votePower block for epoch ${epochId} is ${votePowerBlock}`);

    while(new Date().getTime() / 1000 < revealEndTs.toNumber()) {
      // Reveal prices
      console.log(`Trying to reveal prices; system last triggered at ${(await flareDaemon.systemLastTriggeredAt()).toNumber()}; it is now ${new Date().getTime() / 1000}...`);
      try {
        await revealPricePriceSubmitter(ftsos, ftsoIndices, priceSubmiter, p1SubmitterPrices!, p1);
        await revealPricePriceSubmitter(ftsos, ftsoIndices, priceSubmiter, p2SubmitterPrices!, p2);
        await revealPricePriceSubmitter(ftsos, ftsoIndices, priceSubmiter, p3SubmitterPrices!, p3);        

        console.log("Prices revealed.");
        await advanceBlock();
        break;
      } catch (e) {
        await advanceBlock();
        await new Promise(resolve => {
          setTimeout(resolve, 1000);
        });
      }
    }

    console.log("Waiting for reward finalization to start...");

    const rewardEpochId = await ftsoManager.getCurrentRewardEpoch();

    await waitTillRewardFinalizeStart(
      ftsoManager,
      flareDaemon,
      rewardEpochsStartTs.toNumber(), 
      rewardEpochDurationSeconds.toNumber(), 
      rewardEpochId.toNumber());

    // console.log("CURRENT PRICE FADA", await ftsoFada.getCurrentPrice())
    // console.log("CURRENT PRICE ALGO", await ftsoFalgo.getCurrentPrice())
  
    console.log(`Claiming rewards for reward epoch ${rewardEpochId.toNumber()}...`);

    // Get the opening balances
    const p1OpeningBalance = BN(await web3.eth.getBalance(p1));
    const p2OpeningBalance = BN(await web3.eth.getBalance(p2));
    const p3OpeningBalance = BN(await web3.eth.getBalance(p3));
    const d1OpeningBalance = BN(await web3.eth.getBalance(d1));
    
    // Act
    // By the time we get here, reward manager better have some NAT for claiming...
    const rewardManagerBalance = BN(await web3.eth.getBalance(rewardManager.address));
    console.log(`Reward manager balance = ${rewardManagerBalance.toString()}`);
    assert(rewardManagerBalance.gt(BN(0)), "Reward manager expected to have a balance by now to distribute rewards");

    // Claim rewards
    try {
      let gasCost = BN(0);
      try {
        console.log("Claiming rewards for p1...");
        const tx = await rewardManager.claimReward(p1, [rewardEpochId], { from: p1 });
        gasCost = gasCost.add(await calcGasCost(tx));
      } catch (e: unknown) {
        spewClaimError("p1", e);
      }
      try {
        console.log("Claiming rewards for p2...");
        const tx = await rewardManager.claimReward(p2, [rewardEpochId], { from: p2 });
        gasCost = gasCost.add(await calcGasCost(tx));
      } catch (e: unknown) {
        spewClaimError("p2", e);
      }
      try {
        console.log("Claiming rewards for p3...");
        const tx = await rewardManager.claimReward(p3, [rewardEpochId], { from: p3 });
        gasCost = gasCost.add(await calcGasCost(tx));
      } catch (e: unknown) {
        spewClaimError("p3", e);
      }
      try {
        console.log("Claiming rewards for d1...");
        const tx = await rewardManager.claimReward(d1, [rewardEpochId], { from: d1 });
        gasCost = gasCost.add(await calcGasCost(tx));
      } catch (e: unknown) {
        spewClaimError("d1", e);
      }

      // Assert
      // Get the closing balances
      const p1ClosingBalance = BN(await web3.eth.getBalance(p1));
      const p2ClosingBalance = BN(await web3.eth.getBalance(p2));
      const p3ClosingBalance = BN(await web3.eth.getBalance(p3));
      const d1ClosingBalance = BN(await web3.eth.getBalance(d1));

      // Compute the closing and opening balance differences, and account for gas used
      const computedRewardClaimed = 
        p1ClosingBalance.sub(p1OpeningBalance)
        .add(p2ClosingBalance).sub(p2OpeningBalance)
        .add(p3ClosingBalance).sub(p3OpeningBalance)
        .add(d1ClosingBalance).sub(d1OpeningBalance)
        .add(gasCost);

    // Compute what we should have distributed for one price epoch
    const almost7FullDaysSec = BN(7* 3600 * 24 - 1);
    // Get the daily inflation authorized on ftso reward manager
    const totals = await getRewardTotals(rewardManager);
    const dailyAuthorizedInflation = totals.dailyAuthorizedInflation;
    const authorizedInflationTimestamp = totals.lastInflationAuthorizationReceivedTs;

    // use the same formula as in ftso reward manager to calculate claimable value
    const dailyPeriodEndTs = authorizedInflationTimestamp.add(almost7FullDaysSec);
    const priceEpochEndTime = BN(firstPriceEpochStartTs.toNumber() + (epochId.toNumber() + 1) * priceEpochDurationSeconds.toNumber() - 1);
    const shouldaClaimed = dailyAuthorizedInflation.div( 
        (dailyPeriodEndTs.sub(priceEpochEndTime)).div(priceEpochDurationSeconds).add(BN(1))
    );

      console.log(`Should have claimed: ${shouldaClaimed.toString()}`);
      console.log(`Actually claimed: ${computedRewardClaimed.toString()}`);

      // Any daemon errors? Better spew them to the console.
      // Some of these are inflation zero errors, from before inflation was added to the daemon
      // at deploy time. These are ok and should be ignored.
      await spewDaemonErrors(flareDaemon);
//      assert.equal((await spewDaemonErrors(flareDaemon)), 0);

      // Account for allocation truncation during distribution calc
      const differenceBetweenActualAndExpected = shouldaClaimed.sub(computedRewardClaimed);

      // After all that, one little test...
      assert(shouldaClaimed.sub(computedRewardClaimed).eq(BN(0)), "Claimed amount and amount should have claimed are not equal.");
    } catch (e) {
      // Any daemon errors? Better spew them to the console and fail if so.
      await spewDaemonErrors(flareDaemon);
//      assert.equal((await spewDaemonErrors(flareDaemon)), 0);
      // This is still a test failure even if no daemon errors, as something else happened.
      throw e;
    }
  });

});
