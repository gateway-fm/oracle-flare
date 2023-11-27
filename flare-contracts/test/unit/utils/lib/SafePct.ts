import { expect } from "chai";
import { artifacts, contract } from "hardhat";
import { SafePctMockContract, SafePctMockInstance } from "../../../../typechain-truffle";
import { toBN } from "../../../utils/test-helpers";
import { constants, expectRevert } from '@openzeppelin/test-helpers';

const getTestFile = require('../../../utils/constants').getTestFile;
const SafePct = artifacts.require("SafePctMock") as SafePctMockContract;

contract(`SafePct.sol; ${getTestFile(__filename)};  SafePct unit tests`, async accounts => {
    let safePct: SafePctMockInstance;
    before(async() => {
        safePct = await SafePct.new();
    });

    it(`Should calculate correctly`, async () => {
        let result = await safePct.mulDiv(10, 10, 3);
        expect(result.toNumber()).to.equals(33);
    });

    it(`Should calculate correctly 2`, async () => {
        let result = await safePct.mulDiv(toBN(10).pow(toBN(50)).add(toBN(1)), toBN(10).pow(toBN(50)).sub(toBN(1)), toBN(10).pow(toBN(30)));
        expect(result.eq(toBN(10).pow(toBN(70)).sub(toBN(1)))).to.be.true;
    });

    it(`Should calculate correctly - first factor equals 0`, async () => {
        let result = await safePct.mulDiv(0, 10, 3);
        expect(result.toNumber()).to.equals(0);
    });

    it(`Should calculate correctly - second factor equals 0`, async () => {
        let result = await safePct.mulDiv(10, 0, 3);
        expect(result.toNumber()).to.equals(0);
    });

    it(`Should revert - division by 0`, async () => {
        let tx = safePct.mulDiv(10, 10, 0);
        await expectRevert(tx, "Division by zero");
    });

    it(`Should calculate correctly - no overflow`, async () => {
        let result = await safePct.mulDiv(toBN(2).pow(toBN(225)), toBN(2).pow(toBN(225)), toBN(2).pow(toBN(200)));
        expect(result.eq(toBN(2).pow(toBN(250)))).to.be.true;
    });

    it(`Should calculate correctly - no overflow 2`, async () => {
        let result = await safePct.mulDiv(toBN(2).pow(toBN(200)), toBN(2).pow(toBN(80)), toBN(2).pow(toBN(60)));
        expect(result.eq(toBN(2).pow(toBN(220)))).to.be.true;
    });

    it(`Should revert - overflow`, async () => {
        let tx = safePct.mulDiv(toBN(2).pow(toBN(225)), toBN(2).pow(toBN(225)), toBN(2).pow(toBN(100)));
        await expectRevert(tx, "SafeMath: multiplication overflow");
    });

    it(`Should revert - overflow 2`, async () => {
        let tx = safePct.mulDiv(toBN(2).pow(toBN(170)), toBN(2).pow(toBN(170)), toBN(2).pow(toBN(200)));
        await expectRevert(tx, "SafeMath: multiplication overflow");
    });

    it(`Should revert - overflow 3`, async () => {
        let tx = safePct.mulDiv(toBN(2).pow(toBN(256)).sub(toBN(1)), toBN(2).pow(toBN(128)), toBN(2).pow(toBN(128)).sub(toBN(1)));
        await expectRevert(tx, "SafeMath: addition overflow");
    });
});
