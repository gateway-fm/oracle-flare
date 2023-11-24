import { HardhatRuntimeEnvironment } from 'hardhat/types';
const fs = require("fs");
const parse = require('csv-parse/lib/sync');

import { ValidatorRewardManagerContract, ValidatorRewardManagerInstance } from '../typechain-truffle';

type Row = {
  name: string;
  professional: boolean;
  ip: string;
  passed: boolean;
  details: string;
  address: string;
  comment: string;
}

export async function validatorRewards(
    hre: HardhatRuntimeEnvironment,
    reportFile: string,
    output: string | null = null,
    quiet: boolean = false,
  ){

  // We assume that validators are either fully eligeble for a reward or not eligeble at all
  // and the script will be run periodically every X days, so there is no need for datetime arithemetics.
  // The script should be run mid-day (before inflation ticks)


  let rawData = fs.readFileSync(reportFile, "utf8");
  const parsed: {name: string, professional: string, ip: string, result: string, details: string, rewardAddress: string, comment: string}[] = parse( rawData, {
    columns: true,
    skip_empty_lines: true,
    delimiter: ',',
    skip_lines_with_error: false
  }).map(
    (it: any, i: number) => {
      return {
        name: it["FTSO Name"],
        professional: it.Professional.trim().toUpperCase(),
        ip: it["Validator IP"],
        // While we wait for the spreadsheet to be updated
        rewardAddress: it["Reward Address"] || `0x${i.toString(16).padStart(40, "0")}` ,
        result: it.Result,
        details: it["Security Scan Details"],
        comment: it["Metadata"]
      }
    }
  ).filter(
    (it: any) => ["PASSED", "FAILED"].indexOf(it.result.toUpperCase()) !== -1
  )

  const rewardFlareValidators = false

  function hasPassed(row: Row): boolean {
    // Some validators are special cases and should be rewarded even if they did not pass
    return row.passed || row.comment === "Special treatment";
  }

  const data: Row[] = parsed.map(
    it => {
      if(["", "YES", "NO", "UPDATED"].indexOf(it.professional) === -1 && !quiet){
        console.error(`Invalid value for professional: ${it.professional}; name: ${it.name}; ip: ${it.ip}`);
      }
      return {
        name: it.name, professional: it.professional.toUpperCase() === "YES",
        ip: it.ip, passed: it.result.toUpperCase() == "PASSED", details: it.details,
        address: it.rewardAddress, comment: it.comment
      }
    }
  ).filter(it =>
    hasPassed(it)
  ).filter(
    // Exclude Flare Foundation validators
    it => rewardFlareValidators || !it.name.includes("Flare Foundation")
  );

  const validatorRewardManager = "0xc0CF3Aaf93bd978C5BC662564Aa73E331f2eC0B5";

  const ValidatorRewardManager : ValidatorRewardManagerContract = artifacts.require("ValidatorRewardManager");

  const validator = await ValidatorRewardManager.at(validatorRewardManager);

  const {0: _totalAwardedWei, 2: _totalInflationAuthorizedWei} = await validator.getTotals();

  // Only 50% will be distributed
  const availableRewards = _totalInflationAuthorizedWei.sub(_totalAwardedWei).divn(2);

  const professionalValidators = data.filter(it => it.professional)
  const ftsoValidators = data.filter(it => !it.professional)

  const professionalValidatorPart = availableRewards.divn(2);

  const perFTSO = availableRewards.sub(professionalValidatorPart).divn(ftsoValidators.length);
  const perProfessional = professionalValidatorPart.divn(professionalValidators.length);

  const rewards: Map<string, BN> = new Map();
  let distributed = web3.utils.toBN(0);

  for(let validator of data){
    assert(hasPassed(validator))
    const current = rewards.get(validator.address) ?? web3.utils.toBN(0);
    const value = validator.professional ? perProfessional : perFTSO;

    rewards.set(validator.address, current.add(value));
    distributed = distributed.add(value);

  }
  const remaining = availableRewards.sub(distributed);

  // Sanity checks

  const addresses = new Set<string>()
  for(let validator of data){
    if(!validator.professional){
      assert (addresses.has(validator.address) === false, `Duplicate address: ${validator.address}`);
    }
    addresses.add(validator.address);
  }

  assert(distributed < availableRewards);
  assert(remaining.add(distributed).eq(availableRewards));

  if(!remaining.isZero()){
    console.warn(`Remaining rewards: ${remaining.toString()}; ftsos: ${ftsoValidators.length}; profs: ${professionalValidators.length}`, );
  }
  const obj: {[key:string]: string} = {};

  const rewardAddresses: string[] = [];
  const rewardValues: string[] = [];

  rewards.forEach((value, addr) => {
      obj[addr] = value.toString();
      rewardAddresses.push(addr);
      rewardValues.push(value.toString());
    }
  )

  const result = [rewardAddresses, rewardValues];

  if(output){
    fs.writeFileSync(output, JSON.stringify(result, null, 2));
  }else{
    console.log(result)
  }
}
