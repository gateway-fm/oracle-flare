import { FtsoRewardManagerInstance } from "../../typechain-truffle";
import { increaseTimeTo } from "./test-helpers";

/**
 * @notice Utility to time travel to just past the current reward epoch.
 * @param rewardEpochStartTimestamp - start timemestamp from when epoch are counted, must match to the one set in the FTSO manager contract
 * @param rewardEpochPeriod - epoch period in seconds, must match to the one set in the FTSO manager contract
 * @param rewardEpoch - current reward epoch number
 */
 export async function moveToRewardFinalizeStart(rewardEpochStartTimestamp: number, rewardEpochPeriod: number, rewardEpoch: number) {
  let finalizeTimestamp = (rewardEpoch + 1) * rewardEpochPeriod + rewardEpochStartTimestamp + 1;
  await increaseTimeTo(finalizeTimestamp);
}

export async function getRewardTotals(ftsoRewardManager: FtsoRewardManagerInstance) {
  const {
    0: totalAwardedWei,
    1: totalClaimedWei,
    2: totalExpiredWei,
    3: totalUnearnedWei,
    4: totalBurnedWei,
    5: totalInflationAuthorizedWei,
    6: totalInflationReceivedWei,
    7: lastInflationAuthorizationReceivedTs,
    8: dailyAuthorizedInflation
  } = await ftsoRewardManager.getTotals();
  return {
    totalAwardedWei, totalClaimedWei, totalExpiredWei, totalUnearnedWei, totalBurnedWei, totalInflationAuthorizedWei,
    totalInflationReceivedWei, lastInflationAuthorizationReceivedTs, dailyAuthorizedInflation
  };
}
