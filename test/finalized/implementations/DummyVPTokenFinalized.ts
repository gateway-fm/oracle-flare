import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import chai from "chai";
import { BigNumber } from "ethers";
import { ethers } from "hardhat";
import { DummyVPToken } from "../../../typechain";
import { solidity } from "ethereum-waffle";
import { waitFinalize } from "../../utils/test-helpers";

chai.use(solidity);

const { expect } = chai;

describe("DummyVPToken", () => {
  let dummyToken: DummyVPToken;
  let signers: SignerWithAddress[];
  before(async function () {
    signers = await ethers.getSigners();

    const dummyTokenFactory = await ethers.getContractFactory(
      "DummyVPToken", signers[0]
    );
    dummyToken = await dummyTokenFactory.deploy("Dummy Vote Power Token", "DVPT") as DummyVPToken
    await dummyToken.deployed();
  });

  describe('test', function () {
    it("Accounts balances are not zero", async function () {
      let balances = await Promise.all(signers.slice(0, 10).map(signer => dummyToken.balanceOf(signer.address)))
      balances.forEach((balance, i) => {
        if (i == 0) {
          expect(balance).to.not.equal(BigNumber.from(0));
        } else {
          expect(balance).to.equal(BigNumber.from(0));
        }
      })
    });
    it("MinterAmount should be the same as total supply", async function () {
      let totalSupply = await dummyToken.totalSupply();
      let balanceOf0 = await dummyToken.balanceOf(signers[0].address);
      expect(balanceOf0).to.equal(totalSupply);
    });
    it("Transfer amount should be the same as other account's balance", async function () {
      let approveAmount = ethers.utils.parseEther("5");//BigNumber.from(5) * 1e18) - cannot use this - causes overflow!!!;
      let transferAmount = ethers.utils.parseEther("5");
      await (await dummyToken
        .connect(signers[0])
        .approve(
          signers[1].address, approveAmount,
          { gasLimit: 3000000, gasPrice: ethers.utils.parseUnits("1", "gwei") }
        )
      ).wait();

      await waitFinalize(signers[0], async () =>
        dummyToken.connect(signers[0]).approve(signers[1].address, approveAmount, { gasLimit: 3000000 })
      );

      await waitFinalize(signers[0], async () =>
        dummyToken.connect(signers[0]).transfer(signers[1].address, transferAmount, { gasLimit: 3000000})
      );
      let balanceOf1 = await dummyToken.balanceOf(signers[1].address);
      expect(balanceOf1).to.equal(transferAmount);
    });
    it("Account0's balance should be the same as the account's voting power", async function () {
      let blockNumber = BigNumber.from(0);
      let balanceOf0 = await dummyToken.balanceOf(signers[0].address);
      let votePower0 = await dummyToken.votePowerOfAt(signers[0].address, blockNumber);
      expect(balanceOf0.div(ethers.utils.parseEther("1"))).to.equal(votePower0);
    });
    it("Account1's balance should be the same as the account's voting power", async function () {
      let blockNumber = BigNumber.from(0);
      let balanceOf1 = await dummyToken.balanceOf(signers[1].address);
      let votePower1 = await dummyToken.votePowerOfAt(signers[1].address, blockNumber);
      expect(balanceOf1.div(ethers.utils.parseEther("1"))).to.equal(votePower1);
    });
  });
});


