import { expect } from "chai";
import { artifacts, contract } from "hardhat";
import { FtsoMedianMockContract, FtsoMedianMockInstance } from "../../../../typechain-truffle";
import { compareNumberArrays, toBN } from "../../../utils/test-helpers";

const getTestFile = require('../../../utils/constants').getTestFile;
const FtsoMedian = artifacts.require("FtsoMedianMock") as FtsoMedianMockContract;

contract(`FtsoMedian.sol; ${getTestFile(__filename)};  Ftso median unit tests`, async accounts => {
    // contains a fresh contract for each test
    let ftsoMedian: FtsoMedianMockInstance;

    // Do clean unit tests by spinning up a fresh contract for each test
    beforeEach(async () => {
        ftsoMedian = await FtsoMedian.new();
    });

    it(`Should swap indexes correctly`, async () => {
        let index: BN[] = [toBN(0),toBN(1),toBN(2),toBN(3),toBN(4)];
        index = await ftsoMedian.swap(1, 2, index);
        expect(index[0].toNumber()).to.equals(0);
        expect(index[1].toNumber()).to.equals(2);
        expect(index[2].toNumber()).to.equals(1);
        expect(index[3].toNumber()).to.equals(3);
        expect(index[4].toNumber()).to.equals(4);
    });

    it(`Should swap indexes correctly - do nothing`, async () => {
        let index: BN[] = [toBN(0),toBN(1),toBN(2),toBN(3),toBN(4)];
        index = await ftsoMedian.swap(2, 2, index);
        expect(index[0].toNumber()).to.equals(0);
        expect(index[1].toNumber()).to.equals(1);
        expect(index[2].toNumber()).to.equals(2);
        expect(index[3].toNumber()).to.equals(3);
        expect(index[4].toNumber()).to.equals(4);
    });

    it(`Should calculate partion data correctly`, async () => {
        let index: number[] = [0,1,2,3,4];
        let weight: number[] = [500,200,1000,300,500];
        let indexReturn: number[];
        
        let price: number[] = [30,35,40,35,50];
        let data = await ftsoMedian.partition(0, 4, 3, 0, 0, index, price, weight); // position, leftSum, rightSum
        expect(data[0].toNumber()).to.equals(1);
        expect(data[1].toNumber()).to.equals(500);
        expect(data[2].toNumber()).to.equals(1700);
        indexReturn = [0,3,2,4,1];
        compareNumberArrays(data[3], indexReturn);
        compareNumberArrays(data[4], price);
        compareNumberArrays(data[5], weight);

        let price2: number[] = [30,30,30,30,30];
        let data2 = await ftsoMedian.partition(0, 4, 3, 0, 0, index, price2, weight); // position, leftSum, rightSum
        expect(data2[0].toNumber()).to.equals(0);
        expect(data2[1].toNumber()).to.equals(0);
        expect(data2[2].toNumber()).to.equals(2200);
        indexReturn = [3,1,2,4,0];
        compareNumberArrays(data2[3], indexReturn);
        compareNumberArrays(data2[4], price2);
        compareNumberArrays(data2[5], weight);

        let price3: number[] = [30,35,40,35,50];
        let data3 = await ftsoMedian.partition(1, 4, 3, 500, 0, index, price3, weight); // position, leftSum, rightSum
        expect(data3[0].toNumber()).to.equals(1);
        expect(data3[1].toNumber()).to.equals(500);
        expect(data3[2].toNumber()).to.equals(1700);
        indexReturn = [0,3,2,4,1];
        compareNumberArrays(data3[3], indexReturn);
        compareNumberArrays(data3[4], price3);
        compareNumberArrays(data3[5], weight);

        let price4: number[] = [30,32,40,35,50];
        let data4 = await ftsoMedian.partition(1, 4, 3, 500, 0, index, price4, weight); // position, leftSum, rightSum
        expect(data4[0].toNumber()).to.equals(2);
        expect(data4[1].toNumber()).to.equals(700);
        expect(data4[2].toNumber()).to.equals(1500);
        indexReturn = [0,1,3,4,2];
        compareNumberArrays(data4[3], indexReturn);
        compareNumberArrays(data4[4], price4);
        compareNumberArrays(data4[5], weight);

        let price5: number[] = [30,35,40,35,50];
        let data5 = await ftsoMedian.partition(1, 3, 3, 500, 500, index, price5, weight); // position, leftSum, rightSum
        expect(data5[0].toNumber()).to.equals(1);
        expect(data5[1].toNumber()).to.equals(500);
        expect(data5[2].toNumber()).to.equals(1700);
        indexReturn = [0,3,2,1,4];
        compareNumberArrays(data5[3], indexReturn);
        compareNumberArrays(data5[4], price5);
        compareNumberArrays(data5[5], weight);

        let index2: number[] = [0,3,4,2,1];
        let price6: number[] = [30,35,40,35,50];
        let data6 = await ftsoMedian.partition(1, 4, 3, 500, 0, index2, price6, weight); // position, leftSum, rightSum
        expect(data6[0].toNumber()).to.equals(3);
        expect(data6[1].toNumber()).to.equals(1000);
        expect(data6[2].toNumber()).to.equals(500);
        indexReturn = [0,3,1,2,4];
        compareNumberArrays(data6[3], indexReturn);
        compareNumberArrays(data6[4], price6);
        compareNumberArrays(data6[5], weight);
    });

    it(`Should find same prices and calculate sums correctly`, async () => {
        let index: number[] = [0,1,2,3,4];
        let weight: number[] = [500,200,1000,300,500];
        let indexReturn: number[];
        
        let price: number[] = [30,35,40,40,50];
        let data = await ftsoMedian.samePriceFix(3, 4, 1, 500, index, price, weight); // index, sum
        expect(data[0].toNumber()).to.equals(3);
        expect(data[1].toNumber()).to.equals(500);
        indexReturn = [0,1,2,3,4];
        compareNumberArrays(data[2], indexReturn);
        compareNumberArrays(data[3], price);
        compareNumberArrays(data[4], weight);

        let price2: number[] = [30,35,40,35,50];
        let data2 = await ftsoMedian.samePriceFix(1, 0, -1, 500, index, price2, weight); // index, sum
        expect(data2[0].toNumber()).to.equals(1);
        expect(data2[1].toNumber()).to.equals(500);
        indexReturn = [0,1,2,3,4];
        compareNumberArrays(data2[2], indexReturn);
        compareNumberArrays(data2[3], price2);
        compareNumberArrays(data2[4], weight);

        let price3: number[] = [30,35,40,35,50];
        let data3 = await ftsoMedian.samePriceFix(1, 4, 1, 1800, index, price3, weight); // index, sum
        expect(data3[0].toNumber()).to.equals(2);
        expect(data3[1].toNumber()).to.equals(1500);
        indexReturn = [0,1,3,2,4];
        compareNumberArrays(data3[2], indexReturn);
        compareNumberArrays(data3[3], price3);
        compareNumberArrays(data3[4], weight);

        let price4: number[] = [30,40,35,40,50];
        let data4 = await ftsoMedian.samePriceFix(3, 0, -1, 1700, index, price4, weight); // index, sum
        expect(data4[0].toNumber()).to.equals(2);
        expect(data4[1].toNumber()).to.equals(1500);
        indexReturn = [0,2,1,3,4];
        compareNumberArrays(data4[2], indexReturn);
        compareNumberArrays(data4[3], price4);
        compareNumberArrays(data4[4], weight);

        let price5: number[] = [30,30,30,30,30];
        let data5 = await ftsoMedian.samePriceFix(3, 0, -1, 1700, index, price5, weight); // index, sum
        expect(data5[0].toNumber()).to.equals(0);
        expect(data5[1].toNumber()).to.equals(0);
        indexReturn = [0,1,2,3,4];
        compareNumberArrays(data5[2], indexReturn);
        compareNumberArrays(data5[3], price5);
        compareNumberArrays(data5[4], weight);

        let price6: number[] = [30,30,30,30,30];
        let data6 = await ftsoMedian.samePriceFix(1, 4, 1, 1800, index, price6, weight); // index, sum
        expect(data6[0].toNumber()).to.equals(4);
        expect(data6[1].toNumber()).to.equals(0);
        indexReturn = [0,1,2,3,4];
        compareNumberArrays(data6[2], indexReturn);
        compareNumberArrays(data6[3], price6);
        compareNumberArrays(data6[4], weight);
    });

    it(`Should find closest price correctly`, async () => {
        let index: number[] = [0,1,2,3,4];
        let price: number[] = [30,35,38,36,50];
        let value = await ftsoMedian.closestPriceFix(1, 4, index, price);
        expect(value.toNumber()).to.equals(36);
    });

    it(`Should find closest price correctly - example that should never happen`, async () => {
        let index: number[] = [0,1,2,3,4];
        let price: number[] = [30,35,38,36,50];
        let value = await ftsoMedian.closestPriceFix(4, 4, index, price);
        expect(value.toNumber()).to.equals(50);
    });

    it(`Should compute weighted median correctly`, async () => {
        let weight: number[] = [500,200,1000,300,500];
        
        let price: number[] = [30,35,40,35,50];
        let data = await ftsoMedian.computeWeighted(price, weight);
        compareNumberArrays(data[2], price);
        compareNumberArrays(data[3], weight);
        let index = data[0];
        expect(index.length).to.equals(5);
        let d = data[1];
        expect(d.quartile1Index).to.equals('1');
        expect(d.quartile3Index).to.equals('3');
        expect(d.lowWeightSum).to.equals('500');
        expect(d.rewardedWeightSum).to.equals('1500');
        expect(d.highWeightSum).to.equals('500');
        expect(Number(d.leftSum) + Number(d.medianWeight) + Number(d.rightSum)).to.equals(2500);
        expect(d.finalMedianPrice).to.equals('40');
        expect(d.quartile1Price).to.equals('35');
        expect(d.quartile3Price).to.equals('40');
    });

    it(`Should compute weighted median correctly - same prices`, async () => {
        let weight: number[] = [500,200,1000,300,500];
        
        let price: number[] = [40,40,40,40,40];
        let data = await ftsoMedian.computeWeighted(price, weight);
        compareNumberArrays(data[2], price);
        compareNumberArrays(data[3], weight);
        let index = data[0];
        expect(index.length).to.equals(5);
        let d = data[1];
        expect(d.quartile1Index).to.equals('0');
        expect(d.quartile3Index).to.equals('4');
        expect(d.lowWeightSum).to.equals('0');
        expect(d.rewardedWeightSum).to.equals('2500');
        expect(d.highWeightSum).to.equals('0');
        expect(Number(d.leftSum) + Number(d.medianWeight) + Number(d.rightSum)).to.equals(2500);
        expect(d.finalMedianPrice).to.equals('40');
        expect(d.quartile1Price).to.equals('40');
        expect(d.quartile3Price).to.equals('40');
    });

    it(`Should compute weighted median correctly - middle price`, async () => {
        let weight: number[] = [500,200,400,300,800];
        
        let price: number[] = [25,20,30,50,40];
        let data = await ftsoMedian.computeWeighted(price, weight);
        compareNumberArrays(data[2], price);
        compareNumberArrays(data[3], weight);
        let index = data[0];
        expect(index.length).to.equals(5);
        let d = data[1];
        expect(d.quartile1Index).to.equals('1');
        expect(d.quartile3Index).to.equals('3');
        expect(d.lowWeightSum).to.equals('200');
        expect(d.rewardedWeightSum).to.equals('1700');
        expect(d.highWeightSum).to.equals('300');
        expect(Number(d.leftSum) + Number(d.medianWeight) + Number(d.rightSum)).to.equals(2200);
        expect(d.finalMedianPrice).to.equals('35');
        expect(d.quartile1Price).to.equals('25');
        expect(d.quartile3Price).to.equals('40');
    });

    it(`Should compute weighted median correctly - quartile prices`, async () => {
        let weight: number[] = [20,20,20,20,20];

        let price: number[] = [10,20,30,40,50];
        let data = await ftsoMedian.computeWeighted(price, weight);
        compareNumberArrays(data[2], price);
        compareNumberArrays(data[3], weight);
        let index = data[0];
        expect(index.length).to.equals(5);
        let d = data[1];
        expect(d.quartile1Index).to.equals('1');
        expect(d.quartile3Index).to.equals('3');
        expect(d.quartile1Price).to.equals('20');
        expect(d.quartile3Price).to.equals('40');
    });

    it(`Should compute simple median correctly`, async () => {
        let prices: number[] = [50,20,40,10,30];
        const {0: finalMedianPrice, 1: sortedPrices} = await ftsoMedian.computeSimple(prices);

        prices = prices.sort();
        compareNumberArrays(sortedPrices, prices);
        expect(finalMedianPrice.toString()).to.equals('30');
    });

    it(`Should compute simple median correctly - middle price`, async () => {
        let prices: number[] = [50,20,40,10];
        const {0: finalMedianPrice, 1: sortedPrices} = await ftsoMedian.computeSimple(prices);

        prices = prices.sort();
        compareNumberArrays(sortedPrices, prices);
        expect(finalMedianPrice.toString()).to.equals('30');
    });

    it(`Should show that a single hacked key can't skew the fall back price result`, async () => {
        let prices: number[] = [50000,20,40,10];
        const {0: finalMedianPrice, 1: sortedPrices} = await ftsoMedian.computeSimple(prices);

        prices = prices.sort();
        compareNumberArrays(sortedPrices, prices);
        expect(finalMedianPrice.toString()).to.equals('30');
    });
});
