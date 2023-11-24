import { Contracts } from "../scripts/Contracts";

/**
 * This test assumes a local chain is running with Flare allocated in accounts
 * listed in `./hardhat.config.ts`
 */
contract(`activate-managers.ts system tests`, async accounts => {
  let contracts: Contracts;

  before(async () => {
    contracts = new Contracts();
    await contracts.deserialize(process.stdin);
  });

  describe(Contracts.FTSO_MANAGER, async () => {
    it("Should be activated", async () => {
      // Assemble
      const FtsoManager = artifacts.require("FtsoManager");
      const ftsoManager = await FtsoManager.at(contracts.getContractAddress(Contracts.FTSO_MANAGER));
      // Act
      const active = await ftsoManager.active();
      // Assert
      assert(active);
    });
  });

  describe(Contracts.FTSO_REWARD_MANAGER, async () => {
    it("Should be activated", async () => {
      // Assemble
      const FtsoRewardManager = artifacts.require("FtsoRewardManager");
      const ftsoRewardManager = await FtsoRewardManager.at(contracts.getContractAddress(Contracts.FTSO_REWARD_MANAGER));
      // Act
      const active = await ftsoRewardManager.active();
      // Assert
      assert(active);
    });
  });

});
