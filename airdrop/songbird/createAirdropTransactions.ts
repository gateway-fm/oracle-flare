import * as fs from 'fs';
import {createAirdropUnsignedTransactions, createFlareAirdropGenesisData, validateFile} from "./utils/processFile";
import { logMessage, writeError } from './utils/utils';
const Web3Utils = require('web3-utils');
const parse = require('csv-parse/lib/sync');
import BigNumber from "bignumber.js";

const TEN = new BigNumber(10);
BigNumber.config({ ROUNDING_MODE: BigNumber.ROUND_FLOOR, DECIMAL_PLACES: 20 })

// CONSTANTS
const initialAirdropPercentage:BigNumber = new BigNumber(0.15);
const conversionFactor:BigNumber = new BigNumber(1.0073);

const { argv } = require("yargs")
    .scriptName("airdropTransactions")
    .option("f", {
        alias: "snapshot-file",
        describe: "Path to snapshot file",
        demandOption: "Snapshot file is required",
        type: "string",
        nargs: 1,
    })
    .option("h", {
        alias: "header",
        describe: "Flag that tells us if input csv file has header",
        default: true,
        type: "boolean",
        nargs: 1,
    })
    .option("t", {
        alias: "transaction-file",
        describe: "Unsigned transaction data file for output (.json)",
        demandOption: "Transaction file is required",
        type: "string",
        nargs: 1
    })
    .option("o", {
        alias: "override",
        describe: "if provided genesis data file will override the one at provided destination if there is one",
        nargs: 0
    })
    .option("l", {
        alias: "log-path",
        describe: "log data path",
        type: "string",
        default: "airdrop/files/logs/",
        nargs: 1
    })
    .option("g", {
        alias: "gas",
        describe: "gas per transaction",
        type: "string",
        default: "21000",
        nargs: 1
    })
    .option("p", {
        alias: "gas-price",
        describe: "gas price per transaction",
        type: "string",
        default: "255000000000",
        nargs: 1
    })
    .option("i", {
        alias: "chain-id",
        describe: "chain id for network",
        type: "number",
        demandOption: "Chain id is required (-i or --chain-id)",
        nargs: 1
    })
    .option("c", {
        alias: "contingent-percentage",
        describe: "contingent-percentage to be used at the airdrop, default to 100%",
        type: "number",
        default: 100,
        choices: [...Array(101).keys()],
        nargs: 1
    })
    .option("n", {
        alias: "nonce-offset",
        describe: "Nonce offset if account makes some transactions before airdrop distribution",
        type: "number",
        default: "0",
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

const { snapshotFile, transactionFile, override, logPath, header, gas, gasPrice, quiet, nonceOffset, chainId } = argv;
let {contingentPercentage} = argv;
contingentPercentage = new BigNumber(contingentPercentage).dividedBy(100)
const separatorLine = "--------------------------------------------------------------------------------\n"
if (fs.existsSync(transactionFile)) {
    if(!override){
        console.log("go Genesis file already exist, if you want to overwrite it provide --override");
        process.exit(0);
    }
    else {
        fs.writeFile(transactionFile, '', function (err) {
            if (err) {
                console.log("Can't create file at provided destination")
                throw err
            };
          });
    }
    // File exists in path
  } else {
    fs.writeFile(transactionFile, '', function (err) {
        if (err) {
            console.log("Can't create file at provided destination")
            throw err
        };
      });
  }

let senderAddress: string;
if (process.env.AIRDROP_PUBLIC_KEY) {
    senderAddress = process.env.AIRDROP_PUBLIC_KEY
}
else {
    console.error("No AIRDROP_PUBLIC_KEY provided in env");
    throw new Error("No AIRDROP_PUBLIC_KEY provided in env");
}

if(!fs.existsSync(logPath)){
    fs.mkdirSync(logPath, {recursive: true});
}

if(!fs.existsSync(transactionFile)){
    let transaction_dir = transactionFile.split("/");
    if(transaction_dir.length > 1){
        transaction_dir = transaction_dir.slice(0, -1).join("/")        
        fs.mkdirSync(transaction_dir, {recursive: true});
    }
}

const now = new Date()
const logFileName = logPath+`${now.toISOString()}_createAirdropTransactions_log.txt`;
if(!quiet) console.log(logFileName);
logMessage(logFileName, `Log file created at ${now.toISOString()} GMT(+0)`, quiet)

const inputRepString = `Script run with 
--snapshot-file            (-f)             : ${snapshotFile}
--transaction-file         (-t)             : ${transactionFile}
--override                 (-o)             : ${override}
--log-path                 (-l)             : ${logPath}
--header                   (-h)             : ${header}
--gas                      (-g)             : ${gas}
--gas-price                (-p)             : ${gasPrice}
--AIRDROP_PUBLIC_KEY       (.ENV)           : ${senderAddress}
--nonce-offset             (-n)             : ${nonceOffset}
--chain-id                 (-i)             : ${chainId}
--contingent-percentage    (-c)             : ${contingentPercentage.multipliedBy(100).toFixed()}`
logMessage(logFileName, inputRepString, quiet)

const constantRepString = separatorLine + `Constants
Contingent Percentages                      : ${contingentPercentage.multipliedBy(100).toFixed()} %
Initial Airdrop percentage                  : ${initialAirdropPercentage.multipliedBy(100).toFixed()} %
Conversion Factor                           : ${conversionFactor.toFixed()}`
logMessage(logFileName, constantRepString, quiet)

let columns:string[] | boolean = ['XRPAddress','FlareAddress','XRPBalance','FlareBalance'];
if(header){
    columns = true
}
// Parse the CSV file
let data = fs.readFileSync(snapshotFile, "utf8");
const parsed_file = parse( data, {
  columns: columns,
  skip_empty_lines: true,
  delimiter: ',',
  skip_lines_with_error: true
})

logMessage(logFileName, separatorLine+"Input file problems", quiet);
// Validate Input CSV File
let validatedData = validateFile(parsed_file,logFileName, !quiet);
logMessage(logFileName, `ERRORS                                      : ${validatedData.lineErrors}`, quiet);
// Log Validation results
logMessage(logFileName, separatorLine+"Input file validation output", quiet);
logMessage(logFileName, `Number of valid accounts                    : ${validatedData.validAccountsLen}`, quiet);
logMessage(logFileName, `Number of invalid accounts                  : ${validatedData.invalidAccountsLen}`, quiet);
logMessage(logFileName, `Total valid XRP balance read (* 10^6)       : ${validatedData.totalXRPBalance.toFixed()}`, quiet);
logMessage(logFileName, `Total invalid XRP balance read              : ${validatedData.invalidXRPBalance.toFixed()}`, quiet);
logMessage(logFileName, `Total valid FLR balance predicted (Towo)    : ${validatedData.totalFLRBalance.toFixed()}`, quiet);
logMessage(logFileName, `Total invalid FLR balance predicted (Towo)  : ${validatedData.invalidFLRBalance.toFixed()}`, quiet);

let expectedFlrToDistribute:BigNumber = new BigNumber(0);
expectedFlrToDistribute = validatedData.totalXRPBalance;
expectedFlrToDistribute = expectedFlrToDistribute.multipliedBy(conversionFactor)
expectedFlrToDistribute = expectedFlrToDistribute.multipliedBy(contingentPercentage)
expectedFlrToDistribute = expectedFlrToDistribute.multipliedBy(initialAirdropPercentage);
expectedFlrToDistribute = expectedFlrToDistribute.multipliedBy(TEN.pow(12));
logMessage(logFileName, `Expected Flare to distribute (Wei) (FLare)  : ${expectedFlrToDistribute.toFixed()}`, quiet);
// Calculating conversion factor
logMessage(logFileName, separatorLine+"Input file processing", quiet);
// Create Flare balance json
let convertedAirdropData = createFlareAirdropGenesisData(parsed_file, validatedData,
    contingentPercentage, conversionFactor, initialAirdropPercentage, logFileName);
// Log balance created
const zeroPad = (num:any, places:any) => String(num).padStart(places, '0')
logMessage(logFileName, `Number of processed accounts                : ${convertedAirdropData.processedAccountsLen}`, quiet);
logMessage(logFileName, `Number of Flare accounts added to genesis   : ${convertedAirdropData.processedAccounts.length}`, quiet);
for(let i=0; i<convertedAirdropData.accountsDistribution.length; i++){
    if(convertedAirdropData.accountsDistribution[i]>0){
         logMessage(logFileName, `Number of Flare addresses added ${zeroPad(i,4)} times  : ${convertedAirdropData.accountsDistribution[i]}`, quiet);
    }
}
logMessage(logFileName, `Total FLR added to accounts                 : ${convertedAirdropData.processedWei.toFixed()}`, quiet);

// **********************
// Do final health checks
let healthy = true;
let accounts_match = convertedAirdropData.processedAccountsLen == validatedData.validAccountsLen;
healthy = healthy && accounts_match;
logMessage(logFileName, separatorLine+"Health checks", quiet);
logMessage(logFileName, `Read and processed account number match     : ${accounts_match}`, quiet);

if(healthy){
    const fileData = createAirdropUnsignedTransactions(
        convertedAirdropData.processedAccounts,
        senderAddress,
        gasPrice,
        gas,
        chainId,
        parseInt(nonceOffset));
    let totalGasN = new BigNumber(fileData.totalGasPrice)
    let totalCost = convertedAirdropData.processedWei.plus(totalGasN);
    fs.appendFileSync(transactionFile, JSON.stringify(fileData.transactions));
    logMessage(logFileName, `Created output transaction file             : ${transactionFile}`, quiet);
    logMessage(logFileName, `Created transactions                        : ${fileData.transactions.length}`, quiet); 
    logMessage(logFileName, `Total gas cost of transactions              : ${fileData.totalGasPrice}`, quiet); 
    logMessage(logFileName, `Total balance + gas cost (in Wei)           : ${totalCost.toString(10)}`, quiet); 
    logMessage(logFileName, `Total balance + gas cost (in Wei) (hex)     : 0x${totalCost.toString(16)}`, quiet); 
    logMessage(logFileName, "Successfully generated transactions", quiet);
} else {
    logMessage(logFileName, "No transactions was created", quiet);
}
