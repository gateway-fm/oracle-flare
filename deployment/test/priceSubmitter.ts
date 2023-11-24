import { getRandom, submitHash, toBN } from "../../test/utils/test-helpers";
import { FtsoManagerContract, FtsoManagerInstance, PriceSubmitterContract, PriceSubmitterInstance } from "../../typechain-truffle";
import { Contracts } from "../scripts/Contracts";

let PriceSubmitter: PriceSubmitterContract;
let priceSubmitter: PriceSubmitterInstance;
let FtsoManager: FtsoManagerContract;
let ftsoManager: FtsoManagerInstance;

contract(`PriceSubmitter gas usage tests`, async accounts => {

    let contracts: Contracts;
    let account = accounts[5]; // should already be whitelisted
    let gasPrice = toBN(2250000000000);
    let price = 200000;
    let index = 1;
    let gas = 800000;
    let random = getRandom();

    before(async() => {
        contracts = new Contracts();
        await contracts.deserialize(process.stdin);

        PriceSubmitter = artifacts.require("PriceSubmitter");
        priceSubmitter = await PriceSubmitter.at(contracts.getContractAddress(Contracts.PRICE_SUBMITTER));

        FtsoManager = artifacts.require("FtsoManager");
        ftsoManager = await FtsoManager.at(await priceSubmitter.getFtsoManager());
    });

    describe("submit and reveal price gas usage", async() => {
        it("Should submit price", async() => {
            let hash = submitHash([index], [price], random, account);

            let initialBalance = toBN(await web3.eth.getBalance(account));
            console.log(initialBalance.toString());
            
            let epochId = await ftsoManager.getCurrentPriceEpochId();
            let tx = await priceSubmitter.submitHash(epochId, hash, { from: account, gasPrice: gasPrice, gas: gas });
            let gasUsed = toBN(tx.receipt.gasUsed);
            console.log(gasUsed.toString());

            let finalBalance = toBN(await web3.eth.getBalance(account));
            console.log(finalBalance.toString());
            let balanceDiff = initialBalance.sub(finalBalance);
            console.log("Balance diff: " + balanceDiff.toString());
            console.log("Tx value: " + gasUsed.mul(gasPrice).toString());

            expect(balanceDiff.eq(gasUsed.mul(gasPrice))).to.be.true;
        });
        
        it("Should reveal price", async() => {
            // submit price
            let hash = submitHash([index], [price], random, account);

            let epochId = await ftsoManager.getCurrentPriceEpochId();
            await priceSubmitter.submitHash(epochId, hash, { from: account, gasPrice: gasPrice, gas: gas });

            // wait
            let priceEpochData = await ftsoManager.getPriceEpochConfiguration();

            console.log(priceEpochData[0].add((epochId.addn(1)).mul(priceEpochData[1])).add(priceEpochData[2].divn(10)).toString());
            console.log(Math.floor(Date.now() / 1000));

            while(priceEpochData[0].add((epochId.addn(1)).mul(priceEpochData[1])).add(priceEpochData[2].divn(10)).gt(toBN(Date.now()).divn(1000))) {
                await new Promise(resolve => {
                    setTimeout(resolve, 5000);
                });
                console.log("waiting");
                console.log(toBN(Date.now()).divn(1000).toString());
            }

            // reveal price
            let initialBalance = toBN(await web3.eth.getBalance(account));
            console.log(initialBalance.toString());

            let tx2 = await priceSubmitter.revealPrices(epochId, [index], [price], random, { from: account, gasPrice: gasPrice, gas: gas });
            
            let gasUsed = toBN(tx2.receipt.gasUsed);
            console.log(gasUsed.toString());

            let finalBalance = toBN(await web3.eth.getBalance(account));
            console.log(finalBalance.toString());
            let balanceDiff = initialBalance.sub(finalBalance);
            console.log("Balance diff: " + balanceDiff.toString());
            console.log("Tx value: " + gasUsed.mul(gasPrice).toString());

            expect(balanceDiff.lt(gasUsed.mul(gasPrice))).to.be.true;
        });

        it("Should revert at reveal price", async() => {
            // submit price
            let hash = submitHash([index], [price], random, account);

            let epochId = await ftsoManager.getCurrentPriceEpochId();
            await priceSubmitter.submitHash(epochId, hash, { from: account, gasPrice: gasPrice, gas: gas });

            // wait
            let priceEpochData = await ftsoManager.getPriceEpochConfiguration();

            console.log(priceEpochData[0].add((epochId.addn(1)).mul(priceEpochData[1])).add(priceEpochData[2].divn(10)).toString());
            console.log(Math.floor(Date.now() / 1000));

            while(priceEpochData[0].add((epochId.addn(1)).mul(priceEpochData[1])).add(priceEpochData[2].divn(10)).gt(toBN(Date.now()).divn(1000))) {
                await new Promise(resolve => {
                    setTimeout(resolve, 5000);
                });
                console.log("waiting");
                console.log(toBN(Date.now()).divn(1000).toString());
            }

            // reveal price
            let initialBalance = toBN(await web3.eth.getBalance(account));
            console.log(initialBalance.toString());

            let gasUsed = toBN(0);
            try {
                // will always revert
                await priceSubmitter.revealPrices(epochId, [index], [price + 1], random, { from: account, gasPrice: gasPrice, gas: gas });
            } catch(e: any) {
                gasUsed = toBN(e.receipt.gasUsed);
            }
            console.log(gasUsed.toString());

            let finalBalance = toBN(await web3.eth.getBalance(account));
            console.log(finalBalance.toString());
            let balanceDiff = initialBalance.sub(finalBalance);
            console.log("Balance diff: " + balanceDiff.toString());
            console.log("Tx value: " + gasUsed.mul(gasPrice).toString());

            expect(balanceDiff.eq(gasUsed.mul(gasPrice))).to.be.true;
        });
    });
});
