import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { deployments, ethers } from "hardhat";
import { MockFtso } from "../../../typechain";
import { checkTestCase, randomizePriceGenerator, TestCase, TestExample, testFTSOInitContracts, testFTSOMedian } from "../../utils/FTSO-test-utils";

let testExample: TestExample = {
    description: "Random 20 prices and weights",
    randomizedPivot: true,
    randomizedDataCount: 20,
    prices: [],
    weightsNat: [],
    weightsAsset: [],
    weightRatio: 0,
    priceAverage: 10000,
    priceSD: 6000,
    weightNatAverage: 100000,
    weightNatSD: 50000,
    weightAssetAverage: 100000,
    weightAssetSD: 50000   
}

describe("Test fixture - multiple random FTSO median tests", () => {
    const epochStartTimestamp: number = 1;
    let ftsoFixture: () => Promise<MockFtso>;
    let signers: SignerWithAddress[];
    
    before(async function () {
        signers = await ethers.getSigners();
        let ftsoContract: MockFtso = await testFTSOInitContracts(epochStartTimestamp, signers, testExample);
    
        ftsoFixture = deployments.createFixture(async (env, options) => {
            return await ethers.getContractAt("MockFtso", ftsoContract.address, signers[0]) as MockFtso;
        });
    });

    for (let i = 0; i < 5; i++) {
        it(`${ testExample.description } - ${ i+1 }`, async function () {
            randomizePriceGenerator(testExample);
            let ftso = await ftsoFixture();
            const testCase: TestCase = await testFTSOMedian(epochStartTimestamp, signers, ftso, testExample);

            // Test results
            checkTestCase(testCase);
        });
    }
});

