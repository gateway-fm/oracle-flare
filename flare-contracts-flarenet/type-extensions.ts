import "hardhat/types/runtime";
import { ChainParameters } from "./deployment/chain-config/chain-parameters";

declare module "hardhat/types/runtime" {
  // This is an example of an extension to the Hardhat Runtime Environment.
  // This new field will be available in tasks' actions, scripts, and tests.
  export interface HardhatRuntimeEnvironment {
    getChainConfigParameters(chainConfig: string | undefined): ChainParameters | undefined;
    getContractsMap(filePath?: string): any;
    c: {}; // contracts
  }
}
