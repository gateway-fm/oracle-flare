import { time } from '@openzeppelin/test-helpers';
import { Contracts } from "../../../deployment/scripts/Contracts";
import { AddressBinderInstance, ClaimSetupManagerInstance, CombinedNatInstance, DistributionToDelegatorsInstance, DistributionTreasuryInstance, GovernanceVotePowerInstance, MockContractInstance, PChainStakeMirrorInstance, PChainStakeMirrorVerifierInstance, WNatInstance } from "../../../typechain-truffle";
import { encodeContractNames, toBN } from "../../utils/test-helpers";
import privateKeys from "../../../test-1020-accounts.json"
import * as util from "../../utils/key-to-address";

const getTestFile = require('../../utils/constants').getTestFile;

const BN = web3.utils.toBN;

const ClaimSetupManager = artifacts.require("ClaimSetupManager");
const DelegationAccount = artifacts.require("DelegationAccount");
const DistributionTreasury = artifacts.require("DistributionTreasury");
const DistributionToDelegators = artifacts.require("DistributionToDelegators");
const MockContract = artifacts.require("MockContract");
const WNat = artifacts.require("WNat");
const AddressBinder = artifacts.require("AddressBinder");
const GovernanceVotePower = artifacts.require("GovernanceVotePower");
const PChainStakeMirrorVerifier = artifacts.require("PChainStakeMirrorVerifier");
const PChainStakeMirror = artifacts.require("PChainStakeMirror");
const CombinedNat = artifacts.require("CombinedNat");


let priceSubmitterMock: MockContractInstance;
let claimSetupManager: ClaimSetupManagerInstance;
let wNat: WNatInstance;
let pChainStakeMirror: PChainStakeMirrorInstance;
let combinedNat: CombinedNatInstance;
let distributionTreasury: DistributionTreasuryInstance;
let distribution: DistributionToDelegatorsInstance;
let governanceVotePower: GovernanceVotePowerInstance;
let addressBinder: AddressBinderInstance;
let pChainVerifierInterface: PChainStakeMirrorVerifierInstance;
let verifierMock: MockContractInstance;


