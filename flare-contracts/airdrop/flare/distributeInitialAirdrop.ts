import * as fs from "fs";
import { logMessage, sleep } from "../flare/utils/utils";
const Web3 = require("web3");
const web3Eth = require("web3-eth");
const cliProgress = require("cli-progress");

import InitialAirdropAbi from "../../artifacts/contracts/genesis/implementation/InitialAirdrop.sol/InitialAirdrop.json";
import { toBN } from "../../test/utils/test-helpers";
import { InitialAirdrop } from "../../typechain-web3/InitialAirdrop";

// Uses 0.12 per call for gas, makes 2850 calls => 342 native tokens are burned

let { argv } = require("yargs")
  .scriptName("distributeInitialAirdrop")
  .option("d", {
    alias: "deployment-name",
    describe: "Deployment file name (generated to deployment/deploys/ folder)",
    type: "string",
    demandOption: "Deployment name is required (-d or --deployment-name)",
    default: "deployment/deploys/flare.json",
    nargs: 1,
  })
  .option("g", {
    alias: "gas",
    describe: "gas per transaction",
    type: "string",
    default: "3000000",
    nargs: 1,
  })
  .option("p", {
    alias: "gas-price",
    describe: "gas price per transaction",
    type: "string",
    default: "40000000000", // "225 000 000 000" 
    nargs: 1,
  })
  .option("i", {
    alias: "chain-id",
    describe: "chain id for network",
    type: "number",
    demandOption: "Chain id is required (-i or --chain-id)",
    nargs: 1,
  })
  .option("l", {
    alias: "log-path",
    describe: "log data path",
    type: "string",
    default: "airdrop/flare/files/logs/",
    nargs: 1,
  })
  .option("q", {
    alias: "quiet",
    describe: "quiet",
    type: "boolean",
    default: "false",
    nargs: 1,
  })
  .fail(function (msg: any, err: any, yargs: any) {
    if (err) throw err;
    console.error("Exiting with message");
    console.error(msg);
    console.error(yargs.help());
    process.exit(0);
  });

async function main(
  deploymentName: string,
  logPath: string,
  quiet: boolean = true,
  gasRaw: string,
  gasPriceRaw: string,
  chainIdRaw: number
) {
  let airdropTransferKey: string;
  const gas = "0x" + toBN(gasRaw).toString(16);
  const gasPrice = "0x" + toBN(gasPriceRaw).toString(16);
  const chainId = "0x" + chainIdRaw.toString(16);

  if (process.env.AIRDROP_TRANSFER_PRIVATE_KEY) {
    airdropTransferKey = process.env.AIRDROP_TRANSFER_PRIVATE_KEY;
  } else {
    console.error("No AIRDROP_TRANSFER_PRIVATE_KEY provided in env");
    throw new Error("No AIRDROP_TRANSFER_PRIVATE_KEY provided in env");
  }

  console.log(deploymentName);

  if (!fs.existsSync(deploymentName)) {
    console.error(`No file at ${deploymentName}`);
    throw new Error(`No file at ${deploymentName}`);
  }

  let web3Provider = "";
  if (process.env.WEB3_PROVIDER_URL) {
    web3Provider = process.env.WEB3_PROVIDER_URL;
  } else {
    console.error("No WEB3_PROVIDER_URL provided in env");
    throw new Error("No WEB3_PROVIDER_URL provided in env");
  }

  const rawDeploy = fs.readFileSync(deploymentName);
  const contractArray = JSON.parse(rawDeploy as any) as {
    name: string;
    contractName: string;
    address: string;
  }[];

  const InitialAirdropAddress = contractArray.find(
    (elem) => elem.contractName === "InitialAirdrop.sol"
  );

  const web3 = new Web3(web3Provider);

  const InitialAirdropContract = new web3.eth.Contract(
    InitialAirdropAbi.abi,
    InitialAirdropAddress?.address || ""
  ) as any as InitialAirdrop;

  const now = new Date();
  const logFileName = logPath + `${now.toISOString()}_transferAirdrop_log.txt`;
  if (!quiet) console.log(logFileName);
  logMessage(
    logFileName,
    `Log file created at ${now.toISOString()} GMT(+0)`,
    quiet
  );
  logMessage(logFileName, `Script run with `, quiet);
  logMessage(
    logFileName,
    `Initial Airdrop address: ${InitialAirdropAddress?.address} `,
    quiet
  );

  const AirdropSigner =
    web3.eth.accounts.privateKeyToAccount(airdropTransferKey);
  logMessage(
    logFileName,
    `signer public key (from AIRDROP_TRANSFER_PRIVATE_KEY.  in .env) : ${AirdropSigner.address}`,
    quiet
  );

  const numOfAcc = toBN(await InitialAirdropContract.methods.airdropAccountsLength().call());;
  const initialAirdropBatchSize = 50;

  const numOfCalls = numOfAcc.divn(initialAirdropBatchSize).addn(1).toNumber();
  const bar1 = new cliProgress.SingleBar(
    {},
    cliProgress.Presets.shades_classic
  );
  bar1.start(numOfCalls, 0);
  for (let i = 0; i < numOfCalls; i++) {
    try {
      await sleep(950);

      const call = InitialAirdropContract.methods.transferAirdrop();
      const options = {
        to: InitialAirdropAddress?.address || "",
        from: AirdropSigner.address,
        gas: gas,
        gasPrice: gasPrice,
        chainId: chainId,
        data: call.encodeABI(),
      };

      const signed = await AirdropSigner.signTransaction(options);
      const rec = await web3.eth.sendSignedTransaction(signed.rawTransaction);
;
    } catch (e) {
      console.log(e);
    }
    bar1.update(i);
  }
  bar1.stop();
  logMessage(logFileName, `Complete`, quiet);
}

const { quiet, logPath, deploymentName, gas, gasPrice, chainId } = argv;
main(deploymentName, logPath, quiet, gas, gasPrice, chainId)
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
