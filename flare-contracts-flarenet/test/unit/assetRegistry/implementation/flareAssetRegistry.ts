import { FlareAssetRegistryInstance, AssetTokenInstance, FlareAssetRegistryProviderMockInstance } from "../../../../typechain-truffle";
import { expectRevert } from "@openzeppelin/test-helpers";

const getTestFile = require('../../../utils/constants').getTestFile;

const providerHash = "0x1a66a1d3746f9d4e372c8aa6446ef8663110789183522aefde075d45e150a733" // keccak(BTCETHAVA)
const providerHash2 = "0x6695a23a8eec5bf76460d7435e19723a16fca7c06050b3f58040db6fc031435a" // keccak(FLRXRP)
const providerHash3 = "0x345e9fde188a1e5067b7ce7c18bf0bb31673dcc643494cdcad4e9e741f32c040" // keccak(FLRSOL)

const MAX_DELEGATES_BY_PERCENT = web3.utils.keccak256("MaxDelegatesByPercent");
const INCENTIVE_POOL = web3.utils.keccak256("IncentivePool");
const NON_EXISTENT = web3.utils.keccak256("NonExistent")

const SYMBOL_ALREADY_USED_MSG = "symbol already used";
const HAS_REGISTERED_ASSETS_MSG = "has registered assets";
const REGISTERED_BY_ANOTHER_PROVIDER_MSG = "registered by other provider";
const ONLY_PROVIDER_MSG = "only provider";
const UNKNOWN_PROVIDER_MSG = "unknown provider";
const INVALID_TOKEN_ADDRESS_MSG = "invalid token address";
const ASSET_TYPE_REGISTERED_MSG = "asset type already registered";
const INVALID_ASSET_TYPE_MSG = "invalid asset type";

const FlareAssetRegistry = artifacts.require("FlareAssetRegistry");
const AssetToken = artifacts.require("AssetToken");
const FlareAssetRegistryProviderMock = artifacts.require("FlareAssetRegistryProviderMock");

