import hre from 'hardhat';
import { ChainParameters } from "../../../deployment/chain-config/chain-parameters";
import { activateManagers } from "../../../deployment/scripts/activate-managers";
import { daemonizeContracts } from "../../../deployment/scripts/daemonize-contracts";
import { deployContracts } from "../../../deployment/scripts/deploy-contracts";
import { loadParameters, verifyParameters } from "../../../deployment/scripts/deploy-utils";
import { switchToProductionMode } from "../../../deployment/scripts/switch-to-production-mode";

export function getChainConfigParameters(configFile: string): ChainParameters {
    const parameters = loadParameters(configFile);

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
}

export async function internalLinkContracts() {
    // link FtsoManager
    const FtsoManager = hre.artifacts.require('FtsoManager');
    const FtsoManagement = hre.artifacts.require('FtsoManagement' as any);
    FtsoManager.link(await FtsoManagement.new() as any);
    // link FtsoRewardManager
    const FtsoRewardManager = hre.artifacts.require('FtsoRewardManager');
    const DataProviderFee = hre.artifacts.require('DataProviderFee' as any);
    FtsoRewardManager.link(await DataProviderFee.new() as any);
    // hack artifacts.require to return linked contracts
    const oldRequire = hre.artifacts.require;
    hre.artifacts.require = function (name: string) {
        if (name === 'FtsoManager') return FtsoManager;
        if (name === 'FtsoRewardManager') return FtsoRewardManager;
        return oldRequire.call(hre.artifacts, name);
    };
}

export async function internalFullDeploy(parameters: ChainParameters, quiet: boolean) {
    await internalLinkContracts();
    const deployed = await deployContracts(hre, parameters, quiet);
    const contracts = deployed.contracts!;
    await daemonizeContracts(hre, contracts, parameters, quiet);
    await activateManagers(hre, contracts, parameters.deployerPrivateKey, quiet);
    await switchToProductionMode(hre, contracts, parameters.deployerPrivateKey, parameters.genesisGovernancePrivateKey, quiet);
    return deployed;
}

export function reportError(e: any) {
    console.error(e.stack || e);
}

export function messageIncluded(message: unknown, expectedMessages: string[]) {
    const messageStr = message == null ? '' : '' + message;
    for (const msg of expectedMessages) {
        if (messageStr.includes(msg)) return true;
    }
    return false;
}

export function expectErrors(e: any, expectedMessages: string[]) {
    if (!messageIncluded(e?.message, expectedMessages)) {
        throw e;    // unexpected error
    }
}
