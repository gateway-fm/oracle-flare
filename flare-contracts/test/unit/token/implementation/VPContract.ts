import { setDefaultVPContract } from "../../../utils/token-test-helpers";

// Unit tests for VPToken: checkpointable, delegatable, and ERC20 sanity tests
import { constants, expectRevert, time } from '@openzeppelin/test-helpers';
import { getTestFile } from "../../../utils/constants";

const VPToken = artifacts.require("VPTokenMock");
const VPContract = artifacts.require("VPContractMock");

contract(`VPContract.sol; ${getTestFile(__filename)}; VPContract unit tests`, async accounts => {
  
  it("Should not create VPContract without owner", async () => {
    await expectRevert(VPContract.new(constants.ZERO_ADDRESS, false),
      "VPContract must belong to a VPToken");
  });

  it("Should not access VPContract mutable methods directly", async () => {
    // Assemble
    const vpToken = await VPToken.new(accounts[0], "A token", "ATOK");
    await setDefaultVPContract(vpToken, accounts[0]);
    const vpContractAddr = await vpToken.getWriteVpContract();
    const vpContract = await VPContract.at(vpContractAddr);
    // Act
    // Assert
    await expectRevert(vpContract.updateAtTokenTransfer(accounts[1], accounts[2], 500, 200, 250),
      "only owner token");
    await expectRevert(vpContract.delegate(accounts[1], accounts[2], 500, 2000),
      "only owner token");
    await expectRevert(vpContract.delegateExplicit(accounts[1], accounts[2], 500, 200),
      "only owner token");
    await expectRevert(vpContract.revokeDelegationAt(accounts[1], accounts[2], 500, 15),
      "only owner token");
    await expectRevert(vpContract.undelegateAll(accounts[1], 500),
      "only owner token");
    await expectRevert(vpContract.undelegateAllExplicit(accounts[1], [accounts[2], accounts[3]]),
      "only owner token");
  });
  
  it("Cleanup block/contract setters can only be called by owner token", async () => {
    // Assemble
    const vpToken = await VPToken.new(accounts[0], "A token", "ATOK");
    await setDefaultVPContract(vpToken, accounts[0]);
    const vpContractAddr = await vpToken.getWriteVpContract();
    const vpContract = await VPContract.at(vpContractAddr);
    await vpToken.setCleanupBlockNumberManager(accounts[0], { from: accounts[0] });
    // Act
    // Assert
    await expectRevert(vpContract.setCleanupBlockNumber(1, { from: accounts[1] }),
      "only owner token");
    await expectRevert(vpContract.setCleanerContract(accounts[3], { from: accounts[1] }),
      "only owner token");
    // there should be no revert when called via token
    await vpToken.setCleanupBlockNumber(1, { from: accounts[0] });
    await vpToken.setCleanerContract(accounts[3], { from: accounts[0] });
    expect(Number(await vpContract.cleanupBlockNumber())).to.equal(1);
    expect(await vpContract.cleanerContract()).to.equal(accounts[3]);
  });

  it("Should check if replacement set (trivial case)", async() => {
    // Assemble
    const vpToken = await VPToken.new(accounts[0], "A token", "ATOK");
    const vpContract = await VPContract.new(vpToken.address, false);
    // Act
    const blk = await time.latestBlock();
    // Assert
    const repl = await vpContract.votePowerInitializedAt(accounts[1], blk);
    assert.isTrue(repl);
  });

  it("Should check if replacement set (nontrivial case)", async () => {
    // Assemble
    const vpToken = await VPToken.new(accounts[0], "A token", "ATOK");
    const vpContract = await VPContract.new(vpToken.address, true);
    await vpToken.setWriteVpContract(vpContract.address);
    await vpToken.setReadVpContract(vpContract.address);
    // Act
    const blk1 = await time.latestBlock();
    await vpToken.mint(accounts[1], 1000);
    const blk2 = await time.latestBlock();
    // Assert
    const repl1 = await vpContract.votePowerInitializedAt(accounts[1], blk1);
    assert.equal(repl1, false);
    const repl2 = await vpContract.votePowerInitializedAt(accounts[1], blk2);
    assert.equal(repl2, true);
  });
});
