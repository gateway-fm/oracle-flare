const parse = require('csv-parse/lib/sync');
const fs = require("fs");
const web3 = require("web3");
const toBN = web3.utils.toBN;
const IsAddress = web3.utils.isAddress;
const cliProgress = require('cli-progress');
import path from "path";
import {LineItem, ProcessedLineItem} from "../../../airdrop/songbird/utils/airdropTypes"
// const airdropExports = require("../../airdrop/data");

function parseAndProcessData(dataFile:string):ProcessedLineItem[] {
  let data = fs.readFileSync(dataFile, "utf8");
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
      seenNATAddressesDetail[XRPLine.FlareAddress] =seenNATAddressesDetail[XRPLine.FlareAddress].add(toBN(XRPLine.FlareBalance));
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
  }
  return processedFile;
}

contract(`Airdrop testing: Airdrop transactions validation tests tests for Songbird deploy`, async accounts => {
  let parsedAirdrop: ProcessedLineItem[];
  let web3Provider: string;
  let Web3: any;
  let airdropSigner: string;

  before(async() => {
    const airdropExports = path.join(process.cwd(), '/airdrop/songbird/data/export.csv')
    parsedAirdrop = parseAndProcessData(airdropExports);
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

  it(`Testing airdrop transactions accounting`, async function(){
    console.log("Testing airdrop transactions accounting");
    const bar1 = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
    bar1.start(parsedAirdrop.length, 0);
    let progress = 0;
    for(let NativeItem of parsedAirdrop){
      if (IsAddress(NativeItem.NativeAddress)){
        let actualBalance = await Web3.eth.getBalance(NativeItem.NativeAddress);
        assert.equal(actualBalance,NativeItem.initialAirdropBalance.toString())
      }
      progress += 1;
      bar1.update(progress);
    }
    bar1.stop();
  });

  it(`Testing airdrop signer balance is 0`, async function(){
    const signerBalance = await Web3.eth.getBalance(airdropSigner);
    assert.equal(signerBalance,"0");
  });

  it(`Testing airdrop signer transaction count matches airdrops`, async function(){
    const signerTransactionCount = await Web3.eth.getTransactionCount(airdropSigner);
    assert.equal(signerTransactionCount,parsedAirdrop.length);
  });
});