import { balance, constants, expectEvent, expectRevert, time } from '@openzeppelin/test-helpers';
import { Contracts } from "../../../../deployment/scripts/Contracts";
import { MockContractInstance, SupplyInstance } from "../../../../typechain-truffle";
import { emptyAddressBalance } from "../../../utils/contract-test-helpers";
import { encodeContractNames, getAddressWithZeroBalance, increaseTimeTo, toBN } from "../../../utils/test-helpers";
const getTestFile = require('../../../utils/constants').getTestFile;

const Supply = artifacts.require("Supply");
const MockTokenPool = artifacts.require("MockContract");

let mockTokenPools: MockContractInstance[] = [];

const initialGenesisAmountWei = 10000;
const totalFoundationSupplyWei =  7500;
const circulatingSupply       =  initialGenesisAmountWei - totalFoundationSupplyWei;
const burnAddress = "0x000000000000000000000000000000000000dEaD";
const burnAddressSongbirdTxFee = "0x0100000000000000000000000000000000000000";


const getTokenPoolSupplyData = web3.utils.sha3("getTokenPoolSupplyData()")!.slice(0,10);

async function createTokenPools(totalSupply: number[], totalInflationAuthorized: number[], totalClaimed: number[]) {
    assert(totalSupply.length == totalInflationAuthorized.length, "Array lengths mismatch");
    assert(totalSupply.length == totalClaimed.length, "Array lengths mismatch");
    mockTokenPools = [];
    for (let i = 0; i < totalSupply.length; i++) {
        mockTokenPools.push(await createTokenPool(totalSupply[i], totalInflationAuthorized[i], totalClaimed[i]));
    }
}

async function createTokenPool(totalSupply: number, totalInflationAuthorized: number, totalClaimed: number): Promise<MockContractInstance> {
    let tokenPool = await MockTokenPool.new();
    await updateTokenPoolReturnData(tokenPool, totalSupply, totalInflationAuthorized, totalClaimed);
    return tokenPool;
}

async function updateTokenPoolReturnData(tokenPool: MockContractInstance, totalSupply: number, totalInflationAuthorized: number, totalClaimed: number) {
    let getTokenPoolSupplyDataReturn = web3.eth.abi.encodeParameters(['uint256', 'uint256', 'uint256'], [totalSupply, totalInflationAuthorized, totalClaimed]);
    await tokenPool.givenMethodReturn(getTokenPoolSupplyData, getTokenPoolSupplyDataReturn);
}

