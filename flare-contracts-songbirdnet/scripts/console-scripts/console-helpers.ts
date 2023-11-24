////////////////////////////////////////////////////////
/// This file contains functions that can be used
/// when using `yarn hardhat console --network some_network`
/// NOTE: Javascript is used in console, not Typescript, but
/// functions are added to hardhat environment as 
/// Typescript methods using require
////////////////////////////////////////////////////////

/**
 * Get success parameter from PricesRevealed event given a reveal transaction to PriceSubmitter contract.
 * Default address for genesis PriceSubmitter contract is set as default.
 * @returns 
 */
 export async function checkSuccess(txHash: string, priceSubmitterAddress="0x1000000000000000000000000000000000000003") {
    let PriceSubmitter = artifacts.require("PriceSubmitter");
    let priceSubmitter = await PriceSubmitter.at(priceSubmitterAddress)
    let tx = await web3.eth.getTransactionReceipt(txHash)
    console.log("Gas:", tx.gasUsed)
    let bn = tx.blockNumber
    // let block = await web3.eth.getBlock(bn)
    let event = (await priceSubmitter.getPastEvents("PricesRevealed", {fromBlock: bn, toBlock: bn})).filter(x => x.transactionHash == txHash)
    return (event[0] as any).args.success
}


/**
 * This is used as a helper function to send funds to smaller set of accounts.
 * Provide a file with an address in each line and run as 
 * await sendFLRToAddressesInFile (fs, "fname")
 */
export async function sendFLRToAddressesInFile(fs: any, fname: string, amountFLR: string = "1", from = "0x90E87E067435eb3884D5ecA757Afe7DF7F4cb609") {
    let addresses = fs.readFileSync(fname).toString().split(/\n/).filter((x: any) => !!x).map((x: any) => x.trim());
    for(let address of addresses) {
        let balance = await web3.eth.getBalance(address);
        let amountWei = web3.utils.toWei(amountFLR)
        if(balance === "0") {
            await web3.eth.sendTransaction({ from, to: address, value: amountWei, gasPrice: "225000000000" });
            console.log(`Sent ${amountFLR} to ${address}`);            
        } 
    }

    for(let address of addresses) {
        let balance = await web3.eth.getBalance(address);
        console.log(address, balance)
    }
}