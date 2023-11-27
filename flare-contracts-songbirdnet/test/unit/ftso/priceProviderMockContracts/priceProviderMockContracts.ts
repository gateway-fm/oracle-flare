import { 
    IFtsoRegistryInstance, 
    IVoterWhitelisterInstance,
    IPriceSubmitterInstance,
} from "../../../../typechain-truffle";
import { increaseTimeTo, submitPriceHash, toBN } from "../../../utils/test-helpers";


const {expectRevert, expectEvent, time} = require('@openzeppelin/test-helpers');

const MockPriceSubmitter = artifacts.require("MockPriceSubmitter");
const MockFtsoRegistry = artifacts.require("MockFtsoRegistry");
const MockVoterWhitelister = artifacts.require("MockVoterWhitelister");

contract(`MockPriceSubmitter.sol; MockPriceSubmitter unit tests`, async accounts => {
      
    let priceSubmitter: IPriceSubmitterInstance;
    let ftsoRegistry: IFtsoRegistryInstance;
    let voterWhitelister: IVoterWhitelisterInstance;

    beforeEach(async() => {
        const MockPriceSubmitterInstance = await MockPriceSubmitter.new();
        priceSubmitter = MockPriceSubmitterInstance;
        ftsoRegistry = await MockFtsoRegistry.at(await priceSubmitter.getFtsoRegistry());
        voterWhitelister = await MockVoterWhitelister.at(await priceSubmitter.getVoterWhitelister());
    });
  
    describe("Test usage", async() => {

        it("Should output sample hashes", async() => {
            const randoms = [0, 1, 2, 3, 5, 10, 50, 100, 101, 10**5 + 1, 10**20];
            const prices = randoms;
            const addrs = [accounts[10], accounts[11], accounts[12], accounts[13]];
            if(false){ // enable this branch to get example hashes
                console.log(`Prices: ${prices}`);
                for(let addr of addrs){
                    console.log(`Address: ${addr}`);
                    for(let random of randoms){
                        console.log(`\tRandom: ${random}`)
                        const hashes = prices.map(p => submitPriceHash(p, random, addr));
                        console.log(`\t\t${hashes}`); 
                    } 
                }
            }
        });

        it("Should fail on submit without whitelisting", async() => {
            const hash1 = submitPriceHash(500, 123, accounts[10]);
            let tx = priceSubmitter.submitPriceHashes(1, [1], [hash1], {from: accounts[10]});
            await expectRevert(tx, "Not whitelisted");
        });

        it("Should revert price submission on double submission", async() => {
            const hash1 = submitPriceHash(500, 123, accounts[1]);
            await voterWhitelister.requestFullVoterWhitelisting(accounts[10]);
            await priceSubmitter.submitPriceHashes(1, [1], [hash1], {from: accounts[10]});
            await expectRevert(priceSubmitter.submitPriceHashes(1, [1], [hash1], {from: accounts[10]}), "Duplicate submit in epoch");
        });

        it("Should revert price submission on wrong epoch id", async() => {
            const hash1 = submitPriceHash(500, 123, accounts[1]);
            await voterWhitelister.requestFullVoterWhitelisting(accounts[10]);
            await expectRevert(priceSubmitter.submitPriceHashes(0, [1], [hash1], {from: accounts[10]}), "Wrong epoch id");
            await expectRevert(priceSubmitter.submitPriceHashes(2, [1], [hash1], {from: accounts[10]}), "Wrong epoch id");
        });

        it("Should submit and reveal", async() => {
            // Mock prices: 
            const prices = [500, 400, 100];
            // In a real environment, they would come from some external api, be calculated...
            // Mock randoms:
            const randoms = [27182, 81828, 45904]
            const hash0 = submitPriceHash(prices[0], randoms[0], accounts[10]);
            const hash1 = submitPriceHash(prices[1], randoms[1], accounts[10]);
            const hash2 = submitPriceHash(prices[2], randoms[2], accounts[10]);

            // Ftsos for symbols that are deployed by mock contract
            let ftso0 = await ftsoRegistry.getFtsoBySymbol("XRP");
            let ftso1 = await ftsoRegistry.getFtsoBySymbol("XLM");
            let ftso2 = await ftsoRegistry.getFtsoBySymbol("BCH");

            let ftso0Ind = await ftsoRegistry.getFtsoIndex("XRP");
            let ftso1Ind = await ftsoRegistry.getFtsoIndex("XLM");
            let ftso2Ind = await ftsoRegistry.getFtsoIndex("BCH");


            await voterWhitelister.requestFullVoterWhitelisting(accounts[10]);
            let tx = await priceSubmitter.submitPriceHashes(1, [ftso0Ind, ftso1Ind, ftso2Ind], [hash0, hash1, hash2], {from: accounts[10]});

            expectEvent(tx, "PriceHashesSubmitted", { ftsos: [ftso0, ftso1, ftso2], epochId: "1", hashes: [hash0, hash1, hash2]});

            

            let timestamp = await time.latest() as BN;
            await increaseTimeTo(timestamp.addn(120).toNumber());
            // Do reveal
            tx = await priceSubmitter.revealPrices(1, [ftso0Ind, ftso1Ind, ftso2Ind], prices, randoms, {from: accounts[10]});

            await expectEvent(tx, "PricesRevealed", { ftsos: [ftso0, ftso1, ftso2],
                                                        epochId: "1", prices: [toBN(prices[0]), toBN(prices[1]), toBN(prices[2])]});
            
            // Should fail on double reveal
            let tx1 = priceSubmitter.revealPrices(1, [ftso0Ind, ftso1Ind, ftso2Ind], prices, randoms, {from: accounts[10]});

            await expectRevert(tx1, "Price already revealed or not valid");
        });

        it("Should fail if revealed to soon", async() => {
            const hash0 = submitPriceHash(500, 123, accounts[10]);
            const hash1 = submitPriceHash(500, 123, accounts[10]);
            const hash2 = submitPriceHash(100, 30, accounts[10]);

            let ftso0 = await ftsoRegistry.getFtso(0);
            let ftso1 = await ftsoRegistry.getFtso(1);
            let ftso2 = await ftsoRegistry.getFtso(2);

            await voterWhitelister.requestWhitelistingVoter(accounts[10], 2);
            await voterWhitelister.requestWhitelistingVoter(accounts[10], 1);
            await voterWhitelister.requestWhitelistingVoter(accounts[10], 0);
            let tx = await priceSubmitter.submitPriceHashes(1, [0, 1, 2], [hash0, hash1, hash2], {from: accounts[10]});

            expectEvent(tx, "PriceHashesSubmitted", { ftsos: [ftso0, ftso1, ftso2], epochId: "1", hashes: [hash0, hash1, hash2]});


            let timestamp = await time.latest() as BN;
            // Not yet in new epoch
            await increaseTimeTo(timestamp.addn(60).toNumber());
            // Do reveal
            let tx1 = priceSubmitter.revealPrices(1, [0, 1, 2], [500, 500, 100], [123, 123, 30], {from: accounts[10]});
            await expectRevert(tx1, "Reveal period not active");

            await increaseTimeTo(timestamp.addn(120).toNumber());
            tx = await priceSubmitter.revealPrices(1, [0, 1, 2], [500, 500, 100], [123, 123, 30], {from: accounts[10]});

            await expectEvent(tx, "PricesRevealed", { ftsos: [ftso0, ftso1, ftso2], epochId: "1", prices: [toBN(500), toBN(500), toBN(100)]});

        });

    });
  
  });
  