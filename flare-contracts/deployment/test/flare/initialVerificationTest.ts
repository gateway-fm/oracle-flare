const fs = require("fs");
const web3 = require("web3");
import BigNumber from "bignumber.js";
import * as openpgp from 'openpgp';

import InitialAirdropAbi from "../../../artifacts/contracts/genesis/implementation/InitialAirdrop.sol/InitialAirdrop.json";
import { InitialAirdrop } from "../../../typechain-web3/InitialAirdrop";


const AIRDROP_TRANSACTIONS_GAS_COST = "407200000000000000000"

contract(`initialVerificationTest.ts: Airdrop validation pre-tests for flare deployment`, async accounts => {
  let web3Provider: string;
  let Web3: any;
  let initialAirdropSigner: string;
  let InitialAirdropContract: InitialAirdrop;
  const deploymentName = "deployment/deploys/flare.json"

  before(async() => {
    if (process.env.WEB3_PROVIDER_URL) {
      web3Provider = process.env.WEB3_PROVIDER_URL
      Web3 = new web3(web3Provider);
    }
    else {
        console.error("No WEB3_PROVIDER_URL provided in env");
        throw new Error("No WEB3_PROVIDER_URL provided in env");
    }
    if (process.env.DEPLOYER_PUBLIC_KEY) {
      initialAirdropSigner = process.env.DEPLOYER_PUBLIC_KEY
    }
    else {
        console.error("No DEPLOYER_PUBLIC_KEY provided in env");
        throw new Error("No DEPLOYER_PUBLIC_KEY provided in env");
    }

    const rawDeploy = fs.readFileSync(deploymentName)
    const contractArray = JSON.parse(rawDeploy as any) as {name: string, contractName: string, address: string} []

    const InitialAirdropAddress = contractArray.find((elem) => elem.contractName === 'InitialAirdrop.sol')  

    try{
      InitialAirdropContract = new Web3.eth.Contract(
        InitialAirdropAbi.abi,
        InitialAirdropAddress?.address || ''
      ) as any as InitialAirdrop;
    } catch (e) {
      throw new Error(`Error initializing initial airdrop contract ${e}`);
    }
  });

  it(`Should balance airdrop signer address to ${AIRDROP_TRANSACTIONS_GAS_COST}`, async function(){
    const bnInitial = new BigNumber(AIRDROP_TRANSACTIONS_GAS_COST);
    const signerBalance = await Web3.eth.getBalance(initialAirdropSigner);
    assert(Web3.utils.toBN(signerBalance).gt(bnInitial));
  });

  it(`Should verify airdrop signer is InitialAirdrop governance`, async function(){
    const initialAirdropGovernance = await InitialAirdropContract.methods.governance().call()
    assert.equal(initialAirdropGovernance.toLocaleLowerCase(), initialAirdropSigner.toLocaleLowerCase());
  });

  it("Should verify digital signature of airdrop conversion file", async () => {
    // Assemble
    let msg_data = fs.readFileSync("./airdrop/flare/data/export.csv", 'utf8');
    let sig_data = fs.readFileSync("./airdrop/flare/data/export.csv.sig", null);
    let pubkey_data = fs.readFileSync("./airdrop/flare/data/flare-foundation.asc", 'utf8');
    // Read in csv and create a pgp message to verify
    const msg = await openpgp.createMessage({
      text: msg_data
    });
    // Read in the binary signature
    const sig = await openpgp.readSignature({
      binarySignature: sig_data
    });
    // Read in the ascii armored public key for verification
    const pubkey = await openpgp.readKey({ armoredKey: pubkey_data });
    // Act
    // Verify the signature
    const { signatures: [sigInfo] } = await openpgp.verify({
        message: msg,
        signature: sig,
        verificationKeys: pubkey
    });
    // Assert
    assert.isTrue(await sigInfo.verified);
  })
});