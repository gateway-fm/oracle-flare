import { constants, expectEvent, expectRevert } from '@openzeppelin/test-helpers';
import { DelegationAccountInstance, MockContractInstance } from "../../../../typechain-truffle";
import { toBN } from '../../../utils/test-helpers';

const getTestFile = require('../../../utils/constants').getTestFile;

const DelegationAccount = artifacts.require("DelegationAccount");
const MockContract = artifacts.require("MockContract");
const FtsoRewardManager = artifacts.require("FtsoRewardManager");
const DataProviderFee = artifacts.require("DataProviderFee" as any);
const WNat = artifacts.require("WNat");

const ERR_TRANSFER_FAILURE = "transfer failed";
const ERR_MANAGER_ONLY = "only manager";

contract(`DelegationAccount.sol; ${getTestFile(__filename)}; Delegation account unit tests`, async accounts => {
  const OWNER_ADDRESS = accounts[1];
  const CLAIM_SETUP_MANAGER_ADDRESS = accounts[18];
  let delegationAccount: DelegationAccountInstance;
  let wNatMock: MockContractInstance;

  before(async() => {
    FtsoRewardManager.link(await DataProviderFee.new() as any);
  });


  describe("Initialization", async() => {

    beforeEach(async () => {
      delegationAccount = await DelegationAccount.new();
      wNatMock = await MockContract.new();
    });

    it("Should initialize successfully", async() => {
      const initializeTx = await delegationAccount.initialize(OWNER_ADDRESS, CLAIM_SETUP_MANAGER_ADDRESS);
      expectEvent(initializeTx, "Initialize", { owner: OWNER_ADDRESS, manager: CLAIM_SETUP_MANAGER_ADDRESS });

      let owner = await delegationAccount.owner();
      expect(owner).to.equals(OWNER_ADDRESS);
    
      let manager = await delegationAccount.manager();
      expect(manager).to.equals(CLAIM_SETUP_MANAGER_ADDRESS);
    });

    it("Should revert initialization if address zero", async() => {
      await expectRevert(delegationAccount.initialize(constants.ZERO_ADDRESS, CLAIM_SETUP_MANAGER_ADDRESS), "owner address zero");
      await expectRevert(delegationAccount.initialize(OWNER_ADDRESS, constants.ZERO_ADDRESS), "manager address zero");
    });

    it("Should not initialize twice", async() => {
      await delegationAccount.initialize(OWNER_ADDRESS, CLAIM_SETUP_MANAGER_ADDRESS);
      await expectRevert(delegationAccount.initialize(OWNER_ADDRESS, CLAIM_SETUP_MANAGER_ADDRESS), "owner already set");
    });

  });

  describe("Claiming", async() => {

    beforeEach(async () => {
      delegationAccount = await DelegationAccount.new();
      await delegationAccount.initialize(OWNER_ADDRESS, CLAIM_SETUP_MANAGER_ADDRESS);
      wNatMock = await MockContract.new();
    });

    it("Should enable/disable claiming to delegation account", async() => {
      const balanceOf = web3.utils.sha3("balanceOf(address)")!.slice(0, 10); // first 4 bytes is function selector
      const transfer = web3.utils.sha3("transfer(address,uint256)")!.slice(0, 10); // first 4 bytes is function selector
      await wNatMock.givenMethodReturnUint(balanceOf, 100);
      await wNatMock.givenMethodReturnBool(transfer, true);
      const invocationCountForMethod = await wNatMock.invocationCountForMethod.call(transfer);
      expect(invocationCountForMethod.toNumber()).to.be.equal(0);
    });

    it("Should withdraw funds", async() => {
      const transfer = web3.utils.sha3("transfer(address,uint256)")!.slice(0, 10); // first 4 bytes is function selector
      await wNatMock.givenMethodReturnBool(transfer, false);
      await expectRevert(delegationAccount.withdraw(wNatMock.address, 100, { from: CLAIM_SETUP_MANAGER_ADDRESS }), ERR_TRANSFER_FAILURE);
      await wNatMock.givenMethodReturnBool(transfer, true);
      const tx = await delegationAccount.withdraw(wNatMock.address, 100, { from: CLAIM_SETUP_MANAGER_ADDRESS });
      const invocationCountForMethod = await wNatMock.invocationCountForMethod.call(transfer);
      expect(invocationCountForMethod.toNumber()).to.be.equal(1);
      expectEvent(tx, "WithdrawToOwner", { amount: toBN(100)});
    });

    it("Should fail if not called by manager", async() => {
      const tx5 = delegationAccount.delegate(wNatMock.address, accounts[6], 10000);
      await expectRevert(tx5, ERR_MANAGER_ONLY);

      const tx6 = delegationAccount.undelegateAll(wNatMock.address);
      await expectRevert(tx6, ERR_MANAGER_ONLY);

      const tx7 = delegationAccount.revokeDelegationAt(wNatMock.address, accounts[5], 1000);
      await expectRevert(tx7, ERR_MANAGER_ONLY);

      const tx8 = delegationAccount.delegateGovernance(wNatMock.address, accounts[6]);
      await expectRevert(tx8, ERR_MANAGER_ONLY);

      const tx9 = delegationAccount.undelegateGovernance(wNatMock.address);
      await expectRevert(tx9, ERR_MANAGER_ONLY);

      const tx10 = delegationAccount.transferExternalToken(wNatMock.address, accounts[6], 70);
      await expectRevert(tx10, ERR_MANAGER_ONLY);

      const tx11 = delegationAccount.withdraw(wNatMock.address, 70);
      await expectRevert(tx11, ERR_MANAGER_ONLY);
    });

    it("Should not allow WNat transfer", async() =>{
      // Should not allow WNat transfer
      const tx = delegationAccount.transferExternalToken(wNatMock.address, wNatMock.address, 70, { from: CLAIM_SETUP_MANAGER_ADDRESS });
      await expectRevert(tx, "Transfer from wNat not allowed");
    });

  });

});
