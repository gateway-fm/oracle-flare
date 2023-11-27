import { constants, time } from "@openzeppelin/test-helpers";
import fs from "fs";
import { Contracts } from "../../../deployment/scripts/Contracts";
import { AssetTokenContract, AssetTokenInstance, FtsoInstance, FtsoManagerInstance, FtsoRegistryInstance, FtsoRegistryProxyInstance, PriceSubmitterInstance, VoterWhitelisterInstance, WNatInstance } from "../../../typechain-truffle";
import { defaultPriceEpochCyclicBufferSize, getTestFile, GOVERNANCE_GENESIS_ADDRESS } from "../../utils/constants";
import { encodeContractNames, getRandom, increaseTimeTo, submitHash, toBN } from "../../utils/test-helpers";
import { setDefaultVPContract } from "../../utils/token-test-helpers";

const VoterWhitelister = artifacts.require("VoterWhitelister");
const WNat = artifacts.require("WNat");
const Ftso = artifacts.require("Ftso");
const FtsoRegistry = artifacts.require("FtsoRegistry");
const PriceSubmitter = artifacts.require("PriceSubmitter");
const FtsoManager = artifacts.require("FtsoManager");
const FtsoManagement = artifacts.require("FtsoManagement");
const AssetToken = artifacts.require("AssetToken") as AssetTokenContract;
const FtsoRegistryProxy = artifacts.require("FtsoRegistryProxy");

function toBNFixed(x: number, decimals: number) {
  const prec = Math.min(decimals, 6);
  const s = x.toFixed(prec);
  const dot = s.indexOf('.');
  const bn = toBN(s.slice(0, dot) + s.slice(dot + 1));
  return prec === decimals ? bn : bn.mul(toBN(10).pow(toBN(decimals - prec)));
}

function eth(x: number) {
  return toBNFixed(x, 18);
}

function usd(x: number) {
  return toBNFixed(x, 5);     // asset prices are multiplied by 10**5 (see Ftso.sol)
}

function fmtNum(x: BN) {
  const xn = Number(x.toString());
  return xn < 1e4 ? xn.toString() : xn.toExponential(3);
}
const gasReport: object[] = [];

