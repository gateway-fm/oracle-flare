import { constants, expectEvent, expectRevert } from "@openzeppelin/test-helpers";
import { Contracts } from "../../../../deployment/scripts/Contracts";
import { FtsoRegistryInstance, FtsoRegistryProxyInstance, MockContractInstance, PriceSubmitterInstance, SimpleMockFtsoInstance, VoterWhitelisterMockInstance, VPTokenMockInstance, WNatInstance } from "../../../../typechain-truffle";
import { defaultPriceEpochCyclicBufferSize, getTestFile, GOVERNANCE_GENESIS_ADDRESS } from "../../../utils/constants";
import { calcGasCost } from "../../../utils/eth";
import { assertNumberEqual, compareArrays, compareNumberArrays, compareSets, encodeContractNames, toBN, toBNFixedPrecision } from "../../../utils/test-helpers";
import { setDefaultVPContract } from "../../../utils/token-test-helpers";

const VoterWhitelister = artifacts.require("VoterWhitelisterMock");
const WNat = artifacts.require("WNat");
const VPToken = artifacts.require("VPTokenMock");
const Ftso = artifacts.require("SimpleMockFtso");
const FtsoRegistry = artifacts.require("FtsoRegistry");
const Supply = artifacts.require("Supply");
const MockContract = artifacts.require("MockContract");
const PriceSubmitter = artifacts.require("PriceSubmitter");
const FtsoRegistryProxy = artifacts.require("FtsoRegistryProxy");

const WHITELISTING_ERROR = "vote power too low";

function eth(x: number) {
    return toBNFixedPrecision(x, 18);
}

function usd(x: number) {
    return toBNFixedPrecision(x, 5);     // asset prices are multiplied by 10**5 (see Ftso.sol)
}

function fmtNum(x: BN) {
    const xn = Number(x.toString());
    return xn < 1e4 ? xn.toString() : xn.toExponential(3);
}

