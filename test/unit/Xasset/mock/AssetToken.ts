import { AssetTokenContract, AssetTokenInstance } from "../../../../typechain-truffle";
import { setDefaultVPContract } from "../../../utils/token-test-helpers";
import { expectRevert } from '@openzeppelin/test-helpers';

const getTestFile = require('../../../utils/constants').getTestFile;

const AssetToken = artifacts.require("AssetToken") as AssetTokenContract;

const ONLY_MINTER_MSG = "only minter";

contract(`AssetToken.sol; ${getTestFile(__filename)}; Asset token unit tests`, async accounts => {
  // contains a fresh contract for each test
  let xassetToken: AssetTokenInstance;

  beforeEach(async() => {
    xassetToken = await AssetToken.new(accounts[1], "A Token", "ATOK", 18);
    await setDefaultVPContract(xassetToken, accounts[1]);
  });

  it("Should not mint if not from governance", async() => {
    // Assemble
    // Act
    let promise = xassetToken.mint(accounts[2], 10);
    // Assert
    await expectRevert(promise, ONLY_MINTER_MSG);
  });

  it("Should not burn if not from governance", async() => {
    // Assemble
    await xassetToken.mint(accounts[2], 10, {from: accounts[1]});
    // Act
    let promise = xassetToken.burn(accounts[2], 10);
    // Assert
    await expectRevert(promise, ONLY_MINTER_MSG);
  });
  
  it("Should mint", async() => {
    // Assemble
    // Act
    await xassetToken.mint(accounts[2], 10, {from: accounts[1]});
    // Assert
    let balance = await xassetToken.balanceOf(accounts[2]);
    assert.equal(balance.toNumber(), 10);
  });

  it("Should burn", async() => {
    // Assemble
    await xassetToken.mint(accounts[2], 10, {from: accounts[1]});
    // Act
    await xassetToken.burn(accounts[2], 7, {from: accounts[1]});
    // Assert
    let balance = await xassetToken.balanceOf(accounts[2]);
    assert.equal(balance.toNumber(), 3);
  });

  it("Should set decimals", async() => {
    // Assemble
    const anotherXassetToken = await AssetToken.new(accounts[1], "A Token", "ATOK", 6);
    await setDefaultVPContract(anotherXassetToken, accounts[1]);
    // Act
    const decimals = await anotherXassetToken.decimals();
    // Assert
    assert.equal(decimals.toNumber(), 6);
  });
});
