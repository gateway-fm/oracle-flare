import { artifacts, ethers } from "hardhat";
const hre = require("hardhat");

async function main() {
    let DummyVPToken = artifacts.require("DummyVPToken");
    let dummyVPToken = await DummyVPToken.new("Dummy Vote Power Token", "DVPT");
    
    // Getting accounts
    let signers = await ethers.getSigners()
    let accounts = signers.map(signer => signer.address)

    // info
    console.log("Dummy VP Token deployed to:", dummyVPToken.address);
    console.log("Approving transfer");

    // transaction
    let tx1 = await dummyVPToken.approve(accounts[1], web3.utils.toWei("1", "ether"))

    // store contract deployment metadata
    await hre.tenderly.persistArtifacts({
        name: "DummyVPToken",
        address: dummyVPToken.address
    });

    // printout transaction hash
    console.log("Transfer approved! TX hash:", tx1.tx);
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
