import { VotePowerMockContract, VotePowerMockInstance } from "../../../../typechain-truffle";
import { toBN } from "../../../utils/test-helpers";

// Unit tests for VotePower through VotePowerMock contract
import {expectRevert, constants} from '@openzeppelin/test-helpers';
const getTestFile = require('../../../utils/constants').getTestFile;

const VotePower = artifacts.require("VotePowerMock") as VotePowerMockContract;

contract(`VotePower.sol; ${getTestFile(__filename)}; Vote power unit tests`, async accounts => {
  // contains a fresh contract for each test
  let votePower: VotePowerMockInstance;

  // Do clean unit tests by spinning up a fresh contract for each test
  beforeEach(async () => {
    votePower = await VotePower.new();
  });

  it("Should mint vote power for an address", async() => {
    // Assemble
    // Act
    await votePower._mint(accounts[1], 10);
    // Assert
    assert.equal(await votePower.votePowerOfAtNow(accounts[1]) as any, 10);
  });

  it("Should mint vote power for an address (zero case)", async () => {
    // Assemble
    await votePower._mint(accounts[1], 10);
    // Act
    await votePower._mint(accounts[1], 0);
    // Assert
    assert.equal(await votePower.votePowerOfAtNow(accounts[1]) as any, 10);
  });

  it("Should not mint the zero address", async() => {
    // Assemble
    // Act
    let mintPromise = votePower._mint(constants.ZERO_ADDRESS, 10);
    // Assert
    await expectRevert.assertion(mintPromise);
  });

  it("Should burn vote power for an address", async() => {
    // Assemble
    await votePower._mint(accounts[1], 10);
    // Act
    await votePower._burn(accounts[1], 6);
    // Assert
    assert.equal(await votePower.votePowerOfAtNow(accounts[1]) as any, 4);
  });

  it("Should burn vote power for an address (zero case)", async () => {
    // Assemble
    await votePower._mint(accounts[1], 10);
    // Act
    await votePower._burn(accounts[1], 0);
    // Assert
    assert.equal(await votePower.votePowerOfAtNow(accounts[1]) as any, 10);
  });

  it("Should not burn the zero address", async() => {
    // Assemble
    // Act
    let burnPromise = votePower._burn(constants.ZERO_ADDRESS, 10);
    // Assert
    await expectRevert.assertion(burnPromise);
  });

  it("Should not burn more than minted for an address", async() => {
    // Assemble
    // Act
    let burnPromise = votePower._burn(accounts[1], 10);
    // Assert
    await expectRevert(burnPromise, "SafeMath: subtraction overflow");
  });

  it("Should record historic vote power for an address", async() => {
    // Assemble
    const b = [];
    let blockAfterFirstMinting = 0;

    await votePower._mint(accounts[1], 10);
    await votePower._mint(accounts[2], 20);
    b[blockAfterFirstMinting] = await web3.eth.getBlockNumber();

    // Act
    await votePower._mint(accounts[2], 50);

    // Assert
    assert.equal(await votePower.votePowerOfAt(accounts[2], b[blockAfterFirstMinting]) as any, 20);
  });

  it("Should transmit vote power", async() => {
    // Assemble
    await votePower._mint(accounts[1], 20);
    // Act
    await votePower.transmit(accounts[1], accounts[2], 5);
    // Assert
    assert.equal(await votePower.votePowerOfAtNow(accounts[1]) as any, 15);
    assert.equal(await votePower.votePowerOfAtNow(accounts[2]) as any, 5);
  });

});
