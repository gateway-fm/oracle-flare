// import config used for compilation
import config from "./hardhatSetup.config";

import "@nomiclabs/hardhat-ethers";
// Use also truffle and web3 for backward compatibility
import "@nomiclabs/hardhat-truffle5";
import "@nomiclabs/hardhat-waffle";
import "@nomiclabs/hardhat-web3";
import "@tenderly/hardhat-tenderly";
import * as dotenv from "dotenv";
import "hardhat-contract-sizer";
import 'hardhat-deploy';
import "hardhat-gas-reporter";
import 'solidity-coverage';


dotenv.config();

function getChainConfigParameters(chainConfig: string | undefined): any {
  if (chainConfig) {
    const fs = require("fs");
    const parameters = JSON.parse(fs.readFileSync(`deployment/chain-config/${chainConfig}.json`));

    // inject private keys from .env, if they exist
    if (process.env.DEPLOYER_PRIVATE_KEY) {
      parameters.deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY
    }
    if (process.env.GENESIS_GOVERNANCE_PRIVATE_KEY) {
      parameters.genesisGovernancePrivateKey = process.env.GENESIS_GOVERNANCE_PRIVATE_KEY
    }
    if (process.env.GOVERNANCE_PRIVATE_KEY) {
      parameters.governancePrivateKey = process.env.GOVERNANCE_PRIVATE_KEY
    }
    if (process.env.GOVERNANCE_PUBLIC_KEY) {
      parameters.governancePublicKey = process.env.GOVERNANCE_PUBLIC_KEY
    }
    if (process.env.GOVERNANCE_EXECUTOR_PUBLIC_KEY) {
      parameters.governanceExecutorPublicKey = process.env.GOVERNANCE_EXECUTOR_PUBLIC_KEY
    }
    return parameters;
  } else {
    return undefined;
  }
}


export default config;