contract(`FlareAssetRegistry.sol; ${getTestFile(__filename)}; Flare asset registry unit tests`, async accounts => {
    const governance = accounts[0];
    let flareAssetRegistry: FlareAssetRegistryInstance;
    let assetTokens: AssetTokenInstance[];
    let flareAssetRegistryProvider: FlareAssetRegistryProviderMockInstance;
    let assetTokens2: AssetTokenInstance[];
    let flareAssetRegistryProvider2: FlareAssetRegistryProviderMockInstance;

    beforeEach(async () => {
        flareAssetRegistry = await FlareAssetRegistry.new(governance);
        assetTokens = [
            await AssetToken.new(governance, "Bitcoin", "BTC", 18),
            await AssetToken.new(governance, "Ethereum", "ETH", 18),
            await AssetToken.new(governance, "Avalanche", "AVA", 9)
        ];
        flareAssetRegistryProvider = await FlareAssetRegistryProviderMock.new(
            providerHash, assetTokens.map(x => x.address), flareAssetRegistry.address);
        assetTokens2 = [
            await AssetToken.new(governance, "Flare", "FLR", 18),
            await AssetToken.new(governance, "Ripple", "XRP", 18)
        ]
        flareAssetRegistryProvider2 = await FlareAssetRegistryProviderMock.new(
            providerHash2, assetTokens2.map(x => x.address), flareAssetRegistry.address);
    });

    describe("Registering provider(s)", async () => {

        it("Should register provider with assets", async () => {
            await flareAssetRegistry.registerProvider(flareAssetRegistryProvider.address, true);
            const assets = await flareAssetRegistry.allAssets();
            expect(assets.length).to.equal(assetTokens.length);
            for (let i = 0; i < assetTokens.length; i++)
                expect(assets[i]).to.equal(assetTokens[i].address);
        });
        
        it("Should register provider two times", async () => {
            await flareAssetRegistry.registerProvider(flareAssetRegistryProvider.address, true);
            await flareAssetRegistry.registerProvider(flareAssetRegistryProvider.address, true);
        });

        it("Should register provider without assets", async () => {
            await flareAssetRegistry.registerProvider(flareAssetRegistryProvider.address, false);
            const assets = await flareAssetRegistry.allAssets();
            expect(assets.length).to.equal(0);
        });

        it("Should unregister provider with assets", async () => {
            await flareAssetRegistry.registerProvider(flareAssetRegistryProvider.address, true);
            await flareAssetRegistry.unregisterProvider(flareAssetRegistryProvider.address, true);
            const assets = await flareAssetRegistry.allAssets();
            expect(assets.length).to.equal(0);
        });

        it("Should unregister provider without assets", async () => {
            await flareAssetRegistry.registerProvider(flareAssetRegistryProvider.address, false);
            await flareAssetRegistry.unregisterProvider(flareAssetRegistryProvider.address, false);
        });

        it("Should fail at unregistering provider with assets", async () => {
            await flareAssetRegistry.registerProvider(flareAssetRegistryProvider.address, true);
            const prms = flareAssetRegistry.unregisterProvider(flareAssetRegistryProvider.address, false);
            await expectRevert(prms, HAS_REGISTERED_ASSETS_MSG);
        });

        it("Should fail at two providers registering one same token", async () => {
            const assetTokens3 = [
                await AssetToken.new(governance, "Flare", "FLR", 18),
                await AssetToken.new(governance, "Solana", "SOL", 18)
            ]
            const flareAssetRegistryProvider3 = await FlareAssetRegistryProviderMock.new(
                providerHash3, assetTokens3.map(x => x.address), flareAssetRegistry.address);
            await flareAssetRegistry.registerProvider(flareAssetRegistryProvider2.address, true);
            const resp = flareAssetRegistry.registerProvider(flareAssetRegistryProvider3.address, true);
            await expectRevert(resp, SYMBOL_ALREADY_USED_MSG);
        });

        it("Should fail at one provider unregistring another provider's token", async () => {
            await flareAssetRegistry.registerProvider(flareAssetRegistryProvider.address, true);
            await flareAssetRegistry.registerProvider(flareAssetRegistryProvider2.address, true);
            const resp = flareAssetRegistryProvider2.unregisterAsset(assetTokens[0].address);
            await expectRevert(resp, REGISTERED_BY_ANOTHER_PROVIDER_MSG);
        });

        it("Should unregister an unregistered provider", async () => {
            await flareAssetRegistry.unregisterProvider(flareAssetRegistryProvider.address, true);
            const resp = await flareAssetRegistry.allAssetTypes();
            expect(resp.length).to.equal(0);
        });

        it("Should register two providers and then unregister them", async () => {
            await flareAssetRegistry.registerProvider(flareAssetRegistryProvider.address, true);
            await flareAssetRegistry.registerProvider(flareAssetRegistryProvider2.address, true);
            await flareAssetRegistry.unregisterProvider(flareAssetRegistryProvider.address, true);
            await flareAssetRegistry.unregisterProvider(flareAssetRegistryProvider2.address, true);
            const resp = await flareAssetRegistry.allAssetTypes();
            expect(resp.length).to.equal(0);
            // register, unregister in different order to achieve full coverage
            await flareAssetRegistry.registerProvider(flareAssetRegistryProvider.address, true);
            await flareAssetRegistry.registerProvider(flareAssetRegistryProvider2.address, true);
            await flareAssetRegistry.unregisterProvider(flareAssetRegistryProvider2.address, true);
            await flareAssetRegistry.unregisterProvider(flareAssetRegistryProvider.address, true);
            const resp2 = await flareAssetRegistry.allAssetTypes();
            expect(resp2.length).to.equal(0);
        });
    });

    describe("Registering assets", async () => {

        it("Should revert registering an asset if provider is not registered", async () => {
            const resp = flareAssetRegistry.registerAsset(assetTokens[0].address);
            await expectRevert(resp, ONLY_PROVIDER_MSG);
        });

        it("Should refresh provider's assets", async () => {
            await flareAssetRegistry.registerProvider(flareAssetRegistryProvider.address, false);
            await flareAssetRegistry.refreshProviderAssets(flareAssetRegistryProvider.address);
            const assets = await flareAssetRegistry.allAssets();
            expect(assets.length).to.equal(assetTokens.length);
            for (let i = 0; i < assetTokens.length; i++)
                expect(assets[i]).to.equal(assetTokens[i].address);
        });

        it("Should register a new asset", async () => {
            await flareAssetRegistry.registerProvider(flareAssetRegistryProvider.address, false);
            await flareAssetRegistryProvider.registerAsset(assetTokens[1].address);
            const assets = await flareAssetRegistry.allAssets();
            expect(assets.length).to.equal(1);
            expect(assets[0]).to.equal(assetTokens[1].address);
        });

        it("Should unregister an asset", async () => {
            await flareAssetRegistry.registerProvider(flareAssetRegistryProvider.address, true);
            await flareAssetRegistryProvider.unregisterAsset(assetTokens[assetTokens.length-1].address);
            let assets = await flareAssetRegistry.allAssets();
            expect(assets.length).to.equal(assetTokens.length-1);
            for (let i = 0; i < assetTokens.length-1; i++) 
                expect(assets[i]).to.equal(assetTokens[i].address);
        });

        it("Should fail at refreshing unregistered provider's assets", async () => {
            const prms = flareAssetRegistry.refreshProviderAssets(flareAssetRegistryProvider.address);
            await expectRevert(prms, UNKNOWN_PROVIDER_MSG);
        });

        it("Should do nothing when unregistering an unregistered asset", async () => {
            await flareAssetRegistry.registerProvider(flareAssetRegistryProvider.address, true);
            await flareAssetRegistry.unregisterAsset("0x0000000000000000000000000000000000000000");
            const assets = await flareAssetRegistry.allAssets();
            expect(assets.length).to.equal(assetTokens.length);
            for (let i = 0; i < assetTokens.length; i++)
                expect(assets[i]).to.equal(assetTokens[i].address);
        });

        it("Should fail at registering providers with same name", async () => {
            await flareAssetRegistry.registerProvider(flareAssetRegistryProvider.address, true);
            const flareAssetRegistryProvider3 = await FlareAssetRegistryProviderMock.new(
                providerHash, assetTokens2.map(x => x.address), flareAssetRegistry.address);
            const prms = flareAssetRegistry.registerProvider(flareAssetRegistryProvider3.address, false);
            await expectRevert(prms, ASSET_TYPE_REGISTERED_MSG);
        });

        it("Should register the same asset twice", async () => {
            await flareAssetRegistry.registerProvider(flareAssetRegistryProvider.address, false);
            await flareAssetRegistryProvider.registerAsset(assetTokens[0].address);
            await flareAssetRegistryProvider.registerAsset(assetTokens[0].address);
            const assets = await flareAssetRegistry.allAssets();
            expect(assets.length).to.equal(1);
            expect(assets[0]).to.equal(assetTokens[0].address);
        });

        it("Should fail at registering two tokens by the same provider", async () => {
            const flareAssetRegistryProvider3 = await FlareAssetRegistryProviderMock.new(
                providerHash3, [assetTokens[0].address], flareAssetRegistry.address);
            await flareAssetRegistry.registerProvider(flareAssetRegistryProvider.address, true);
            await flareAssetRegistry.registerProvider(flareAssetRegistryProvider3.address, false);
            const prms = flareAssetRegistryProvider3.registerAsset(assetTokens[0].address);
            await expectRevert(prms, REGISTERED_BY_ANOTHER_PROVIDER_MSG);
        });

    });

    describe("Fetching data", async () => {

        it("Should fetch asset types and symbols", async () => {
            const resp1 = await flareAssetRegistry.assetBySymbol("BTC");
            expect(resp1).to.equal("0x0000000000000000000000000000000000000000");
            const resp2 = await flareAssetRegistry.assetType(assetTokens[0].address);
            expect(resp2).to.equal("0x0000000000000000000000000000000000000000000000000000000000000000");
            await flareAssetRegistry.registerProvider(flareAssetRegistryProvider.address, true);
            const resp3 = await flareAssetRegistry.assetBySymbol("BTC");
            expect(resp3).to.equal(assetTokens[0].address);
            const resp4 = await flareAssetRegistry.assetType(assetTokens[0].address);
            expect(resp4).to.equal(providerHash);
        });

        it("Should fetch all assets of given type", async () => {
            await flareAssetRegistry.registerProvider(flareAssetRegistryProvider.address, true);
            await flareAssetRegistry.registerProvider(flareAssetRegistryProvider2.address, true);
            const assets = await flareAssetRegistry.allAssetsOfType(providerHash);
            expect(assets.length).to.equal(assetTokens.length);
            for (let i = 0; i < assetTokens.length; i++)
                expect(assets[i]).to.equal(assetTokens[i].address);
        });

        it("Should fetch all assets of given type with symbols", async () => {
            await flareAssetRegistry.registerProvider(flareAssetRegistryProvider.address, true);
            await flareAssetRegistry.registerProvider(flareAssetRegistryProvider2.address, true);
            const assets = await flareAssetRegistry.allAssetsOfTypeWithSymbols(providerHash);
            expect(assets[0].length).to.equal(assetTokens.length);
            const symbols = ["BTC", "ETH", "AVA"];
            for (let i = 0; i < assetTokens.length; i++) {
                expect(assets[0][i]).to.equal(assetTokens[i].address)
                expect(assets[1][i]).to.equal(symbols[i]);
            }
        });

        it("Should test whether token is flare asset", async () => {
            await flareAssetRegistry.registerProvider(flareAssetRegistryProvider.address, false);
            await flareAssetRegistryProvider.registerAsset(assetTokens[0].address);
            const resp1 = await flareAssetRegistry.isFlareAsset(assetTokens[0].address);
            expect(resp1).to.equal(true);
            const resp2 = await flareAssetRegistry.isFlareAsset(assetTokens[1].address);
            expect(resp2).to.equal(false);
        });

        it("Should fech asset type list", async () => {
            await flareAssetRegistry.registerProvider(flareAssetRegistryProvider.address, true);
            await flareAssetRegistry.registerProvider(flareAssetRegistryProvider2.address, true);
            const assetTypes = await flareAssetRegistry.allAssetTypes();
            expect(assetTypes.length).to.equal(2);
            expect(assetTypes[0]).to.equal(providerHash);
            expect(assetTypes[1]).to.equal(providerHash2);
        });

        it("Should fetch all assets with their symbols", async () => {
            const symbols = ['BTC', 'ETH', 'AVA'];
            await flareAssetRegistry.registerProvider(flareAssetRegistryProvider.address, true);
            const { 0: addr, 1: syms } = await flareAssetRegistry.allAssetsWithSymbols();
            for (let i = 0; i < assetTokens.length; i++) {
                expect(addr[i]).to.equal(assetTokens[i].address);
                expect(syms[i]).to.equal(symbols[i]);
            }
        });

        it("Should fail at fetching assets of an unregistered asset type", async () => {
            await flareAssetRegistry.registerProvider(flareAssetRegistryProvider.address, true);
            const prms = flareAssetRegistry.allAssetsOfType(providerHash2);
            await expectRevert(prms, INVALID_ASSET_TYPE_MSG);
        });

    });

    describe("Getting attributes", async () => {

        it("Should get attributes", async () => {
            await flareAssetRegistry.registerProvider(flareAssetRegistryProvider.address, true);
            const resp1 = await flareAssetRegistry.getAttribute(assetTokens[1].address, MAX_DELEGATES_BY_PERCENT);
            expect(resp1[0]).to.equal(true);
            expect(resp1[1]).to.equal("0x000000000000000000000000000000000000000000000000000000000000000a");
            const resp2 = await flareAssetRegistry.getAttribute(assetTokens[0].address, INCENTIVE_POOL);
            expect(resp2[0]).to.equal(true);
            expect(resp2[1]).to.equal("0x0000000000000000000000000000000000000000000000000000000000000001");
            const resp3 = await flareAssetRegistry.getAttribute(assetTokens[0].address, NON_EXISTENT);
            expect(resp3[0]).to.equal(false);
            expect(resp3[1]).to.equal("0x0000000000000000000000000000000000000000000000000000000000000000");
        });

        it("Should check if token supports ftso delegation", async () => {
            await flareAssetRegistry.registerProvider(flareAssetRegistryProvider.address, true);
            const resp = await flareAssetRegistry.supportsFtsoDelegation(assetTokens[0].address);
            expect(resp).to.equal(true);
        });

        it("Should fetch max delegates by percent", async () => {
            await flareAssetRegistry.registerProvider(flareAssetRegistryProvider.address, true);
            const resp = await flareAssetRegistry.maxDelegatesByPercent(assetTokens[0].address);
            expect(resp.toString()).to.equal("10");
        });

        it("Should fetch incentive pool", async () => {
            await flareAssetRegistry.registerProvider(flareAssetRegistryProvider.address, true);
            const resp = await flareAssetRegistry.incentivePoolFor(assetTokens[0].address);
            expect(resp).to.equal("0x0000000000000000000000000000000000000001");
        });

        it("Should fail at getting attributes of an unregistered token", async () => {
            const prms = flareAssetRegistry.getAttribute("0x0000000000000000000000000000000000000000", INCENTIVE_POOL);
            await expectRevert(prms, INVALID_TOKEN_ADDRESS_MSG);
        })

    });
});
