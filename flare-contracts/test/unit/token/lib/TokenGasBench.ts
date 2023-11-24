import { VotePowerMockContract, VotePowerMockInstance, VPTokenMockInstance } from "../../../../typechain-truffle";
import { getTestFile } from "../../../utils/constants";
import { toBN } from "../../../utils/test-helpers";
import { setDefaultVPContract } from "../../../utils/token-test-helpers";

const VPToken = artifacts.require("VPTokenMock");
const VotePower = artifacts.require("VotePowerMock") as VotePowerMockContract;

const gasList: string[] = [];

async function measureGas<T extends Truffle.AnyEvent>(responsePromise: Promise<Truffle.TransactionResponse<T>>, comment: string) {
    const response = await responsePromise;
    gasList.push(`${('' + response.receipt.gasUsed).padStart(9)}   ${comment}`);
    return response;
}

contract(`VPToken.sol; ${getTestFile(__filename)}; VPToken gas benchmarks`, async accounts => {
    // contains a fresh contract for each test
    let vpToken: VPTokenMockInstance;

    // Do clean unit tests by spinning up a fresh contract for each test
    beforeEach(async () => {
        vpToken = await VPToken.new(accounts[0], "A token", "ATOK");
        await setDefaultVPContract(vpToken, accounts[0]);
    });
    
    after(async() => {
        for (const line of gasList) {
            console.log(line);
        }
    });
    
    it("mint and transfer benchmark", async () => {
        await measureGas(vpToken.mint(accounts[1], 1e6), "mint (initial overhead)");
        await measureGas(vpToken.mint(accounts[2], 1e6), "mint 2");
        await measureGas(vpToken.mint(accounts[2], 1e6), "mint 2 (warm)");
        await measureGas(vpToken.transfer(accounts[2], 500, { from: accounts[1] }), "transfer 1->2 (simple, warm dest)");
        await measureGas(vpToken.transfer(accounts[3], 500, { from: accounts[1] }), "transfer 1->3 (simple)");
        await measureGas(vpToken.transfer(accounts[4], 500, { from: accounts[2] }), "transfer 2->4 (simple)");
        await measureGas(vpToken.delegate(accounts[11], 4000, { from: accounts[1] }), "delegate 1->11 40%");
        await measureGas(vpToken.delegate(accounts[21], 4000, { from: accounts[2] }), "delegate 2->21 40%");
        await measureGas(vpToken.transfer(accounts[2], 500, { from: accounts[1] }), "transfer 1->2 (both 1 delegate, warm dest)");
        await measureGas(vpToken.delegate(accounts[12], 2000, { from: accounts[1] }), "delegate 1->12 20%");
        await measureGas(vpToken.delegate(accounts[22], 2000, { from: accounts[2] }), "delegate 2->22 20%");
        await measureGas(vpToken.transfer(accounts[2], 500, { from: accounts[1] }), "transfer 1->2 (both 2 delegates 60%, warm dest)");
        await measureGas(vpToken.delegate(accounts[12], 6000, { from: accounts[1] }), "delegate 1->12 60%");
        await measureGas(vpToken.delegate(accounts[22], 6000, { from: accounts[2] }), "delegate 2->22 60%");
        await measureGas(vpToken.transfer(accounts[2], 500, { from: accounts[1] }), "transfer 1->2 (both 2 delegates 100%, warm dest)");
        await measureGas(vpToken.delegate(accounts[51], 4000, { from: accounts[5] }), "delegate 5->51 40%");
        await measureGas(vpToken.delegate(accounts[52], 6000, { from: accounts[5] }), "delegate 5->52 60%");
        await measureGas(vpToken.transfer(accounts[5], 500, { from: accounts[1] }), "transfer 1->5 (both 2 delegates 100%, cold dest)");
        await measureGas(vpToken.transfer(accounts[5], 500, { from: accounts[2] }), "transfer 1->5 (both 2 delegates 100%, warm dest)");
        await measureGas(vpToken.transfer(accounts[6], 500, { from: accounts[2] }), "transfer 1->6 (src 2 delegates 100%, cold dest)");
    });
});
