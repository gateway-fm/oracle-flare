import BigNumber from "bignumber.js";
import * as fs from 'fs';
import { createFlareAirdropGenesisData, createSetAirdropBalanceUnsignedTransactions, validateFile } from "./utils/processFile";
import { logMessage } from './utils/utils';
const Web3Utils = require('web3-utils');
const Web3 = require('web3');
const parse = require('csv-parse/lib/sync');

const TEN = new BigNumber(10);
BigNumber.config({ ROUNDING_MODE: BigNumber.ROUND_FLOOR, DECIMAL_PLACES: 20 })

// CONSTANTS
// const initialAirdropPercentage:BigNumber = new BigNumber(0.15);
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
        default: "airdrop/flare/files/logs/",
        nargs: 1
    })
    .option("g", {
        alias: "gas",
        describe: "gas per transaction",
        type: "string",
        default: "2000000",
        nargs: 1
    })
    .option("p", {
        alias: "gas-price",
        describe: "gas price per transaction",
        type: "string",
        default: "25000000000",
        nargs: 1
    })
    .option("i", {
        alias: "chain-id",
        describe: "chain id for network",
        type: "number",
        demandOption: "Chain id is required (-i or --chain-id)",
        nargs: 1
    })
    .option("d", {
        alias: "deployment-name",
        describe: "Deployment file name (generated to deployment/deploys/ folder)",
        type: "string",
        demandOption: "Deployment name is required (-d or --deployment-name)",
        nargs: 1
    })
    .option("a", {
        alias: "deployment-config",
        describe: "Deployment file name (generated to deployment/chain-config/ folder)",
        type: "string",
        demandOption: "Deployment name is required (-a or --deployment-config)",
        nargs: 1
    })
    .option("b", {
        alias: "batch-size",
        describe: "Batch size",
        type: "number",
        default: 30,
        demandOption: "Batch size is required (-b or --batch-size)",
        nargs: 1
    })
    .option("ga", {
        alias: "generate-airdrop",
        describe: "Should transactions for initial airdrop be generated",
        type: "boolean",
        default: true,
        demandOption: "Deployment name is required (-ga or --generate-airdrop)",
        nargs: 1
    })
    // .option("c", {
    //     alias: "contingent-percentage",
    //     describe: "contingent-percentage to be used at the airdrop, default to 100%",
    //     type: "number",
    //     default: 100,
    //     choices: [...Array(101).keys()],
    //     nargs: 1
    // })
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


