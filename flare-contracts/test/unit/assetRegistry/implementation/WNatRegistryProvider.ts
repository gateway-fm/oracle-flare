import { 
  AssetTokenInstance, FlareAssetRegistryInstance, 
  WNatRegistryProviderInstance, AddressUpdaterMockInstance
} from "../../../../typechain-truffle";
import { expectRevert } from "@openzeppelin/test-helpers";

const getTestFile = require('../../../utils/constants').getTestFile;

const MAX_DELEGATES_BY_PERCENT = web3.utils.keccak256("MaxDelegatesByPercent");
const INCENTIVE_POOL = web3.utils.keccak256("IncentivePool");
const NON_EXISTENT = web3.utils.keccak256("NonExistent")

const INVALID_TOKEN_MSG = "invalid token";

const providerHash = web3.utils.keccak256("wrapped native");

const AssetToken = artifacts.require("AssetToken");
const WNatRegistryProvider = artifacts.require("WNatRegistryProvider");
const FlareAssetRegistry = artifacts.require("FlareAssetRegistry");
const AddressUpdater = artifacts.require("AddressUpdaterMock");

contract(`FlareAssetRegistry.sol; ${getTestFile(__filename)}; Flare asset registry unit tests`, async accounts => {
    const governance = accounts[0];
    let wNat: AssetTokenInstance;
    let flareAssetRegistry: FlareAssetRegistryInstance;
    let wNatRegistryProvider: WNatRegistryProviderInstance;
    let addressUpdater: AddressUpdaterMockInstance;

    beforeEach(async () => {
        wNat = await AssetToken.new(governance, "WNat", "WNT", 9);
        addressUpdater = await AddressUpdater.new(governance, wNat.address);
        flareAssetRegistry = await FlareAssetRegistry.new(governance);
        wNatRegistryProvider = await WNatRegistryProvider.new(addressUpdater.address, flareAssetRegistry.address);
    });

    describe("Fetching data", async () => {

        it("Should correctly check the asset type", async () => {
            const resp = await wNatRegistryProvider.assetType();
            expect(resp).to.equal(providerHash);
        });

        it("Should fetch all assets", async () => {
            const resp = await wNatRegistryProvider.allAssets();
            expect(resp.length).to.equal(1);
            expect(resp[0]).to.equal(wNat.address);
        });

        it("Should fail at getting attributes for non-wnat token", async () => {
            const prms = wNatRegistryProvider.getAttribute(
                "0x0000000000000000000000000000000000000000", MAX_DELEGATES_BY_PERCENT);
            await expectRevert(prms, INVALID_TOKEN_MSG);
        });

        it("Should get attributes", async () => {
            const resp1 = await wNatRegistryProvider.getAttribute(wNat.address, MAX_DELEGATES_BY_PERCENT);
            expect(resp1[0]).to.equal(true);
            expect(resp1[1]).to.equal("0x0000000000000000000000000000000000000000000000000000000000000002");
            const resp2 = await wNatRegistryProvider.getAttribute(wNat.address, INCENTIVE_POOL);
            expect(resp2[0]).to.equal(true);
            expect(resp2[1]).to.equal("0x0000000000000000000000000000000000000000000000000000000000000000");
            const resp3 = await wNatRegistryProvider.getAttribute(wNat.address, NON_EXISTENT);
            expect(resp3[0]).to.equal(false);
            expect(resp3[1]).to.equal("0x0000000000000000000000000000000000000000000000000000000000000000"); 
        });

    });

    describe("Updating contract addresses", async () => {

        it("Should update wnat address", async () => {
            await flareAssetRegistry.registerProvider(wNatRegistryProvider.address, true);
            const newWNat = await AssetToken.new(governance, "WNat", "WNT", 9);
            let wnatHash = web3.utils.keccak256(web3.eth.abi.encodeParameters(["string"], ["WNat"]));
            let updaterHash = web3.utils.keccak256(web3.eth.abi.encodeParameters(["string"], ["AddressUpdater"]));
            await addressUpdater.updateContractAddresses(wNatRegistryProvider.address, 
                [wnatHash, updaterHash], [newWNat.address, addressUpdater.address]);
            // check that the asset was replaced in wNatRegistryProvider
            const resp = await wNatRegistryProvider.allAssets();
            expect(resp.length).to.equal(1);
            expect(resp[0]).to.equal(newWNat.address);
            // check that the asset war replaced in flareAssetRegistry
            const resp2 = await flareAssetRegistry.allAssets();
            expect(resp2.length).to.equal(1);
            expect(resp[0]).to.equal(newWNat.address);
        });

        it("Should do nothing if updating wnat address with the same address", async () => {
            await flareAssetRegistry.registerProvider(wNatRegistryProvider.address, true);
            let wnatHash = web3.utils.keccak256(web3.eth.abi.encodeParameters(["string"], ["WNat"]));
            let updaterHash = web3.utils.keccak256(web3.eth.abi.encodeParameters(["string"], ["AddressUpdater"]));
            await addressUpdater.updateContractAddresses(wNatRegistryProvider.address, 
                [wnatHash, updaterHash], [wNat.address, addressUpdater.address]);
            // check that the asset was replaced in wNatRegistryProvider
            const resp = await wNatRegistryProvider.allAssets();
            expect(resp.length).to.equal(1);
            expect(resp[0]).to.equal(wNat.address);
            // check that the asset war replaced in flareAssetRegistry
            const resp2 = await flareAssetRegistry.allAssets();
            expect(resp2.length).to.equal(1);
            expect(resp[0]).to.equal(wNat.address);
        });

    });

});