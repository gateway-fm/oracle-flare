const fs = require("fs");
import * as openpgp from "openpgp";

contract(`Should verify airdrop data signature`, async (accounts) => {
  it("Should verify digital signature of airdrop conversion file", async () => {
    // Assemble
    let msg_data = fs.readFileSync("./airdrop/flare/data/export.csv", "utf8");
    let sig_data = fs.readFileSync("./airdrop/flare/data/export.csv.sig", null);
    let pubkey_data = fs.readFileSync(
      "./airdrop/flare/data/flare-foundation.asc",
      "utf8"
    );
    // Read in csv and create a pgp message to verify
    const msg = await openpgp.createMessage({
      text: msg_data,
    });
    // Read in the binary signature
    const sig = await openpgp.readSignature({
      binarySignature: sig_data,
    });
    // Read in the ascii armored public key for verification
    const pubkey = await openpgp.readKey({ armoredKey: pubkey_data });
    // Act
    // Verify the signature
    const {
      signatures: [sigInfo],
    } = await openpgp.verify({
      message: msg,
      signature: sig,
      verificationKeys: pubkey,
    });
    // Assert
    assert.isTrue(await sigInfo.verified);
  });
});
