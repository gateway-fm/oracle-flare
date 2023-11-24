// For testing purposes during development - should be deleted at end.
// Run
// yarn ts-node scripts/test.ts
import { readTestData, resultsFromTestData } from "../test/utils/FTSO-test-utils";


function test() {
    let fname = "small-4.json";
    let testExample = readTestData(`../test-cases/FTSO-cases/${fname}`);
    let addresses: string[] = [...Array(testExample.prices.length)].map(_=> Math.random().toString(36).substring(2));
    console.log(testExample);
    console.log(resultsFromTestData(testExample, addresses))
}

test()
