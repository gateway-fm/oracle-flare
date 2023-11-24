import * as fs from 'fs';
import { signedTransaction } from './utils/airdropTypes';
import { logMessage } from './utils/utils';
import BigNumber from "bignumber.js";
const Web3 = require('web3');
const web3Eth = require("web3-eth");
const cliProgress = require('cli-progress');

let { argv } = require("yargs")
.scriptName("signAirdropTransactions")
.option("f", {
    alias: "transactions-file",
    describe: "Path to transactions file",
    demandOption: "Transactions file is required",
    type: "string",
    nargs: 1,
})
.option("o", {
    alias: "output-file",
    describe: "Path to output raw transactions file",
    demandOption: "Output file is required",
    type: "string",
    nargs: 1,
})
.option("l", {
    alias: "log-path",
    describe: "log data path",
    type: "string",
    default: "airdrop/files/logs/",
    nargs: 1
})
.option("q", {
    alias: "quiet",
    describe: "quiet",
    type: "boolean",
    default: "false",
    nargs: 1
})
.fail(function (msg:any, err:any, yargs:any) {
    if (err) throw err;
    console.error("Exiting with message")
    console.error(msg);
    console.error(yargs.help())
    process.exit(0);
})

async function main(transactionsFile:string, outputFile:string, logFile:string, quiet:boolean = true) {
    let SignerKey: string = ""
    let signedTransactions:signedTransaction[] = []

    if (process.env.AIRDROP_PRIVATE_KEY) {
        SignerKey = process.env.AIRDROP_PRIVATE_KEY
    }
    else {
        console.error("No DEPLOYER_PRIVATE_KEY provided in env");
        throw new Error("No DEPLOYER_PRIVATE_KEY provided in env");
    }

    const now = new Date()
    const logFileName = logFile+`${now.toISOString()}_signAirdropTransactions_log.txt`;
    if(!quiet) console.log(logFileName);
    logMessage(logFileName, `Log file created at ${now.toISOString()} GMT(+0)`, quiet);
    logMessage(logFileName, `Script run with `, quiet);
    logMessage(logFileName, `--transactions-file        (-f)                      : ${transactionsFile}`, quiet);
    logMessage(logFileName, `--output-file              (-t)                      : ${outputFile}`, quiet);
    logMessage(logFileName, `--log-path                 (-l)                      : ${logFile}`, quiet);

    const web3 = new Web3();

    const unsignedTransactions = JSON.parse(await fs.readFileSync(transactionsFile, "utf8"));
    const signerWallet = web3.eth.accounts.wallet.add(SignerKey);
    logMessage(logFileName, `signer public key (from AIRDROP_PRIVATE_KEY in .env) : ${signerWallet.address}`, quiet);
    let totalBalance = new BigNumber(0);
    let totalGas = new BigNumber(0);
    const bar1 = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
    if(!quiet){
        console.log("Signing Transactions")
        bar1.start(unsignedTransactions.length, 0);
    }
    let progress = 0;
    for(let tx of unsignedTransactions){
        let signedTx = await signerWallet.signTransaction(tx);
        totalBalance = totalBalance.plus(tx.value);
        let tempGas = new BigNumber(tx.gas);
        totalGas = totalGas.plus(tempGas.multipliedBy(tx.gasPrice));
        const newRawTx:signedTransaction = {
            raw: signedTx.rawTransaction
        }
        signedTransactions.push(newRawTx)
        progress += 1;
        if(!quiet) bar1.update(progress);
    }
    if(!quiet) bar1.stop();
    logMessage(logFileName, `Total balance in signed transactions                 : ${totalBalance.toFixed()}`, quiet);
    logMessage(logFileName, `Total gas price in signed transactions               : ${totalGas.toFixed()}`, quiet);

    fs.writeFileSync(outputFile, JSON.stringify(signedTransactions));
    logMessage(logFileName, `Complete`, quiet);
}
  
  const { transactionsFile, quiet, outputFile, logPath } = argv;
  main(transactionsFile, outputFile, logPath, quiet )
    .then(() => process.exit(0))
    .catch(error => {
      console.error(error);
      process.exit(1);
    });
  