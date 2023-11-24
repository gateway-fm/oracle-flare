import { constants, expectEvent, expectRevert, time } from '@openzeppelin/test-helpers';
import { BigNumber } from 'ethers';
import { keccak256, defaultAbiCoder } from 'ethers/lib/utils';
import { Contracts } from "../../../../deployment/scripts/Contracts";
import { FtsoContract, FtsoInstance, FtsoManagerContract, FtsoManagerInstance, MockContractContract, MockContractInstance, PriceSubmitterContract, PriceSubmitterInstance, VoterWhitelisterContract, VoterWhitelisterInstance, WNatContract, WNatInstance } from "../../../../typechain-truffle";
import { defaultPriceEpochCyclicBufferSize } from "../../../utils/constants";
import { compareArrays, computeVoteRandom2, encodeContractNames, getRandom, increaseTimeTo, lastOf, submitHash, toBN } from "../../../utils/test-helpers";
import { setDefaultVPContract } from "../../../utils/token-test-helpers";
const getTestFile = require('../../../utils/constants').getTestFile;

const Wnat = artifacts.require("WNat") as WNatContract;
const MockWnat = artifacts.require("MockContract") as MockContractContract;
const FtsoManager = artifacts.require("FtsoManager") as FtsoManagerContract;
const FtsoManagement = artifacts.require("FtsoManagement");
const MockRegistry = artifacts.require("MockContract") as MockContractContract;
const MockFtso = artifacts.require("MockContract") as MockContractContract;
const Ftso = artifacts.require("Ftso") as FtsoContract;
const PriceSubmitter = artifacts.require("PriceSubmitter") as PriceSubmitterContract;
const VoterWhitelister = artifacts.require("VoterWhitelister") as VoterWhitelisterContract;
const GOVERNANCE_GENESIS_ADDRESS = require('../../../utils/constants').GOVERNANCE_GENESIS_ADDRESS;

const ERR_FTSO_MANAGER_ONLY = "FTSO manager only";
const ERR_WHITELISTER_ONLY = "Voter whitelister only"
const ERR_NOT_WHITELISTED = "Not whitelisted";
const ERR_ONLY_GOVERNANCE = "only governance";
const ERR_ONLY_ADDRESS_UPDATER = "only address updater";
const ERR_ARRAY_LENGTHS = "Array lengths do not match";
const ERR_ALREADY_SET = "Already set";

// contains a fresh contract for each test 
let wnatInterface: WNatInstance;
let mockWnat: MockContractInstance;
let mockFtsoManager: FtsoManagerInstance;
let mockFtsoRegistry: MockContractInstance;
let ftsos: FtsoInstance[];
let priceSubmitter: PriceSubmitterInstance;
let epochId: number;
let voterWhitelister: VoterWhitelisterInstance;

let FTSO_MANAGER_ADDRESS: string;
let ADDRESS_UPDATER: string;

// WARNING: This sets mock vote power fully, irrespective of address and blockNumber
async function setBatchMockVotePower(votePower: number[]) {
    // Both are address and block number are irrelevant. We just need them for proper method coding
    const batchVotePowerOfAt = wnatInterface.contract.methods.batchVotePowerOfAt([constants.ZERO_ADDRESS], 1).encodeABI();
    const batchVotePowerOfAtReturn = web3.eth.abi.encodeParameter('uint256[]', votePower);
    await mockWnat.givenMethodReturn(batchVotePowerOfAt, batchVotePowerOfAtReturn);
}

// hack - change ftso manager address to set trusted addresses from known address with private key
async function setTrustedAddresses(addresses: string[]) {
    await priceSubmitter.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_REGISTRY, Contracts.VOTER_WHITELISTER, Contracts.FTSO_MANAGER]),
        [ADDRESS_UPDATER, mockFtsoRegistry.address, voterWhitelister.address, FTSO_MANAGER_ADDRESS], {from: ADDRESS_UPDATER});
        
    await priceSubmitter.setTrustedAddresses(addresses, { from: FTSO_MANAGER_ADDRESS });

    await priceSubmitter.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_REGISTRY, Contracts.VOTER_WHITELISTER, Contracts.FTSO_MANAGER]),
        [ADDRESS_UPDATER, mockFtsoRegistry.address, voterWhitelister.address, mockFtsoManager.address], {from: ADDRESS_UPDATER});
}

async function setGetFtsosMock(ftsoIndices: number[]) {
    let params: any[] = [ftsoIndices.map(i => toBN(i))];
    let values: any[] = ftsoIndices.map(i => ftsos[i].address);
    await mockFtsoRegistry.givenCalldataReturn(
        web3.eth.abi.encodeFunctionCall({type: "function", name: "getFtsos", inputs: [{name: "_ftsoIndices", type: "uint256[]"}]} as AbiItem, params), 
        web3.eth.abi.encodeParameters(['address[]'], [values])
    );
}

function calculateRandom(number: BN, address: string): BN{
    return toBN(keccak256(defaultAbiCoder.encode(["uint256", "address" ], [number.toString(), address])).toString());
}

