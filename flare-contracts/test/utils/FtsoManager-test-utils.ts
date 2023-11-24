import { constants } from '@openzeppelin/test-helpers';
import { FtsoInstance, FtsoManagerInstance, MockContractInstance, MockFtsoContract, MockFtsoInstance, MockVPTokenContract, MockVPTokenInstance } from "../../typechain-truffle";
import { defaultPriceEpochCyclicBufferSize } from "./constants";
import { submitPriceHash, toBN } from "./test-helpers";

export interface RewardEpochData {
    votepowerBlock: BN | number,
    startBlock: BN | number,
    startTimestamp: BN | number
}

export function toNumberify(rewardEpochData: RewardEpochData): RewardEpochData {
    return {
        votepowerBlock: Number(rewardEpochData.votepowerBlock),
        startBlock: Number(rewardEpochData.startBlock),
        startTimestamp: Number(rewardEpochData.startTimestamp)
    }
}

/**
 * - Sets mock finalizePriceEpoch returning `[[accounts[1], accounts[2]], [25, 75], 100]`
 * - adds it to FTSOManager
 * - fills 1e6 wei to reward manager
 * - activates ftsoManager
 * @param accounts 
 * @param ftsoInterface 
 * @param mockFtso 
 * @param inflation 
 * @param ftsoManager 
 * @param rewardManager 
 */
export async function settingWithOneFTSO_1(accounts: Truffle.Accounts, ftsoInterface: FtsoInstance, mockFtso: MockContractInstance, ftsoManager: FtsoManagerInstance) {
    // stub ftso finalizer
    const finalizePriceEpoch = ftsoInterface.contract.methods.finalizePriceEpoch(0, true).encodeABI();
    const finalizePriceEpochReturn = web3.eth.abi.encodeParameters(
        ['address[]', 'uint256[]', 'uint256'],
        [[accounts[1], accounts[2]], [25, 75], 100]);
    await mockFtso.givenMethodReturn(finalizePriceEpoch, finalizePriceEpochReturn);
    // give reward manager some nat to distribute
    // await web3.eth.sendTransaction({ from: accounts[0], to: rewardManager.address, value: 1000000 });
    // await inflation.setRewardManagerDailyRewardAmount(1000000);

    await setDefaultGovernanceParameters(ftsoManager);
    // add fakey ftso
    await ftsoManager.addFtso(mockFtso.address, { from: accounts[0] });
    // activte ftso manager
    await ftsoManager.activate();
}

export async function settingWithTwoFTSOs(accounts: Truffle.Accounts, ftsoManager: FtsoManagerInstance) {

    const Ftso = artifacts.require("MockFtso") as MockFtsoContract;
    const MockVPToken = artifacts.require("MockVPToken") as MockVPTokenContract;

    let natToken = await MockVPToken.new(accounts.slice(0, 10), []) as MockVPTokenInstance;
    let xasset1Token = await MockVPToken.new(accounts.slice(0, 10), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) as MockVPTokenInstance;
    let xasset2Token = await MockVPToken.new(accounts.slice(0, 10), [0, 1, 2, 0, 1, 2, 0, 1, 2, 0]) as MockVPTokenInstance;

    const {0: startTimestamp, 1: epochPeriod, 2: revealPeriod} = await ftsoManager.getPriceEpochConfiguration();
    
    let ftso1 = await Ftso.new(
        "FA1", 5, constants.ZERO_ADDRESS, natToken.address, ftsoManager.address, // _symbol, address _wNat, address _ftsoManager,
        startTimestamp,
        epochPeriod, 
        revealPeriod,
        0, //uint256 _initialPrice
        1e10,
        defaultPriceEpochCyclicBufferSize,
        false // do not init/activate
    ) as MockFtsoInstance;
    await ftsoManager.setFtsoAsset(ftso1.address, xasset1Token.address);

    let ftso2 = await Ftso.new(
        "FA2", 5, constants.ZERO_ADDRESS, natToken.address, ftsoManager.address,  // _symbol, address _wNat, address _ftsoManager,
        startTimestamp,
        epochPeriod, 
        revealPeriod,
        0, //uint256 _initialPrice
        1e10,
        defaultPriceEpochCyclicBufferSize,
        false // do not init/activate
    ) as MockFtsoInstance;
    await ftsoManager.setFtsoAsset(ftso2.address, xasset2Token.address);

    // await web3.eth.sendTransaction({ from: accounts[0], to: rewardManager.address, value: 1000000 });
    // await inflation.setRewardManagerDailyRewardAmount(1000000);

    // activte ftso manager
    // await ftsoManager.activate();    
    return [ftso1, ftso2];
}

