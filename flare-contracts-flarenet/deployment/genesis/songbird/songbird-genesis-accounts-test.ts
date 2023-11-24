import { BigNumber } from "ethers";
import { songbirdGenesisAccountDefinitions, songbirdTargetTotalSupply } from "./songbird-genesis-accounts-definitions";
import { processGenesisAccountDefinitions } from "../genesis-lib";

describe("Genesis balances", async () => {
    it("Should balance to genesis block", async () => {
        let processedAccounts = processGenesisAccountDefinitions(songbirdGenesisAccountDefinitions, songbirdTargetTotalSupply);
        for(let account of processedAccounts) {
            let balance = BigNumber.from(await web3.eth.getBalance(account.address));
            // console.log("id:", account.id, balance.toString(), account.balance?.toString())
            assert.equal(balance.toString(), account.balance?.toString());
        }
    })
});
