const Web3Utils = require("web3-utils");
const RippleAPI = require("ripple-lib").RippleAPI;
const Web3 = require("web3");
const cliProgress = require("cli-progress");
import BigNumber from "bignumber.js";
import {
  airdropGenesisRes,
  generateTransactionCallRes,
  LineItem,
  ProcessedAccount,
  validateRes,
} from "./airdropTypes";
import { isBaseTenNumber, logMessage } from "./utils";

import InitialAirdropAbi from "../../../artifacts/contracts/genesis/implementation/InitialAirdrop.sol/InitialAirdrop.json";
import { InitialAirdrop } from "../../../typechain-web3/InitialAirdrop";

const TEN = new BigNumber(10);
const MAX_FLARE_BALANCE = new BigNumber(1).multipliedBy(TEN.pow(27));
const indexOffset = 2;
BigNumber.config({ ROUNDING_MODE: BigNumber.ROUND_FLOOR, DECIMAL_PLACES: 20 });

const RippleApi = new RippleAPI({
  server: "wss://s1.ripple.com", // Public rippled server hosted by Ripple, Inc.
});

export function validateFile(
  parsedFile: LineItem[],
  logFile: string,
  logConsole: boolean = true
): validateRes {
  let validAccountsLen: number = 0;
  let validAccounts: boolean[] = [];
  let invalidAccountsLen: number = 0;
  let lineErrors = 0;
  let seenXRPAddresses = new Set();
  let totalXRPBalance = new BigNumber(0);
  let invalidXRPBalance = new BigNumber(0);
  let totalFLRBalance = new BigNumber(0);
  let invalidFLRBalance = new BigNumber(0);
  let seenXRPAddressesDetail: { [name: string]: number[] } = {};
  for (let lineIndex = 0; lineIndex < parsedFile.length; lineIndex++) {
    let lineItem = parsedFile[lineIndex];
    let isValid = true;
    let isValidXRP = true;
    let isValidFLR = true;
    let readableIndex = lineIndex + indexOffset;
    if (!RippleApi.isValidAddress(lineItem.XRPAddress)) {
      logMessage(
        logFile,
        `Line ${readableIndex}: XRP address is invalid ${lineItem.XRPAddress}`,
        !logConsole
      );
      isValid = false;
      lineErrors += 1;
    }
    if (seenXRPAddresses.has(lineItem.XRPAddress)) {
      // We have already seen this XRP address
      logMessage(
        logFile,
        `Line ${readableIndex}: XRP address is duplicate of lines: ${
          seenXRPAddressesDetail[lineItem.XRPAddress]
        }`,
        !logConsole
      );
      // isValid = false;
      seenXRPAddressesDetail[lineItem.XRPAddress].push(lineIndex);
      lineErrors += 1;
    }
    if (!seenXRPAddresses.has(lineItem.XRPAddress)) {
      seenXRPAddresses.add(lineItem.XRPAddress);
      seenXRPAddressesDetail[lineItem.XRPAddress] = [lineIndex];
    }
    if (!Web3Utils.isAddress(lineItem.FlareAddress)) {
      logMessage(
        logFile,
        `Line ${readableIndex}: Flare address is invalid ${lineItem.FlareAddress}`,
        !logConsole
      );
      isValid = false;
      lineErrors += 1;
    }
    if (!isBaseTenNumber(lineItem.XRPBalance)) {
      logMessage(
        logFile,
        `Line ${readableIndex}: XRP Balance is not a valid number`,
        !logConsole
      );
      isValid = false;
      lineErrors += 1;
      isValidXRP = false;
    }
    if (!isBaseTenNumber(lineItem.FlareBalance)) {
      logMessage(
        logFile,
        `Line ${readableIndex}: FLR Balance is not a valid number`,
        !logConsole
      );
      isValid = false;
      lineErrors += 1;
      isValidFLR = false;
    }
    validAccounts[lineIndex] = isValid;
    if (isValid) {
      validAccountsLen += 1;
      totalXRPBalance = totalXRPBalance.plus(lineItem.XRPBalance);
      totalFLRBalance = totalFLRBalance.plus(lineItem.FlareBalance);
    } else {
      invalidAccountsLen += 1;
      if (isValidXRP) {
        invalidXRPBalance = invalidXRPBalance.plus(lineItem.XRPBalance);
      }
      if (isValidFLR) {
        invalidFLRBalance = invalidFLRBalance.plus(lineItem.FlareBalance);
      }
    }
  }
  return {
    validAccounts,
    validAccountsLen,
    invalidAccountsLen,
    totalXRPBalance,
    invalidXRPBalance,
    totalFLRBalance,
    invalidFLRBalance,
    lineErrors,
  };
}