contract(`DistributionToDelegators.sol; ${getTestFile(__filename)}; gas consumption tests`, async accounts => {
  const GOVERNANCE_ADDRESS = accounts[10];
  const FLARE_DAEMON = accounts[1];
  const ADDRESS_UPDATER = accounts[2];
  const CLEANUP_BLOCK_NUMBER_MANAGER = accounts[3];
  const totalEntitlementWei = toBN(1000000);
  let latestStart: BN;
  let registeredPAddresses = new Map<string, string>();

  async function distributionToDelegatorsGasBenchmarking(
    noOfOptOutAccounts: number,
    noOfWNatTransfersPerMonth: number,
    noOfStakesPerMonth: number,
    noOfMonths: number,
  ) {
    const claimers = accounts.slice(10, 100);
    const optOutAccounts = accounts.slice(100, 100 + noOfOptOutAccounts);
    for (let i = 10; i < 100 + noOfOptOutAccounts; i++) {
      await wNat.deposit({value: toBN(100), from: accounts[i]});
      let prvKey = privateKeys[i].privateKey.slice(2);
      let prvkeyBuffer = Buffer.from(prvKey, 'hex');
      let [x, y] = util.privateKeyToPublicKeyPair(prvkeyBuffer);
      let pubKey = "0x" + util.encodePublicKey(x, y, false).toString('hex');
      let pAddr = "0x" + util.publicKeyToAvalancheAddress(x, y).toString('hex');
      await addressBinder.registerAddresses(pubKey, pAddr, accounts[i]);
      registeredPAddresses.set(accounts[i], pAddr);
    }
    for (let i = 100; i < 100 + noOfOptOutAccounts; i++) {
      await distribution.optOutOfAirdrop({from: accounts[i]});
    }
    await distribution.confirmOptOutOfAirdrop(optOutAccounts, {from: GOVERNANCE_ADDRESS});

    const startTs = (await time.latest()).addn(10);
    await distribution.setEntitlementStart(startTs, {from: GOVERNANCE_ADDRESS});
    const monthSec = 30 * 24 * 60 * 60;
    const endTs = startTs.addn(monthSec * noOfMonths + 500);
    for (let month = 1; month <= noOfMonths; month++) {
      const increaseTimeSecPerWNatTransfer = monthSec / (noOfWNatTransfersPerMonth + 1);
      const increaseTimeSecPerStake = monthSec / (noOfStakesPerMonth + 1);
      let noOfWNatTransferCheckpoints = 1;
      let noOfStakeCheckpoints = 1;
      while (noOfWNatTransferCheckpoints <= noOfWNatTransfersPerMonth || noOfStakeCheckpoints <= noOfStakesPerMonth) {
        let increaseTimeSec = Math.min(noOfWNatTransferCheckpoints * increaseTimeSecPerWNatTransfer, noOfStakeCheckpoints * increaseTimeSecPerStake);
        let tx = await distribution.daemonize({from: FLARE_DAEMON});
        console.log(tx.receipt.gasUsed);
        if ((await time.latest()).lt(startTs.addn(increaseTimeSec + (month - 1) * monthSec))) {
          await time.increaseTo(startTs.addn(increaseTimeSec + (month - 1) * monthSec));
        }
        if (increaseTimeSec == noOfWNatTransferCheckpoints * increaseTimeSecPerWNatTransfer) {
          for (let i = 10; i < 100 + noOfOptOutAccounts; i++) {
            await wNat.deposit({value: toBN(5), from: accounts[i]});
          }
          noOfWNatTransferCheckpoints++;
        }
        if (increaseTimeSec == noOfStakeCheckpoints * increaseTimeSecPerStake) {
          for (let i = 10; i < 100 + noOfOptOutAccounts; i++) {
            const data = {
              txId: web3.utils.keccak256(i + "-" + month + "-" + noOfStakeCheckpoints),
              stakingType: 0,
              inputAddress: registeredPAddresses.get(accounts[i])!,
              nodeId: "0x0123456789012345678901234567890123456789",
              startTime: startTs.toNumber(),
              endTime: endTs.toNumber(),
              weight: 1000
            };
            const verifyPChainStakingMethod = pChainVerifierInterface.contract.methods.verifyStake(data, []).encodeABI();
            await verifierMock.givenCalldataReturnBool(verifyPChainStakingMethod, true);
            await pChainStakeMirror.mirrorStake(data, []);
          }
          noOfStakeCheckpoints++;
        }
      }
      if ((await time.latest()).lt(startTs.addn(month * monthSec))) {
        await time.increaseTo(startTs.addn(month * monthSec));
      }
      let tx = await distribution.daemonize({from: FLARE_DAEMON});
      console.log(`finalize month: ${month}, gas usage: ${tx.receipt.gasUsed}`);
    }
  }


  beforeEach(async () => {
    wNat = await WNat.new(GOVERNANCE_ADDRESS, "Wrapped NAT", "WNAT");
    pChainStakeMirror =  await PChainStakeMirror.new(GOVERNANCE_ADDRESS, FLARE_DAEMON, ADDRESS_UPDATER, 50);
    governanceVotePower = await GovernanceVotePower.new(wNat.address, pChainStakeMirror.address);
    await wNat.setGovernanceVotePower(governanceVotePower.address, { from: GOVERNANCE_ADDRESS });

    addressBinder = await AddressBinder.new();
    pChainVerifierInterface = await PChainStakeMirrorVerifier.new(ADDRESS_UPDATER, 1, 1000, 5, 5000);
    verifierMock = await MockContract.new();

    combinedNat = await CombinedNat.new(wNat.address, pChainStakeMirror.address);
    priceSubmitterMock = await MockContract.new();
    claimSetupManager = await ClaimSetupManager.new(GOVERNANCE_ADDRESS, ADDRESS_UPDATER, 3, 0, 100, 1000);
    const delegationAccount = await DelegationAccount.new()
    const ftsoManagerMock = await MockContract.new();
    await claimSetupManager.setLibraryAddress(delegationAccount.address, { from: GOVERNANCE_ADDRESS });
    distributionTreasury = await DistributionTreasury.new(GOVERNANCE_ADDRESS);
    await web3.eth.sendTransaction({value: totalEntitlementWei, from: GOVERNANCE_ADDRESS, to: distributionTreasury.address});
    latestStart = (await time.latest()).addn(10 * 24 * 60 * 60); // in 10 days
    distribution = await DistributionToDelegators.new(GOVERNANCE_ADDRESS, FLARE_DAEMON, ADDRESS_UPDATER, distributionTreasury.address, totalEntitlementWei, latestStart);
    // set distribution contract
    await distributionTreasury.setDistributionContract( distribution.address, {from: GOVERNANCE_ADDRESS});

    await distribution.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.WNAT, Contracts.CLAIM_SETUP_MANAGER, Contracts.PRICE_SUBMITTER, Contracts.COMBINED_NAT]),
      [ADDRESS_UPDATER, wNat.address, claimSetupManager.address, priceSubmitterMock.address, combinedNat.address], {from: ADDRESS_UPDATER});

    await claimSetupManager.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.WNAT, Contracts.FTSO_MANAGER]),
      [ADDRESS_UPDATER, wNat.address, ftsoManagerMock.address], {from: ADDRESS_UPDATER});

    await pChainStakeMirror.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.ADDRESS_BINDER, Contracts.GOVERNANCE_VOTE_POWER, Contracts.CLEANUP_BLOCK_NUMBER_MANAGER, Contracts.P_CHAIN_STAKE_MIRROR_VERIFIER]),
      [ADDRESS_UPDATER, addressBinder.address, governanceVotePower.address, CLEANUP_BLOCK_NUMBER_MANAGER, verifierMock.address], { from: ADDRESS_UPDATER });

    await pChainStakeMirror.activate({ from: GOVERNANCE_ADDRESS });
  });

  it.skip("DistributionToDelegators daemonize calls for 150 opt-out accounts with 20 WNat transfers and 10 stakes per month - 3 months", async () => {
    await distributionToDelegatorsGasBenchmarking(150, 20, 10, 3);
  });

  it.skip("DistributionToDelegators daemonize calls for 150 opt-out accounts with 50 WNat transfers and 10 stakes per month - 3 months", async () => {
    await distributionToDelegatorsGasBenchmarking(150, 50, 10, 3);
  });

  it.skip("DistributionToDelegators daemonize calls for 150 opt-out accounts with 50 WNat transfers and 0 stakes per month - 3 months", async () => {
    await distributionToDelegatorsGasBenchmarking(150, 50, 0, 3);
  });

  it("DistributionToDelegators daemonize calls for 200 opt-out accounts with 50 WNat transfers and 10 stakes per month - 3 months", async () => {
    await distributionToDelegatorsGasBenchmarking(200, 50, 10, 3);
  });

});