contract(`PriceSubmitter.sol; ${getTestFile(__filename)}; PriceSubmitter unit tests`, async accounts => {

    FTSO_MANAGER_ADDRESS = accounts[12];
    ADDRESS_UPDATER = accounts[16];

    before(async () => {
        FtsoManager.link(await FtsoManagement.new() as any);
    });

    describe("submit and reveal price", async() => {
        beforeEach(async() => {
            ftsos = [];
            wnatInterface = await Wnat.new(accounts[0], "Wrapped NAT", "WNAT");
            await setDefaultVPContract(wnatInterface, accounts[0]);
            mockWnat = await MockWnat.new();
            mockFtsoRegistry = await MockRegistry.new();
            priceSubmitter = await PriceSubmitter.new();
            await priceSubmitter.initialiseFixedAddress();
            await priceSubmitter.setAddressUpdater(ADDRESS_UPDATER, { from: GOVERNANCE_GENESIS_ADDRESS});
            voterWhitelister = await VoterWhitelister.new(GOVERNANCE_GENESIS_ADDRESS, ADDRESS_UPDATER, priceSubmitter.address, 10, constants.ZERO_ADDRESS);
            mockFtsoManager = await FtsoManager.new(
                GOVERNANCE_GENESIS_ADDRESS,
                GOVERNANCE_GENESIS_ADDRESS,
                ADDRESS_UPDATER,
                constants.ZERO_ADDRESS,
                0,
                120,
                60,
                180,
                240,
                7
            );
            
            // Have an exisitng address just to set up FtsoManager and can act like it in {from: _}
            await voterWhitelister.updateContractAddresses(
                encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_REGISTRY, Contracts.FTSO_MANAGER]),
                [ADDRESS_UPDATER, mockFtsoRegistry.address, FTSO_MANAGER_ADDRESS], {from: ADDRESS_UPDATER});
                
            await priceSubmitter.updateContractAddresses(
                encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_REGISTRY, Contracts.VOTER_WHITELISTER, Contracts.FTSO_MANAGER]),
                [ADDRESS_UPDATER, mockFtsoRegistry.address, voterWhitelister.address, mockFtsoManager.address], {from: ADDRESS_UPDATER});
            
            for (let i = 0; i < 3; i++) {
                let ftso = await Ftso.new(
                    `ATOK${i}`,
                    5,
                    priceSubmitter.address,
                    mockWnat.address,
                    accounts[10],
                    0,
                    120,
                    60,
                    1, // initial token price 0.00001$
                    1e10,
                    defaultPriceEpochCyclicBufferSize
                );
                await ftso.configureEpochs(1, 1, 1000, 10000, 50, 500, 0, 0, [accounts[5], accounts[6], accounts[7]], {from: accounts[10]});
                await ftso.setVotePowerBlock(1, {from: accounts[10]});
                await ftso.activateFtso(0, 120, 60, {from: accounts[10]});

                ftsos[i] = ftso;
            }

            const getSupportedSymbolsAndFtsos = web3.eth.abi.encodeFunctionCall({type: "function", name: "getSupportedIndices", inputs: []} as AbiItem, []);
            const supportedFtsos = web3.eth.abi.encodeParameter("uint256[]", [...Array(ftsos.length).keys()]);
            await mockFtsoRegistry.givenCalldataReturn(getSupportedSymbolsAndFtsos, supportedFtsos);

            for(let i = 0; i < ftsos.length; ++i){
                await mockFtsoRegistry.givenCalldataReturnAddress(
                    web3.eth.abi.encodeFunctionCall({type: "function", name: "getFtso", inputs: [{name: "_ftsoIndex", type: "uint256"}]} as AbiItem, [`${i}`]), 
                    ftsos[i].address
                );

                await voterWhitelister.addFtso(i, {from: FTSO_MANAGER_ADDRESS});
            }

            // Force a block in order to get most up to date time
            await time.advanceBlock();
            // Get the timestamp for the just mined block
            let timestamp = await time.latest();
            epochId = Math.floor(timestamp.toNumber() / 120) + 1;
            await increaseTimeTo(epochId * 120);
        });
        
        it("Should set trusted addresses only if ftso manager", async () => {
            let addresses: string[] = [accounts[6], accounts[7]];

            let tx = priceSubmitter.setTrustedAddresses(addresses);
            await expectRevert(tx, ERR_FTSO_MANAGER_ONLY);

            compareArrays([], await priceSubmitter.getTrustedAddresses());
            await setTrustedAddresses(addresses);
            compareArrays(addresses, await priceSubmitter.getTrustedAddresses());
        });

        it("Should add to whitelist only if VoterWhitelister", async () => {

            let tx = priceSubmitter.voterWhitelisted(accounts[0], 0);
            
            await expectRevert(tx, ERR_WHITELISTER_ONLY);
        });

        it("Should remove from whitelist only if VoterWhitelister", async () => {

            let tx = priceSubmitter.votersRemovedFromWhitelist([accounts[0]], 0);
            
            await expectRevert(tx, ERR_WHITELISTER_ONLY);
        });

        it("Should correctly set individual part of mask and fire events", async () => {
            await setBatchMockVotePower([10, 0]);

            // Set 1 on index 0
            let tx = await voterWhitelister.requestWhitelistingVoter(accounts[10], 0);
            let bitmask = await priceSubmitter.voterWhitelistBitmap(accounts[10]);
            expectEvent(tx, "VoterWhitelisted", {voter: accounts[10], ftsoIndex: toBN(0)});
            
            // Should not reemit
            tx = await voterWhitelister.requestWhitelistingVoter(accounts[10], 0);
            bitmask = await priceSubmitter.voterWhitelistBitmap(accounts[10]);
            expectEvent.notEmitted(tx, "VoterWhitelisted");
            assert.equal(bitmask.toNumber(), 1 * 2**0);
            
            // Set 1 on index 2
            tx = await voterWhitelister.requestWhitelistingVoter(accounts[10], 2);
            bitmask = await priceSubmitter.voterWhitelistBitmap(accounts[10]);
            assert.equal(bitmask.toNumber(), 1 * 2**0 + 1 * 2**2);
            expectEvent(tx, "VoterWhitelisted", {voter: accounts[10], ftsoIndex: toBN(2)});

            // Fill 10 voters
            await setBatchMockVotePower([...Array(11).keys()]);
            for(let i = 0; i < 9; ++i){
                tx = await voterWhitelister.requestWhitelistingVoter(accounts[20 + i], 2);

                expectEvent(tx, "VoterWhitelisted", {voter: accounts[20 + i], ftsoIndex: toBN(2)});
                expectEvent.notEmitted(tx, "VoterRemovedFromWhitelist");
            }

            // Should add and remove old
            tx = await voterWhitelister.requestWhitelistingVoter(accounts[11], 2);

            expectEvent(tx, "VoterWhitelisted", {voter: accounts[11], ftsoIndex: toBN(2)});
            expectEvent(tx, "VoterRemovedFromWhitelist", {voter: accounts[10], ftsoIndex: toBN(2)});

            bitmask = await priceSubmitter.voterWhitelistBitmap(accounts[10]);
            assert.equal(bitmask.toNumber(), 1 * 2**0);

            bitmask = await priceSubmitter.voterWhitelistBitmap(accounts[11]);
            assert.equal(bitmask.toNumber(), 1 * 2**2);

            await setBatchMockVotePower([...Array(10).keys()]);

            tx = await voterWhitelister.setMaxVotersForFtso(2, 8, {from : GOVERNANCE_GENESIS_ADDRESS});
            expectEvent(tx, "VoterRemovedFromWhitelist", {voter: accounts[20 + 0], ftsoIndex: toBN(2)});
            // We do not know explicitly which will be the second one (too implementation defined as we are just mocking), 
            // just require another one to be kicked out
            expectEvent(tx, "VoterRemovedFromWhitelist", {ftsoIndex: toBN(2)});

            bitmask = await priceSubmitter.voterWhitelistBitmap(accounts[20 + 0]);
            assert.equal(bitmask.toNumber(), 0 * 2**0);
        });

        it("Should work with deleted ftsos", async() => {
            let indices = [0, 2];
            let hash = submitHash(indices, [500, 300], 123, accounts[1]);

            await ftsos[1].deactivateFtso({from: accounts[10]});
            await voterWhitelister.removeFtso(1, {from: FTSO_MANAGER_ADDRESS});

            const getSupportedSymbolsAndFtsos = web3.eth.abi.encodeFunctionCall({type: "function", name: "getSupportedIndices", inputs: []} as AbiItem, []);
            // Remove 1 from a list of supported indices
            const supportedFtsos = web3.eth.abi.encodeParameter("uint256[]", [...Array(ftsos.length).keys()].filter(x => x != 1));
            await mockFtsoRegistry.givenCalldataReturn(getSupportedSymbolsAndFtsos, supportedFtsos);

            await voterWhitelister.setMaxVotersForFtso(0, 100, {from: GOVERNANCE_GENESIS_ADDRESS});
            await voterWhitelister.setMaxVotersForFtso(2, 100, {from: GOVERNANCE_GENESIS_ADDRESS});
            await voterWhitelister.requestFullVoterWhitelisting(accounts[1]);
            await setGetFtsosMock(indices);
            let tx = await priceSubmitter.submitHash(epochId, hash, {from: accounts[1]});
            expectEvent(tx, "HashSubmitted", {submitter: accounts[1], epochId: toBN(epochId), hash: hash});
        });

        it("Should allow voting", async() => {
            let hash1 = submitHash([3], [500], 123, accounts[10]);
            let hash2 = submitHash([3], [500], 123, accounts[11]);
            let hash3 = submitHash([3], [300], 125, accounts[12]);

            let mockFtso1 = await MockFtso.new()

            await mockFtsoRegistry.givenCalldataReturnAddress(
                web3.eth.abi.encodeFunctionCall({type: "function", name: "getFtso", inputs: [{name: "_ftsoIndex", type: "uint256"}]} as AbiItem, ["3"]), 
                mockFtso1.address
            );

            const getSupportedSymbolsAndFtsos = web3.eth.abi.encodeFunctionCall({type: "function", name: "getSupportedIndices", inputs: []} as AbiItem, []);
            const supportedFtsos = web3.eth.abi.encodeParameter(
                "uint256[]", [...Array(ftsos.length).keys(), 3]);
            await mockFtsoRegistry.givenCalldataReturn(getSupportedSymbolsAndFtsos, supportedFtsos);
            
            await mockFtso1.givenCalldataReturn(
                web3.eth.abi.encodeFunctionCall({type: "function", name: "symbol", inputs: []} as AbiItem, []),
                web3.eth.abi.encodeParameter("string", "MOCK_1")
                );
            
            await mockFtsoRegistry.givenCalldataReturn(
                web3.eth.abi.encodeFunctionCall({type: "function", name: "getFtsos", inputs: [{name: "_ftsoIndices", type: "uint256[]"}]} as AbiItem, [[toBN(3)]] as any[]), 
                web3.eth.abi.encodeParameters(['address[]'], [[mockFtso1.address]])
            );
            
            await voterWhitelister.addFtso(3, {from: FTSO_MANAGER_ADDRESS});

            // Everyone gets some WNAT
            await setBatchMockVotePower([10, 10, 10]);

            await voterWhitelister.setMaxVotersForFtso(3, 3, {from: GOVERNANCE_GENESIS_ADDRESS});
            await voterWhitelister.requestFullVoterWhitelisting(accounts[10]);
            await voterWhitelister.requestFullVoterWhitelisting(accounts[11]);
            await voterWhitelister.requestFullVoterWhitelisting(accounts[12]);
            
            // Check that they work
            await priceSubmitter.submitHash(epochId, hash1, {from: accounts[10]});
            await priceSubmitter.submitHash(epochId, hash2, {from: accounts[11]});
            await priceSubmitter.submitHash(epochId, hash3, {from: accounts[12]});
        });

        it("Should submit with precheck", async() => {
            let hash = submitHash([0, 1], [500, 200], 123, accounts[10]);

            const getSupportedFtsos = web3.eth.abi.encodeFunctionCall({type: "function", name: "getSupportedFtsos", inputs: []} as AbiItem, []);
            const supportedFtsos = web3.eth.abi.encodeParameter("address[]", ftsos.map(ftso => ftso.address));
            await mockFtsoRegistry.givenCalldataReturn(getSupportedFtsos, supportedFtsos);

            const failPrecheck = priceSubmitter.submitHash(epochId, hash);
            await expectRevert(failPrecheck, ERR_NOT_WHITELISTED);

            await voterWhitelister.requestFullVoterWhitelisting(accounts[10]);

            await setGetFtsosMock([0, 1]);
            await priceSubmitter.submitHash(epochId, hash, {from: accounts[10]});
            
            // This kicks out 10            
            await setBatchMockVotePower([0, 10]);
            // Lower max amount of voters
            await voterWhitelister.setMaxVotersForFtso(0, 1, {from: GOVERNANCE_GENESIS_ADDRESS});
            await voterWhitelister.setMaxVotersForFtso(1, 1, {from: GOVERNANCE_GENESIS_ADDRESS});
            await voterWhitelister.setMaxVotersForFtso(2, 1, {from: GOVERNANCE_GENESIS_ADDRESS});

            await voterWhitelister.requestFullVoterWhitelisting(accounts[11]);
            await voterWhitelister.requestFullVoterWhitelisting(accounts[10]);

            await increaseTimeTo((epochId + 1) * 120); // submit was done successfuly, continue test on next price epoch
            await priceSubmitter.submitHash(epochId + 1, hash, {from: accounts[10]});

            await setGetFtsosMock([0]);
            await expectRevert(priceSubmitter.submitHash(epochId + 1, hash, { from: accounts[11] }), ERR_NOT_WHITELISTED);
        });

        it("Should submit prices", async() => {
            let hash = submitHash([0, 1, 2], [500, 200, 300], 123, accounts[1]);
            await voterWhitelister.requestFullVoterWhitelisting(accounts[1]);
            await setGetFtsosMock([0, 1, 2]);
            let tx = await priceSubmitter.submitHash(epochId, hash, {from: accounts[1]});
            expectEvent(tx, "HashSubmitted", {submitter: accounts[1], epochId: toBN(epochId), hash: hash});
        });

        it("Should submit prices from trusted address", async () => {
            let trustedAddresses: string[] = [accounts[6], accounts[7]];
            await setTrustedAddresses(trustedAddresses);
            
            let hash = submitHash([0, 1, 2], [500, 200, 300], 123, accounts[6]);
            await setGetFtsosMock([0, 1, 2]);
            let tx = await priceSubmitter.submitHash(epochId, hash, {from: accounts[6]});
            expectEvent(tx, "HashSubmitted", {submitter: accounts[6], epochId: toBN(epochId), hash: hash});
        });

        it("Should submit prices from whitelisted trusted address", async () => {
            await voterWhitelister.requestFullVoterWhitelisting(accounts[6]);
            
            let trustedAddresses: string[] = [accounts[6], accounts[7]];
            await setTrustedAddresses(trustedAddresses);
            
            let hash = submitHash([0, 1, 2], [500, 200, 300], 123, accounts[6]);
            await setGetFtsosMock([0, 1, 2]);
            let tx = await priceSubmitter.submitHash(epochId, hash, {from: accounts[6]});
            expectEvent(tx, "HashSubmitted", {submitter: accounts[6], epochId: toBN(epochId), hash: hash});
        });

        it("Should revert submit prices from removed trusted address", async () => {
            let trustedAddresses: string[] = [accounts[6], accounts[7]];
            await setTrustedAddresses(trustedAddresses);

            // change trusted addresses
            await setTrustedAddresses([accounts[7]]);
            
            let hash = submitHash([0, 1, 2], [500, 200, 300], 123, accounts[6]);
            await setGetFtsosMock([0, 1, 2]);
            let tx = priceSubmitter.submitHash(epochId, hash, {from: accounts[6]});
            await expectRevert(tx, ERR_NOT_WHITELISTED);
        });

        it("Should submit prices from whitelisted trusted address which was then removed from trusted addresses", async () => {
            await voterWhitelister.requestFullVoterWhitelisting(accounts[6]);
            
            let trustedAddresses: string[] = [accounts[6], accounts[7]];
            await setTrustedAddresses(trustedAddresses);

            // change trusted addresses
            await setTrustedAddresses([accounts[7]]);
            
            let hash = submitHash([0, 1, 2], [500, 200, 300], 123, accounts[6]);
            await setGetFtsosMock([0, 1, 2]);
            let tx = await priceSubmitter.submitHash(epochId, hash, {from: accounts[6]});
            expectEvent(tx, "HashSubmitted", {submitter: accounts[6], epochId: toBN(epochId), hash: hash});
        });

        it("Should revert submit prices from whitelisted trusted address which was then removed from whitelist and from trusted addresses", async () => {
            await voterWhitelister.requestFullVoterWhitelisting(accounts[6]);
            
            let trustedAddresses: string[] = [accounts[6], accounts[7]];
            await setTrustedAddresses(trustedAddresses);

            await voterWhitelister.removeTrustedAddressFromWhitelist(accounts[6], 0);
            await voterWhitelister.removeTrustedAddressFromWhitelist(accounts[6], 1);
            await voterWhitelister.removeTrustedAddressFromWhitelist(accounts[6], 2);

            // change trusted addresses
            await setTrustedAddresses([accounts[7]]);
            
            let hash = submitHash([0, 1, 2], [500, 200, 300], 123, accounts[6]);
            await setGetFtsosMock([0, 1, 2]);
            let tx = priceSubmitter.submitHash(epochId, hash, {from: accounts[6]});
            await expectRevert(tx, ERR_NOT_WHITELISTED);
        });

        it("Should revert submit prices if not all ftsos are active", async () => {
            await voterWhitelister.requestFullVoterWhitelisting(accounts[1]);

            await ftsos[0].deactivateFtso({ from: accounts[10] });
            await voterWhitelister.removeFtso(0, { from: FTSO_MANAGER_ADDRESS });
            await ftsos[1].deactivateFtso({ from: accounts[10] });
            await voterWhitelister.removeFtso(1, { from: FTSO_MANAGER_ADDRESS });
            await ftsos[2].deactivateFtso({ from: accounts[10] });
            await voterWhitelister.removeFtso(2, { from: FTSO_MANAGER_ADDRESS });

            let hash = submitHash([0, 1], [500, 200], 123, accounts[1]);
            let tx = priceSubmitter.submitHash(epochId, hash, { from: accounts[1] });
            await expectRevert(tx, ERR_NOT_WHITELISTED);
        });
        
        it("Should reveal price", async() => {
            let prices = [500, 200, 300];
            let pricesBN = prices.map(x => toBN(x));
            let random = getRandom();
            let addresses = [ftsos[0].address, ftsos[1].address, ftsos[2].address];
            let hash = submitHash([0, 1, 2], prices, random, accounts[1]);
            
            await voterWhitelister.requestFullVoterWhitelisting(accounts[1]);
            
            await setGetFtsosMock([0, 1, 2]);
            let tx = await priceSubmitter.submitHash(epochId, hash, {from: accounts[1]});
            expectEvent(tx, "HashSubmitted", {submitter: accounts[1], epochId: toBN(epochId), hash: hash});
            await ftsos[0].initializeCurrentEpochStateForReveal(10000, false, {from: accounts[10]});
            await ftsos[1].initializeCurrentEpochStateForReveal(10000, false, {from: accounts[10]});
            await ftsos[2].initializeCurrentEpochStateForReveal(10000, false, {from: accounts[10]});

            await increaseTimeTo((epochId + 1) * 120); // reveal period start
            let tx2 = await priceSubmitter.revealPrices(epochId, [0, 1, 2], prices, random, {from: accounts[1]});
            expectEvent(tx2, "PricesRevealed", {voter: accounts[1], epochId: toBN(epochId), ftsos: addresses, prices: pricesBN, random: random});
            
            let ftso0Event = lastOf(await ftsos[0].getPastEvents("PriceRevealed"));
            let ftso1Event = lastOf(await ftsos[1].getPastEvents("PriceRevealed"));
            let ftso2Event = lastOf(await ftsos[2].getPastEvents("PriceRevealed"));
            expect(ftso0Event.args.voter).to.equals(accounts[1]);
            expect(ftso0Event.args.epochId.toNumber()).to.equals(epochId);
            expect(ftso0Event.args.price.toNumber()).to.equals(prices[0]);
            expect(ftso1Event.args.voter).to.equals(accounts[1]);
            expect(ftso1Event.args.epochId.toNumber()).to.equals(epochId);
            expect(ftso1Event.args.price.toNumber()).to.equals(prices[1]);
            expect(ftso2Event.args.voter).to.equals(accounts[1]);
            expect(ftso2Event.args.epochId.toNumber()).to.equals(epochId);
            expect(ftso2Event.args.price.toNumber()).to.equals(prices[2]);
        });

        it("Should reveal price from trusted address", async() => {
            let trustedAddresses: string[] = [accounts[6], accounts[7]];
            await setTrustedAddresses(trustedAddresses);

            let prices = [500, 200, 300];
            let pricesBN = prices.map(x => toBN(x));
            let random = getRandom();
            let addresses = [ftsos[0].address, ftsos[1].address, ftsos[2].address];
            let hash = submitHash([0, 1, 2], prices, random, accounts[6]);
            
            await setGetFtsosMock([0, 1 ,2]);
            let tx = await priceSubmitter.submitHash(epochId, hash, {from: accounts[6]});
            expectEvent(tx, "HashSubmitted", {submitter: accounts[6], epochId: toBN(epochId), hash: hash});
            await ftsos[0].initializeCurrentEpochStateForReveal(10000, false, {from: accounts[10]});
            await ftsos[1].initializeCurrentEpochStateForReveal(10000, false, {from: accounts[10]});
            await ftsos[2].initializeCurrentEpochStateForReveal(10000, false, {from: accounts[10]});

            await increaseTimeTo((epochId + 1) * 120); // reveal period start
            let tx2 = await priceSubmitter.revealPrices(epochId, [0, 1, 2], prices, random, {from: accounts[6]});
            expectEvent(tx2, "PricesRevealed", {voter: accounts[6], epochId: toBN(epochId), ftsos: addresses, prices: pricesBN, random: random});
        });

        it("Should reveal price from whitelisted trusted address", async() => {
            await voterWhitelister.requestFullVoterWhitelisting(accounts[6]);

            let trustedAddresses: string[] = [accounts[6], accounts[7]];
            await setTrustedAddresses(trustedAddresses);

            let prices = [500, 200, 300];
            let pricesBN = prices.map(x => toBN(x));
            let random = getRandom();
            let addresses = [ftsos[0].address, ftsos[1].address, ftsos[2].address];
            let hash = submitHash([0, 1, 2], prices, random, accounts[6]);
            
            await setGetFtsosMock([0, 1, 2]);
            let tx = await priceSubmitter.submitHash(epochId, hash, {from: accounts[6]});
            expectEvent(tx, "HashSubmitted", {submitter: accounts[6], epochId: toBN(epochId), hash: hash});
            await ftsos[0].initializeCurrentEpochStateForReveal(10000, false, {from: accounts[10]});
            await ftsos[1].initializeCurrentEpochStateForReveal(10000, false, {from: accounts[10]});
            await ftsos[2].initializeCurrentEpochStateForReveal(10000, false, {from: accounts[10]});

            await increaseTimeTo((epochId + 1) * 120); // reveal period start
            let tx2 = await priceSubmitter.revealPrices(epochId, [0, 1, 2], prices, random, {from: accounts[6]});
            expectEvent(tx2, "PricesRevealed", {voter: accounts[6], epochId: toBN(epochId), ftsos: addresses, prices: pricesBN, random: random});
        });

        it("Should not submit and reveal price in arbitrary order", async() => {
            let prices = [500, 200, 300];
            let random = getRandom();
            let hash = submitHash([1, 0, 2], prices, random, accounts[1]);

            await voterWhitelister.requestFullVoterWhitelisting(accounts[1]);
            
            await setGetFtsosMock([1, 0, 2]);
            let tx = await priceSubmitter.submitHash(epochId, hash, {from: accounts[1]});
            expectEvent(tx, "HashSubmitted", {submitter: accounts[1], epochId: toBN(epochId), hash: hash});
            await ftsos[0].initializeCurrentEpochStateForReveal(10000, false, {from: accounts[10]});
            await ftsos[1].initializeCurrentEpochStateForReveal(10000, false, {from: accounts[10]});
            await ftsos[2].initializeCurrentEpochStateForReveal(10000, false, {from: accounts[10]});

            await increaseTimeTo((epochId + 1) * 120); // reveal period start
            let tx2 = priceSubmitter.revealPrices(epochId, [1, 0, 2], prices, random, {from: accounts[1]});
            await expectRevert(tx2, "FTSO indices not increasing");
        });

        it("Should revert submit if not whitelisted", async () => {
            let prices = [500, 200, 300];
            let random = toBN(123);
            let hash = submitHash([0, 1, 2], prices, random, accounts[1]);
            
            await voterWhitelister.requestFullVoterWhitelisting(accounts[1]);

            // Kick 1 out
            await voterWhitelister.setMaxVotersForFtso(0, 1, {from : GOVERNANCE_GENESIS_ADDRESS});
            await voterWhitelister.setMaxVotersForFtso(1, 1, {from : GOVERNANCE_GENESIS_ADDRESS});
            await voterWhitelister.setMaxVotersForFtso(2, 1, {from : GOVERNANCE_GENESIS_ADDRESS});
            await setBatchMockVotePower([0, 10]);
            await voterWhitelister.requestFullVoterWhitelisting(accounts[2]);

            await setGetFtsosMock([0, 1, 2]);
            let tx = priceSubmitter.submitHash(epochId, hash, {from: accounts[1]});
            await expectRevert(tx, ERR_NOT_WHITELISTED);
        });

        it("Should revert submit if wrong epoch id", async () => {
            let prices = [500, 200, 300];
            let random = toBN(123);
            let hash = submitHash([0, 1, 2], prices, random, accounts[1]);
            
            await voterWhitelister.requestFullVoterWhitelisting(accounts[1]);

            await setGetFtsosMock([0, 1, 2]);
            let tx1 = priceSubmitter.submitHash(epochId + 1, hash, {from: accounts[1]});
            await expectRevert(tx1, "Wrong epoch id");

            let tx2 = priceSubmitter.submitHash(epochId - 1, hash, {from: accounts[1]});
            await expectRevert(tx2, "Wrong epoch id");

            await priceSubmitter.submitHash(epochId, hash, {from: accounts[1]});
        });

        it("Should revert submitting twice", async () => {
            let prices = [500, 200, 300];
            let random = toBN(123);
            let hash = submitHash([0, 1, 2], prices, random, accounts[1]);
            
            await voterWhitelister.requestFullVoterWhitelisting(accounts[1]);

            await setGetFtsosMock([0, 1, 2]);

            await priceSubmitter.submitHash(epochId, hash, {from: accounts[1]});

            let tx = priceSubmitter.submitHash(epochId, hash, {from: accounts[1]});
            await expectRevert(tx, "Duplicate submit in epoch");
        });

        it("Should revert on reveal whitelist error", async () => {
            let prices = [500, 200, 300];
            let random = getRandom();
            let hash = submitHash([0, 1, 2], prices, random, accounts[1]);
            
            await voterWhitelister.requestFullVoterWhitelisting(accounts[1]);
            
            await setGetFtsosMock([0, 1, 2]);
            let tx = await priceSubmitter.submitHash(epochId, hash, {from: accounts[1]});
            expectEvent(tx, "HashSubmitted", {submitter: accounts[1], epochId: toBN(epochId), hash: hash});
            await ftsos[0].initializeCurrentEpochStateForReveal(10000, false, {from: accounts[10]});
            await ftsos[1].initializeCurrentEpochStateForReveal(10000, false, {from: accounts[10]});
            await ftsos[2].initializeCurrentEpochStateForReveal(10000, false, {from: accounts[10]});
            
            // Kick 1 out
            await voterWhitelister.setMaxVotersForFtso(0, 1, {from : GOVERNANCE_GENESIS_ADDRESS});
            await voterWhitelister.setMaxVotersForFtso(1, 1, {from : GOVERNANCE_GENESIS_ADDRESS});
            await voterWhitelister.setMaxVotersForFtso(2, 1, {from : GOVERNANCE_GENESIS_ADDRESS});
            await setBatchMockVotePower([0, 10]);
            await voterWhitelister.requestFullVoterWhitelisting(accounts[2]);

            await increaseTimeTo((epochId + 1) * 120); // reveal period start
            let tx2 = priceSubmitter.revealPrices(epochId, [0, 1, 2], prices, random, {from: accounts[1]});
            await expectRevert(tx2, ERR_NOT_WHITELISTED);
        });

        it("Should revert on reveal hashes error", async () => {
            let prices = [500, 200, 300];
            let random = getRandom();
            let hash = submitHash([0, 1, 2], prices, random, accounts[1]);
            
            await voterWhitelister.requestFullVoterWhitelisting(accounts[1]);
            
            await setGetFtsosMock([0, 1, 2]);
            let tx = await priceSubmitter.submitHash(epochId, hash, {from: accounts[1]});
            expectEvent(tx, "HashSubmitted", {submitter: accounts[1], epochId: toBN(epochId), hash: hash});
            await ftsos[0].initializeCurrentEpochStateForReveal(10000, false, {from: accounts[10]});
            await ftsos[1].initializeCurrentEpochStateForReveal(10000, false, {from: accounts[10]});
            await ftsos[2].initializeCurrentEpochStateForReveal(10000, false, {from: accounts[10]});
            
            await increaseTimeTo((epochId + 1) * 120); // reveal period start
            let tx2 = priceSubmitter.revealPrices(epochId, [0, 1, 2], [10, 10, 10], random, {from: accounts[1]});
            await expectRevert(tx2, "Price already revealed or not valid");
        });

        it("Should revert reveal if not whitelisted", async () => {
            let prices = [500, 200, 300];
            let random = getRandom();
            let hash = submitHash([0, 1, 2], prices, random, accounts[1]);
            await voterWhitelister.requestFullVoterWhitelisting(accounts[1]);
            
            await setGetFtsosMock([0, 1, 2]);
            let tx = await priceSubmitter.submitHash(epochId, hash, {from: accounts[1]});
            expectEvent(tx, "HashSubmitted", {submitter: accounts[1], epochId: toBN(epochId), hash: hash});
            await ftsos[0].initializeCurrentEpochStateForReveal(10000, false, {from: accounts[10]});
            await ftsos[1].initializeCurrentEpochStateForReveal(10000, false, {from: accounts[10]});
            await ftsos[2].initializeCurrentEpochStateForReveal(10000, false, {from: accounts[10]});
            
            // Kick 1 out
            await voterWhitelister.setMaxVotersForFtso(0, 1, {from : GOVERNANCE_GENESIS_ADDRESS});
            await setBatchMockVotePower([0, 10]);
            await voterWhitelister.requestFullVoterWhitelisting(accounts[2]);

            await increaseTimeTo((epochId + 1) * 120); // reveal period start
            let tx2 = priceSubmitter.revealPrices(epochId, [0, 1, 2], prices, random, {from: accounts[1]});
            await expectRevert(tx2, ERR_NOT_WHITELISTED);
            
            // Nothing should happen here
            let ftso0Event = await ftsos[0].getPastEvents("PriceRevealed");
            let ftso1Event = await ftsos[1].getPastEvents("PriceRevealed");
            let ftso2Event = await ftsos[2].getPastEvents("PriceRevealed");
            
            assert.isEmpty(ftso0Event);
            assert.isEmpty(ftso1Event);
            assert.isEmpty(ftso2Event);
        });

        it("Should revert reveal if too small random", async () => {
            let prices = [500, 200, 300];
            let random = toBN(5);
            let hash = submitHash([0, 1, 2], prices, random, accounts[1]);
            await voterWhitelister.requestFullVoterWhitelisting(accounts[1]);
            
            await setGetFtsosMock([0, 1, 2]);
            let tx = await priceSubmitter.submitHash(epochId, hash, {from: accounts[1]});
            expectEvent(tx, "HashSubmitted", {submitter: accounts[1], epochId: toBN(epochId), hash: hash});
            await ftsos[0].initializeCurrentEpochStateForReveal(10000, false, {from: accounts[10]});
            await ftsos[1].initializeCurrentEpochStateForReveal(10000, false, {from: accounts[10]});
            await ftsos[2].initializeCurrentEpochStateForReveal(10000, false, {from: accounts[10]});

            await increaseTimeTo((epochId + 1) * 120); // reveal period start
            let tx2 = priceSubmitter.revealPrices(epochId, [0, 1, 2], prices, random, {from: accounts[1]});
            await expectRevert(tx2, "Too small random number");
            
            // Nothing should happen here
            let ftso0Event = await ftsos[0].getPastEvents("PriceRevealed");
            let ftso1Event = await ftsos[1].getPastEvents("PriceRevealed");
            let ftso2Event = await ftsos[2].getPastEvents("PriceRevealed");
            
            assert.isEmpty(ftso0Event);
            assert.isEmpty(ftso1Event);
            assert.isEmpty(ftso2Event);
        });

        it("Should not allow price shadowing", async () => {
            // This tests against an attacker that just copies submitted commit hash and sends 
            // the same revealed price without doing anything else
            // This is mitigated by including sender's address in the hash before reveal.
            let prices = [500, 200];
            let pricesBN = prices.map(x => toBN(x));
            let random = getRandom();
            let addresses = [ftsos[0].address, ftsos[1].address];
            let hash = submitHash([0, 1], prices, random, accounts[1]);
            let hashAttacker = hash; // Copy sent hash

            await voterWhitelister.requestFullVoterWhitelisting(accounts[1]);
            await voterWhitelister.requestFullVoterWhitelisting(accounts[2]);

            await setGetFtsosMock([0, 1]);
            let tx = await priceSubmitter.submitHash(epochId, hash, {from: accounts[1]});
            let txAttacker = await priceSubmitter.submitHash(epochId, hashAttacker, {from: accounts[2]});

            expectEvent(tx, "HashSubmitted", {submitter: accounts[1], epochId: toBN(epochId), hash: hash});
            expectEvent(txAttacker, "HashSubmitted", {submitter: accounts[2], epochId: toBN(epochId), hash: hash});
            
            await ftsos[0].initializeCurrentEpochStateForReveal(10000, false, {from: accounts[10]});
            await ftsos[1].initializeCurrentEpochStateForReveal(10000, false, {from: accounts[10]});
            await ftsos[2].initializeCurrentEpochStateForReveal(10000, false, {from: accounts[10]});
            
            await increaseTimeTo((epochId + 1) * 120); // reveal period start
            let tx2 = await priceSubmitter.revealPrices(epochId, [0, 1], prices, random, {from: accounts[1]});

            expectEvent(tx2, "PricesRevealed", {voter: accounts[1], epochId: toBN(epochId), ftsos: addresses, prices: pricesBN, random: random});

            const f0e1 = lastOf(await ftsos[0].getPastEvents("PriceRevealed"));
            const f1e1 = lastOf(await ftsos[1].getPastEvents("PriceRevealed"));

            // First submit should succeed
            expect(f0e1.args.voter).to.equals(accounts[1]);
            expect(f0e1.args.epochId.toNumber()).to.equals(epochId);
            expect(f0e1.args.price.toNumber()).to.equals(prices[0]);
            expect(f1e1.args.voter).to.equals(accounts[1]);
            expect(f1e1.args.epochId.toNumber()).to.equals(epochId);
            expect(f1e1.args.price.toNumber()).to.equals(prices[1]);

            let tx2Attacker = priceSubmitter.revealPrices(epochId, [0, 1], prices, random, {from: accounts[2]});
            // Copy attacker should not succeed in submitting the final price
            await expectRevert(tx2Attacker, "Price already revealed or not valid");
            
            // No correct prices should be revealed
            const f0e2 = lastOf(await ftsos[0].getPastEvents("PriceRevealed"));
            const f1e2 = lastOf(await ftsos[1].getPastEvents("PriceRevealed"));
            
            assert.isUndefined(f0e2);
            assert.isUndefined(f1e2);
        });

        it("Should revert on wrong argument len: reveal", async () => {
            let prices = [500, 200, 300];
            let pricesBN = prices.map(x => toBN(x));
            let random = getRandom();
            let addresses = [ftsos[0].address, ftsos[1].address, ftsos[2].address];
            let hash = submitHash([0, 1, 2], prices, random, accounts[1]);
            
            await voterWhitelister.requestFullVoterWhitelisting(accounts[1]);
            
            await setGetFtsosMock([0, 1, 2]);
            let tx = await priceSubmitter.submitHash(epochId, hash, {from: accounts[1]});
            expectEvent(tx, "HashSubmitted", {submitter: accounts[1], epochId: toBN(epochId), hash: hash});
            await ftsos[0].initializeCurrentEpochStateForReveal(10000, false, {from: accounts[10]});
            await ftsos[1].initializeCurrentEpochStateForReveal(10000, false, {from: accounts[10]});
            await ftsos[2].initializeCurrentEpochStateForReveal(10000, false, {from: accounts[10]});

            await increaseTimeTo((epochId + 1) * 120); // reveal period start
            // Wrong ftso id len
            let tx2 = priceSubmitter.revealPrices(epochId, [0, 1, 2, 3], prices, random, {from: accounts[1]});
            await expectRevert(tx2, ERR_ARRAY_LENGTHS);
            // Wrong prices len
            tx2 = priceSubmitter.revealPrices(epochId, [0, 1, 2], prices.concat(prices), random, {from: accounts[1]});
            await expectRevert(tx2, ERR_ARRAY_LENGTHS);
            
            // This should go through
            tx2 = priceSubmitter.revealPrices(epochId, [0, 1, 2], prices, random, {from: accounts[1]});
            expectEvent(await tx2, "PricesRevealed", {voter: accounts[1], epochId: toBN(epochId), ftsos: addresses, prices: pricesBN, random: random});
            
            let ftso0Event = lastOf(await ftsos[0].getPastEvents("PriceRevealed"));
            let ftso1Event = lastOf(await ftsos[1].getPastEvents("PriceRevealed"));
            let ftso2Event = lastOf(await ftsos[2].getPastEvents("PriceRevealed"));
            expect(ftso0Event.args.voter).to.equals(accounts[1]);
            expect(ftso0Event.args.epochId.toNumber()).to.equals(epochId);
            expect(ftso0Event.args.price.toNumber()).to.equals(prices[0]);
            expect(ftso1Event.args.voter).to.equals(accounts[1]);
            expect(ftso1Event.args.epochId.toNumber()).to.equals(epochId);
            expect(ftso1Event.args.price.toNumber()).to.equals(prices[1]);
            expect(ftso2Event.args.voter).to.equals(accounts[1]);
            expect(ftso2Event.args.epochId.toNumber()).to.equals(epochId);
            expect(ftso2Event.args.price.toNumber()).to.equals(prices[2]);
        });

        it("Should not set address updater if not governance", async() => {
            let tx = priceSubmitter.setAddressUpdater(ADDRESS_UPDATER, {from: accounts[10]});

            await expectRevert(tx, ERR_ONLY_GOVERNANCE);
        });

        it("Should not update address updater", async() => {
            let tx = priceSubmitter.setAddressUpdater(ADDRESS_UPDATER, {from: GOVERNANCE_GENESIS_ADDRESS});

            await expectRevert(tx, ERR_ALREADY_SET);
        });

        it("Should not set addresses if not address updater", async() => {
            let tx = priceSubmitter.updateContractAddresses(
                encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_REGISTRY, Contracts.VOTER_WHITELISTER, Contracts.FTSO_MANAGER]),
                [ADDRESS_UPDATER, mockFtsoRegistry.address, voterWhitelister.address, FTSO_MANAGER_ADDRESS], {from: accounts[10]});

            await expectRevert(tx, ERR_ONLY_ADDRESS_UPDATER);
        });

        it("Should set contract addresses", async ()=> {
            await priceSubmitter.updateContractAddresses(
                encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_REGISTRY, Contracts.VOTER_WHITELISTER, Contracts.FTSO_MANAGER]),
                [ADDRESS_UPDATER, mockFtsoRegistry.address, voterWhitelister.address, FTSO_MANAGER_ADDRESS], {from: ADDRESS_UPDATER});
            
            assert.equal(
                ADDRESS_UPDATER, 
                await priceSubmitter.getAddressUpdater()
            )

            assert.equal(
                mockFtsoRegistry.address, 
                await priceSubmitter.getFtsoRegistry()
            )

            assert.equal(
                voterWhitelister.address, 
                await priceSubmitter.getVoterWhitelister()
            )

            assert.equal(
                FTSO_MANAGER_ADDRESS, 
                await priceSubmitter.getFtsoManager()
            )

        });

        it("Should get random", async() => {
            let prices1 = [500, 200, 300];
            let random1 = getRandom();
            let hash1 = submitHash([0, 1, 2], prices1, random1, accounts[1]);

            let prices2 = [550, 220];
            let random2 = getRandom();
            let hash2 = submitHash([0, 1], prices2, random2, accounts[2]);
            
            await voterWhitelister.requestFullVoterWhitelisting(accounts[1]);
            await voterWhitelister.requestFullVoterWhitelisting(accounts[2]);
            
            await priceSubmitter.submitHash(epochId, hash1, {from: accounts[1]});
            await priceSubmitter.submitHash(epochId, hash2, {from: accounts[2]});
            
            await ftsos[0].initializeCurrentEpochStateForReveal(10000, false, {from: accounts[10]});
            await ftsos[1].initializeCurrentEpochStateForReveal(10000, false, {from: accounts[10]});
            await ftsos[2].initializeCurrentEpochStateForReveal(10000, false, {from: accounts[10]});

            let random: BN;
            random = await priceSubmitter.getCurrentRandom();
            assert(random.eq(toBN(0)));
            random = await priceSubmitter.getRandom(epochId);
            assert(random.eq(toBN(0)));
            
            await increaseTimeTo((epochId + 1) * 120); // reveal period start
            
            await setGetFtsosMock([0, 1, 2]);
            await priceSubmitter.revealPrices(epochId, [0, 1, 2], prices1, random1, {from: accounts[1]});

            let prices_random = [[prices1, random1]];
            let computedRandom = computeVoteRandom2(prices_random);

            random = await priceSubmitter.getCurrentRandom();
            assert(random.eq(toBN(computedRandom)));
            random = await priceSubmitter.getRandom(epochId - 1);
            assert(random.eq(toBN(0)));
            random = await priceSubmitter.getRandom(epochId);
            assert(random.eq(toBN(computedRandom)));
            random = await priceSubmitter.getRandom(epochId + 1);
            assert(random.eq(toBN(0)));

            await setGetFtsosMock([0, 1]);
            await priceSubmitter.revealPrices(epochId, [0, 1], prices2, random2, {from: accounts[2]});

            prices_random.push([prices2, random2]);
            computedRandom = computeVoteRandom2(prices_random);

            random = await priceSubmitter.getCurrentRandom();
            assert(random.eq(toBN(computedRandom)));
            random = await priceSubmitter.getRandom(epochId - 1);
            assert(random.eq(toBN(0)));
            random = await priceSubmitter.getRandom(epochId);
            assert(random.eq(toBN(computedRandom)));
            random = await priceSubmitter.getRandom(epochId + 1);
            assert(random.eq(toBN(0)));

            for(let diff of [-1, 0, 1]){
                for(let ftsoIndex of [0, 1, 2]){
                    assert(calculateRandom(await priceSubmitter.getRandom(epochId + diff), ftsos[ftsoIndex].address).eq(await ftsos[ftsoIndex].getRandom(epochId + diff)));
                }
            }

            for(let ftsoIndex of [0, 1, 2]){
                assert(calculateRandom(await priceSubmitter.getCurrentRandom(), ftsos[ftsoIndex].address).eq(await ftsos[ftsoIndex].getCurrentRandom()));
            }
        });

        it("Should get current random for epoch 0", async () => {
            // Force a block in order to get most up to date time
            await time.advanceBlock();
            // Get the timestamp for the just mined block
            let timestamp = await time.latest();

            mockFtsoManager = await FtsoManager.new(
                GOVERNANCE_GENESIS_ADDRESS,
                GOVERNANCE_GENESIS_ADDRESS,
                ADDRESS_UPDATER,
                constants.ZERO_ADDRESS,
                timestamp,
                120,
                60,
                timestamp.toNumber() + 180,
                240,
                7
            );
                
            await priceSubmitter.updateContractAddresses(
                encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_REGISTRY, Contracts.VOTER_WHITELISTER, Contracts.FTSO_MANAGER]),
                [ADDRESS_UPDATER, mockFtsoRegistry.address, voterWhitelister.address, mockFtsoManager.address], {from: ADDRESS_UPDATER});
    
            let random = await priceSubmitter.getCurrentRandom();
            expect(random.toNumber()).to.equals(0);
        });

    });
});