contract(`VoterWhitelister.sol; ${getTestFile(__filename)}; Voter whitelist unit tests`, async accounts => {
    const governance = accounts[32];
    const ADDRESS_UPDATER = accounts[16];
    const ftsoManager = accounts[33];

    let ftsoManagerMock: MockContractInstance;
    let whitelist: VoterWhitelisterMockInstance;
    let priceSubmitter: any;

    let wNat: WNatInstance;
    let natFtso: SimpleMockFtsoInstance;

    let ftsoRegistry: FtsoRegistryInstance;
    let registry: FtsoRegistryInstance
    let ftsoRegistryProxy: FtsoRegistryProxyInstance;

    let vpBlockNumber: number;

    async function createFtso(symbol: string, initialPriceUSDDec5: BN) {
        const ftso = await Ftso.new(symbol, 5, priceSubmitter.address, wNat.address, ftsoManager, 0, 120, 60, initialPriceUSDDec5, 1e10, defaultPriceEpochCyclicBufferSize);
        await registry.addFtso(ftso.address, { from: ftsoManager });
        // both turnout thresholds are set to 0 to match whitelist vp calculation (which doesn't use turnout)
        await ftso.configureEpochs(1, 1, 1000, 10000, 0, 0, 0, 0, [], { from: ftsoManager });
        await ftso.activateFtso(0, 120, 60, { from: ftsoManager });
        return ftso;
    }

    async function initializeEpochForReveal(vpBlock?: number, natSupply: number = 10_000) {
        // set votepower block
        vpBlockNumber = vpBlock ?? await web3.eth.getBlockNumber();
        const ftsoAddrList = await registry.getAllFtsos();
        const ftsoList = await Promise.all(ftsoAddrList.map(addr => Ftso.at(addr)));
        for (const ftso of ftsoList) {
            await ftso.setVotePowerBlock(vpBlockNumber, { from: ftsoManager });
        }

        // initial reveal
        for (const ftso of ftsoList) {
            await ftso.initializeCurrentEpochStateForReveal(natSupply, false, { from: ftsoManager });
        }
    }
    
    describe("Simple nat with 2 ftso tests", async () => {
        let fxrp: VPTokenMockInstance;
        let fbtc: VPTokenMockInstance;

        let xrpFtso: SimpleMockFtsoInstance;
        let btcFtso: SimpleMockFtsoInstance;

        beforeEach(async () => {
            priceSubmitter = await MockContract.new();
            // create registry
            ftsoRegistry = await FtsoRegistry.new();
            ftsoRegistryProxy = await FtsoRegistryProxy.new(accounts[0], ftsoRegistry.address);
            registry = await FtsoRegistry.at(ftsoRegistryProxy.address);
            await registry.initialiseRegistry(ADDRESS_UPDATER);
            await registry.updateContractAddresses(
                encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_MANAGER]),
                [ADDRESS_UPDATER, ftsoManager], {from: ADDRESS_UPDATER});
            // create assets
            wNat = await WNat.new(governance, "Wrapped NAT", "WNAT");
            await setDefaultVPContract(wNat, governance);
            fxrp = await VPToken.new(governance, "Ripple", "XRP");
            await setDefaultVPContract(fxrp, governance);
            fbtc = await VPToken.new(governance, "Bitcoin", "BTC");
            await setDefaultVPContract(fbtc, governance);
            // create ftsos
            natFtso = await createFtso("NAT", usd(1));
            xrpFtso = await createFtso("XRP", usd(0.5));
            btcFtso = await createFtso("BTC", usd(5));
            await xrpFtso.setAsset(fxrp.address, { from: ftsoManager });
            await btcFtso.setAsset(fbtc.address, { from: ftsoManager });
            await natFtso.setAssetFtsos([xrpFtso.address, btcFtso.address], { from: ftsoManager });
            // create whitelist
            whitelist = await VoterWhitelister.new(governance, ADDRESS_UPDATER, priceSubmitter.address, 5);
            // update ftso manager to some account
            await whitelist.updateContractAddresses(
                encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_REGISTRY, Contracts.FTSO_MANAGER]),
                [ADDRESS_UPDATER, registry.address, ftsoManager], {from: ADDRESS_UPDATER});
            await whitelist.addFtso(0, { from: ftsoManager });
            await whitelist.addFtso(1, { from: ftsoManager });
            await whitelist.addFtso(2, { from: ftsoManager });

            ftsoManagerMock = await MockContract.new();
            // update ftso manager to contract
            await whitelist.updateContractAddresses(
                encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_REGISTRY, Contracts.FTSO_MANAGER]),
                [ADDRESS_UPDATER, registry.address, ftsoManagerMock.address], {from: ADDRESS_UPDATER});
        });

        it("get correct parameters", async () => {
            // Assemble
            for (let i = 1; i < 10; i++) {
                await wNat.deposit({ from: accounts[i], value: eth(100 * i) });
                await fxrp.mint(accounts[i], eth(100 * i));
                await fbtc.mint(accounts[i], eth(100 * i));
            }
            await initializeEpochForReveal();
            // Assert
            const result = await xrpFtso.getVoteWeightingParameters();
            const assetMultipliers = result[1].map(fmtNum);
            const totalVotePowerNat = fmtNum(result[2]);
            const totalVotePowerAsset = fmtNum(result[3]);
            const assetWeightRatio = fmtNum(result[4]);
            compareArrays(assetMultipliers, ['5.000e+16']);
            assert.equal(totalVotePowerNat, '4.500e+21');
            assert.equal(totalVotePowerAsset, '2.250e+8');
            assert.equal(assetWeightRatio, '5000');
            assert.isFalse(await whitelist.copyMode());
        });

        async function calculateCorrectVotePowers(ftso: SimpleMockFtsoInstance) {
            // Assemble
            for (let i = 1; i < 10; i++) {
                await wNat.deposit({ from: accounts[i], value: eth(100 * Math.random()) });
                await fxrp.mint(accounts[i], eth(100 * Math.random()));
                await fbtc.mint(accounts[i], eth(100 * Math.random()));
            }
            await initializeEpochForReveal();
            // Assert
            const { 0: assets, 1: assetMultipliers, 2: totalVotePowerNat, 3: totalVotePowerAsset, 4: assetWeightRatio, 5: votePowerBlock } =
                await ftso.getVoteWeightingParameters();
            const voters = accounts.slice(1, 5);
            const assetVP = await whitelist.getAssetVotePowerWeights.call(assets, assetMultipliers, totalVotePowerAsset, voters, votePowerBlock);
            // console.log('assetVP', assetVP.map(fmtNum));
            const nativeVP = await whitelist.getNativeVotePowerWeights.call(wNat.address, totalVotePowerNat, voters, votePowerBlock);
            // console.log('nativeVP', nativeVP.map(fmtNum));
            const combined = await whitelist.getVotePowerWeights.call(ftso.address, voters);
            // console.log('Combined', combined.map(fmtNum));
            // from ftso
            const ftsoVPNat: BN[] = [];
            const ftsoVPAsset: BN[] = [];
            for (const voter of voters) {
                const vp = await ftso.getVotePowerOf.call(voter);
                ftsoVPNat.push(vp[0]);
                ftsoVPAsset.push(vp[1]);
            }
            // console.log('ftsoVPAsset', ftsoVPAsset.map(fmtNum));
            // console.log('ftsoVPNat', ftsoVPNat.map(fmtNum));
            const ftsoVPCombined = await ftso.getVotePowerWeights.call(voters);
            // console.log('ftsoVPCombined', ftsoVPCombined.map(fmtNum));
            compareArrays(ftsoVPCombined.map(fmtNum), combined.map(fmtNum));
        }

        it("calculates correct vote powers (NAT)", async () => {
            await calculateCorrectVotePowers(natFtso);
        });

        it("calculates correct vote powers (NAT without fassets)", async () => {
            natFtso = await createFtso("NAT", usd(1));
            xrpFtso = await createFtso("XRP", usd(0.5));
            btcFtso = await createFtso("BTC", usd(5));
            await natFtso.setAssetFtsos([xrpFtso.address, btcFtso.address], { from: ftsoManager });
            await calculateCorrectVotePowers(natFtso);
        });

        it("calculates correct vote powers (XRP)", async () => {
            await calculateCorrectVotePowers(xrpFtso);
        });

        it("calculations work with zeros", async () => {
            // Assemble
            await initializeEpochForReveal();
            // Act
            const voters = accounts.slice(1, 5);
            const assetVP = await whitelist.getAssetVotePowerWeights.call([constants.ZERO_ADDRESS], [0], 10, voters, vpBlockNumber);
            // console.log('assetVP', assetVP.map(fmtNum));
            const nativeVP = await whitelist.getNativeVotePowerWeights.call(wNat.address, 10, voters, vpBlockNumber);
            // console.log('nativeVP', nativeVP.map(fmtNum));
            const combined = await whitelist.getVotePowerWeights.call(xrpFtso.address, voters);
            // Assert
            compareArrays(assetVP.map(x => x.toNumber()), [0, 0, 0, 0]);
            compareArrays(nativeVP.map(x => x.toNumber()), [0, 0, 0, 0]);
            compareArrays(combined.map(x => x.toNumber()), [0, 0, 0, 0]);
        });

        async function init10Voters() {
            const voters = accounts.slice(1, 11);
            const votePowers = [2, 8, 4, 5, 9, 1, 10, 3, 6, 7];
            for (let i = 0; i < 10; i++) {
                await wNat.deposit({ from: voters[i], value: eth(votePowers[i]) });
                await fxrp.mint(voters[i], eth(votePowers[i]));
                await fbtc.mint(voters[i], eth(votePowers[i]));
            }
            await initializeEpochForReveal();
            return voters;
        }

        it("add accounts to the whitelist (nat, simple)", async () => {
            // Assemble
            const ftsoIndex = 0;    // nat
            const voters = await init10Voters();
            // Act
            for (const voter of voters) {
                try {
                    await whitelist.requestWhitelistingVoter(voter, ftsoIndex);
                } catch (error: any) {
                    expect(error.message).to.contain(WHITELISTING_ERROR);
                }
            }
            // Assert
            const wl = await whitelist.getFtsoWhitelistedPriceProviders(ftsoIndex);
            const wlind = wl.map(x => voters.indexOf(x));
            // console.log(wlind);
            compareArrays(wlind, [6, 1, 8, 9, 4]);
        });

        it("add accounts to the whitelist (xrp, simple)", async () => {
            // Assemble
            const ftsoIndex = 1;    // xrp
            const voters = await init10Voters();
            // Act
            for (const voter of voters) {
                try {
                    await whitelist.requestWhitelistingVoter(voter, ftsoIndex);
                } catch (error: any) {
                    expect(error.message).to.contain(WHITELISTING_ERROR);
                }
            }
            // Assert
            const wl = await whitelist.getFtsoWhitelistedPriceProviders(ftsoIndex);
            const wlind = wl.map(x => voters.indexOf(x));
            // console.log(wlind);
            compareArrays(wlind, [6, 1, 8, 9, 4]);
        });

        it("adding accounts twice changes nothing", async () => {
            // Assemble
            const ftsoIndex = 0;    // nat
            const voters = await init10Voters();
            // Act
            for (const voter of voters) {
                try {
                    await whitelist.requestWhitelistingVoter(voter, ftsoIndex);
                } catch (error: any) {
                    expect(error.message).to.contain(WHITELISTING_ERROR);
                }
            }
            for (const voter of voters) {
                try {
                    await whitelist.requestWhitelistingVoter(voter, ftsoIndex);
                } catch (error: any) {
                    expect(error.message).to.contain(WHITELISTING_ERROR);
                }
            }
            // Assert
            const wl = await whitelist.getFtsoWhitelistedPriceProviders(ftsoIndex);
            const wlind = wl.map(x => voters.indexOf(x));
            // console.log(wlind);
            compareArrays(wlind, [6, 1, 8, 9, 4]);
        });

        it("add works even if assets have no votepower", async () => {
            // Assemble
            const ftsoIndex = 0;    // nat
            const voters = accounts.slice(1, 11);
            const votePowers = [2, 8, 4, 5, 9, 1, 10, 3, 6, 7];
            for (let i = 0; i < 10; i++) {
                await wNat.deposit({ from: voters[i], value: eth(votePowers[i]) });
            }
            await initializeEpochForReveal();
            // Act
            for (const voter of voters) {
                try {
                    await whitelist.requestWhitelistingVoter(voter, ftsoIndex);
                } catch (error: any) {
                    expect(error.message).to.contain(WHITELISTING_ERROR);
                }
            }
            // Assert
            const wl = await whitelist.getFtsoWhitelistedPriceProviders(ftsoIndex);
            const wlind = wl.map(x => voters.indexOf(x));
            // console.log(wlind);
            compareArrays(wlind, [6, 1, 8, 9, 4]);
        });

        it("add works for assetless ftsos", async () => {
            // Assemble
            const xyzFtso = await createFtso("XYZ", usd(2));
            const ftsoIndex = await registry.getFtsoIndex(await xyzFtso.symbol());
            const voters = accounts.slice(1, 11);
            const votePowers = [2, 8, 4, 5, 9, 1, 10, 3, 6, 7];
            for (let i = 0; i < 10; i++) {
                await wNat.deposit({ from: voters[i], value: eth(votePowers[i]) });
            }
            await initializeEpochForReveal();
            // Act
            await whitelist.setMaxVotersForFtso(ftsoIndex, 5, { from: governance });
            for (const voter of voters) {
                try {
                    await whitelist.requestWhitelistingVoter(voter, ftsoIndex);
                } catch (error: any) {
                    expect(error.message).to.contain(WHITELISTING_ERROR);
                }
            }
            // Assert
            const wl = await whitelist.getFtsoWhitelistedPriceProvidersBySymbol(await xyzFtso.symbol());
            const wlind = wl.map(x => voters.indexOf(x));
            // console.log(wlind);
            compareArrays(wlind, [6, 1, 8, 9, 4]);
        });

        it("add works even if assets have no native votepower", async () => {
            // Assemble
            const ftsoIndex = 0;    // nat
            const voters = accounts.slice(1, 11);
            const votePowers = [2, 8, 4, 5, 9, 1, 10, 3, 6, 7];
            for (let i = 0; i < 10; i++) {
                await fxrp.mint(voters[i], eth(votePowers[i]));
            }
            await initializeEpochForReveal();
            // Act
            for (const voter of voters) {
                try {
                    await whitelist.requestWhitelistingVoter(voter, ftsoIndex);
                } catch (error: any) {
                    expect(error.message).to.contain(WHITELISTING_ERROR);
                }
            }
            // Assert
            const wl = await whitelist.getFtsoWhitelistedPriceProviders(ftsoIndex);
            const wlind = wl.map(x => voters.indexOf(x));
            // console.log(wlind);
            compareArrays(wlind, [6, 1, 8, 9, 4]);
        });

        it("whitelist all ftsos works", async () => {
            // Assemble
            const voters = accounts.slice(1, 7);
            const votePowersNat = [2, 2, 2, 2, 2, 2];
            const votePowersXrp = [2, 8, 4, 5, 9, 1];
            const votePowersBtc = [2, 8, 4, 5, 9, 10];
            for (let i = 0; i < 6; i++) {
                await wNat.deposit({ from: voters[i], value: eth(votePowersNat[i]) });
                await fxrp.mint(voters[i], eth(votePowersXrp[i]));
                await fbtc.mint(voters[i], eth(votePowersBtc[i]));
            }
            await initializeEpochForReveal();

            // Act
            for (let i = 0; i < 5; i++) {
                let tx = await whitelist.requestFullVoterWhitelisting.call(voters[i]);
                compareNumberArrays(tx[0], [0, 1, 2]);
                compareArrays(tx[1], [true, true, true]);

                await whitelist.requestFullVoterWhitelisting(voters[i]); // actually send transaction
            }

            // Assert
            let tx = await whitelist.requestFullVoterWhitelisting.call(voters[5]);
            compareNumberArrays(tx[0], [0, 1, 2]);
            compareArrays(tx[1], [true, false, true]);
            await whitelist.requestFullVoterWhitelisting(voters[5]); // actually send transaction

            let wl = await whitelist.getFtsoWhitelistedPriceProviders(0);
            let wlind = wl.map(x => voters.indexOf(x));
            compareArrays(wlind, [5, 1, 2, 3, 4]);

            wl = await whitelist.getFtsoWhitelistedPriceProviders(1);
            wlind = wl.map(x => voters.indexOf(x));
            compareArrays(wlind, [0, 1, 2, 3, 4]);

            wl = await whitelist.getFtsoWhitelistedPriceProviders(2);
            wlind = wl.map(x => voters.indexOf(x));
            compareArrays(wlind, [5, 1, 2, 3, 4]);
        });

        it("should revert adding trusted address to whitelist", async () => {
            // Assemble
            const ftsoIndex = 0;    // nat
            const voters = await init10Voters();

            let priceSubmitterInterface = await PriceSubmitter.new();
            const getTrustedAddresses = priceSubmitterInterface.contract.methods.getTrustedAddresses().encodeABI();
            const getTrustedAddressesReturn = web3.eth.abi.encodeParameter('address[]', [voters[0]]);
            await priceSubmitter.givenCalldataReturn(getTrustedAddresses, getTrustedAddressesReturn);

            // Act
            let tx = whitelist.requestFullVoterWhitelisting(voters[0]);
            let tx2 = whitelist.requestWhitelistingVoter(voters[0], ftsoIndex);

            // Assert
            await expectRevert(tx, "trusted address");
            await expectRevert(tx2, "trusted address");
        });

        it("should remove trusted address from whitelist", async () => {
            // Assemble
            const ftsoIndex = 0;    // nat
            const voters = await init10Voters();
            await whitelist.requestWhitelistingVoter(voters[3], ftsoIndex);
            await whitelist.requestWhitelistingVoter(voters[0], ftsoIndex);

            let priceSubmitterInterface = await PriceSubmitter.new();
            const getTrustedAddresses = priceSubmitterInterface.contract.methods.getTrustedAddresses().encodeABI();
            const getTrustedAddressesReturn = web3.eth.abi.encodeParameter('address[]', [voters[0]]);
            await priceSubmitter.givenCalldataReturn(getTrustedAddresses, getTrustedAddressesReturn);

            let wl = await whitelist.getFtsoWhitelistedPriceProviders(ftsoIndex);
            let wlind = wl.map(x => voters.indexOf(x));
            compareArrays(wlind, [3, 0]);

            // Act
            // Assert
            let tx = whitelist.removeTrustedAddressFromWhitelist(voters[1], ftsoIndex);
            await expectRevert(tx, "not trusted address");
            let tx2 = whitelist.removeTrustedAddressFromWhitelist(voters[0], 1);
            await expectRevert(tx2, "trusted address not whitelisted");
            let tx3 = await whitelist.removeTrustedAddressFromWhitelist(voters[0], ftsoIndex);
            expectEvent(tx3, "VoterRemovedFromWhitelist", { voter: voters[0], ftsoIndex: eth(ftsoIndex) });

            wl = await whitelist.getFtsoWhitelistedPriceProviders(ftsoIndex);
            wlind = wl.map(x => voters.indexOf(x));
            compareArrays(wlind, [3]);
        });

        it("change whitelist size", async () => {
            // Assemble
            const ftsoIndex = 0;    // nat
            const voters = await init10Voters();
            // Act
            await whitelist.setMaxVotersForFtso(ftsoIndex, 5, { from: governance });
            for (const voter of voters.slice(0, 5)) {
                await whitelist.requestWhitelistingVoter(voter, ftsoIndex);
            }
            await expectRevert(whitelist.requestWhitelistingVoter(voters[5], ftsoIndex), WHITELISTING_ERROR)
            await whitelist.setMaxVotersForFtso(ftsoIndex, 10, { from: governance });
            for (const voter of voters.slice(6)) {
                await whitelist.requestWhitelistingVoter(voter, ftsoIndex);
            }
            // Assert
            const wl = await whitelist.getFtsoWhitelistedPriceProviders(ftsoIndex);
            const wlind = wl.map(x => voters.indexOf(x));
            // console.log(wlind);
            compareArrays(wlind, [0, 1, 2, 3, 4, 6, 7, 8, 9]);
        });

        it("decrease whitelist size", async () => {
            // Assemble
            const ftsoIndex = 0;    // nat
            const voters = await init10Voters();
            // Act
            await whitelist.setMaxVotersForFtso(ftsoIndex, 10, { from: governance });
            for (const voter of voters) {
                await whitelist.requestWhitelistingVoter(voter, ftsoIndex);
            }
            await whitelist.setMaxVotersForFtso(ftsoIndex, 5, { from: governance });
            // Assert
            const wl = await whitelist.getFtsoWhitelistedPriceProviders(ftsoIndex);
            const wlind = wl.map(x => voters.indexOf(x));
            // console.log(wlind);
            compareArrays(wlind, [8, 1, 6, 9, 4]);
        });

        it("can change default whitelist size", async () => {
            // Assemble
            // update ftso manager to some account
            await whitelist.updateContractAddresses(
                encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_REGISTRY, Contracts.FTSO_MANAGER]),
                [ADDRESS_UPDATER, registry.address, ftsoManager], {from: ADDRESS_UPDATER});
            const xyzFtso = await createFtso("XYZ", usd(2));
            const xyzFtsoIndex = await registry.getFtsoIndex(await xyzFtso.symbol());
            const abcFtso = await createFtso("ABC", usd(3));
            const abcFtsoIndex = await registry.getFtsoIndex(await abcFtso.symbol());
            // Act
            await whitelist.setDefaultMaxVotersForFtso(15, { from: governance });
            await whitelist.addFtso(xyzFtsoIndex, { from: ftsoManager });
            await whitelist.setDefaultMaxVotersForFtso(32, { from: governance });
            await whitelist.addFtso(abcFtsoIndex, { from: ftsoManager });
            // Assert
            assertNumberEqual(await whitelist.maxVotersForFtso(xyzFtsoIndex), 15);
            assertNumberEqual(await whitelist.maxVotersForFtso(abcFtsoIndex), 32);
        });

        it("remove whitelist", async () => {
            // Assemble
            const ftsoIndex = 0;    // nat
            const voters = await init10Voters();
            // Act
            await whitelist.setMaxVotersForFtso(ftsoIndex, 10, { from: governance });
            for (const voter of voters) {
                await whitelist.requestWhitelistingVoter(voter, ftsoIndex);
            }
            assertNumberEqual(await whitelist.maxVotersForFtso(ftsoIndex), 10);
            // update ftso manager temporary
            await whitelist.updateContractAddresses(
                encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_REGISTRY, Contracts.FTSO_MANAGER]),
                [ADDRESS_UPDATER, registry.address, ftsoManager], {from: ADDRESS_UPDATER});
            await whitelist.removeFtso(ftsoIndex, { from: ftsoManager });
            await whitelist.updateContractAddresses(
                encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_REGISTRY, Contracts.FTSO_MANAGER]),
                [ADDRESS_UPDATER, registry.address, ftsoManagerMock.address], {from: ADDRESS_UPDATER});
            // Assert
            await expectRevert(whitelist.getFtsoWhitelistedPriceProviders(ftsoIndex), "FTSO index not supported");
            // whitelist must be empty now
            assertNumberEqual(await whitelist.maxVotersForFtso(ftsoIndex), 0);
            await expectRevert(whitelist.requestWhitelistingVoter(voters[0], ftsoIndex),
                "FTSO index not supported");
        });

        it("should revert at get price providers for non existing index or symbol", async () => {
            // Assemble
            const ftsoIndex = 10;
            const ftsoSymbol = "MOCK";
            // Act

            // Assert
            await expectRevert(whitelist.getFtsoWhitelistedPriceProviders(ftsoIndex), "FTSO index not supported");
            await expectRevert(whitelist.getFtsoWhitelistedPriceProvidersBySymbol(ftsoSymbol), "FTSO index not supported");
        });

        it("only ftso manager can add or remove ftso", async () => {
            // Assert
            await expectRevert(whitelist.addFtso(0, { from: accounts[1] }),
                "only ftso manager");
            await expectRevert(whitelist.removeFtso(0, { from: accounts[1] }),
                "only ftso manager");
        });

        it("only address updater can set ftso registry and ftso manager", async () => {
            // Assert
            await expectRevert(whitelist.updateContractAddresses(
                encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_REGISTRY, Contracts.FTSO_MANAGER]),
                [ADDRESS_UPDATER, registry.address, ftsoManager], {from: accounts[1]}),
                "only address updater");
        });

        it("Should not add ftso twice", async () => {
            await createFtso("MOCK", usd(2));
            // update ftso manager to some account
            await whitelist.updateContractAddresses(
                encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_REGISTRY, Contracts.FTSO_MANAGER]),
                [ADDRESS_UPDATER, registry.address, ftsoManager], {from: ADDRESS_UPDATER});
            await whitelist.addFtso(3, {from: ftsoManager});
            let tx = whitelist.addFtso(3, {from: ftsoManager});
            await expectRevert(tx, "whitelist already exist");
        });

        it("only governance can change whitelist sizes", async () => {
            // Assert
            await expectRevert(whitelist.setMaxVotersForFtso(0, 10, { from: accounts[1] }),
                "only governance");
            await expectRevert(whitelist.setDefaultMaxVotersForFtso(10, { from: accounts[1] }),
                "only governance");
        });

        it("should only throw out if strictly greater", async () => {
            const ftsoIndex = 0;    // nat

            const votePowers = [10, 10, 10, 10, 12, 12, 13];
            const voters = accounts.slice(1, votePowers.length + 1);
            for (let i = 0; i < voters.length; i++) {
                // Give each one some voting power
                await wNat.deposit({ from: voters[i], value: eth(votePowers[i]) });
                await fxrp.mint(voters[i], eth(votePowers[i]));
            }
            await initializeEpochForReveal();
            await whitelist.setMaxVotersForFtso(ftsoIndex, 2, { from: governance });
            for (let i = 0; i < 3; ++i) {
                try {
                    await whitelist.requestWhitelistingVoter(voters[i], ftsoIndex);
                } catch (error: any) {
                    expect(error.message).to.contain(WHITELISTING_ERROR);
                }
            }
            let wl = await whitelist.getFtsoWhitelistedPriceProviders(ftsoIndex);
            let wlind = wl.map(x => voters.indexOf(x));
            compareArrays(wlind, [0, 1]); // 2 should not throw out anyone

            await whitelist.setMaxVotersForFtso(ftsoIndex, 3, { from: governance });

            for (let i = 0; i < 5; ++i) {
                try {
                    await whitelist.requestWhitelistingVoter(voters[i], ftsoIndex);
                } catch (error: any) {
                    expect(error.message).to.contain(WHITELISTING_ERROR);
                }
            }

            wl = await whitelist.getFtsoWhitelistedPriceProviders(ftsoIndex);
            wlind = wl.map(x => voters.indexOf(x));
            compareArrays(wlind, [0, 1, 4]);

            await whitelist.setMaxVotersForFtso(ftsoIndex, 4, { from: governance });
            await whitelist.requestWhitelistingVoter(voters[3], ftsoIndex);

            wl = await whitelist.getFtsoWhitelistedPriceProviders(ftsoIndex);
            wlind = wl.map(x => voters.indexOf(x));
            compareArrays(wlind, [0, 1, 4, 3]);
        });

        it("should only list once per address", async () => {
            const ftsoIndex = 0;    // nat

            const votePowers = [10, 10, 10, 10, 12, 12, 13];
            const voters = accounts.slice(1, votePowers.length + 1);
            for (let i = 0; i < voters.length; i++) {
                // Give each one some voting power
                await wNat.deposit({ from: voters[i], value: eth(votePowers[i]) });
                await fxrp.mint(voters[i], eth(votePowers[i]));
            }
            await initializeEpochForReveal();

            await whitelist.setMaxVotersForFtso(ftsoIndex, 3, { from: governance });

            let tx = await whitelist.requestWhitelistingVoter(voters[3], ftsoIndex);
            expectEvent(tx, "VoterWhitelisted", { voter: voters[3], ftsoIndex: eth(ftsoIndex) });
            tx = await whitelist.requestWhitelistingVoter(voters[3], ftsoIndex);
            expectEvent.notEmitted(tx, "VoterWhitelisted");

            let wl = await whitelist.getFtsoWhitelistedPriceProviders(ftsoIndex);
            let wlind = wl.map(x => voters.indexOf(x));
            compareArrays(wlind, [3]); // Should not be added twice
            // At least 2 more should be added 

            tx = await whitelist.requestWhitelistingVoter(voters[5], ftsoIndex);
            expectEvent(tx, "VoterWhitelisted", { voter: voters[5], ftsoIndex: eth(ftsoIndex) });
            tx = await whitelist.requestWhitelistingVoter(voters[4], ftsoIndex);
            expectEvent(tx, "VoterWhitelisted", { voter: voters[4], ftsoIndex: eth(ftsoIndex) });

            wl = await whitelist.getFtsoWhitelistedPriceProviders(ftsoIndex);
            wlind = wl.map(x => voters.indexOf(x));
            compareArrays(wlind, [3, 5, 4]);

            tx = await whitelist.requestWhitelistingVoter(voters[6], ftsoIndex);
            expectEvent(tx, "VoterRemovedFromWhitelist", { voter: voters[3], ftsoIndex: eth(ftsoIndex) });
            expectEvent(tx, "VoterWhitelisted", { voter: voters[6], ftsoIndex: eth(ftsoIndex) });

            wl = await whitelist.getFtsoWhitelistedPriceProviders(ftsoIndex);
            wlind = wl.map(x => voters.indexOf(x));
            compareArrays(wlind, [6, 5, 4]);
        });

        it("should work with zero total power nat", async () => {
            const ftsoIndex = 0;    // nat
            const votePowers = [10, 10, 10, 10, 12, 12, 13];
            const voters = accounts.slice(1, votePowers.length + 1);
            for (let i = 0; i < voters.length; i++) {
                // Give each one some voting power, but nothing to xasset
                await wNat.deposit({ from: voters[i], value: eth(votePowers[i]) });
            }
            await initializeEpochForReveal();
            // Act
            await whitelist.setMaxVotersForFtso(0, 1, { from: governance });
            let tx = await whitelist.requestWhitelistingVoter(accounts[10], ftsoIndex);
            expectEvent(tx, "VoterWhitelisted", { voter: accounts[10], ftsoIndex: eth(ftsoIndex) });
            await expectRevert(whitelist.requestWhitelistingVoter(accounts[11], ftsoIndex), WHITELISTING_ERROR);
        });

        it("should work with zero total power xasset", async () => {
            const ftsoIndex = 0;    // nat
            const votePowers = [10, 10, 10, 10, 12, 12, 13];
            const voters = accounts.slice(1, votePowers.length + 1);
            for (let i = 0; i < voters.length; i++) {
                // Give each one some voting power, but no native
                await fxrp.mint(voters[i], eth(votePowers[i]));
            }
            await initializeEpochForReveal();
            // Act
            await whitelist.setMaxVotersForFtso(0, 1, { from: governance });
            await whitelist.requestWhitelistingVoter(accounts[10], ftsoIndex);
            await expectRevert(whitelist.requestWhitelistingVoter(accounts[11], ftsoIndex), WHITELISTING_ERROR);
        });

        it("should emit on kicking out", async () => {
            const ftsoIndex = 0;    // nat
            const votePowers = [15, 8, 14, 10, 12, 11, 13];
            const voters = accounts.slice(1, votePowers.length + 1);
            for (let i = 0; i < voters.length; i++) {
                // Give each one some voting
                await wNat.deposit({ from: voters[i], value: eth(votePowers[i]) });
                await fxrp.mint(voters[i], eth(votePowers[i]));
            }
            await initializeEpochForReveal();
            // Act
            await whitelist.setMaxVotersForFtso(0, 7, { from: governance });

            for (let i = 0; i < 7; ++i) {
                const tx = await whitelist.requestWhitelistingVoter(voters[i], ftsoIndex);
                expectEvent(tx, "VoterWhitelisted", { voter: voters[i], ftsoIndex: eth(ftsoIndex) });
            }

            let wl = await whitelist.getFtsoWhitelistedPriceProviders(ftsoIndex);
            let wlind = wl.map(x => voters.indexOf(x));
            compareArrays(wlind, [0, 1, 2, 3, 4, 5, 6]);

            let tx = await whitelist.setMaxVotersForFtso(0, 5, { from: governance });
            expectEvent(tx, "VoterRemovedFromWhitelist", { voter: voters[1], ftsoIndex: eth(ftsoIndex) });
            expectEvent(tx, "VoterRemovedFromWhitelist", { voter: voters[3], ftsoIndex: eth(ftsoIndex) });

            await whitelist.setMaxVotersForFtso(0, 6, { from: governance });
            tx = await whitelist.setMaxVotersForFtso(0, 2, { from: governance });
            expectEvent(tx, "VoterRemovedFromWhitelist", { voter: voters[5], ftsoIndex: eth(ftsoIndex) });
            expectEvent(tx, "VoterRemovedFromWhitelist", { voter: voters[4], ftsoIndex: eth(ftsoIndex) });
            expectEvent(tx, "VoterRemovedFromWhitelist", { voter: voters[6], ftsoIndex: eth(ftsoIndex) });

        });

        it("only governance can copy whitelist", async () => {
            // Assert
            await expectRevert(whitelist.copyWhitelist(1, { from: accounts[1] }), "only governance");
            await expectRevert(whitelist.turnOffCopyMode( { from: accounts[1] }), "only governance");
        });

        it("should only copy whitelisted voters when in copy mode", async () => {
            // Assemble
            const ftsoIndex = 0;    // nat
            const voters = await init10Voters();
            // Act
            for (const voter of voters) {
                try {
                    await whitelist.requestWhitelistingVoter(voter, ftsoIndex);
                } catch (error: any) {
                    expect(error.message).to.contain(WHITELISTING_ERROR);
                }
            }
            
            const VoterWhitelister = artifacts.require("VoterWhitelister");
            const voterWhitelister = await VoterWhitelister.new(governance, ADDRESS_UPDATER, priceSubmitter.address, 10, whitelist.address);
            assert.equal(await voterWhitelister.oldVoterWhitelister(), whitelist.address);
            assert.isTrue(await voterWhitelister.copyMode());
            let wl1 = await voterWhitelister.getFtsoWhitelistedPriceProviders(ftsoIndex);
            let wlind1 = wl1.map(x => voters.indexOf(x));
            compareArrays(wlind1, [6, 1, 8, 9, 4]);
            await voterWhitelister.copyWhitelist(ftsoIndex, { from: governance });
            await expectRevert(voterWhitelister.requestWhitelistingVoter(voters[0], ftsoIndex), "copy mode");
            await expectRevert(voterWhitelister.copyWhitelist(ftsoIndex, { from: governance }), "already copied");
            let wl2 = await voterWhitelister.getFtsoWhitelistedPriceProviders(ftsoIndex);
            let wlind2 = wl2.map(x => voters.indexOf(x));
            compareArrays(wlind2, [6, 1, 8, 9, 4]);

            await voterWhitelister.turnOffCopyMode({from: governance});
            await expectRevert(voterWhitelister.copyWhitelist(ftsoIndex, { from: governance }), "not in copy mode");
            await expectRevert(voterWhitelister.turnOffCopyMode({ from: governance }), "not in copy mode");
            assert.isFalse(await voterWhitelister.copyMode());
            
            // Assert
            assert.equal((await voterWhitelister.maxVotersForFtso(ftsoIndex)).toNumber(), 5);
            let wl3 = await voterWhitelister.getFtsoWhitelistedPriceProviders(ftsoIndex);
            let wlind3 = wl3.map(x => voters.indexOf(x));
            // console.log(wlind);
            compareArrays(wlind3, [6, 1, 8, 9, 4]);
        });

        it("only governance can chill voter", async () => {
            // Assert
            await expectRevert(whitelist.chillVoter(accounts[0], 1, [0], { from: accounts[1] }),
                "only governance");
        });

        it("should chill voter for one reward epoch", async () => {
            const ftsoIndex = 0;    // nat
            const votePowers = [15, 8, 14, 10, 12, 11, 13];
            const voters = accounts.slice(1, votePowers.length + 1);
            for (let i = 0; i < voters.length; i++) {
                // Give each one some voting
                await wNat.deposit({ from: voters[i], value: eth(votePowers[i]) });
                await fxrp.mint(voters[i], eth(votePowers[i]));
            }
            await initializeEpochForReveal();
            
            let trustedAddress = accounts[20];
            let priceSubmitterInterface = await PriceSubmitter.new();
            const getTrustedAddresses = priceSubmitterInterface.contract.methods.getTrustedAddresses().encodeABI();
            const getTrustedAddressesReturn = web3.eth.abi.encodeParameter('address[]', [trustedAddress]);
            await priceSubmitter.givenCalldataReturn(getTrustedAddresses, getTrustedAddressesReturn);

            // Act
            await whitelist.setMaxVotersForFtso(0, 7, { from: governance });

            for (let i = 0; i < 7; ++i) {
                const tx = await whitelist.requestWhitelistingVoter(voters[i], ftsoIndex);
                expectEvent(tx, "VoterWhitelisted", { voter: voters[i], ftsoIndex: eth(ftsoIndex) });
            }

            let wl = await whitelist.getFtsoWhitelistedPriceProviders(ftsoIndex);
            let wlind = wl.map(x => voters.indexOf(x));
            compareArrays(wlind, [0, 1, 2, 3, 4, 5, 6]);

            const getCurrentRewardEpoch = web3.utils.sha3("getCurrentRewardEpoch()")!.slice(0, 10); // first 4 bytes is function selector
            await ftsoManagerMock.givenMethodReturnUint(getCurrentRewardEpoch, 1);
            let tx = await whitelist.chillVoter(voters[0], 0, [ftsoIndex], { from: governance });
            expectEvent.notEmitted(tx, "VoterRemovedFromWhitelist");
            expectEvent(tx, "VoterChilled", { voter: voters[0], untilRewardEpoch: toBN(1)});
            let tx1 = await whitelist.chillVoter(voters[1], 1, [ftsoIndex], { from: governance });
            expectEvent(tx1, "VoterRemovedFromWhitelist", { voter: voters[1], ftsoIndex: eth(ftsoIndex) });
            expectEvent(tx1, "VoterChilled", { voter: voters[1], untilRewardEpoch: toBN(2)});
            assert.equal((await whitelist.chilledUntilRewardEpoch(voters[1])).toNumber(), 2);

            let wl2 = await whitelist.getFtsoWhitelistedPriceProviders(ftsoIndex);
            let wlind2 = wl2.map(x => voters.indexOf(x));
            compareArrays(wlind2, [0, 6, 2, 3, 4, 5]);

            const promise = whitelist.chillVoter(trustedAddress, 1, [ftsoIndex], { from: governance });
            await expectRevert(promise, "trusted address");
            const promise1 = whitelist.requestWhitelistingVoter(voters[1], ftsoIndex);
            await expectRevert(promise1, "voter chilled");
            const promise2 = whitelist.requestFullVoterWhitelisting(voters[1]);
            await expectRevert(promise2, "voter chilled");

            await ftsoManagerMock.givenMethodReturnUint(getCurrentRewardEpoch, 2);
            const tx2 = await whitelist.requestWhitelistingVoter(voters[1], ftsoIndex);
            expectEvent(tx2, "VoterWhitelisted", { voter: voters[1], ftsoIndex: eth(ftsoIndex) });
        });
    });

    describe.skip("Benchmarking nat with 5 ftso tests", async () => {
        let assetData: Array<[name: string, symbol: string, price: BN]> = [
            ["Ripple", "XRP", usd(0.5)],
            ["Bitcoin", "BTC", usd(5)],
            ["Ethereum", "ETH", usd(2)],
            ["Dodge", "DOGE", usd(0.2)],
            ["Polkadot", "DOT", usd(1.5)],
        ]

        let assets: VPTokenMockInstance[];
        let ftsos: SimpleMockFtsoInstance[];

        beforeEach(async () => {
            priceSubmitter = await PriceSubmitter.new();
            // create registry
            ftsoRegistry = await FtsoRegistry.new();
            ftsoRegistryProxy = await FtsoRegistryProxy.new(accounts[0], ftsoRegistry.address);
            registry = await FtsoRegistry.at(ftsoRegistryProxy.address);
            await registry.initialiseRegistry(ADDRESS_UPDATER);
            await registry.updateContractAddresses(
                encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_MANAGER]),
                [ADDRESS_UPDATER, ftsoManager], {from: ADDRESS_UPDATER});
            // create assets
            wNat = await WNat.new(governance, "Wrapped NAT", "WNAT");
            await setDefaultVPContract(wNat, governance);
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
                await ftso.setAsset(assets[i].address, { from: ftsoManager });
                ftsos.push(ftso);
            }
            await natFtso.setAssetFtsos(ftsos.map(f => f.address), { from: ftsoManager });
            // create whitelist
            whitelist = await VoterWhitelister.new(governance, ADDRESS_UPDATER, priceSubmitter.address, 10);
            ftsoManagerMock = await MockContract.new();
            await whitelist.updateContractAddresses(
                encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_REGISTRY, Contracts.FTSO_MANAGER]),
                [ADDRESS_UPDATER, registry.address, ftsoManagerMock.address], {from: ADDRESS_UPDATER});
            await priceSubmitter.initialiseFixedAddress();
            await priceSubmitter.setAddressUpdater(ADDRESS_UPDATER, { from: GOVERNANCE_GENESIS_ADDRESS});
            await priceSubmitter.updateContractAddresses(
                encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_REGISTRY, Contracts.FTSO_MANAGER, Contracts.VOTER_WHITELISTER]),
                [ADDRESS_UPDATER, registry.address, ftsoManager, whitelist.address], {from: ADDRESS_UPDATER});
        });

        async function addAccountsToWhitelist(ftsoIndex: number, maxWhitelistLength: number, votePowers: number[]) {
            // Assemble
            const voters = accounts.slice(100, 100 + votePowers.length);
            for (let i = 0; i < votePowers.length; i++) {
                await wNat.deposit({ from: voters[i], value: eth(votePowers[i]) });
                for (const asset of assets) {
                    await asset.mint(voters[i], eth(votePowers[i]));
                }
            }
            await whitelist.setMaxVotersForFtso(ftsoIndex, maxWhitelistLength, { from: governance });
            await initializeEpochForReveal();
            // warm cache
            for (const voter of voters) {
                for (const asset of assets) {
                    await asset.votePowerOfAtCached(voter, vpBlockNumber);
                }
            }
            // Act
            for (const voter of voters) {
                try {
                    await whitelist.requestWhitelistingVoter(voter, ftsoIndex);
                } catch (error: any) {
                    expect(error.message).to.contain(WHITELISTING_ERROR);
                }
            }
            // simulate
            const simVoters = Array.from({ length: voters.length }, (_, i) => i);
            const simList: number[] = [];
            for (const voter of simVoters) {
                if (simList.length < maxWhitelistLength) {
                    simList.push(voter);
                } else {
                    let minIndex = 0;
                    for (let i = 0; i < simList.length; i++) {
                        if (votePowers[simList[i]] <= votePowers[simList[minIndex]]) {
                            minIndex = i;
                        }
                    }
                    if (votePowers[simList[minIndex]] < votePowers[voter]) {
                        simList[minIndex] = voter;
                    }
                }
            }
            // Assert
            const wl = await whitelist.getFtsoWhitelistedPriceProviders(ftsoIndex);
            const wlind = wl.map(x => voters.indexOf(x));
            compareArrays(wlind, simList);
        }

        it("add accounts to the whitelist (NAT)", async () => {
            const votePowers = Array.from({ length: 200 }, (_, i) => Math.random() * 100);
            await addAccountsToWhitelist(0, 100, votePowers);
        });

        it("add accounts to the whitelist (XRP)", async () => {
            const votePowers = Array.from({ length: 200 }, (_, i) => Math.random() * 100);
            await addAccountsToWhitelist(1, 100, votePowers);
        });

        async function batchReadVotepowers(batchSize: number, cached: boolean) {
            // Assemble
            const votePowers = Array.from({ length: batchSize }, (_, i) => Math.random() * 100);
            const voters = accounts.slice(100, 100 + votePowers.length);
            for (let i = 0; i < votePowers.length; i++) {
                await wNat.deposit({ from: voters[i], value: eth(votePowers[i]) });
                for (const asset of assets) {
                    await asset.mint(voters[i], eth(votePowers[i]));
                }
            }
            const allAssets = [wNat, ...assets];
            await initializeEpochForReveal();
            // Act
            if (cached) {
                for (const voter of voters) {
                    for (const asset of allAssets) {
                        await asset.votePowerOfAtCached(voter, vpBlockNumber);
                    }
                }
            }
            // Assert
            for (const asset of allAssets) {
                await whitelist.getVotePowers(asset.address, voters, vpBlockNumber);
            }
        }

        it("batch read the votepowers (non-cached)", async () => {
            await batchReadVotepowers(100, false);
        });

        it("batch read the votepowers (cached)", async () => {
            await batchReadVotepowers(100, true);
        });

        async function decreaseWhitelistLength(ftsoIndex: number, maxWhitelistLength: number, minWhitelistLength: number, votePowers: number[]) {
            // Assemble
            const voters = accounts.slice(100, 100 + votePowers.length);
            for (let i = 0; i < votePowers.length; i++) {
                await wNat.deposit({ from: voters[i], value: eth(votePowers[i]) });
                for (const asset of assets) {
                    await asset.mint(voters[i], eth(votePowers[i]));
                }
            }
            await whitelist.setMaxVotersForFtso(ftsoIndex, maxWhitelistLength, { from: governance });
            await initializeEpochForReveal();
            // warm cache
            for (const voter of voters) {
                for (const asset of assets) {
                    await asset.votePowerOfAtCached(voter, vpBlockNumber);
                }
            }
            for (const voter of voters) {
                try {
                    await whitelist.requestWhitelistingVoter(voter, ftsoIndex);
                } catch (error: any) {
                    expect(error.message).to.contain(WHITELISTING_ERROR);
                }
            }
            // Act
            await whitelist.setMaxVotersForFtso(ftsoIndex, minWhitelistLength, { from: governance });
            // simulate
            const simVoters = Array.from({ length: voters.length }, (_, i) => i);
            const pairs = simVoters.map((v, i) => [v, votePowers[i]] as const);
            pairs.sort((a, b) => b[1] - a[1]);  // sort decreasing
            pairs.splice(minWhitelistLength, pairs.length - minWhitelistLength);
            const simList = pairs.map(p => p[0]);
            // Assert
            const wl = await whitelist.getFtsoWhitelistedPriceProviders(ftsoIndex);
            const wlind = wl.map(x => voters.indexOf(x));
            // console.log(wlind);
            // console.log(simList);
            compareSets(wlind, simList);
        }

        it("decrease whitelist size (nat)", async () => {
            const votePowers = Array.from({ length: 100 }, (_, i) => Math.random() * 100);
            await decreaseWhitelistLength(0, 100, 50, votePowers);
        });

        it("decrease whitelist size (xrp)", async () => {
            const votePowers = Array.from({ length: 100 }, (_, i) => Math.random() * 100);
            await decreaseWhitelistLength(1, 100, 50, votePowers);
        });
    });
});