export function createFlareAirdropGenesisData(
  parsedFile: LineItem[],
  validAccounts: validateRes,
  conversionFactor: BigNumber,
  logFile: string,
  logConsole: boolean = true
): airdropGenesisRes {
  let processedAccountsLen: number = 0;
  let processedAccounts: ProcessedAccount[] = [];
  let processedWei = new BigNumber(0);
  let seenFlareAddresses = new Set<string>();
  let flrAddDetail: { [name: string]: { balance: BigNumber; num: number } } =
    {};
  for (let lineIndex = 0; lineIndex < parsedFile.length; lineIndex++) {
    let readableIndex = lineIndex + indexOffset;
    if (validAccounts.validAccounts[lineIndex]) {
      let lineItem = parsedFile[lineIndex];
      processedAccountsLen += 1;
      // Calculate account balance
      let accBalance = new BigNumber(lineItem.XRPBalance);
      accBalance = accBalance.multipliedBy(conversionFactor);
      let expectedBalance = new BigNumber(lineItem.FlareBalance);
      // To get from XRP to 6 decimal places to Wei (Flare to 18 decimal places)
      accBalance = accBalance.multipliedBy(TEN.pow(12));
      // rounding down to 0 decimal places
      accBalance = accBalance.dp(0, BigNumber.ROUND_FLOOR);
      // Special case for RippleWorks
      if (lineItem.XRPAddress == "rKveEyR1SrkWbJX214xcfH43ZsoGMb3PEv") {
        // RippleWorks address is capped to 1BN
        accBalance = BigNumber.minimum(accBalance, MAX_FLARE_BALANCE);
        logMessage(
          logFile,
          `Line ${readableIndex}: Flare balance capped to: ${accBalance.toString(
            10
          )}`,
          !logConsole
        );
      }
      // Check that balances are calculated properly
      if (!accBalance.isEqualTo(expectedBalance)) {
        logMessage(
          logFile,
          `Line ${readableIndex}: Flare balance error: ${accBalance.toString(
            10
          )}`,
          !logConsole
        );
      }

      // Total Wei book keeping
      processedWei = processedWei.plus(accBalance);
      if (seenFlareAddresses.has(lineItem.FlareAddress)) {
        flrAddDetail[lineItem.FlareAddress].balance =
          flrAddDetail[lineItem.FlareAddress].balance.plus(accBalance);
        flrAddDetail[lineItem.FlareAddress].num += 1;
      } else {
        seenFlareAddresses.add(lineItem.FlareAddress);
        flrAddDetail[lineItem.FlareAddress] = { balance: accBalance, num: 1 };
      }
    }
  }
  let accountsDistribution: number[] = [];
  for (let flrAdd of seenFlareAddresses) {
    if (flrAddDetail[flrAdd].balance.gt(MAX_FLARE_BALANCE)) {
      logMessage(
        logFile,
        `Address ${flrAdd}: Flare balance bigger than 1BN`,
        !logConsole
      );
    }
    processedAccounts.push({
      NativeAddress: flrAdd,
      NativeBalance: flrAddDetail[flrAdd].balance.toString(10),
    });
    if (accountsDistribution[flrAddDetail[flrAdd].num]) {
      accountsDistribution[flrAddDetail[flrAdd].num] += 1;
    } else {
      accountsDistribution[flrAddDetail[flrAdd].num] = 1;
    }
  }
  return {
    processedAccounts,
    processedAccountsLen,
    processedWei,
    accountsDistribution,
  };
}

export function createSetAirdropBalanceUnsignedTransactions(
  processedAccounts: ProcessedAccount[],
  initialAirdropContractAddress: string,
  createInitialAirdropTx: boolean,
  initialAirdropSenderAddress: string,
  gasPrice: string,
  gas: string,
  chainId: number,
  initialAirdropNonceOffset: number = 0,
  batchSize: number = 900
): generateTransactionCallRes {
  const rawTransactions = [];
  const web3 = new Web3();

  const InitialAirdropContract = new web3.eth.Contract(
    InitialAirdropAbi.abi,
    initialAirdropContractAddress
  ) as any as InitialAirdrop;

  let index = 0;
  let initialAirdropNonce = initialAirdropNonceOffset;
  let shouldBreak = false;

  const bar1 = new cliProgress.SingleBar(
    {},
    cliProgress.Presets.shades_classic
  );
  let progress = 0;

  console.log(
    "Creating unsigned transactions for InitialAirdrop"
  );
  bar1.start(Math.ceil(processedAccounts.length / batchSize), 0);
  while (true) {
    const tempAddresses: string[] = [];
    const tempBalances = [];

    for (let i = 0; i < batchSize; i++) {
      if (!(index < processedAccounts.length)) {
        shouldBreak = true;
        break;
      }
      tempAddresses.push(processedAccounts[index].NativeAddress);
      tempBalances.push(
        web3.utils.toBN(processedAccounts[index].NativeBalance)
      );
      index += 1;
    }

    if (
      tempAddresses.length > 0 &&
      tempAddresses.length === tempBalances.length
    ) {
      if (createInitialAirdropTx) {
        const encodedCallInitialAirdrop = InitialAirdropContract.methods
          .setAirdropBalances(tempAddresses, tempBalances)
          .encodeABI();
        const newTransaction = {
          from: initialAirdropSenderAddress,
          to: initialAirdropContractAddress,
          data: encodedCallInitialAirdrop,
          gas: gas,
          gasPrice: gasPrice,
          nonce: initialAirdropNonce,
          chainId: chainId,
        };
        rawTransactions.push(newTransaction);
        initialAirdropNonce += 1;
      }

      progress += 1;
      bar1.update(progress);
    }

    if (shouldBreak) {
      break;
    }
  }
  bar1.stop();

  let totalGasPrice = new BigNumber(1);
  totalGasPrice = totalGasPrice
    .multipliedBy(gas)
    .multipliedBy(gasPrice)
    .multipliedBy(rawTransactions.length);
  const GasPrice = totalGasPrice.toString(10);

  return {
    rawTransactions: rawTransactions,
    totalGasPrice: GasPrice,
  };
}
