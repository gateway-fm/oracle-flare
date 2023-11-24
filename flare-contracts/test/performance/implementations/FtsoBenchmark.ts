import { constants, time } from "@openzeppelin/test-helpers";
import { Contracts } from "../../../deployment/scripts/Contracts";
import { FtsoRegistryInstance, SimpleMockFtsoInstance, PriceSubmitterInstance, SupplyInstance, VoterWhitelisterMockInstance, VPTokenMockInstance, WNatInstance, FtsoManagerInstance, FtsoRegistryProxyInstance } from "../../../typechain-truffle";
import { defaultPriceEpochCyclicBufferSize, GOVERNANCE_GENESIS_ADDRESS, getTestFile } from "../../utils/constants";
import { compareArrays, encodeContractNames, getRandom, increaseTimeTo, submitHash, submitPriceHash, toBN } from "../../utils/test-helpers";
import { setDefaultVPContract } from "../../utils/token-test-helpers";

const VoterWhitelister = artifacts.require("VoterWhitelisterMock");
const WNat = artifacts.require("WNat");
const VPToken = artifacts.require("VPTokenMock");
const Ftso = artifacts.require("SimpleMockFtso");
const FtsoRegistry = artifacts.require("FtsoRegistry");
const PriceSubmitter = artifacts.require("PriceSubmitter");
const FtsoManager = artifacts.require("FtsoManager");
const FtsoManagement = artifacts.require("FtsoManagement");
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