async function main(
    snapshotFile: string,
    transactionFile: string,
    override: any,
    logPath: any,
    header: any,
    gas: any,
    gasPrice: any,
    quiet: any, 
    chainId: number, 
    deploymentName: string, 
    deploymentConfig: string,
    batchSize: number,
    createInitial: boolean
    ){

const separatorLine = "--------------------------------------------------------------------------------\n"
if (fs.existsSync(transactionFile)) {
    if(!override){
        console.log("raw transaction file already exists, if you want to overwrite it provide --override");
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

let initialAirdropSenderAddress: string;
if (process.env.DEPLOYER_PUBLIC_KEY) {
    initialAirdropSenderAddress = process.env.DEPLOYER_PUBLIC_KEY
}
else {
    console.error("No DEPLOYER_PUBLIC_KEY provided in env");
    throw new Error("No DEPLOYER_PUBLIC_KEY provided in env");
}

if(!fs.existsSync(logPath)){
    fs.mkdirSync(logPath, {recursive: true});
}

if(!fs.existsSync(transactionFile)){
    let transaction_dir = transactionFile.split("/");
    if(transaction_dir.length > 1){
        const transactionGenDir = transaction_dir.slice(0, -1).join("/")        
        fs.mkdirSync(transactionGenDir, {recursive: true});
    }
}

if(!fs.existsSync(deploymentName)){
    console.error(`No file at ${deploymentName}`);
    throw new Error(`No file at ${deploymentName}`);
}

const rawDeploy = fs.readFileSync(deploymentName)
const contractArray = JSON.parse(rawDeploy as any) as {name: string, contractName: string, address: string} []

const InitialAirdropAddress = contractArray.find((elem) => elem.contractName === 'InitialAirdrop.sol')

const now = new Date()
const logFileName = logPath+`${now.toISOString()}_createAirdropTransactions_log.txt`;
if(!quiet) console.log(logFileName);
logMessage(logFileName, `Log file created at ${now.toISOString()} GMT(+0)`, quiet)

let web3Provider = ""
if (process.env.WEB3_PROVIDER_URL) {
    web3Provider = process.env.WEB3_PROVIDER_URL
}
else {
    console.error("No WEB3_PROVIDER_URL provided in env");
    throw new Error("No WEB3_PROVIDER_URL provided in env");
}

// Get initial nonce of sender
const web3 = new Web3(web3Provider);
const initialAirdropNonce = await web3.eth.getTransactionCount(initialAirdropSenderAddress);

// deployment parameters
const deploymentConfigJson = JSON.parse(fs.readFileSync(deploymentConfig, "utf8"))
const airdropStart = `${deploymentConfigJson.initialAirdropStart}`

const accountPerBatch = batchSize
const createInitialAirdropTransactions = createInitial

const inputRepString = `Script run with 
--snapshot-file                    (-f)     : ${snapshotFile}
--transaction-file                 (-t)     : ${transactionFile}
--override                         (-o)     : ${override}
--log-path                         (-l)     : ${logPath}
--header                           (-h)     : ${header}
--gas                              (-g)     : ${gas}
--gas-price                        (-p)     : ${gasPrice}
--DEPLOYER_PRIVATE_KEY             (.ENV)   : ${initialAirdropSenderAddress}
--WEB3_PROVIDER_URL                (.ENV)   : ${web3Provider}
--chain-id                         (-i)     : ${chainId}
--deployment-name                  (-d)     : ${deploymentName}
--deployment-config                (-a)     : ${deploymentConfig}

Initial airdrop address                     : ${InitialAirdropAddress?.address}
Initial Airdrop signer Nonce                : ${initialAirdropNonce.toString(10)}
Initial Airdrop start ts                    : ${airdropStart}

Account per batch for airdrop               : ${accountPerBatch}
Generating Initial Airdrop Transactions     : ${createInitialAirdropTransactions}
`
logMessage(logFileName, inputRepString, quiet)

const constantRepString = separatorLine + `Constants
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
expectedFlrToDistribute = expectedFlrToDistribute.multipliedBy(TEN.pow(12));
logMessage(logFileName, `Expected Flare without caps (Wei) (FLare)   : ${expectedFlrToDistribute.toFixed()}`, quiet);
// Calculating conversion factor
logMessage(logFileName, separatorLine+"Input file processing", quiet);
// Create Flare balance json
let convertedAirdropData = createFlareAirdropGenesisData(parsed_file, validatedData,
    conversionFactor, logFileName);
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
// check that towo calculated balances and flare calculated balances match

healthy = healthy && accounts_match;
logMessage(logFileName, separatorLine+"Health checks", quiet);
logMessage(logFileName, `Read and processed account number match     : ${accounts_match}`, quiet);

if(healthy){
    // Initial Airdrop transactions
    const fileData = createSetAirdropBalanceUnsignedTransactions(
        convertedAirdropData.processedAccounts,
        InitialAirdropAddress?.address || '',
        createInitialAirdropTransactions,
        initialAirdropSenderAddress,
        gasPrice,
        gas,
        chainId,
        parseInt(initialAirdropNonce),
        accountPerBatch
        );
    let totalGas = new BigNumber(fileData.totalGasPrice)
    let totalCost = convertedAirdropData.processedWei.plus(totalGas);
    const balancesMatch = validatedData.totalFLRBalance.toString(10) === convertedAirdropData.processedWei.toString(10)
    logMessage(logFileName, `Towo balances and Flare balances match      : ${balancesMatch}`, quiet);
    fs.appendFileSync(transactionFile, JSON.stringify(fileData.rawTransactions));
    logMessage(logFileName, `Created output transaction file             : ${transactionFile}`, quiet);
    logMessage(logFileName, `Created transactions                        : ${fileData.rawTransactions.length}`, quiet); 
    logMessage(logFileName, `Total gas cost of transactions              : ${fileData.totalGasPrice}`, quiet); 
    logMessage(logFileName, `Total gas cost of transactions (hex)        : 0x${(new BigNumber(fileData.totalGasPrice)).toString(16)}`, quiet); 
    logMessage(logFileName, `Total balance + gas cost (in Wei)           : ${totalCost.toString(10)}`, quiet); 
    logMessage(logFileName, `Total balance + gas cost (in Wei) (hex)     : 0x${totalCost.toString(16)}`, quiet); 
    logMessage(logFileName, "Successfully generated transactions", quiet);
} else {
    logMessage(logFileName, "No transactions was created", quiet);
}
}
const { snapshotFile, transactionFile, override, logPath, header, gas, gasPrice, quiet, chainId, deploymentName, deploymentConfig, batchSize, generateAirdrop } = argv;
main(snapshotFile, transactionFile, override, logPath, header, gas, gasPrice, quiet, chainId, deploymentName, deploymentConfig, batchSize, generateAirdrop)
.then(() => process.exit(0))
.catch(error => {
    console.error(error);
    process.exit(1);
});
  