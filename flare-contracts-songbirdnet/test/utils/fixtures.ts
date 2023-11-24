import { deployments } from "hardhat";
import { deployContracts } from "../../deployment/scripts/deploy-contracts";
import fs from "fs";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { ChainParameters } from "../../deployment/chain-config/chain-parameters";

const BN = web3.utils.toBN;

export interface FtsoConfigParams {
    firstPriceEpochStartTs: BN;
    priceEpochDurationSec: BN;
    revealEpochDurationSec: BN;
    rewardEpochDurationSec: BN;
    rewardEpochsStartTs: BN;
}

// Reads deployment parameters from file
export function readDeploymentParametersForConfiguration(configName: string): ChainParameters {
    let deploymentParameters: ChainParameters = JSON.parse(fs.readFileSync(`deployment/chain-config/${configName}.json`).toString());
    // inject private keys from .env, if they exist

    if (process.env.DEPLOYER_PRIVATE_KEY) {
        deploymentParameters.deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY
    }
    if (process.env.GENESIS_GOVERNANCE_PRIVATE_KEY) {
        deploymentParameters.genesisGovernancePrivateKey = process.env.GENESIS_GOVERNANCE_PRIVATE_KEY
    }
    if (process.env.GOVERNANCE_PRIVATE_KEY) {
        deploymentParameters.governancePrivateKey = process.env.GOVERNANCE_PRIVATE_KEY
    }
    return deploymentParameters;
}

// Returns full deployment fixture
export function fullDeploymentFixture(hre: HardhatRuntimeEnvironment, deploymentParameters: ChainParameters) {
    return deployments.createFixture(async (env, options) => {
        let contracts = await deployContracts(hre, deploymentParameters, true);
        return contracts;
    });
}
