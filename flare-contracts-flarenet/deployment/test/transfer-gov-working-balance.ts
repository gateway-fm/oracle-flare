import { governanceAccounts, WORKING_BALANCE_WEI } from "../scripts/multisig-governance-accounts";

contract(`transfer-gov-working-balance.ts system tests`, async accounts => {
  describe("Multisig governance accounts balance check", async () => {
    it("Should have working balances", async () => {
      for(let i = 0; i < governanceAccounts.length; i++) {
        // Assemble
        // Act
        const balance = await web3.eth.getBalance(governanceAccounts[i]);
        // Assert
        assert.equal(balance, WORKING_BALANCE_WEI, `Address ${governanceAccounts[i]} does not have ${WORKING_BALANCE_WEI} wei.`);
      };
    });
  });
});