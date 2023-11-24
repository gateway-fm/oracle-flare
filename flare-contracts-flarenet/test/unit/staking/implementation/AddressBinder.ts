import { expectRevert, expectEvent } from "@openzeppelin/test-helpers";
import { AddressBinderInstance, BytesLibMockInstance } from "../../../../typechain-truffle";
import * as util from "../../../utils/key-to-address";
import privateKeys from "../../../../test-1020-accounts.json"
import { toChecksumAddress } from "ethereumjs-util";
import { bech32 } from 'bech32';

const getTestFile = require('../../../utils/constants').getTestFile;

const AddressBinder = artifacts.require("AddressBinder");
const BytesLibMock = artifacts.require("BytesLibMock");

contract(`AddressBinder.sol; ${getTestFile(__filename)}; Address binder unit tests`, async accounts => {

    let addressBinder: AddressBinderInstance;
    let bytesLibMock: BytesLibMockInstance;

    beforeEach(async () => {
        addressBinder = await AddressBinder.new();
    });

    it("Should register p and c addresses - public key is of the form 0x04+x+y", async () => {
        for (let i = 0; i < 50; i++) {
            let prvKey = privateKeys[i].privateKey.slice(2);
            let prvkeyBuffer = Buffer.from(prvKey, 'hex');
            let [x, y] = util.privateKeyToPublicKeyPair(prvkeyBuffer);
            let pubKey = "0x" + util.encodePublicKey(x, y, false).toString('hex');
            let pAddr = "0x" + util.publicKeyToAvalancheAddress(x, y).toString('hex');
            let cAddr = toChecksumAddress("0x" + util.publicKeyToEthereumAddress(x, y).toString('hex'));
            let registerCall = await addressBinder.registerPublicKey.call(pubKey);
            expect(registerCall[0]).to.equals(pAddr);
            expect(registerCall[1]).to.equals(cAddr);
            let register = await addressBinder.registerPublicKey(pubKey);
            expectEvent(register, "AddressesRegistered", { publicKey: pubKey, pAddress: pAddr, cAddress: cAddr });
            expect(await addressBinder.pAddressToCAddress(pAddr)).to.equals(cAddr);
            expect(await addressBinder.cAddressToPAddress(cAddr)).to.equals(pAddr);
        }
    });

    it("Should register p and c addresses - public key is of the form 0x+x+y", async () => {
        for (let i = 0; i < 50; i++) {
            let prvKey = privateKeys[i].privateKey.slice(2);
            let prvkeyBuffer = Buffer.from(prvKey, 'hex');
            let [x, y] = util.privateKeyToPublicKeyPair(prvkeyBuffer);
            let pubKey = "0x" + x.toString('hex') + y.toString('hex');
            let pAddr = "0x" + util.publicKeyToAvalancheAddress(x, y).toString('hex');
            let cAddr = toChecksumAddress("0x" + util.publicKeyToEthereumAddress(x, y).toString('hex'));
            let registerCall = await addressBinder.registerPublicKey.call(pubKey);
            expect(registerCall[0]).to.equals(pAddr);
            expect(registerCall[1]).to.equals(cAddr);
            let register = await addressBinder.registerPublicKey(pubKey);
            expectEvent(register, "AddressesRegistered", { publicKey: pubKey, pAddress: pAddr, cAddress: cAddr });
            expect(await addressBinder.pAddressToCAddress(pAddr)).to.equals(cAddr);
            expect(await addressBinder.cAddressToPAddress(cAddr)).to.equals(pAddr);
        }
    });

    it("Should register p and c addresses - public key is of the form 0x + 02/03 + x", async () => {
        for (let i = 0; i < 50; i++) {
            let prvKey = privateKeys[i].privateKey.slice(2);
            let prvkeyBuffer = Buffer.from(prvKey, 'hex');
            let [x, y] = util.privateKeyToPublicKeyPair(prvkeyBuffer);
            let pubKey = "0x" + util.encodePublicKey(x, y, true).toString('hex');
            let pAddr = "0x" + util.publicKeyToAvalancheAddress(x, y).toString('hex');
            let cAddr = toChecksumAddress("0x" + util.publicKeyToEthereumAddress(x, y).toString('hex'));
            let registerCall = await addressBinder.registerPublicKey.call(pubKey);
            expect(registerCall[0]).to.equals(pAddr);
            expect(registerCall[1]).to.equals(cAddr);
            let register = await addressBinder.registerPublicKey(pubKey);
            expectEvent(register, "AddressesRegistered", { publicKey: pubKey, pAddress: pAddr, cAddress: cAddr });
            expect(await addressBinder.pAddressToCAddress(pAddr)).to.equals(cAddr);
            expect(await addressBinder.cAddressToPAddress(cAddr)).to.equals(pAddr);
        }
    });

    it("Should not register if public key is of wrong format - wrong prefix", async () => {
        let prvKey = privateKeys[0].privateKey.slice(2);
        let prvkeyBuffer = Buffer.from(prvKey, 'hex');
        let [x, y] = util.privateKeyToPublicKeyPair(prvkeyBuffer);
        let pubKey = "0x05" + x.toString('hex') + y.toString('hex');
        let register = addressBinder.registerPublicKey(pubKey);
        await expectRevert(register, "wrong format of public key");
    });

    it("Should not register if public key is of wrong format - wrong length", async () => {
        let prvKey = privateKeys[0].privateKey.slice(2);
        let prvkeyBuffer = Buffer.from(prvKey, 'hex');
        let [x, y] = util.privateKeyToPublicKeyPair(prvkeyBuffer);
        let pubKey = "0x" + util.encodePublicKey(x, y, true).toString('hex');
        pubKey = pubKey.slice(4);
        pubKey = "0x05" + pubKey;
        let register = addressBinder.registerPublicKey(pubKey);
        await expectRevert(register, "wrong format of public key");
    });

    it("Should not register if public key is of wrong format - wrong prefix", async () => {
        let prvKey = privateKeys[0].privateKey.slice(2);
        let prvkeyBuffer = Buffer.from(prvKey, 'hex');
        let [x, y] = util.privateKeyToPublicKeyPair(prvkeyBuffer);
        let pubKey = "0x" + x.toString('hex') + y.toString('hex').slice(0, -3);
        let register = addressBinder.registerPublicKey(pubKey);
        await expectRevert(register, "wrong format of public key");
    });

    it("Should register p and c addresses - public key is of the form 0x04+x+y", async () => {
        for (let i = 0; i < 50; i++) {
            let prvKey = privateKeys[i].privateKey.slice(2);
            let prvkeyBuffer = Buffer.from(prvKey, 'hex');
            let [x, y] = util.privateKeyToPublicKeyPair(prvkeyBuffer);
            let pubKey = "0x" + util.encodePublicKey(x, y, false).toString('hex');
            let pAddr = "0x" + util.publicKeyToAvalancheAddress(x, y).toString('hex');
            let cAddr = toChecksumAddress("0x" + util.publicKeyToEthereumAddress(x, y).toString('hex'));
            let register = await addressBinder.registerAddresses(pubKey, pAddr, cAddr);
            expectEvent(register, "AddressesRegistered", { publicKey: pubKey, pAddress: pAddr, cAddress: cAddr });
            expect(await addressBinder.pAddressToCAddress(pAddr)).to.equals(cAddr);
            expect(await addressBinder.cAddressToPAddress(cAddr)).to.equals(pAddr);
        }
    });

    it("Should register p and c addresses - public key is of the form 0x+x+y", async () => {
        for (let i = 0; i < 50; i++) {
            let prvKey = privateKeys[i].privateKey.slice(2);
            let prvkeyBuffer = Buffer.from(prvKey, 'hex');
            let [x, y] = util.privateKeyToPublicKeyPair(prvkeyBuffer);
            let pubKey = "0x" + x.toString('hex') + y.toString('hex');
            let pAddr = "0x" + util.publicKeyToAvalancheAddress(x, y).toString('hex');
            let cAddr = toChecksumAddress("0x" + util.publicKeyToEthereumAddress(x, y).toString('hex'));
            let register = await addressBinder.registerAddresses(pubKey, pAddr, cAddr);
            expectEvent(register, "AddressesRegistered", { publicKey: pubKey, pAddress: pAddr, cAddress: cAddr });
            expect(await addressBinder.pAddressToCAddress(pAddr)).to.equals(cAddr);
            expect(await addressBinder.cAddressToPAddress(cAddr)).to.equals(pAddr);
        }
    });

    it("Should register p and c addresses - public key is of the form 0x + 02/03 + x", async () => {
        for (let i = 0; i < 50; i++) {
            let prvKey = privateKeys[i].privateKey.slice(2);
            let prvkeyBuffer = Buffer.from(prvKey, 'hex');
            let [x, y] = util.privateKeyToPublicKeyPair(prvkeyBuffer);
            let pubKey = "0x" + util.encodePublicKey(x, y, true).toString('hex');
            let pAddr = "0x" + util.publicKeyToAvalancheAddress(x, y).toString('hex');
            let cAddr = toChecksumAddress("0x" + util.publicKeyToEthereumAddress(x, y).toString('hex'));
            let register = await addressBinder.registerAddresses(pubKey, pAddr, cAddr);
            expectEvent(register, "AddressesRegistered", { publicKey: pubKey, pAddress: pAddr, cAddress: cAddr });
            expect(await addressBinder.pAddressToCAddress(pAddr)).to.equals(cAddr);
            expect(await addressBinder.cAddressToPAddress(cAddr)).to.equals(pAddr);
        }
    });

    it("Should not register if public key is of wrong format - wrong prefix", async () => {
        let prvKey = privateKeys[0].privateKey.slice(2);
        let prvkeyBuffer = Buffer.from(prvKey, 'hex');
        let [x, y] = util.privateKeyToPublicKeyPair(prvkeyBuffer);
        let pubKey = "0x05" + x.toString('hex') + y.toString('hex');
        let pAddr = "0x" + util.publicKeyToAvalancheAddress(x, y).toString('hex');
        let register = addressBinder.registerAddresses(pubKey, pAddr, accounts[1]);
        await expectRevert(register, "wrong format of public key");
    });

    it("Should not register if public key is of wrong format - wrong length", async () => {
        let prvKey = privateKeys[0].privateKey.slice(2);
        let prvkeyBuffer = Buffer.from(prvKey, 'hex');
        let [x, y] = util.privateKeyToPublicKeyPair(prvkeyBuffer);
        let pubKey = "0x" + util.encodePublicKey(x, y, true).toString('hex');
        pubKey = pubKey.slice(4);
        pubKey = "0x05" + pubKey;
        let pAddr = "0x" + util.publicKeyToAvalancheAddress(x, y).toString('hex');
        let register = addressBinder.registerAddresses(pubKey, pAddr, accounts[1]);
        await expectRevert(register, "wrong format of public key");
    });

    it("Should not register if public key is of wrong format - wrong prefix", async () => {
        let prvKey = privateKeys[0].privateKey.slice(2);
        let prvkeyBuffer = Buffer.from(prvKey, 'hex');
        let [x, y] = util.privateKeyToPublicKeyPair(prvkeyBuffer);
        let pubKey = "0x" + x.toString('hex') + y.toString('hex').slice(0, -3);
        let pAddr = "0x" + util.publicKeyToAvalancheAddress(x, y).toString('hex');
        let register = addressBinder.registerAddresses(pubKey, pAddr, accounts[1]);
        await expectRevert(register, "wrong format of public key");
    });

    it("Should not register if p address doesn't match public key", async () => {
        // accounts[1]
        let prvKey0 = privateKeys[0].privateKey.slice(2);
        let prvkeyBuffer0 = Buffer.from(prvKey0, 'hex');
        let [x0, y0] = util.privateKeyToPublicKeyPair(prvkeyBuffer0);
        let pubKey0 = "0x" + util.encodePublicKey(x0, y0, false).toString('hex');

        // accounts[2]
        let prvKey1 = privateKeys[1].privateKey.slice(2);
        let prvkeyBuffer1 = Buffer.from(prvKey1, 'hex');
        let [x1, y1] = util.privateKeyToPublicKeyPair(prvkeyBuffer1);
        let pAddr1 = "0x" + util.publicKeyToAvalancheAddress(x1, y1).toString('hex');
        let register = addressBinder.registerAddresses(pubKey0, pAddr1,accounts[1]);

        await expectRevert(register, "p chain address doesn't match public key");
    });

    it("Should not register if c address doesn't match public key", async () => {
        let prvKey = privateKeys[0].privateKey.slice(2); // accounts[1]
        let prvkeyBuffer = Buffer.from(prvKey, 'hex');
        let [x, y] = util.privateKeyToPublicKeyPair(prvkeyBuffer);
        let pubKey = "0x" + util.encodePublicKey(x, y, false).toString('hex');
        let pAddr = "0x" + util.publicKeyToAvalancheAddress(x, y).toString('hex');
        let register = addressBinder.registerAddresses(pubKey, pAddr, accounts[10]);
        await expectRevert(register, "c chain address doesn't match public key");
    });

    it("Should revert if bytes length is not correct", async () => {
        bytesLibMock = await BytesLibMock.new();
        let toBytes32 = bytesLibMock.toBytes32("0x12345", 2);
        await expectRevert(toBytes32, "toBytes32_outOfBounds");
    });

    it("Should correctly convert bech32 address", async () => {
        const paddr = "0x" + Buffer.from(bech32.fromWords(bech32.decode("P-costwo1n5vvqn7g05sxzaes8xtvr5mx6m95q96jesrg5g".slice(2)).words)).toString('hex');
        expect("0x9d18c04fc87d206177303996c1d366d6cb401752").to.eq(paddr);
    });
});
