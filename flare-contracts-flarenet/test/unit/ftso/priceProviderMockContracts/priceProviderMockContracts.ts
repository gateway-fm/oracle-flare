import { 
    IFtsoRegistryInstance, 
    IVoterWhitelisterInstance,
    IPriceSubmitterInstance,
} from "../../../../typechain-truffle";
import { MIN_RANDOM } from "../../../utils/constants";
import { getRandom, increaseTimeTo, submitHash, toBN } from "../../../utils/test-helpers";


const {expectRevert, expectEvent, time} = require('@openzeppelin/test-helpers');

const MockPriceSubmitter = artifacts.require("MockPriceSubmitter");
const MockFtsoRegistry = artifacts.require("MockFtsoRegistry");
const MockVoterWhitelister = artifacts.require("MockVoterWhitelister");

contract(`MockPriceSubmitter.sol; MockPriceSubmitter unit tests`, async accounts => {
      
    let priceSubmitter: IPriceSubmitterInstance;
    let ftsoRegistry: IFtsoRegistryInstance;
    let voterWhitelister: IVoterWhitelisterInstance;

    beforeEach(async() => {
        const MockPriceSubmitterInstance = await MockPriceSubmitter.new("0x0000000000000000000000000000000000000000");
        priceSubmitter = MockPriceSubmitterInstance;
        ftsoRegistry = await MockFtsoRegistry.at(await priceSubmitter.getFtsoRegistry());
        voterWhitelister = await MockVoterWhitelister.at(await priceSubmitter.getVoterWhitelister());
    });
  
    describe("Test usage", async() => {

        it("Should output sample hashes", async() => {
            const ftsoIndices = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
            const randoms = [MIN_RANDOM, MIN_RANDOM.addn(5), MIN_RANDOM.addn(1059), MIN_RANDOM.addn(10682), MIN_RANDOM.addn(159726)];
            const prices = [0, 1, 2, 3, 5, 10, 50, 100, 101, 10**5 + 1, 10**8];
            const addrs = [accounts[10], accounts[11], accounts[12], accounts[13]];
            if(false){ // enable this branch to get example hashes
                console.log(`Prices: ${prices}`);
                for(let addr of addrs){
                    console.log(`Address: ${addr}`);
                    for(let random of randoms){
                        console.log(`\tRandom: ${random}`)
                        const hash = submitHash(ftsoIndices, prices, random, addr);
                        console.log(`\t\t${hash}`); 
                    } 
                }
            }
        });

        it("Should fail on submit without whitelisting", async() => {
            const hash = submitHash([1], [500], 123, accounts[10]);
            let tx = priceSubmitter.submitHash(1, hash, {from: accounts[10]});
            await expectRevert(tx, "Not whitelisted");
        });

        it("Should revert price submission on double submission", async() => {
            const hash = submitHash([1], [500], 123, accounts[10]);
            await voterWhitelister.requestFullVoterWhitelisting(accounts[10]);
            await priceSubmitter.submitHash(1, hash, {from: accounts[10]});
            await expectRevert(priceSubmitter.submitHash(1, hash, {from: accounts[10]}), "Duplicate submit in epoch");
        });

        it("Should revert price submission on wrong epoch id", async() => {
            const hash = submitHash([1], [500], 123, accounts[10]);
            await voterWhitelister.requestFullVoterWhitelisting(accounts[10]);
            await expectRevert(priceSubmitter.submitHash(0, hash, {from: accounts[10]}), "Wrong epoch id");
            await expectRevert(priceSubmitter.submitHash(2, hash, {from: accounts[10]}), "Wrong epoch id");
        });

        it("Should submit and reveal", async() => {
            // Mock prices: 
            const prices = [500, 400, 100];
            // In a real environment, they would come from some external api, be calculated...
            // Mock random:
            const random = getRandom();

            // Ftsos for symbols that are deployed by mock contract
            let ftso0 = await ftsoRegistry.getFtsoBySymbol("XRP");
            let ftso1 = await ftsoRegistry.getFtsoBySymbol("XLM");
            let ftso2 = await ftsoRegistry.getFtsoBySymbol("BCH");

            let ftso0Ind = await ftsoRegistry.getFtsoIndex("XRP");
            let ftso1Ind = await ftsoRegistry.getFtsoIndex("XLM");
            let ftso2Ind = await ftsoRegistry.getFtsoIndex("BCH");

            const hash = submitHash([ftso0Ind, ftso1Ind, ftso2Ind], prices, random, accounts[10]);

            await voterWhitelister.requestFullVoterWhitelisting(accounts[10]);
            let tx = await priceSubmitter.submitHash(1, hash, {from: accounts[10]});

            expectEvent(tx, "HashSubmitted", { epochId: "1", hash: hash});

            

            let timestamp = await time.latest() as BN;
            await increaseTimeTo(timestamp.addn(120).toNumber());

            // Should fail on too small random
            let tx1 = priceSubmitter.revealPrices(1, [ftso0Ind, ftso1Ind, ftso2Ind], prices, MIN_RANDOM.subn(1), {from: accounts[10]});

            await expectRevert(tx1, "Too small random number");

            // Do reveal
            tx = await priceSubmitter.revealPrices(1, [ftso0Ind, ftso1Ind, ftso2Ind], prices, random, {from: accounts[10]});

            await expectEvent(tx, "PricesRevealed", { ftsos: [ftso0, ftso1, ftso2],
                                                      epochId: "1", 
                                                      prices: [toBN(prices[0]), toBN(prices[1]), toBN(prices[2])],
                                                      random: random});
            
            // Should fail on double reveal
            tx1 = priceSubmitter.revealPrices(1, [ftso0Ind, ftso1Ind, ftso2Ind], prices, random, {from: accounts[10]});
            
            await expectRevert(tx1, "Price already revealed or not valid");
        });

        it("Should fail if revealed to soon", async() => {
            let ftso0 = await ftsoRegistry.getFtso(0);
            let ftso1 = await ftsoRegistry.getFtso(1);
            let ftso2 = await ftsoRegistry.getFtso(2);

            await voterWhitelister.requestWhitelistingVoter(accounts[10], 2);
            await voterWhitelister.requestWhitelistingVoter(accounts[10], 1);
            await voterWhitelister.requestWhitelistingVoter(accounts[10], 0);
            
            let random = getRandom();
            const hash = submitHash([0, 1, 2], [500, 500, 100], random, accounts[10]);

            let tx = await priceSubmitter.submitHash(1, hash, {from: accounts[10]});

            expectEvent(tx, "HashSubmitted", { epochId: "1", hash: hash });


            let timestamp = await time.latest() as BN;
            // Not yet in new epoch
            await increaseTimeTo(timestamp.addn(60).toNumber());
            // Do reveal
            let tx1 = priceSubmitter.revealPrices(1, [0, 1, 2], [500, 500, 100], random, {from: accounts[10]});
            await expectRevert(tx1, "Reveal period not active");

            await increaseTimeTo(timestamp.addn(120).toNumber());
            tx = await priceSubmitter.revealPrices(1, [0, 1, 2], [500, 500, 100], random, {from: accounts[10]});

            await expectEvent(tx, "PricesRevealed", { ftsos: [ftso0, ftso1, ftso2], epochId: "1", prices: [toBN(500), toBN(500), toBN(100)], random: random});

        });

    });
  
  });
  