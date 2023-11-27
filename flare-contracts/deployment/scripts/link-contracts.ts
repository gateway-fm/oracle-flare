import { readFileSync, writeFileSync } from 'fs';
import { HardhatRuntimeEnvironment } from 'hardhat/types';

export async function linkContracts(hre: HardhatRuntimeEnvironment) {
  const artifacts = hre.artifacts;

  const overrideTempl = {
    version: "0.7.6",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      },
      "libraries": {}
    }
  };
  
  // deploy libraries
  
  const DataProviderFee = artifacts.require("DataProviderFee");
  const deployedDataProviderFee = await DataProviderFee.new();

  const FtsoManagement = artifacts.require("FtsoManagement");
  const deployedFtsoManagement = await FtsoManagement.new();

  // add to config for compilation
  
  const lines: string[] = [];
  
  overrideTempl.settings.libraries = {
    "contracts/tokenPools/lib/DataProviderFee.sol": {
      "DataProviderFee": deployedDataProviderFee.address
    }
  };
  lines.push(`"contracts/tokenPools/implementation/FtsoRewardManager.sol": ${JSON.stringify(overrideTempl, null, 2)}`);

  overrideTempl.settings.libraries = {
    "contracts/ftso/lib/FtsoManagement.sol": {
      "FtsoManagement": deployedFtsoManagement.address
    }
  };
  lines.push(`"contracts/ftso/implementation/FtsoManager.sol": ${JSON.stringify(overrideTempl, null, 2)}`);

  let text = readFileSync("hardhatSetup.config.ts").toString();
  text = text.replace("// EXTRA_OVERRIDES", lines.join(",\n"))

  writeFileSync("hardhat-link.config.ts", text);
}
