import { 
  FundDistributorInstance, 
  WhitelisterGetterMockInstance, 
  WhitelistedGetterMockInstance
} from "../../../../typechain-truffle";

const getTestFile = require('../../../utils/constants').getTestFile;

const FundDistributor = artifacts.require("FundDistributor")
const WhitelisterGetter = artifacts.require("WhitelisterGetterMock")
const WhitelistedGetter = artifacts.require("WhitelistedGetterMock")

const BN = web3.utils.toBN

async function getBalance(address: string) {
  return BN((await web3.eth.getBalance(address)).toString())
}

contract(`FundDistributor.sol; ${getTestFile(__filename)}; FundDistributor unit tests`, async accounts => {
  let fundDistributor: FundDistributorInstance
  let whitelisterGetter: WhitelisterGetterMockInstance
  let whitelistedGetter: WhitelistedGetterMockInstance
  let whitelisted: string[] = []

  beforeEach(async() => {
    whitelisted = accounts.slice(1, 6)
    whitelistedGetter = await WhitelistedGetter.new(whitelisted)
    whitelisterGetter = await WhitelisterGetter.new(whitelistedGetter.address)
    fundDistributor = await FundDistributor.new(whitelisterGetter.address)
  });

  describe("Test sendInitialFunds function", async() => { 

    it("Should distribute a given default fund to every input address", async() => {
      let balances = await Promise.all(whitelisted.map(getBalance))
      await fundDistributor.sendInitialFunds(whitelisted, [], 100, { value: '1000000000000000000000000000000', from: accounts[0] })
      for (let i = 0; i < whitelisted.length; i++) {
        let newBalance = await getBalance(whitelisted[i])
        let expectedBalance = balances[i].add(BN(100))
        expect(newBalance.toString()).to.equal(expectedBalance.toString())
      }
    })

    it("Should distribute given funds to input addresses", async() => {
      let balances = await Promise.all(whitelisted.map(getBalance))
      let values = [];
      for (let i = 1; i <= whitelisted.length; i++) values.push(10 * i)
      await fundDistributor.sendInitialFunds(whitelisted, values, 0, { value: '1000000000000000000000000000000', from: accounts[0] })
      for (let i = 0; i < whitelisted.length; i++) {
        let newBalance = (await web3.eth.getBalance(whitelisted[i]))
        let expectedBalance = balances[i].add(BN(values[i]))
        expect(newBalance.toString()).to.equal(expectedBalance.toString())
      }
    })

    it("Should check if msg.sender has leftover funds returned", async() => {
      let senderBalance = await getBalance(accounts[0]);
      let sendValue = senderBalance.div(BN(2))
      await fundDistributor.sendInitialFunds([accounts[1]], [], 100, { value: sendValue, from: accounts[0] })
      let newBalance = await getBalance(accounts[0])
      expect(newBalance > senderBalance.sub(sendValue.div(BN(2))))
    })

  })

  describe("Test topupAllWhitelistedAddresses function", async() => {

    it("Should topup the balance of all whitelisted accounts", async() => {
      let minBalance = (await Promise.all(whitelisted.map(getBalance))).reduce((x, y) => (x < y) ? x : y)
      let topupValue = minBalance.add(BN(1000))
      await fundDistributor.topupAllWhitelistedAddresses(topupValue, { value: "1000000000000000000000000000000", from: accounts[0] })
      for (let address of whitelisted) {
        let newBalance = await getBalance(address)
        expect(newBalance >= topupValue)
      }
    })

    it("Should check if msg.sender has leftover funds returned", async() => {
      let balance = await getBalance(accounts[0]);
      let sendValue = balance.div(BN(2))
      await fundDistributor.topupAllWhitelistedAddresses(100, { value: sendValue, from: accounts[0] })
      let newBalance = await getBalance(accounts[0])
      expect(newBalance > balance.sub(sendValue.div(BN(2))))
    })

  })
})