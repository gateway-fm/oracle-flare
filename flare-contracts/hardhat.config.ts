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
import { extendEnvironment, task, types } from "hardhat/config";
import 'solidity-coverage';
import { activateManagers } from "./deployment/scripts/activate-managers";
import { Contracts } from "./deployment/scripts/Contracts";
import { daemonizeContracts } from "./deployment/scripts/daemonize-contracts";
import { deployContracts } from "./deployment/scripts/deploy-contracts";
import { loadParameters, verifyParameters } from "./deployment/scripts/deploy-utils";
import { transferGovWorkingBalance } from "./deployment/scripts/transfer-gov-working-balance";
import { undaemonizeContracts } from "./deployment/scripts/undaemonize-contracts";
import { TASK_CONSOLE } from "hardhat/builtin-tasks/task-names";
import "./type-extensions";
import { deployContractsGovernance } from "./deployment/scripts/deploy-contracts-governance";
import { switchToProductionMode } from "./deployment/scripts/switch-to-production-mode";
import { linkContracts } from "./deployment/scripts/link-contracts";
import { validatorRewards } from "./scripts/validatorRewards";
import { redeployContracts } from "./deployment/scripts/redeploy-contracts";


dotenv.config();

function getChainConfigParameters(chainConfig: string | undefined) {
  if (chainConfig) {
    const parameters = loadParameters(`deployment/chain-config/${chainConfig}.json`);

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
    verifyParameters(parameters);
    return parameters;
  } else {
    return undefined;
  }
}

function readContracts(network: string, filePath?: string): Contracts {
  const contracts = new Contracts();
  contracts.deserializeFile(filePath || (`deployment/deploys/${network}.json`));
  return contracts;
}

function injectModule(hre: any, mod: any) {
  // eslint-disable-next-line guard-for-in
  for (let key in mod) {
    hre[key] = mod[key];
  }
}

extendEnvironment((hre) => {
  injectModule(hre, require('./scripts/console-scripts/console-helpers'));
  hre.getChainConfigParameters = getChainConfigParameters;
  hre.getContractsMap = (filePath?: string) => readContracts(hre.network.name, filePath).getContractsMap(hre);
});

task(TASK_CONSOLE, "Opens a hardhat console")
  .setAction(async (args, hre, runSuper) => {
    // use try catch as hardhat.json has wrong addresses when used in unit tests
    try {
      hre.c = await hre.getContractsMap();
    } catch (error) {
      // do nothing
    }
    return runSuper(args);
  });

// Rig up deployment tasks
task("deploy-contracts", "Deploy all contracts")
  .addFlag("quiet", "Suppress console output")
  .setAction(async (args, hre, runSuper) => {
    const parameters = getChainConfigParameters(process.env.CHAIN_CONFIG);
    if (parameters) {
      await deployContracts(hre, parameters, args.quiet);
    } else {
      throw Error("CHAIN_CONFIG environment variable not set. Must be parameter json file name.")
    }
  });

task("link-contracts", "Link contracts with external libraries")
  .setAction(async (args, hre, runSuper) => {
    await linkContracts(hre);
  });

task("redeploy-contracts", "Redeploy some contracts")
  .addFlag("quiet", "Suppress console output")
  .setAction(async (args, hre, runSuper) => {
    const parameters = getChainConfigParameters(process.env.CHAIN_CONFIG);
    if (parameters) {
      const contracts = new Contracts();
      await contracts.deserialize(process.stdin);
      await redeployContracts(hre, contracts, parameters, args.quiet);
    } else {
      throw Error("CHAIN_CONFIG environment variable not set. Must be parameter json file name.")
    }
  });

task("deploy-contracts-governance", "Deploy governance contracts")
  .addFlag("quiet", "Suppress console output")
  .setAction(async (args, hre, runSuper) => {
    const parameters = loadParameters(`deployment/chain-config/${process.env.CHAIN_CONFIG}.json`);
    const contracts = new Contracts();
    await contracts.deserialize(process.stdin);
    // inject private keys from .env, if they exist
    if (process.env.DEPLOYER_PRIVATE_KEY) {
      parameters.deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY
    }
    if (parameters) {
      await deployContractsGovernance(hre, contracts, parameters, args.quiet);
    } else {
      throw Error("CHAIN_CONFIG environment variable not set. Must be parameter json file name.")
    }
  });

