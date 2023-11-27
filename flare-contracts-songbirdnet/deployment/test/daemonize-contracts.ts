import { Contracts } from "../scripts/Contracts";
import {
  FlareDaemonContract, 
  FlareDaemonInstance
} from "../../typechain-truffle";
import { validateParameters } from "../scripts/deploy-utils";

const parameters = validateParameters(require(`../chain-config/${process.env.CHAIN_CONFIG}.json`))

async function findDaemonizedContract(contracts: Contracts, address: string): Promise<boolean> {
  const FlareDaemon = artifacts.require("FlareDaemon");
  const flareDaemon = await FlareDaemon.at(contracts.getContractAddress(Contracts.FLARE_DAEMON));
  const { 0: daemonizedContracts } = await flareDaemon.getDaemonizedContractsData();
  return daemonizedContracts && daemonizedContracts.indexOf(address) >= 0
}

/**
 * This test assumes a local chain is running with Flare allocated in accounts
 * listed in `./hardhat.config.ts`
 */
contract(`daemonize-contracts.ts system tests`, async accounts => {
  let contracts: Contracts;

  before(async () => {
    contracts = new Contracts();
    await contracts.deserialize(process.stdin);
  });

  describe(Contracts.FLARE_DAEMON, async () => {
    let FlareDaemon: FlareDaemonContract;
    let flareDaemon: FlareDaemonInstance;

    beforeEach(async () => {
      FlareDaemon = artifacts.require("FlareDaemon") as FlareDaemonContract;
      flareDaemon = await FlareDaemon.at(contracts.getContractAddress(Contracts.FLARE_DAEMON));
    });

    it("Should be daemonizing inflation contract", async () => {
      // Assemble
      // Act
      const found = await findDaemonizedContract(contracts, contracts.getContractAddress(Contracts.INFLATION));
      // Assert
      assert(found);
    });

    it("Should be daemonizing ftso manager", async () => {
      // Assemble
      // Act
      const found = await findDaemonizedContract(contracts, contracts.getContractAddress(Contracts.FTSO_MANAGER));
      // Assert
      assert(found);
    });
  });
});
