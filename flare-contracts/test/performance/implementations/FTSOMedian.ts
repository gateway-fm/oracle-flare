import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { ethers } from "hardhat";
import path from "path";
import { MockFtso } from "../../../typechain";
import { checkTestCase, readTestData, TestCase, testFTSOInitContracts, testFTSOMedian } from "../../utils/FTSO-test-utils";
import { ftsoRandomTestRuns } from "../../utils/constants";

const fs = require('fs');

const testCasesPath = 'test/test-cases/FTSO-cases/performance'

// Importing test cases
// Note: this snippet cannot be defined in `before`- needs to exist even before `before`
let files: string[] = fs.readdirSync(testCasesPath)
files.sort();
let testExamples = files.map(fname => {
    let data = readTestData(path.join("../..", testCasesPath, fname));
    data.fileName = fname;
    return data;
})

describe("FTSO contract - performance test cases from files", () => {

    testExamples.forEach(testExample => {
        let envRuns = parseInt(process.env.FTSORND_RUNS!);
        let runs;
        if (Number.isNaN(envRuns)) {
            runs =  ftsoRandomTestRuns ?? testExample.randomizedRuns ?? 1;
        } else {
            runs = envRuns;
        }
        for (let run = 0; run < runs; run++) {
            let testName = `${testExample.fileName}: ${testExample.description}`;
            if (runs > 1) {
                testName = `${testName} (run ${run+1}/${runs})`;
            }
            it(testName, async function () {
                const epochStartTimestamp: number = 1;
                const signers: SignerWithAddress[] = await ethers.getSigners();
                const ftso: MockFtso = await testFTSOInitContracts(epochStartTimestamp, signers, testExample);
                const testCase: TestCase = await testFTSOMedian(epochStartTimestamp, signers, ftso, testExample);

                // Test results
                checkTestCase(testCase);
            });
        }
    });
});