contract(`FtsoBenchmark.sol; ${getTestFile(__filename)}; FTSO gas consumption tests`, async accounts => {
    const governance = GOVERNANCE_GENESIS_ADDRESS;
    const ADDRESS_UPDATER = accounts[16];
    const ftsoManager = accounts[33];
    
    const epochDurationSec = 120;
    const revealDurationSec = 60;

    let whitelist: VoterWhitelisterMockInstance;
    let priceSubmitter: PriceSubmitterInstance;

    let wnat: WNatInstance;
    let natFtso: SimpleMockFtsoInstance;

    let registry: FtsoRegistryInstance;
    let ftsoRegistry: FtsoRegistryInstance;

    let mockFtsoManager: FtsoManagerInstance;

    let vpBlockNumber: number;
    let epochId: number;

    async function createFtso(symbol: string, initialPrice: BN) {
        const ftso = await Ftso.new(symbol, 5, priceSubmitter.address, wnat.address, ftsoManager, 0, epochDurationSec, revealDurationSec, initialPrice, 1e10, defaultPriceEpochCyclicBufferSize);
        await registry.addFtso(ftso.address, { from: ftsoManager });
        // add ftso to price submitter and whitelist
        const ftsoIndex = await registry.getFtsoIndex(symbol);
        await whitelist.addFtso(ftsoIndex, { from: ftsoManager });
        // both turnout thresholds are set to 0 to match whitelist vp calculation (which doesn't use turnout)
        const trustedVoters = accounts.slice(101, 101 + 10);
        await ftso.configureEpochs(1, 1, 1000, 10000, 0, 0, 0, 0, trustedVoters, { from: ftsoManager });
        await ftso.activateFtso(0, epochDurationSec, revealDurationSec, { from: ftsoManager });
        return ftso;
    }

    async function initializeRewardEpoch(vpBlock?: number) {
        // set votepower block
        vpBlockNumber = vpBlock ?? await web3.eth.getBlockNumber();
        await time.advanceBlock();
        const ftsoAddrList = await registry.getAllFtsos();
        const ftsoList = await Promise.all(ftsoAddrList.map(addr => Ftso.at(addr)));
        for (const ftso of ftsoList) {
            await ftso.setVotePowerBlock(vpBlockNumber, { from: ftsoManager });
        }
        await startNewPriceEpoch();
    }
    
    async function advanceTimeTo(target: number) {
        await time.advanceBlock();
        let timestamp = await time.latest();
        if (timestamp.toNumber() >= target) return;
        await increaseTimeTo(target, 'web3');
    }
    
    async function startNewPriceEpoch() {
        await time.advanceBlock();
        let timestamp = await time.latest();
        epochId = Math.floor(timestamp.toNumber() / epochDurationSec) + 1;
        await increaseTimeTo(epochId * epochDurationSec, 'web3');
    }
    
    async function initializeForReveal(natSupply: BN | number = eth(1000)) {
        const ftsoAddrList = await registry.getAllFtsos();
        const ftsoList = await Promise.all(ftsoAddrList.map(addr => Ftso.at(addr)));
        for (const ftso of ftsoList) {
            await ftso.initializeCurrentEpochStateForReveal(natSupply, false, { from: ftsoManager });
        }
        await advanceTimeTo((epochId + 1) * epochDurationSec); // reveal period start
    }
    
    before(async () => {
        FtsoManager.link(await FtsoManagement.new() as any);
    });

    describe("Voting for nat + 5 assets", async () => {
        let assetData: Array<[name: string, symbol: string, price: BN]> = [
            ["Ripple", "XRP", usd(0.5)],
            ["Bitcoin", "BTC", usd(5)],
            ["Ethereum", "ETH", usd(2)],
            ["Dodge", "DOGE", usd(0.2)],
            ["Polkadot", "DOT", usd(1.5)],
        ]

        let assets: VPTokenMockInstance[];
        let ftsos: SimpleMockFtsoInstance[];
        var ftsoRegistryProxy: FtsoRegistryProxyInstance;

        beforeEach(async () => {
            // create price submitter
            priceSubmitter = await PriceSubmitter.new();
            await priceSubmitter.initialiseFixedAddress();
            await priceSubmitter.setAddressUpdater(ADDRESS_UPDATER, { from: governance });

            mockFtsoManager = await FtsoManager.new(
                governance,
                governance,
                ADDRESS_UPDATER,
                constants.ZERO_ADDRESS,
                0,
                epochDurationSec,
                revealDurationSec,
                2 * epochDurationSec + revealDurationSec,
                10 * epochDurationSec,
                7
              );

            // create registry
            ftsoRegistry = await FtsoRegistry.new();
            ftsoRegistryProxy = await FtsoRegistryProxy.new(governance, ftsoRegistry.address, { from: governance });
            registry = await FtsoRegistry.at(ftsoRegistryProxy.address);
            await registry.initialiseRegistry(ADDRESS_UPDATER, { from: governance });
            await registry.updateContractAddresses(
                encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_MANAGER]),
                [ADDRESS_UPDATER, ftsoManager], {from: ADDRESS_UPDATER});

            // create whitelister
            whitelist = await VoterWhitelister.new(governance, ADDRESS_UPDATER, priceSubmitter.address, 200);
            await whitelist.updateContractAddresses(
                encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_REGISTRY, Contracts.FTSO_MANAGER]),
                [ADDRESS_UPDATER, registry.address, ftsoManager], {from: ADDRESS_UPDATER});
            await priceSubmitter.updateContractAddresses(
                encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_REGISTRY, Contracts.VOTER_WHITELISTER, Contracts.FTSO_MANAGER]),
                [ADDRESS_UPDATER, registry.address, whitelist.address, mockFtsoManager.address], {from: ADDRESS_UPDATER});
            // create assets
            wnat = await WNat.new(governance, "Wrapped NAT", "WNAT");
            await setDefaultVPContract(wnat, governance);
            assets = [];
            for (const [name, symbol, _] of assetData) {
                const asset = await VPToken.new(governance, name, symbol);
                await setDefaultVPContract(asset, governance);
                assets.push(asset);
            }
            // create ftsos
            natFtso = await createFtso("NAT", usd(1));
            ftsos = [];
            for (let i = 0; i < assets.length; i++) {
                const [_, symbol, price] = assetData[i];
                const ftso = await createFtso(symbol, price);
                // 3 of 5 asset ftsos have xasset
                if (i <= 2) {
                    await ftso.setAsset(assets[i].address, { from: ftsoManager });
                }
                ftsos.push(ftso);
            }
            await natFtso.setAssetFtsos(ftsos.map(f => f.address), { from: ftsoManager });
        });
        
        it("submit hashes and reveal prices", async () => {
            const voters = accounts.slice(101, 101 + 5);
            const vp = eth(1.5);
            // Assemble
            for (const voter of voters) {
                await wnat.deposit({ from: voter, value: vp });
                for (const asset of assets) {
                    await asset.mint(voter, vp);
                }
            }
            await initializeRewardEpoch();
            // warm cache
            for (const voter of voters) {
                await wnat.votePowerOfAtCached(voter, vpBlockNumber);
                for (const asset of assets) {
                    await asset.votePowerOfAtCached(voter, vpBlockNumber);
                }
            }
            // Act
            const allFtsos = [natFtso, ...ftsos];
            const prices = [usd(2.1), usd(0.6), usd(5.5), usd(1.9), usd(0.23), usd(1.4)];
            const randoms = prices.map(_ => toBN(Math.round(Math.random() * 1e9)));
            // submit hashes
            for (const voter of voters) {
                for (let i = 0; i < allFtsos.length; i++) {
                    const ftso = allFtsos[i];
                    const hash = submitPriceHash(prices[i], randoms[i], voter);
                    await ftso.submitPriceHash(epochId, hash, { from: voter });
                }
            }
            // reveal prices
            await initializeForReveal();
            for (const voter of voters) {
                for (let i = 0; i < allFtsos.length; i++) {
                    const ftso = allFtsos[i];
                    await ftso.revealPrice(epochId, prices[i], randoms[i], { from: voter });
                }
            }
            // Assert
            for (let i = 0; i < allFtsos.length; i++) {
                const ftso = allFtsos[i];
                const { 0: pricesFromFtso } = await ftso.readVotes(epochId);
                compareArrays(pricesFromFtso.map(x => x.toNumber()), voters.map(_ => prices[i].toNumber()));
            }
        });
        
        it("submit hashes and reveal prices through PriceSubmitter", async () => {
            const voters = accounts.slice(101, 101 + 50);
            const vp = eth(1.5);
            // Assemble
            for (const voter of voters) {
                await wnat.deposit({ from: voter, value: vp });
                for (const asset of assets) {
                    await asset.mint(voter, vp);
                }
            }
            await initializeRewardEpoch();
            // warm cache
            for (const voter of voters) {
                await wnat.votePowerOfAtCached(voter, vpBlockNumber);
                for (const asset of assets) {
                    await asset.votePowerOfAtCached(voter, vpBlockNumber);
                }
            }
            // Act
            const allFtsos = [natFtso, ...ftsos];
            const prices = [usd(2.1), usd(0.6), usd(5.5), usd(1.9), usd(0.23), usd(1.4)];
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
                await ftso.finalizePriceEpoch(epochId, false, { from: ftsoManager });
            }
            // Assert
            for (let i = 0; i < allFtsos.length; i++) {
                const ftso = allFtsos[i];
                const { 0: pricesFromFtso } = await ftso.readVotes(epochId);
                compareArrays(pricesFromFtso.map(x => x.toNumber()), voters.map(_ => prices[i].toNumber()));
            }
        });
    });
});