contract(`a few contracts; ${getTestFile(__filename)}; gas consumption tests`, async accounts => {
  const governance = GOVERNANCE_GENESIS_ADDRESS;
  const ADDRESS_UPDATER = accounts[16];
  const ftsoManager = accounts[33];
  let mockFtsoManager: FtsoManagerInstance;

  const epochDurationSec = 1000;
  const revealDurationSec = 500;
  const rewardDurationSec = 1000000;

  let whitelist: VoterWhitelisterInstance;
  let priceSubmitter: PriceSubmitterInstance;
  let startTs: BN;
  let rewardStartTs: BN;

  let wNat: WNatInstance;
  let natFtso: FtsoInstance;

  let ftsoRegistry: FtsoRegistryInstance;
  let registry: FtsoRegistryInstance
  let ftsoRegistryProxy: FtsoRegistryProxyInstance;

  let vpBlockNumber: number;
  let epochId: number;

  before(async () => {
    FtsoManager.link(await FtsoManagement.new() as any);
  });

  async function createFtso(symbol: string, initialPrice: BN) {
    const ftso = await Ftso.new(symbol, 5, priceSubmitter.address, wNat.address, ftsoManager, startTs, epochDurationSec, revealDurationSec, initialPrice, 1e10, defaultPriceEpochCyclicBufferSize);
    await registry.addFtso(ftso.address, { from: ftsoManager });
    // add ftso to price submitter and whitelist
    const ftsoIndex = await registry.getFtsoIndex(symbol);
    await whitelist.addFtso(ftsoIndex, { from: ftsoManager });
    // both turnout thresholds are set to 0 to match whitelist vp calculation (which doesn't use turnout)
    const trustedVoters = accounts.slice(201, 201 + 5);
    await ftso.configureEpochs(1, 1, 1000, 10000, 0, 0, 0, 0, trustedVoters, { from: ftsoManager });
    await ftso.activateFtso(startTs, epochDurationSec, revealDurationSec, { from: ftsoManager });
    return ftso;
  }

  async function initializeRewardEpoch(vpBlock?: number, natSupply: BN | number = eth(1000)) {
    // set votepower block
    vpBlockNumber = vpBlock ?? await web3.eth.getBlockNumber();
    await time.advanceBlock();
    const ftsoAddrList = await registry.getAllFtsos();
    const ftsoList = await Promise.all(ftsoAddrList.map(addr => Ftso.at(addr)));
    for (const ftso of ftsoList) {
      await ftso.setVotePowerBlock(vpBlockNumber, { from: ftsoManager });
    }
    // await setNatSupply(natSupply, vpBlockNumber);
    await startNewPriceEpoch();
  }

  async function advanceTimeTo(target: number) {
    await time.advanceBlock();
    let timestamp = await time.latest();
    if (timestamp.toNumber() >= startTs.toNumber() + target) return;
    await increaseTimeTo(startTs.toNumber() + target, 'web3');
  }

  async function startNewPriceEpoch() {
    await time.advanceBlock();
    let timestamp = await time.latest();
    epochId = Math.floor(timestamp.sub(startTs).toNumber() / epochDurationSec) + 1;
    await increaseTimeTo(startTs.toNumber() + epochId * epochDurationSec, 'web3');
  }

  async function initializeForReveal() {
    const ftsoAddrList = await registry.getAllFtsos();
    const ftsoList = await Promise.all(ftsoAddrList.map(addr => Ftso.at(addr)));
    for (const ftso of ftsoList) {
      await ftso.initializeCurrentEpochStateForReveal(10000, false, { from: ftsoManager });
    }
    await advanceTimeTo((epochId + 1) * epochDurationSec); // reveal period start
  }

  describe('Wnat transfer', function () {

    beforeEach(async () => {
      wNat = await WNat.new(governance, "Wrapped NAT", "WNAT");
      await setDefaultVPContract(wNat, governance);
    });
    
    it("Should test gas for wNat transfer where both sender and receiver have 0 delegates", async () => {
      await wNat.deposit({ from: accounts[1], value: "100" });
      await wNat.deposit({ from: accounts[2], value: "100" });

      let transferTx = await wNat.transfer(accounts[2], 10, { from: accounts[1] });
      console.log(`transfer wNat where both sender and receiver have 0 delegates (by percentage): ${transferTx.receipt.gasUsed}`);
      gasReport.push({ "function": "transfer wNat where both sender and receiver have 0 delegates (by percentage)", "gasUsed": transferTx.receipt.gasUsed })
    });

    it("Should test gas for wNat transfer where sender has 1 delegate", async () => {
      await wNat.deposit({ from: accounts[1], value: "100" });
      await wNat.deposit({ from: accounts[2], value: "100" });

      await wNat.delegate(accounts[3], 50, { from: accounts[1] });

      let transferTx = await wNat.transfer(accounts[2], 10, { from: accounts[1] });
      console.log(`transfer wNat where sender has 1 delegate and receiver has 0 delegates (by percentage): ${transferTx.receipt.gasUsed}`);
      gasReport.push({ "function": "transfer wNat where sender has 1 delegate and receiver has 0 delegates (by percentage)", "gasUsed": transferTx.receipt.gasUsed });
    });

    it("Should test gas for wNat transfer where receiver has 1 delegate", async () => {
      await wNat.deposit({ from: accounts[1], value: "100" });
      await wNat.deposit({ from: accounts[2], value: "100" });

      await wNat.delegate(accounts[3], 50, { from: accounts[2] });

      let transferTx = await wNat.transfer(accounts[2], 10, { from: accounts[1] });
      console.log(`transfer wNat where sender has 0 delegates and receiver has 1 delegate (by percentage): ${transferTx.receipt.gasUsed}`);
      gasReport.push({ "function": "transfer wNat where sender has 0 delegates and receiver has 1 delegate (by percentage)", "gasUsed": transferTx.receipt.gasUsed });
    });

    it("Should test gas for wNat transfer where both sender and receiver have 1 delegate", async () => {
      await wNat.deposit({ from: accounts[1], value: "100" });
      await wNat.deposit({ from: accounts[2], value: "100" });

      await wNat.delegate(accounts[3], 50, { from: accounts[1] });
      await wNat.delegate(accounts[3], 50, { from: accounts[2] });

      let transferTx = await wNat.transfer(accounts[2], 10, { from: accounts[1] });
      console.log(`transfer wNat where both sender and receiver have 1 delegate (by percentage): ${transferTx.receipt.gasUsed}`);
      gasReport.push({ "function": "transfer wNat where both sender and receiver have 1 delegate (by percentage)", "gasUsed": transferTx.receipt.gasUsed });
    });

    it("Should test gas for wNat transfer where sender has 2 delegates", async () => {
      await wNat.deposit({ from: accounts[1], value: "100" });
      await wNat.deposit({ from: accounts[2], value: "100" });

      await wNat.delegate(accounts[3], 50, { from: accounts[1] });
      await wNat.delegate(accounts[4], 50, { from: accounts[1] });

      let transferTx = await wNat.transfer(accounts[2], 10, { from: accounts[1] });
      console.log(`transfer wNat where sender has 2 delegates and receiver has 0 delegates (by percentage): ${transferTx.receipt.gasUsed}`);
      gasReport.push({ "function": "transfer wNat where sender has 2 delegates and receiver has 0 delegates (by percentage)", "gasUsed": transferTx.receipt.gasUsed })
    });

    it("Should test gas for wNat transfer where receiver has 2 delegates", async () => {
      await wNat.deposit({ from: accounts[1], value: "100" });
      await wNat.deposit({ from: accounts[2], value: "100" });

      await wNat.delegate(accounts[3], 50, { from: accounts[2] });
      await wNat.delegate(accounts[4], 50, { from: accounts[2] });

      let transferTx = await wNat.transfer(accounts[2], 10, { from: accounts[1] });
      console.log(`transfer wNat where sender has 0 delegates and receiver has 2 delegates (by percentage): ${transferTx.receipt.gasUsed}`);
      gasReport.push({ "function": "transfer wNat where sender has 0 delegates and receiver has 2 delegates (by percentage)", "gasUsed": transferTx.receipt.gasUsed })
    });

    it("Should test gas for wNat transfer where sender has 2 delegates and reveiver has 1 delegate", async () => {
      await wNat.deposit({ from: accounts[1], value: "100" });
      await wNat.deposit({ from: accounts[2], value: "100" });

      await wNat.delegate(accounts[3], 50, { from: accounts[1] });
      await wNat.delegate(accounts[4], 50, { from: accounts[1] });

      await wNat.delegate(accounts[3], 50, { from: accounts[2] });

      let transferTx = await wNat.transfer(accounts[2], 10, { from: accounts[1] });
      console.log(`transfer wNat where sender has 2 delegates and receiver has 1 delegate (by percentage): ${transferTx.receipt.gasUsed}`);
      gasReport.push({ "function": "transfer wNat where sender has 2 delegates and receiver has 1 delegate (by percentage)", "gasUsed": transferTx.receipt.gasUsed })
    });

    it("Should test gas for wNat transfer where sender has 1 delegate and receiver has 2 delegates", async () => {
      await wNat.deposit({ from: accounts[1], value: "100" });
      await wNat.deposit({ from: accounts[2], value: "100" });

      await wNat.delegate(accounts[3], 50, { from: accounts[1] });

      await wNat.delegate(accounts[3], 50, { from: accounts[2] });
      await wNat.delegate(accounts[4], 50, { from: accounts[2] });

      let transferTx = await wNat.transfer(accounts[2], 10, { from: accounts[1] });
      console.log(`transfer wNat where sender has 1 delegate and receiver has 2 delegates (by percentage): ${transferTx.receipt.gasUsed}`);
      gasReport.push({ "function": "transfer wNat where sender has 1 delegate and receiver has 2 delegates (by percentage)", "gasUsed": transferTx.receipt.gasUsed })
    });

    it("Should test gas for wNat transfer where both sender and receiver have 2 delegates", async () => {
      await wNat.deposit({ from: accounts[1], value: "100" });
      await wNat.deposit({ from: accounts[2], value: "100" });

      await wNat.delegate(accounts[3], 50, { from: accounts[1] });
      await wNat.delegate(accounts[4], 50, { from: accounts[1] });

      await wNat.delegate(accounts[3], 50, { from: accounts[2] });
      await wNat.delegate(accounts[4], 50, { from: accounts[2] });

      let transferTx = await wNat.transfer(accounts[2], 10, { from: accounts[1] });
      console.log(`transfer wNat where both sender and receiver have 2 delegates (by percentage): ${transferTx.receipt.gasUsed}`);
      gasReport.push({ "function": "transfer wNat where both sender and receiver have 2 delegates (by percentage)", "gasUsed": transferTx.receipt.gasUsed })
    });
  })

  describe("FTSO gas benchmarking", async () => {
    let assetData: Array<[name: string, symbol: string, price: BN]> = [
      ["Ripple", "XRP", usd(0.5)],
      ["Bitcoin", "BTC", usd(5)],
      ["Ethereum", "ETH", usd(2)],
      ["Dodge", "DOGE", usd(0.2)],
      ["Polkadot", "DOT", usd(1.5)],
      ['Chiliz ', "CHZ", usd(0.6)],
      ['Algorand', 'ALGO', usd(1.1)],
      ['Chainlink', 'LINK', usd(20)]
    ]

    let assets: AssetTokenInstance[];
    let ftsos: FtsoInstance[];

    beforeEach(async () => {
      // create price submitter
      priceSubmitter = await PriceSubmitter.new();
      await priceSubmitter.initialiseFixedAddress();
      await priceSubmitter.setAddressUpdater(ADDRESS_UPDATER, { from: governance });

      // create ftso manager
      startTs = await time.latest();
      rewardStartTs = startTs.addn(2 * epochDurationSec + revealDurationSec);
      mockFtsoManager = await FtsoManager.new(
        governance,
        governance,
        ADDRESS_UPDATER,
        constants.ZERO_ADDRESS,
        startTs,
        epochDurationSec,
        revealDurationSec,
        rewardStartTs,
        rewardDurationSec,
        7
      );

      // create registry
      ftsoRegistry = await FtsoRegistry.new();
      ftsoRegistryProxy = await FtsoRegistryProxy.new(accounts[0], ftsoRegistry.address);
            registry = await FtsoRegistry.at(ftsoRegistryProxy.address);
            await registry.initialiseRegistry(ADDRESS_UPDATER);
      await registry.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_MANAGER]),
        [ADDRESS_UPDATER, ftsoManager], {from: ADDRESS_UPDATER});
      // create whitelister
      whitelist = await VoterWhitelister.new(governance, ADDRESS_UPDATER, priceSubmitter.address, 500, constants.ZERO_ADDRESS);
      await whitelist.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_REGISTRY, Contracts.FTSO_MANAGER]),
        [ADDRESS_UPDATER, registry.address, ftsoManager], {from: ADDRESS_UPDATER});
      await priceSubmitter.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_REGISTRY, Contracts.VOTER_WHITELISTER, Contracts.FTSO_MANAGER]),
        [ADDRESS_UPDATER, registry.address, whitelist.address, mockFtsoManager.address], {from: ADDRESS_UPDATER});
      // create assets
      wNat = await WNat.new(governance, "Wrapped NAT", "WNAT");
      await setDefaultVPContract(wNat, governance);
      assets = [];
      for (const [name, symbol, _] of assetData) {
        const asset = await AssetToken.new(governance, name, symbol, 6);
        await setDefaultVPContract(asset, governance);
        assets.push(asset);
      }

      // create ftsos
      natFtso = await createFtso("NAT", usd(1));
      ftsos = [];
      for (let i = 0; i < assets.length; i++) {
        const [_, symbol, price] = assetData[i];
        const ftso = await createFtso(symbol, price);
        await ftso.setAsset(assets[i].address, { from: ftsoManager });
        ftsos.push(ftso);
      }
      await natFtso.setAssetFtsos(ftsos.slice(0,4).map(f => f.address), { from: ftsoManager });
    });

    it("Should test gas to initialize for reveal for one ftso", async () => {
      const voter = accounts[101];
      const vp = eth(1.5);
      // Assemble
      await wNat.deposit({ from: voter, value: vp });
      await initializeRewardEpoch();

      // Act
      let initializeForRevealTx = await ftsos[0].initializeCurrentEpochStateForReveal(10000, false, { from: ftsoManager });
      console.log(`initialize for reveal for single ftso: ${initializeForRevealTx.receipt.gasUsed}`);
      gasReport.push({ "function": "initialize for reveal for single ftso", "gasUsed": initializeForRevealTx.receipt.gasUsed });
    });

    it("Should test gas to initialize for reveal for wNat ftso with 4 assets", async () => {
      const voter = accounts[101];
      const vp = eth(1.5);
      // Assemble
      await wNat.deposit({ from: voter, value: vp });
      for (const asset of assets) {
        await asset.mint(voter, vp, { from: governance });
      }
      await initializeRewardEpoch();

      // Act
      let initializeForRevealTx = await natFtso.initializeCurrentEpochStateForReveal(10000, false, { from: ftsoManager });
      console.log(`initialize for reveal for wNat ftso with 4 assets: ${initializeForRevealTx.receipt.gasUsed}`);
      gasReport.push({ "function": "initialize for reveal for wNat ftso with 4 assets", "gasUsed": initializeForRevealTx.receipt.gasUsed });
    });

    it("Should test gas to submit and reveal price for one ftso", async () => {
      const voters = accounts.slice(101, 102);
      const vp = eth(1.5);
      // Assemble
      for (const voter of voters) {
        await wNat.deposit({ from: voter, value: vp });
      }
      await initializeRewardEpoch();
      // warm cache
      for (const voter of voters) {
        await wNat.votePowerOfAtCached(voter, vpBlockNumber);
        for (const asset of assets) {
          await asset.votePowerOfAtCached(voter, vpBlockNumber);
        }
      }
      // Act
      const allFtsos = [ftsos[0]];
      const prices = [usd(2.1)];
      const random = getRandom();
      const indices: BN[] = [];
      for (const ftso of allFtsos) {
        const symbol = await ftso.symbol();
        indices.push(await registry.getFtsoIndex(symbol));
      }
      // whitelist
      await initializeForReveal();
      for (const voter of voters) {
        await whitelist.requestFullVoterWhitelisting(voter);
      }
      // submit hashes
      await startNewPriceEpoch();
      for (const voter of voters) {
        const hash = submitHash(indices, prices, random, voter);
        let submitTx = await priceSubmitter.submitHash(epochId, hash, { from: voter });
        console.log(`submit price for single ftso: ${submitTx.receipt.gasUsed}`);
        gasReport.push({ "function": "submit price for single ftso", "gasUsed": submitTx.receipt.gasUsed });
      }
      // reveal prices
      await initializeForReveal();
      for (const voter of voters) {
        let revealTx = await priceSubmitter.revealPrices(epochId, indices, prices, random, { from: voter });
        console.log(`reveal price for single ftso: ${revealTx.receipt.gasUsed}`);
        gasReport.push({ "function": "reveal price for single ftso", "gasUsed": revealTx.receipt.gasUsed });
      }
      // finalize
      await advanceTimeTo((epochId + 1) * epochDurationSec + revealDurationSec); // reveal period end
    });

    it("Should test gas to initialize for reveal for wNat ftso with 4 assets + 8 ftsos", async () => {
      const voter = accounts[101];
      const vp = eth(1.5);
      // Assemble
      await wNat.deposit({ from: voter, value: vp });
      for (const asset of assets) {
        await asset.mint(voter, vp, { from: governance });
      }
      await initializeRewardEpoch();

      // Act
      const allFtsos = [natFtso, ...ftsos];

      let gasUsed = 0;
      for (const ftso of allFtsos) {
        let initializeForRevealTx = await ftso.initializeCurrentEpochStateForReveal(10000, false, { from: ftsoManager });
        gasUsed += initializeForRevealTx.receipt.gasUsed;
      }

      console.log(`initialize for reveal for wNat ftso with 4 assets + 8 ftsos: ${gasUsed}`);
      gasReport.push({ "function": "initialize for reveal for wNat ftso with 4 assets + 8 ftsos", "gasUsed": gasUsed });
    });

    it("Should test gas to submit and reveal prices for wNat ftso with 4 assets + 8 ftsos", async () => {
      const voters = accounts.slice(101, 102);
      const vp = eth(1.5);
      // Assemble
      for (const voter of voters) {
        await wNat.deposit({ from: voter, value: vp });
        for (const asset of assets) {
          await asset.mint(voter, vp, { from: governance });
        }
      }
      await initializeRewardEpoch();
      // warm cache
      for (const voter of voters) {
        await wNat.votePowerOfAtCached(voter, vpBlockNumber);
        for (const asset of assets) {
          await asset.votePowerOfAtCached(voter, vpBlockNumber);
        }
      }
      // Act
      const allFtsos = [natFtso, ...ftsos];
      const prices = [usd(2.58), usd(0.6), usd(5.5), usd(1.9), usd(0.23), usd(1.4), usd(0.5), usd(1.2), usd(19.7)];
      const random = getRandom();
      const indices: BN[] = [];
      for (const ftso of allFtsos) {
        const symbol = await ftso.symbol();
        indices.push(await registry.getFtsoIndex(symbol));
      }
      // whitelist
      await initializeForReveal();
      for (const voter of voters) {
        await whitelist.requestFullVoterWhitelisting(voter);
      }
      // submit hashes
      await startNewPriceEpoch();
      for (const voter of voters) {
        const hash = submitHash(indices, prices, random, voter);
        let submitTx = await priceSubmitter.submitHash(epochId, hash, { from: voter });
        console.log(`submit prices for wNat ftso with 4 assets + 8 ftsos: ${submitTx.receipt.gasUsed}`);
        gasReport.push({ "function": "submit prices for wNat ftso with 4 assets + 8 ftsos", "gasUsed": submitTx.receipt.gasUsed });
      }
      // reveal prices
      await initializeForReveal();
      for (const voter of voters) {
        let revealTx = await priceSubmitter.revealPrices(epochId, indices, prices, random, { from: voter });
        console.log(`reveal prices for wNat ftso with 4 assets + 8 ftsos: ${revealTx.receipt.gasUsed}`);
        gasReport.push({ "function": "reveal prices for wNat ftso with 4 assets + 8 ftsos", "gasUsed": revealTx.receipt.gasUsed });
      }
      // finalize
      await advanceTimeTo((epochId + 1) * epochDurationSec + revealDurationSec); // reveal period end
    });

    it.skip("Should test gas for finalizing price epoch for 50 submissions", async () => {
      const voters = accounts.slice(101, 101 + 50);
      const vp = eth(1.5);
      // Assemble
      for (const voter of voters) {
        await wNat.deposit({ from: voter, value: vp });
        for (const asset of assets) {
          await asset.mint(voter, vp, { from: governance });
        }
      }
      await initializeRewardEpoch();
      // warm cache
      for (const voter of voters) {
        await wNat.votePowerOfAtCached(voter, vpBlockNumber);
        for (const asset of assets) {
          await asset.votePowerOfAtCached(voter, vpBlockNumber);
        }
      }
      // Act
      const allFtsos = [ftsos[0]];
      const prices = [usd(2.1)];
      const random = getRandom();
      const indices: BN[] = [];
      for (const ftso of allFtsos) {
        const symbol = await ftso.symbol();
        indices.push(await registry.getFtsoIndex(symbol));
      }
      // whitelist
      await initializeForReveal();
      for (const voter of voters) {
        await whitelist.requestFullVoterWhitelisting(voter);
      }
      // submit hashes
      await startNewPriceEpoch();
      for (const voter of voters) {
        const hash = submitHash(indices, prices, random, voter);
        await priceSubmitter.submitHash(epochId, hash, { from: voter });
      }
      // reveal prices
      await initializeForReveal();
      for (const voter of voters) {
        await priceSubmitter.revealPrices(epochId, indices, prices, random, { from: voter });
      }
      // finalize
      await advanceTimeTo((epochId + 1) * epochDurationSec + revealDurationSec); // reveal period end
      for (const ftso of allFtsos) {
        let finalizeTx = await ftso.finalizePriceEpoch(epochId, false, { from: ftsoManager });
        console.log(`finalize price epoch for 50 submissions: ${finalizeTx.receipt.gasUsed}`);
        gasReport.push({ "function": "finalize price epoch for 50 submissions", "gasUsed": finalizeTx.receipt.gasUsed });
      }
    });

    it("Should test gas for finalizing price epoch for 100 submissions + 5 trusted providers", async () => {
      const voters = accounts.slice(101, 101 + 105);
      const vp = eth(1.5);
      // Assemble
      for (const voter of voters) {
        await wNat.deposit({ from: voter, value: vp });
        for (const asset of assets) {
          await asset.mint(voter, vp, { from: governance });
        }
      }
      await initializeRewardEpoch();
      // warm cache
      for (const voter of voters) {
        await wNat.votePowerOfAtCached(voter, vpBlockNumber);
        for (const asset of assets) {
          await asset.votePowerOfAtCached(voter, vpBlockNumber);
        }
      }
      // Act
      const allFtsos = [ftsos[0]];
      const prices = [usd(2.1)];
      const random = getRandom();
      const indices: BN[] = [];
      for (const ftso of allFtsos) {
        const symbol = await ftso.symbol();
        indices.push(await registry.getFtsoIndex(symbol));
      }
      // whitelist
      await initializeForReveal();
      for (const voter of voters) {
        await whitelist.requestFullVoterWhitelisting(voter);
      }
      // submit hashes
      await startNewPriceEpoch();
      for (const voter of voters) {
        const hash = submitHash(indices, prices, random, voter);
        await priceSubmitter.submitHash(epochId, hash, { from: voter });
      }
      // reveal prices
      await initializeForReveal();
      for (const voter of voters) {
        await priceSubmitter.revealPrices(epochId, indices, prices, random, { from: voter });
      }
      // finalize
      await advanceTimeTo((epochId + 1) * epochDurationSec + revealDurationSec); // reveal period end
      for (const ftso of allFtsos) {
        let finalizeTx = await ftso.finalizePriceEpoch(epochId, false, { from: ftsoManager });
        console.log(`finalize price epoch for 100 submissions + 5 trusted providers: ${finalizeTx.receipt.gasUsed}`);
        gasReport.push({ "function": "finalize price epoch for 100 submissions + 5 trusted providers", "gasUsed": finalizeTx.receipt.gasUsed });
      }
      fs.unlinkSync('gas-report.json');
      fs.writeFile('gas-report.json', JSON.stringify(gasReport, null, 2) + '\n', { flag: 'a+' }, err => { return err })
    });

    it.skip("Should test gas for finalizing price epoch for 300 submissions", async () => {
      const voters = accounts.slice(101, 101 + 300);
      const vp = eth(1.5);
      let finalizeTxt = 0;
      // Assemble
      for (const voter of voters) {
        await wNat.deposit({ from: voter, value: vp });
        for (const asset of assets) {
          await asset.mint(voter, vp, { from: governance });
        }
      }
      await initializeRewardEpoch();
      // warm cache
      for (const voter of voters) {
        await wNat.votePowerOfAtCached(voter, vpBlockNumber);
        for (const asset of assets) {
          await asset.votePowerOfAtCached(voter, vpBlockNumber);
        }
      }
      // Act
      const allFtsos = [ftsos[0]];
      const prices = [usd(2.1)];
      const random = getRandom();
      const indices: BN[] = [];
      for (const ftso of allFtsos) {
        const symbol = await ftso.symbol();
        indices.push(await registry.getFtsoIndex(symbol));
      }
      // whitelist
      await initializeForReveal();
      for (const voter of voters) {
        await whitelist.requestFullVoterWhitelisting(voter);
      }
      // submit hashes
      await startNewPriceEpoch();
      for (const voter of voters) {
        const hash = submitHash(indices, prices, random, voter);
        await priceSubmitter.submitHash(epochId, hash, { from: voter });
      }
      // reveal prices
      await initializeForReveal();
      for (const voter of voters) {
        await priceSubmitter.revealPrices(epochId, indices, prices, random, { from: voter });
      }
      // finalize
      await advanceTimeTo((epochId + 1) * epochDurationSec + revealDurationSec); // reveal period end
      for (const ftso of allFtsos) {
        let finalizeTx = await ftso.finalizePriceEpoch(epochId, false, { from: ftsoManager });
        console.log(`finalize price epoch for 300 submissions: ${finalizeTx.receipt.gasUsed}`);
        gasReport.push({ "function": "finalize price epoch for 300 submissions", "gasUsed": finalizeTx.receipt.gasUsed });
      }
    });
  });
});
