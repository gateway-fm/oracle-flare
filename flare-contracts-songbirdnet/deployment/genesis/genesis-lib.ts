import { BigNumber, ethers } from "ethers";
const fs = require('fs');

export interface GenesisAccount {
    id: number;
    address: string;
    balance?: BigNumber;
    initialEntryNat?: string;  // no decimals, can have thousands comma separator
    initialEntryWei?: string;  // integer, can have thousands comma separator 
}

// Reads accounts, creates BigNumber balances and fills the accounts with 
// id 2 and 3 with reminder to `targetTotalSupply`, each one half of it.
export function processGenesisAccountDefinitions(accounts: GenesisAccount[], targetTotalSupply: BigNumber) {
    let balancingAccount2: GenesisAccount;
    let balancingAccount3: GenesisAccount;
    let total = BigNumber.from(0);
    let processedAccounts: GenesisAccount[] = [];
    for (let account of accounts) {
        let processed = {
            ...account
        } as GenesisAccount;
        // identify accounts with id 2 and 3
        if (processed.id == 2) {
            balancingAccount2 = processed;
        }
        if (processed.id == 3) {
            balancingAccount3 = processed;
        }
        // Read the proposed balance strings and create BigNumber representation
        if (account.initialEntryNat) {
            processed.balance = BigNumber.from(processed.initialEntryNat?.replace(/[, ]/g, "")).mul(ethers.utils.parseEther("1"))
        }
        if (account.initialEntryWei) { // Overrides `initialEntryNat` if both are present.
            processed.balance = BigNumber.from(processed.initialEntryWei?.replace(/[,. ]/g, ""))
        }
        // Calculate running total balance
        if (processed.balance) {
            total = total.add(processed.balance)
        }
        processedAccounts.push(processed);
    }
    // Calculating balances for id 2 and 3
    let remaining = targetTotalSupply.sub(total);
    balancingAccount2!.balance = remaining.div(BigNumber.from(2));
    balancingAccount3!.balance = remaining.sub(balancingAccount2!.balance);
    return processedAccounts;
}

// Creates textual printout
export function accountsTextPrintout(accounts: GenesisAccount[], targetTotalSupply: BigNumber) {
    let stringOutput = "";
    for (let account of accounts) {
        stringOutput += `${account.id.toString().padStart(2, " ")}: ${account.address.padStart(30)} ${formatWei(account.balance!, 15)}${account.balance?.toHexString().padStart(30)}\n`
    }
    let calculatedTotalSupply = calculateTotalSupplyFromAccounts(accounts)
    stringOutput += "".padStart(116, "-") + "\n";
    stringOutput += `TARGET TOTAL SUPPLY: ${formatWei(targetTotalSupply, 0)}\n`
    stringOutput += `ACTUAL TOTAL SUPPLY: ${formatWei(calculatedTotalSupply, 0)}\n`

    return stringOutput;
}

// Creates genesis code to be pasted into genesis file.
export function accountsGenesisCode(accounts: GenesisAccount[]) {
    let stringOutput = "";
    for (let account of accounts) {
        stringOutput += `\t\t\t"${account.address.slice(2)}": {"balance": ${('"' + account.balance?.toHexString() + '"').padStart(30)}},\n`
    }
    return stringOutput;
}

// Creates CSV
export function accountsCSV(accounts: GenesisAccount[]) {
    let stringOutput = "RowNo,Address,SGB_balance_dec,SGB_balance_hex\n";
    let rowNo = 2;
    for (let account of accounts) {
        while (account.id != rowNo) {
            stringOutput += "\n";
            rowNo++;
        }
        stringOutput += `${account.id},"${account.address}","${formatWei(account.balance!, 0)}","${account.balance?.toHexString()}"\n`
        rowNo++;
    }
    return stringOutput;
}

// Injects separator for triples of characters in a string, starting from right.
function stringNumberWithThousandsSeparator(x: string, separator = ",") {
    return x.replace(/\B(?=(\d{3})+(?!\d))/g, separator);
}

