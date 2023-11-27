import * as fs from 'fs';
import { signedTransaction } from './utils/airdropTypes';
import { logMessage, sleep } from './utils/utils';
const Web3 = require('web3');
const web3Eth = require("web3-eth");
let txDecoder = require('ethereum-tx-decoder');
import BigNumber from "bignumber.js";
const cliProgress = require('cli-progress');

let { argv } = require("yargs")
.scriptName("sendAirdropTransactions")
.option("f", {
    alias: "transactions-file",
    describe: "Path to signed transactions file",
    demandOption: "Signed transactions file is required",
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

async function main(transactionsFile:string, logPath:string, quiet:boolean = true) {
    let web3Provider = ""
    if (process.env.WEB3_PROVIDER_URL) {
        web3Provider = process.env.WEB3_PROVIDER_URL
    }
    else {
        console.error("No WEB3_PROVIDER_URL provided in env");
        throw new Error("No WEB3_PROVIDER_URL provided in env");
    }

    const now = new Date()
    const logFileName = logPath+`${now.toISOString()}_signAirdropTransactions_log.txt`;
    if(!quiet) console.log(logFileName);
    logMessage(logFileName, `Log file created at ${now.toISOString()} GMT(+0)`, quiet);
    logMessage(logFileName, `Script run with `, quiet);
    logMessage(logFileName, `--transactions-file        (-f)       : ${transactionsFile}`, quiet);
    logMessage(logFileName, `--log-path                 (-l)       : ${logPath}`, quiet);
    logMessage(logFileName, `web3 provider url          (.ENV)     : ${web3Provider}`, quiet);


    console.log(web3Provider);
    
    const web3 = new Web3(web3Provider);

    const rawTransactions = JSON.parse(await fs.readFileSync(transactionsFile, "utf8"));
    let promises = []

    let totalBalance = new BigNumber(0);
    let totalGasPrice = new BigNumber(0);

    const bar1 = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
    if(!quiet){
        console.log("Sending sign Transactions")
        bar1.start(rawTransactions.length, 0);
    }
    let progress = 0;
    for(let tx of rawTransactions){
        let decoded = txDecoder.decodeTx(tx.raw);
        totalBalance = totalBalance.plus(decoded.value);
        let decodedGas = new BigNumber(decoded.gasLimit);
        totalGasPrice = totalGasPrice.plus(decodedGas.multipliedBy(decoded.gasPrice));
        promises.push(web3.eth.sendSignedTransaction(tx.raw).catch((e:any) => null));
        await sleep(8);
        progress += 1;
        if(!quiet) bar1.update(progress);
    }
    if(!quiet) bar1.stop();
    logMessage(logFileName, `Total Balance send                    : ${totalBalance.toFixed()}`, quiet);
    logMessage(logFileName, `Total Gas upper limit                 : ${totalGasPrice.toFixed()}`, quiet);
    
    await Promise.all(promises);
    logMessage(logFileName, `Complete`, quiet);
}
  
  const { transactionsFile, quiet, logPath } = argv;
  main(transactionsFile, logPath, quiet )
    .then(() => process.exit(0))
    .catch(error => {
      console.error(error);
      process.exit(1);
    });
  