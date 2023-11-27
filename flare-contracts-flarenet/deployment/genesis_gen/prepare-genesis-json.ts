import * as fs from "fs";
import glob from "glob";
import yargs from "yargs";
import Web3 from "web3";

const ROOT = "deployment/genesis_gen/configs";
const ARTIFACTS_ROOT = "artifacts";
const GENERATED_ROOT = "deployment/genesis_gen/generated";

// todo: find those files

const filenameCode1 = "StateConnector";
const filenameCode2 = "FlareDaemon";
const filenameCode3 = "PriceSubmitter";
const filenameCode4 = "DistributionTreasury";
const filenameCode5 = "IncentivePoolTreasury";
const filenameCode6 = "InitialAirdrop";
const filenameCode7 = "GovernanceSettings";
const web3 = new Web3();

async function relativeContractABIPathForContractName(name: string, artifactsRoot = ARTIFACTS_ROOT): Promise<string> {
  return new Promise((resolve, reject) => {
    glob(`contracts/**/${name}.sol/${name}.json`, { cwd: artifactsRoot }, (er: any, files: string[] | null) => {
      if (er) {
        reject(er);
      } else {
        if (files && files.length === 1) {
          resolve(files[0]);
        } else {
          reject(files);
        }
      }
    });
  });
}

async function getArtifactCode(name: string, verbose = false): Promise<string> {
  const filename = await relativeContractABIPathForContractName(name, ARTIFACTS_ROOT);

  if (verbose) {
    console.info(`reading artifact '${name}' from '${ARTIFACTS_ROOT}/${filename}'`)
  }

  const code = JSON.parse(fs.readFileSync(`${ARTIFACTS_ROOT}/${filename}`).toString());

  return code.deployedBytecode;
}

async function printCChainConfig(fname: string, verbose: boolean) {
  try {
    let inFile = `${GENERATED_ROOT}/${fname}.json`
    let outFile = `${GENERATED_ROOT}/${fname}-cChainGenesis.json`
    let config = JSON.parse(fs.readFileSync(inFile).toString())
    let cChainGenesis = JSON.parse(config.cChainGenesis);
    let result = JSON.stringify(cChainGenesis, null, 3);
    fs.writeFileSync(outFile, result, "utf8");
    if (verbose) {
      console.info(`Generating '${outFile}'`)
    }

  }
  catch (error) {
    console.error(`error: ${error}`)
  }
}

async function joinChainGenesis(network: string, verbose: boolean) {
  try {
    if (verbose) {
      console.info(`Building JSON genesis config for network '${network}' using '${ROOT}/${network}'`)
      console.info(`Using config in '${ROOT}/${network}'`)
      console.info(`Reading '${ROOT}/${network}/template.json'`)
    }
    const template = JSON.parse(fs.readFileSync(`${ROOT}/${network}/template.json`).toString());

    if (verbose) {
      console.info(`Reading '${ROOT}/${network}/cChainGenesis.json'`)
    }

    const cChainGenesis = JSON.parse(fs.readFileSync(`${ROOT}/${network}/cChainGenesis.json`).toString());

    cChainGenesis.alloc["0x1000000000000000000000000000000000000001"].code = await getArtifactCode(filenameCode1, verbose);
    cChainGenesis.alloc["0x1000000000000000000000000000000000000002"].code = await getArtifactCode(filenameCode2, verbose);
    cChainGenesis.alloc["0x1000000000000000000000000000000000000003"].code = await getArtifactCode(filenameCode3, verbose);
    cChainGenesis.alloc["0x1000000000000000000000000000000000000004"].code = await getArtifactCode(filenameCode4, verbose);
    cChainGenesis.alloc["0x1000000000000000000000000000000000000005"].code = await getArtifactCode(filenameCode5, verbose);
    cChainGenesis.alloc["0x1000000000000000000000000000000000000006"].code = await getArtifactCode(filenameCode6, verbose);
    cChainGenesis.alloc["0x1000000000000000000000000000000000000007"].code = await getArtifactCode(filenameCode7, verbose);

    let accounts = JSON.parse(fs.readFileSync(`${ROOT}/../../genesis/${network}/outputs/${network}-genesis.json`).toString());
    for (let account of accounts) {
      if (cChainGenesis.alloc[account.address]) {
        cChainGenesis.alloc[account.address].balance = account.balance;
      } else {
        cChainGenesis.alloc[account.address] = { balance: account.balance };
      }
    }

    template.cChainGenesis = JSON.stringify(cChainGenesis);

    const newData = JSON.stringify(template, null, 3);

    let outFile = `${GENERATED_ROOT}/${network}.json`
    fs.writeFileSync(outFile, newData, "utf8");
    if (verbose) {
      console.info(`Generating '${outFile}'`)
    }

    // Transform the genesis file to staging version with chain id 161
    let testAccounts = JSON.parse(fs.readFileSync(`test-1020-accounts.json`).toString());
    for (let item of testAccounts) {
      let address = web3.eth.accounts.privateKeyToAccount(item.privateKey).address;
      if (cChainGenesis.alloc[address]) {
        cChainGenesis.alloc[address].balance = item.balance;
      } else {
        cChainGenesis.alloc[address] = { balance: item.balance };
      }
    }
    
    cChainGenesis.config.chainId = 161;

    template.cChainGenesis = JSON.stringify(cChainGenesis);

    const newDataWithTestAccounts = JSON.stringify(template, null, 3);

    let outFileWithTestAccounts = `${GENERATED_ROOT}/${network}-staging.json`
    fs.writeFileSync(outFileWithTestAccounts, newDataWithTestAccounts, "utf8");
    if (verbose) {
      console.info(`Generating '${outFileWithTestAccounts}'`)
    }

    await printCChainConfig(`${network}`, verbose);
    await printCChainConfig(`${network}-staging`, verbose);

  }
  catch (error) {
    console.error(`error: ${error}`)
  }
}


// Args parsing
const args = yargs
  .option("network", {
    alias: "n",
    type: "string",
    description: "Specify network",
    default: "scdev",
    demand: false,
  })
  .option("verbose", {
    alias: "v",
    type: "boolean",
    description: "Verbose outputs",
    default: true,
    demand: false,
  })
  .argv;

joinChainGenesis((args as any).network, (args as any).verbose)
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