task("daemonize-contracts", "Register contracts to be daemonized with the FlareDaemon.")
  .addFlag("quiet", "Suppress console output")
  .setAction(async (args, hre, runSuper) => {
    const parameters = getChainConfigParameters(process.env.CHAIN_CONFIG);
    if (parameters) {
      const contracts = new Contracts();
      await contracts.deserialize(process.stdin);
      await daemonizeContracts(hre, contracts, parameters, args.quiet);
    } else {
      throw Error("CHAIN_CONFIG environment variable not set. Must be parameter json file name.")
    }
  });

task("activate-managers", "Activate all manager contracts.")
    .addFlag("quiet", "Suppress console output")
    .setAction(async (args, hre, runSuper) => {
    const parameters = getChainConfigParameters(process.env.CHAIN_CONFIG);
    if (parameters) {
      const contracts = new Contracts();
      await contracts.deserialize(process.stdin);
      await activateManagers(
        hre,
        contracts,
        parameters.deployerPrivateKey,
        args.quiet);
    } else {
      throw Error("CHAIN_CONFIG environment variable not set. Must be parameter json file name.")
    }
  });

task("switch-to-production-mode", "Switch governed contracts to production mode. All contracts will use governance from governance pointer contract and with timelock.")
  .addFlag("quiet", "Suppress console output")
  .setAction(async (args, hre, runSuper) => {
    const parameters = getChainConfigParameters(process.env.CHAIN_CONFIG);
    if (parameters) {
      const contracts = new Contracts();
      await contracts.deserialize(process.stdin);
      await switchToProductionMode(
        hre,
        contracts,
        parameters.deployerPrivateKey,
        parameters.genesisGovernancePrivateKey,
        args.quiet
      );
    } else {
      throw Error("CHAIN_CONFIG environment variable not set. Must be parameter json file name.")
    }
  });

task("transfer-gov-working-balance", "Transfer working balance to multisig governance accounts.")
  .addFlag("quiet", "Suppress console output")
  .setAction(async (args, hre, runSuper) => {
    const parameters = getChainConfigParameters(process.env.CHAIN_CONFIG);
    if (parameters) {
      await transferGovWorkingBalance(
        hre,
        parameters.deployerPrivateKey,
        args.quiet);
    } else {
      throw Error("CHAIN_CONFIG environment variable not set. Must be parameter json file name.")
    }
  });

task("undaemonize-contracts", "Remove daemonized contracts from the FlareDaemon.")
  .addFlag("quiet", "Suppress console output")
  .setAction(async (args, hre, runSuper) => {
    const parameters = getChainConfigParameters(process.env.CHAIN_CONFIG);
    if (parameters) {
      const contracts = new Contracts();
      await contracts.deserialize(process.stdin);
      try {
        // Try first with the deployer key
        await undaemonizeContracts(
          hre,
          contracts,
          parameters.deployerPrivateKey,
          args.quiet);
      } catch {
        try {
          // That did not work, so try with the genesis governance private key
          await undaemonizeContracts(
            hre,
            contracts,
            parameters.genesisGovernancePrivateKey,
            args.quiet);
        } catch {
          // That did not work, so try with the governance private key, if it exists (won't work with Gnosis safe)
          await undaemonizeContracts(
            hre,
            contracts,
            parameters.governancePrivateKey,
            args.quiet);
          // If this throws, let it...
        }
      }
    } else {
      throw Error("CHAIN_CONFIG environment variable not set. Must be parameter json file name.")
    }
  });

task("calculate-validator-rewards", "Calculate validator rewards\n example usage: yarn hardhat calculate-validator-rewards  --input validator_data/validator_data.csv --network flare")
  .addFlag("quiet", "Suppress console output")
  .addParam("input", "Report File")
  .addOptionalParam<string | undefined>("output", "Output file or empty for stdout", undefined)
  .setAction(async (args, hre, runSuper) => {
    await validatorRewards(hre, args.input, args.output, args.quiet);
  });


export default config;
