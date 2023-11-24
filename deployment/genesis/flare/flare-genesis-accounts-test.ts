import { BigNumber } from "ethers";
import { processGenesisAccountDefinitionsFlare } from "../genesis-lib";
import { flareGenesisAccountDefinitions, flareTargetTotalSupply } from "./flare-genesis-accounts-definitions";

describe("Genesis balances", async () => {
    it("Should balance to genesis block", async () => {
        let processedAccounts = processGenesisAccountDefinitionsFlare(flareGenesisAccountDefinitions, flareTargetTotalSupply);
        for(let account of processedAccounts) {
            let balance = BigNumber.from(await web3.eth.getBalance(account.address));
            // console.log("id:", account.id, balance.toString(), account.balance?.toString())
            assert.equal(balance.toString(), account.balance?.toString());
        }
    })
});
