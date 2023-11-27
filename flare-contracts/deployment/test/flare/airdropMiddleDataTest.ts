const parse = require('csv-parse/lib/sync');
const fs = require("fs");
const web3 = require("web3");
const toBN = web3.utils.toBN;
const IsAddress = web3.utils.isAddress;
const cliProgress = require('cli-progress');
import path from "path";
import {LineItem, ProcessedLineItem} from "../../../airdrop/flare/utils/airdropTypes"
// const airdropExports = require("../../airdrop/data");

import InitialAirdropAbi from "../../../artifacts/contracts/genesis/implementation/InitialAirdrop.sol/InitialAirdrop.json";
import { InitialAirdrop } from "../../../typechain-web3/InitialAirdrop";


function parseAndProcessData(dataFile:string):{processedFile: ProcessedLineItem[], TotalInitialAirdrop: BN, TotalDistribution: BN} {
  let data = fs.readFileSync(dataFile, "utf8");
  let TotalInitialAirdrop = toBN(0)
  let TotalDistribution = toBN(0)
  const parsed_file:LineItem[] = parse( data, {
    columns: true,
    skip_empty_lines: true,
    delimiter: ',',
    skip_lines_with_error: true
  })
  let seenNATAddressesDetail: {[name: string]: BN } = {};
  let seenNATAddresses:Set<string> = new Set();
  for(let XRPLine of parsed_file){
    if(!seenNATAddresses.has(XRPLine.FlareAddress)){
      seenNATAddresses.add(XRPLine.FlareAddress);
      seenNATAddressesDetail[XRPLine.FlareAddress] = toBN(XRPLine.FlareBalance);
    } 
    else {
      seenNATAddressesDetail[XRPLine.FlareAddress] = seenNATAddressesDetail[XRPLine.FlareAddress].add(toBN(XRPLine.FlareBalance));
    }    
  }
  let processedFile:ProcessedLineItem[] = []
  for(let natAdd of seenNATAddresses){
    let tempTotal = seenNATAddressesDetail[natAdd];
    let tempAirdrop = tempTotal.muln(15).divn(100);
    processedFile.push(
        {
          NativeAddress: natAdd,
          totalNativeBalance: tempTotal,
          initialAirdropBalance: tempAirdrop,
          distributionMonthlyBalance: tempTotal.muln(3).divn(100),
          totalDistributionBalance: tempTotal.sub(tempAirdrop),
        }
    ) 
    TotalInitialAirdrop = TotalInitialAirdrop.add(tempAirdrop);
    TotalDistribution = TotalDistribution.add(tempTotal.sub(tempAirdrop));
  }
  return {processedFile, TotalInitialAirdrop, TotalDistribution};
}

contract(`Airdrop testing: Airdrop transactions validation tests tests for Flare mainnet deployment`, async accounts => {
  let parsedAirdrop: ProcessedLineItem[];
  let web3Provider: string;
  let Web3: any;
  let initialAirdropSigner: string;
  let InitialAirdropContract: InitialAirdrop;
  let totalInitialAirdrop: BN;
  const deploymentName = "deployment/deploys/flare.json"

  before(async() => {
    const airdropExports = path.join(process.cwd(), '/airdrop/flare/data/export.csv')
    const {processedFile, TotalInitialAirdrop, TotalDistribution} = parseAndProcessData(airdropExports);
    parsedAirdrop = processedFile
    totalInitialAirdrop = TotalInitialAirdrop
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
    if(!fs.existsSync(deploymentName)){
      console.error(`No file at ${deploymentName}`);
      throw new Error(`No file at ${deploymentName}`);
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


  it(`InitialAirdrop contract must not yet be started`,async () => {
    const airdropStarted = await InitialAirdropContract.methods.initialAirdropStartTs().call()
    assert.equal(airdropStarted, "0")
  })

  it(`InitialAirdrop balances array length check`,async () => {
    const airdropArrayLength = await InitialAirdropContract.methods.airdropAccountsLength().call()
    assert.equal(airdropArrayLength, parsedAirdrop.length.toString(10))
  })

  it(`InitialAirdrop total balance`,async () => {
    const totalAirdrop = await InitialAirdropContract.methods.totalInitialAirdropWei().call()
    assert.equal(totalAirdrop, totalInitialAirdrop.toString(10))
  })

  it(`Testing initialAirdropSigner signer transaction count matches airdrops`, async function(){
    const signerTransactionCount = await Web3.eth.getTransactionCount(initialAirdropSigner);
    assert.isAbove(signerTransactionCount,Math.ceil(parsedAirdrop.length/35));
  });
});