function formatWei(valueWei: BigNumber, fixedLength = 20) {
    let eth1 = ethers.utils.parseEther("1");
    let decimals = stringNumberWithThousandsSeparator(valueWei.toString().slice(-18), " ");
    let integerPart = valueWei.div(eth1);
    return `${stringNumberWithThousandsSeparator(integerPart.toString()).padStart(fixedLength, " ")}.${decimals}`
}

function calculateTotalSupplyFromAccounts(accounts: GenesisAccount[]) {
    let totalSupply = BigNumber.from(0);
    for (let account of accounts) {
        totalSupply = totalSupply.add(account.balance!)
    }
    return totalSupply;
}

////////////////////////////////////////////////////////////////////////
/// Processor functions
////////////////////////////////////////////////////////////////////////

export function processGenesisAccounts(network: string, accountDefinitions: GenesisAccount[], totalSupply: BigNumber) {
    let processedAccounts = processGenesisAccountDefinitions(accountDefinitions, totalSupply);

    let dir = `deployment/genesis/${network}/outputs`;
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    let textPrintout = accountsTextPrintout(processedAccounts, totalSupply)
    fs.writeFileSync(`${dir}/${network}.txt`, textPrintout, "utf8");
    console.log(textPrintout);

    let genesisCode = accountsGenesisCode(processedAccounts);
    fs.writeFileSync(`${dir}/${network}-genesis.txt`, genesisCode, "utf8");

    let csvData = accountsCSV(processedAccounts)
    fs.writeFileSync(`${dir}/${network}.csv`, csvData, "utf8");

    return genesisCode;
}

export function genesisContractsCode() {

    let genesisFolder = "artifacts/contracts/genesis/implementation"
    let deployedCodeStateConnector = JSON.parse(fs.readFileSync(`${genesisFolder}/StateConnector.sol/StateConnector.json`)).deployedBytecode;
    let deployedFlareDaemon = JSON.parse(fs.readFileSync(`${genesisFolder}/FlareDaemon.sol/FlareDaemon.json`)).deployedBytecode;
    let deployedPriceSubmitter = JSON.parse(fs.readFileSync(`${genesisFolder}/PriceSubmitter.sol/PriceSubmitter.json`)).deployedBytecode;


    let code = `\t\t\t"1000000000000000000000000000000000000001": {
\t\t\t\t"balance": "0x0",
\t\t\t\t"code": "${deployedCodeStateConnector}"
\t\t\t},
\t\t\t"1000000000000000000000000000000000000002": {
\t\t\t\t"balance": "0x0",
\t\t\t\t"code": "${deployedFlareDaemon}"
\t\t\t},
\t\t\t"1000000000000000000000000000000000000003": {
\t\t\t\t"balance": "0x0",
\t\t\t\t"code": "${deployedPriceSubmitter}"
\t\t\t},`

    return code;
}

export function processGenesisContracts(network: string) {
    let code = genesisContractsCode();
    let dir = `deployment/genesis/${network}/outputs`;
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(`${dir}/genesis-contracts.txt`, code, "utf8");
    return code;
}

export function genesisGenerate(network: string, accountDefinitions: GenesisAccount[], totalSupply: BigNumber, pathToTemplate: string, pathToTargetGenesisFile?: string) {
    let dir = `deployment/genesis/${network}/outputs`;
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    let genesisAccountsCode = processGenesisAccounts(network, accountDefinitions, totalSupply);
    let genesisContractCode = processGenesisContracts(network);
    let template = fs.readFileSync(pathToTemplate).toString();
    let genesisFileText = template.replace("<DATA>", genesisContractCode + "\n" + genesisAccountsCode.slice(0, -2));
    fs.writeFileSync(`${dir}/genesis_${network}.go`, genesisFileText, "utf8");
    if (pathToTargetGenesisFile) {
        fs.writeFileSync(pathToTargetGenesisFile, genesisFileText, "utf8");
    }
}