export async function settingWithFourFTSOs(accounts: Truffle.Accounts, ftsoManager: FtsoManagerInstance, natContract=false) {

    const Ftso = artifacts.require("MockFtso") as MockFtsoContract;
    const MockVPToken = artifacts.require("MockVPToken") as MockVPTokenContract;

    let natToken = await MockVPToken.new(accounts.slice(0, 10), []) as MockVPTokenInstance;
    let xasset1Token = await MockVPToken.new(accounts.slice(0, 10), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) as MockVPTokenInstance;
    let xasset2Token = await MockVPToken.new(accounts.slice(0, 10), [0, 1, 2, 0, 1, 2, 0, 1, 2, 0]) as MockVPTokenInstance;
    let xasset3Token = await MockVPToken.new(accounts.slice(0, 10), [2, 2, 2, 2, 2, 2, 2, 2, 2, 2]) as MockVPTokenInstance;
    let xasset4Token = await MockVPToken.new(accounts.slice(0, 10), [3, 3, 3, 3, 3, 3, 3, 3, 3, 3]) as MockVPTokenInstance;

    const {0: startTimestamp, 1: epochPeriod, 2: revealPeriod} = await ftsoManager.getPriceEpochConfiguration();
    
    let ftso1 = await Ftso.new(
        natContract ? "NAT" : "FA1", 5, constants.ZERO_ADDRESS, natToken.address, ftsoManager.address,  // _symbol, address _wNat, address _ftsoManager,
        startTimestamp,
        epochPeriod, 
        revealPeriod,
        0, //uint256 _initialPrice
        1e10,
        defaultPriceEpochCyclicBufferSize,
        false // do not init/activate
    ) as MockFtsoInstance;
    if (!natContract) {
        await ftsoManager.setFtsoAsset(ftso1.address, xasset1Token.address);
    }

    let ftso2 = await Ftso.new(
        "FA2", 5, constants.ZERO_ADDRESS, natToken.address, ftsoManager.address, // _symbol, address _wNat, address _ftsoManager,
        startTimestamp,
        epochPeriod, 
        revealPeriod,
        0, //uint256 _initialPrice
        1e10,
        defaultPriceEpochCyclicBufferSize,
        false // do not init/activate
    ) as MockFtsoInstance;
    await ftsoManager.setFtsoAsset(ftso2.address, xasset2Token.address);

    let ftso3 = await Ftso.new(
        "FA3", 5, constants.ZERO_ADDRESS, natToken.address, ftsoManager.address, // _symbol, address _wNat, address _ftsoManager,
        startTimestamp,
        epochPeriod, 
        revealPeriod,
        0, //uint256 _initialPrice
        1e10,
        defaultPriceEpochCyclicBufferSize,
        false // do not init/activate
    ) as MockFtsoInstance;
    await ftsoManager.setFtsoAsset(ftso3.address, xasset3Token.address);

    let ftso4 = await Ftso.new(
        "FA4", 5, constants.ZERO_ADDRESS, natToken.address, ftsoManager.address,  // _symbol, address _wNat, address _ftsoManager,
        startTimestamp,
        epochPeriod, 
        revealPeriod,
        0, //uint256 _initialPrice
        1e10,
        defaultPriceEpochCyclicBufferSize,
        false // do not init/activate
    ) as MockFtsoInstance;
    await ftsoManager.setFtsoAsset(ftso4.address, xasset4Token.address);

    // await web3.eth.sendTransaction({ from: accounts[0], to: rewardManagerAddress, value: 1000000 });
    // await inflation.setRewardManagerDailyRewardAmount(1000000);

    // activte ftso manager
    // await ftsoManager.activate();    
    return [ftso1, ftso2, ftso3, ftso4];
}


export async function setDefaultGovernanceParameters(ftsoManager: FtsoManagerInstance) {
    let paramList = [0, 1, 1, 1000, 10000, 50, 1500, 0, 60*60*24*10];
    let paramListBN = paramList.map(x => toBN(x));
    await (ftsoManager.setGovernanceParameters as any)(...paramListBN, []);   
    return paramListBN;
}

export async function submitSomePrices(epochId: number , ftso: MockFtsoInstance, n: number, accounts: Truffle.Accounts, minimalRandom: number=10) {
    let epoch!: BN;;
    for(let i = 0; i < n; i++) {        
        let hash = submitPriceHash(i, i + minimalRandom, accounts[i]);
        let res = await ftso.submitPriceHash(epochId, hash, {from: accounts[i]});
        epoch = res.logs[0].args![1] as BN
    }
    return epoch;
}

export async function revealSomePrices(ftso: MockFtsoInstance, n: number, epoch: number, accounts: Truffle.Accounts, minimalRandom: number=10) {
    for(let i = 0; i < n; i++) {     
        await ftso.revealPrice(epoch, i, i + minimalRandom, {from: accounts[i]});
    }
}
