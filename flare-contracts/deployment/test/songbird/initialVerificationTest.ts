const fs = require("fs");
const web3 = require("web3");
import BigNumber from "bignumber.js";
import * as openpgp from 'openpgp';

const AIRDROP_SIGNER_BALANCE = "3900056276934594667740000000";

contract(`initialVerificationTest.ts: Airdrop validation pre-tests`, async accounts => {
  let web3Provider: string;
  let Web3: any;
  let airdropSigner: string;

  before(async() => {
    if (process.env.WEB3_PROVIDER_URL) {
      web3Provider = process.env.WEB3_PROVIDER_URL
      Web3 = new web3(web3Provider);
    }
    else {
        console.error("No WEB3_PROVIDER_URL provided in env");
        throw new Error("No WEB3_PROVIDER_URL provided in env");
    }
    if (process.env.AIRDROP_PUBLIC_KEY) {
      airdropSigner = process.env.AIRDROP_PUBLIC_KEY
    }
    else {
        console.error("No AIRDROP_PUBLIC_KEY provided in env");
        throw new Error("No AIRDROP_PUBLIC_KEY provided in env");
    }
  });

  it(`Should balance airdrop signer address to ${AIRDROP_SIGNER_BALANCE}`, async function(){
    const bninitial = new BigNumber(AIRDROP_SIGNER_BALANCE);
    const signerBalance = await Web3.eth.getBalance(airdropSigner);
    assert.equal(signerBalance,bninitial.toString(10));
  });

  it(`Should verify airdrop signer transaction count is 0`, async function(){
    const signerTransactionCount = await Web3.eth.getTransactionCount(airdropSigner);
    assert.equal(signerTransactionCount,0);
  });

  it("Should verify digital signature of airdrop conversion file", async () => {
    // Assemble
    let msg_data = fs.readFileSync("./airdrop/songbird/data/export.csv", 'utf8');
    let sig_data = fs.readFileSync("./airdrop/songbird/data/export.csv.sig", null);
    let pubkey_data = fs.readFileSync("./airdrop/songbird/data/flare-foundation.asc", 'utf8');
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