contract(`Supply.sol; ${getTestFile(__filename)}; Supply unit tests`, async accounts => {
    const ADDRESS_UPDATER = accounts[16];
    const governanceAddress = accounts[10];
    const inflationAddress = accounts[9];
    // contains a fresh contract for each test
    let supply: SupplyInstance;
    let newSupply: SupplyInstance;

    beforeEach(async() => {
        // clean up burnAddress
        await emptyAddressBalance(burnAddress, accounts[0]);
        assert.equal(Number(await balance.current(burnAddress)), 0);
        //
        supply = await Supply.new(governanceAddress, ADDRESS_UPDATER, initialGenesisAmountWei, totalFoundationSupplyWei, [], [], constants.ZERO_ADDRESS);
        await supply.updateContractAddresses(
            encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION]),
            [ADDRESS_UPDATER, inflationAddress], {from: ADDRESS_UPDATER});
    });

    it("Should revert deploying supply - initial genesis amount zero", async() => {
        await expectRevert(Supply.new(governanceAddress, ADDRESS_UPDATER, 0, totalFoundationSupplyWei, [], [], constants.ZERO_ADDRESS), "initial genesis amount zero");
    });

    it("Should know about inflation", async() => {
        expect(await supply.inflation()).to.equals(inflationAddress);
    });

    it("Should know about burn address", async() => {
        expect((await supply.burnAddress())).to.equals(burnAddress);
    });

    it("Should get initial genesis amount", async() => {
        expect((await supply.initialGenesisAmountWei()).toNumber()).to.equals(initialGenesisAmountWei);
    });

    it("Should change inflation", async() => {
        expect(await supply.inflation()).to.equals(inflationAddress);
        await supply.updateContractAddresses(
            encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION]),
            [ADDRESS_UPDATER, accounts[8]], {from: ADDRESS_UPDATER});
        expect(await supply.inflation()).to.not.equals(inflationAddress);
        expect(await supply.inflation()).to.equals(accounts[8]);
    });

    it("Should revert changing inflation if not from address updater", async() => {
        await expectRevert(supply.updateContractAddresses(
            encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION]),
            [ADDRESS_UPDATER, accounts[8]], {from: accounts[1]}), "only address updater");
    });

    it("Should get circulating supply", async() => {
        const currentBlockNumber = await web3.eth.getBlockNumber();
        expect((await supply.getCirculatingSupplyAt(currentBlockNumber + 5)).toNumber()).to.equals(circulatingSupply);
        expect((await supply.getCirculatingSupplyAt(currentBlockNumber)).toNumber()).to.equals(circulatingSupply);
        expect((await supply.getCirculatingSupplyAt(0)).toNumber()).to.equals(0);
    });

    it("Should update circulating supply", async() => {
        await createTokenPools([0, 0, 1000, 500], [100, 5000, 0, 0], [50, 1000, 200, 100]);
        await supply.addTokenPool(mockTokenPools[0].address, 0, {from: governanceAddress});
        await supply.addTokenPool(mockTokenPools[1].address, 0, {from: governanceAddress});
        await supply.addTokenPool(mockTokenPools[2].address, 10, {from: governanceAddress});
        await supply.addTokenPool(mockTokenPools[3].address, 5, {from: governanceAddress});
        expect((await supply.initialGenesisAmountWei()).toNumber()).to.equals(initialGenesisAmountWei);
        expect((await supply.getInflatableBalance()).toNumber()).to.equals((await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber())).toNumber());
        expect((await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber())).toNumber()).to.equals(circulatingSupply + 50 + 1000 - 1000 - 500 + 200 + 100 + 10 + 5);
        expect((await supply.totalInflationAuthorizedWei()).toNumber()).to.equals(5100);
    
        await updateTokenPoolReturnData(mockTokenPools[0], 0, 200, 150);
        await updateTokenPoolReturnData(mockTokenPools[1], 0, 5000, 1500);
        await updateTokenPoolReturnData(mockTokenPools[2], 1000, 0, 300);
        await updateTokenPoolReturnData(mockTokenPools[3], 1000, 0, 300);
        await web3.eth.sendTransaction({ to: burnAddress, value: toBN(100), from: accounts[1] });
        let tx = await supply.updateAuthorizedInflationAndCirculatingSupply(100, { from: inflationAddress });
        expectEvent.notEmitted(tx, "AuthorizedInflationUpdateError");

        expect((await supply.initialGenesisAmountWei()).toNumber()).to.equals(initialGenesisAmountWei);
        expect((await supply.getInflatableBalance()).toNumber()).to.equals((await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber())).toNumber() + 100); // burn address
        expect((await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber())).toNumber()).to.equals(circulatingSupply + 150 + 1500 - 1000 - 1000 + 300 + 300 + 10 + 5 - 100);
        expect((await supply.totalInflationAuthorizedWei()).toNumber()).to.equals(5200);
    });

    it("Should update circulating supply and emit event for inflation authorized error", async() => {
        await createTokenPools([0, 0, 1000, 500], [100, 5000, 0, 0], [50, 1000, 200, 100]);
        await supply.addTokenPool(mockTokenPools[0].address, 0, {from: governanceAddress});
        await supply.addTokenPool(mockTokenPools[1].address, 0, {from: governanceAddress});
        await supply.addTokenPool(mockTokenPools[2].address, 10, {from: governanceAddress});
        await supply.addTokenPool(mockTokenPools[3].address, 5, {from: governanceAddress});
        expect((await supply.initialGenesisAmountWei()).toNumber()).to.equals(initialGenesisAmountWei);
        expect((await supply.getInflatableBalance()).toNumber()).to.equals((await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber())).toNumber());
        expect((await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber())).toNumber()).to.equals(circulatingSupply + 50 + 1000 - 1000 - 500 + 200 + 100 + 10 + 5);
        expect((await supply.totalInflationAuthorizedWei()).toNumber()).to.equals(5100);
    
        await updateTokenPoolReturnData(mockTokenPools[0], 0, 200, 150);
        await updateTokenPoolReturnData(mockTokenPools[1], 0, 5000, 1500);
        await updateTokenPoolReturnData(mockTokenPools[2], 1000, 0, 300);
        await updateTokenPoolReturnData(mockTokenPools[3], 1000, 0, 300);
        await web3.eth.sendTransaction({ to: burnAddress, value: toBN(100), from: accounts[1] });
        
        let tx = await supply.updateAuthorizedInflationAndCirculatingSupply(400, { from: inflationAddress });
        expectEvent(tx, "AuthorizedInflationUpdateError", {actual: toBN(100), expected: toBN(400)});

        expect((await supply.initialGenesisAmountWei()).toNumber()).to.equals(initialGenesisAmountWei);
        expect((await supply.getInflatableBalance()).toNumber()).to.equals((await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber())).toNumber() + 100); // burn address
        expect((await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber())).toNumber()).to.equals(circulatingSupply + 150 + 1500 - 1000 - 1000 + 300 + 300 + 10 + 5 - 100);
        expect((await supply.totalInflationAuthorizedWei()).toNumber()).to.equals(5200);
    });

    it("Should revert updating circulating supply if not from inflation", async() => {
        await expectRevert(supply.updateAuthorizedInflationAndCirculatingSupply(100), "inflation only");
    });

    it("Should get circulating supply (cached)", async() => {
        const currentBlockNumber = await web3.eth.getBlockNumber();
        // Force a block in order to get most up to date time
        await time.advanceBlock();
        // Get the timestamp for the just mined block
        let timestamp = await time.latest();
        await increaseTimeTo(timestamp.toNumber() + 10, "web3");

        expect(await supply.contract.methods.getCirculatingSupplyAtCached(currentBlockNumber).call()).to.equals(circulatingSupply.toString());
        expect(await supply.contract.methods.getCirculatingSupplyAtCached(0).call()).to.equals('0');
    });

    it("Should revert getting circulating supply (cached) for future block", async() => {
        const currentBlockNumber = await web3.eth.getBlockNumber();
        await expectRevert(supply.getCirculatingSupplyAtCached(currentBlockNumber + 10), "Can only be used for past blocks");
    });

    it("Should get inflatable balance", async() => {
        expect((await supply.getInflatableBalance()).toNumber()).to.equals((await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber())).toNumber());
        expect((await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber())).toNumber()).to.equals(circulatingSupply);
    });

    it("Should add token pools", async() => {
        await createTokenPools([100, 500], [100, 0], [50, 200]);
        await supply.addTokenPool(mockTokenPools[0].address, 0, {from: governanceAddress});
        await supply.addTokenPool(mockTokenPools[1].address, 100, {from: governanceAddress});
        expect((await supply.initialGenesisAmountWei()).toNumber()).to.equals(initialGenesisAmountWei);
        expect((await supply.getInflatableBalance()).toNumber()).to.equals((await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber())).toNumber());
        expect((await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber())).toNumber()).to.equals(circulatingSupply - 100 - 500 + 50 + 200 + 100);
        expect((await supply.tokenPools(0))[0]).to.equals(mockTokenPools[0].address);
        expect((await supply.tokenPools(1))[0]).to.equals(mockTokenPools[1].address);
        await expectRevert.unspecified(supply.tokenPools(2));
    });

    it("Should revert adding token pool twice", async() => {
        let tokenPool = await createTokenPool(1000, 0, 0);
        await supply.addTokenPool(tokenPool.address, 100, {from: governanceAddress});
        await expectRevert(supply.addTokenPool(tokenPool.address, 200, {from: governanceAddress}), "token pool already added");
        expect((await supply.tokenPools(0))[0]).to.equals(tokenPool.address);
        await expectRevert.unspecified(supply.tokenPools(1));
    });

    it("Should revert adding token pool if not from governance", async() => {
        await expectRevert(supply.addTokenPool(accounts[1], 100, {from: accounts[0]}), "only governance");
    });

    it("Should deploy supply with Foundation addresses", async() => {
        const foundationAddress1 = await getAddressWithZeroBalance();
        await web3.eth.sendTransaction({ to: foundationAddress1, value: toBN(100), from: accounts[1] });
        const foundationAddress2 = await getAddressWithZeroBalance();
        await web3.eth.sendTransaction({ to: foundationAddress2, value: toBN(200), from: accounts[1] });
        supply = await Supply.new(governanceAddress, ADDRESS_UPDATER, initialGenesisAmountWei, totalFoundationSupplyWei, [], [foundationAddress1, foundationAddress2], constants.ZERO_ADDRESS);
        const addresses = await supply.getFoundationAddresses();
        expect(addresses.length).to.equals(2);
        expect(addresses[0]).to.equals(foundationAddress1);
        expect(addresses[1]).to.equals(foundationAddress2);
        expect((await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber())).toNumber()).to.equals(circulatingSupply - 100 - 200);
    });

    it("Should change Foundation addresses", async() => {
        const foundationAddress1 = await getAddressWithZeroBalance();
        await web3.eth.sendTransaction({ to: foundationAddress1, value: toBN(100), from: accounts[1] });
        const foundationAddress2 = await getAddressWithZeroBalance();
        await web3.eth.sendTransaction({ to: foundationAddress2, value: toBN(200), from: accounts[1] });
        let tx = await supply.changeFoundationAddresses([foundationAddress1, foundationAddress2], [], {from: governanceAddress});
        expectEvent(tx, "FoundationAddressesChanged", {addedFoundationAddresses: [foundationAddress1, foundationAddress2], removedFoundationAddresses: []});

        const addresses = await supply.getFoundationAddresses();
        expect(addresses.length).to.equals(2);
        expect(addresses[0]).to.equals(foundationAddress1);
        expect(addresses[1]).to.equals(foundationAddress2);
        expect((await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber())).toNumber()).to.equals(circulatingSupply - 100 - 200);

        await web3.eth.sendTransaction({ to: foundationAddress2, value: toBN(50), from: accounts[1] });

        tx = await supply.changeFoundationAddresses([foundationAddress2], [foundationAddress1], {from: governanceAddress});
        expectEvent(tx, "FoundationAddressesChanged", {addedFoundationAddresses: [foundationAddress2], removedFoundationAddresses: [foundationAddress1]});

        const addresses2 = await supply.getFoundationAddresses();
        expect(addresses2.length).to.equals(1);
        expect(addresses2[0]).to.equals(foundationAddress2);
        expect((await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber())).toNumber()).to.equals(circulatingSupply - 250);
    });

    it("Should revert updating Foundation addresses if not from governance", async() => {
        await expectRevert(supply.changeFoundationAddresses([accounts[1]], [], {from: accounts[0]}), "only governance");
    });

    it("Should deploy supply with token pools", async() => {
        await createTokenPools([500, 1000], [0, 0], [200, 50]);
        supply = await Supply.new(governanceAddress, ADDRESS_UPDATER, initialGenesisAmountWei, totalFoundationSupplyWei, mockTokenPools.map(rp => rp.address), [], constants.ZERO_ADDRESS);
        expect((await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber())).toNumber()).to.equals(circulatingSupply - 500 - 1000 + 200 + 50);
    });

    it("Should deploy supply with some burn address balance", async() => {
        await web3.eth.sendTransaction({ to: burnAddress, value: toBN(100), from: accounts[1] });
        supply = await Supply.new(governanceAddress, ADDRESS_UPDATER, initialGenesisAmountWei, totalFoundationSupplyWei, [], [], constants.ZERO_ADDRESS);
        expect((await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber())).toNumber()).to.equals(circulatingSupply - 100);
    });

    it("Should increase distributed supply", async() => {
        await supply.increaseDistributedSupply(500, {from: governanceAddress});
        expect((await supply.getInflatableBalance()).toNumber()).to.equals((await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber())).toNumber());
        expect((await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber())).toNumber()).to.equals(circulatingSupply + 500);
    });

    it("Should increase distributed supply 2", async() => {
        await supply.increaseDistributedSupply(500, {from: governanceAddress});
        expect((await supply.getInflatableBalance()).toNumber()).to.equals((await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber())).toNumber());
        expect((await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber())).toNumber()).to.equals(circulatingSupply + 500);

        // round 2
        await supply.increaseDistributedSupply(1000, {from: governanceAddress});
        expect((await supply.getInflatableBalance()).toNumber()).to.equals((await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber())).toNumber());
        expect((await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber())).toNumber()).to.equals(circulatingSupply + 500 + 1000);
    });

    it("Should revert increasing distributed supply if not from governance", async() => {
        await expectRevert(supply.increaseDistributedSupply(500, {from: accounts[0]}), "only governance");
    });

    it("Should revert increasing distributed supply if not enough founds", async() => {
        await supply.increaseDistributedSupply(500, {from: governanceAddress});
        expect((await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber())).toNumber()).to.equals(circulatingSupply + 500);

        await expectRevert.assertion(supply.increaseDistributedSupply(totalFoundationSupplyWei, {from: governanceAddress}));
    });

    it("Should decrease distributed supply", async() => {
        await supply.increaseDistributedSupply(5000, {from: governanceAddress});
        await supply.decreaseDistributedSupply(500, {from: governanceAddress});
        expect((await supply.getInflatableBalance()).toNumber()).to.equals((await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber())).toNumber());
        expect((await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber())).toNumber()).to.equals(circulatingSupply + 5000 - 500);
    });

    it("Should decrease distributed supply 2", async() => {
        await supply.increaseDistributedSupply(5000, {from: governanceAddress});
        await supply.decreaseDistributedSupply(500, {from: governanceAddress});
        expect((await supply.getInflatableBalance()).toNumber()).to.equals((await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber())).toNumber());
        expect((await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber())).toNumber()).to.equals(circulatingSupply + 5000 - 500);

        // round 2
        await supply.decreaseDistributedSupply(1000, {from: governanceAddress});
        expect((await supply.getInflatableBalance()).toNumber()).to.equals((await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber())).toNumber());
        expect((await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber())).toNumber()).to.equals(circulatingSupply + 5000 - 500 - 1000);
    });

    it("Should revert decreasing distributed supply if not from governance", async() => {
        await expectRevert(supply.decreaseDistributedSupply(500, {from: accounts[0]}), "only governance");
    });

    it("Should revert decreasing distributed supply if not enough founds", async() => {
        await expectRevert(supply.decreaseDistributedSupply(500, {from: governanceAddress}), "SafeMath: subtraction overflow");
    });

    it("Should know about songbird tx fee burn address", async() => {
        expect((await supply.burnAddressSongbirdTxFee())).to.equals(burnAddressSongbirdTxFee);
    });

    it("Should set old supply contract", async() => {
        // deploy new supply contract
        newSupply = await Supply.new(governanceAddress, ADDRESS_UPDATER, initialGenesisAmountWei, totalFoundationSupplyWei, [], [], supply.address);
        await newSupply.updateContractAddresses(
            encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION]),
            [ADDRESS_UPDATER, inflationAddress], {from: ADDRESS_UPDATER});

        expect((await supply.switchOverBlock()).toString()).to.equals("0");
        expect(await newSupply.oldSupply()).to.equals(supply.address);
        expect((await newSupply.switchOverBlock()).toString()).to.not.equals("0");
    });

    it("Should read circulating supply from old contract until switchover", async() => {
        await supply.increaseDistributedSupply(5000, {from: governanceAddress});
        expect((await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber())).toNumber()).to.equals(circulatingSupply + 5000);

        newSupply = await Supply.new(governanceAddress, ADDRESS_UPDATER, initialGenesisAmountWei, totalFoundationSupplyWei, [], [], supply.address);
        await newSupply.updateContractAddresses(
            encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION]),
            [ADDRESS_UPDATER, inflationAddress], {from: ADDRESS_UPDATER});

        // reading data from old supply contract
        let block = await web3.eth.getBlockNumber();
        expect((await newSupply.getCirculatingSupplyAt(await web3.eth.getBlockNumber())).toNumber()).to.equals(circulatingSupply + 5000);

        // update circulating supply (switchover)
        await newSupply.updateCirculatingSupply({ from: inflationAddress });
        let switchOverBlock = await web3.eth.getBlockNumber();
        await time.advanceBlock();
        expect((await newSupply.switchOverBlock()).toString()).to.equals(switchOverBlock.toString());
        // reading data from new supply contract
        expect((await newSupply.getCirculatingSupplyAt(await web3.eth.getBlockNumber())).toNumber()).to.equals(circulatingSupply);
        // block before switchover -> read from old contract
        expect((await newSupply.getCirculatingSupplyAt(block)).toNumber()).to.equals(circulatingSupply + 5000);

        // should not update switchover block again
        await newSupply.updateCirculatingSupply({ from: inflationAddress });
        expect((await newSupply.switchOverBlock()).toString()).to.equals(switchOverBlock.toString());
    });

    it("Should read circulating supply from old contract until switchover", async() => {
        expect((await supply.getInflatableBalance()).toNumber()).to.equals(circulatingSupply);

        newSupply = await Supply.new(governanceAddress, ADDRESS_UPDATER, initialGenesisAmountWei, totalFoundationSupplyWei, [], [], supply.address);
        await newSupply.updateContractAddresses(
            encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION]),
            [ADDRESS_UPDATER, inflationAddress], {from: ADDRESS_UPDATER});

        await newSupply.increaseDistributedSupply(5000, {from: governanceAddress});

        // reading data from old supply contract
        expect((await newSupply.getInflatableBalance()).toNumber()).to.equals(circulatingSupply);
        // switchover
        await newSupply.updateCirculatingSupply({ from: inflationAddress });
        // reading data from new supply contract
        expect((await newSupply.getInflatableBalance()).toNumber()).to.equals(circulatingSupply + 5000);
    });

    it("Should read cached circulating supply from old contract until switchover", async() => {
        await supply.increaseDistributedSupply(5000, {from: governanceAddress});

        let block = await web3.eth.getBlockNumber();
        await time.advanceBlock();
        await supply.getCirculatingSupplyAtCached(block);
        expect(await supply.contract.methods.getCirculatingSupplyAtCached(block).call()).to.equals((circulatingSupply + 5000).toString());

        newSupply = await Supply.new(governanceAddress, ADDRESS_UPDATER, initialGenesisAmountWei, totalFoundationSupplyWei, [], [], supply.address);
        await newSupply.updateContractAddresses(
            encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION]),
            [ADDRESS_UPDATER, inflationAddress], {from: ADDRESS_UPDATER});

        // reading data from old supply contract
        await newSupply.getCirculatingSupplyAtCached(block);
        expect(await newSupply.contract.methods.getCirculatingSupplyAtCached(block).call()).to.equals((circulatingSupply + 5000).toString());

        // update circulating supply (switchover)
        await newSupply.updateCirculatingSupply({ from: inflationAddress });

        // block before switchover -> read from old contract
        await newSupply.getCirculatingSupplyAtCached(block);
        expect(await newSupply.contract.methods.getCirculatingSupplyAtCached(block).call()).to.equals((circulatingSupply + 5000).toString());

        await time.advanceBlock();
        // reading from new supply contract
        await newSupply.getCirculatingSupplyAtCached(await web3.eth.getBlockNumber() - 1);
        expect(await newSupply.contract.methods.getCirculatingSupplyAtCached(await web3.eth.getBlockNumber() - 1).call()).to.equals((circulatingSupply).toString());
    });

    it("Should unlock 2 wei", async() => {
        await createTokenPools([67, 0, 1000, 500], [100, 5000, 0, 0], [50, 1000, 200, 100]);
        await supply.addTokenPool(mockTokenPools[0].address, 20, {from: governanceAddress});
        await updateTokenPoolReturnData(mockTokenPools[0], 65, 200, 150);
        let totalLockedBeforeUpdate = (await supply.totalLockedWei()).toNumber();
        await supply.updateCirculatingSupply( { from: inflationAddress });
        let totalLockedAfterUpdate = (await supply.totalLockedWei()).toNumber();
        expect(totalLockedBeforeUpdate - totalLockedAfterUpdate).to.equals(67 - 65);
    });


});
