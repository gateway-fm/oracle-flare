/**
 * This script will deploy all contracts for the MockPriceSubmitter.
 * It will output the address of deployed PriceSubmitter.
 */


 import {
    MockPriceSubmitterInstance
  } from "../../typechain-truffle";


 
 async function main() {
  const PriceSubmitter = artifacts.require("MockPriceSubmitter");
  const priceSubmitter: MockPriceSubmitterInstance = await PriceSubmitter.new() 
  console.log("PriceSubmitter address:", priceSubmitter.address);
 }
 
 main()
   .then(() => process.exit(0))
   .catch(error => {
     console.error(error);
     process.exit(1);
   });
 