// mapped to integer in JSON schema
export type integer = number;

export interface ChainParameters {
    // JSON schema url
    $schema?: string;

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // Native currency settings

    /**
     * The symbol of the native currency (used as symbol for FTSO).
     */
    nativeSymbol: string;

    /**
     * The number of decimals for USD price of the native currency.
     */
    nativeFtsoDecimals: integer;

    /**
     * Hybrid reward band, prices for native currency within nativeElasticBandWidthPPM of median are rewarded (in parts-per-million).
     */
    nativeElasticBandWidthPPM: integer;

    /**
     * The name of the wrapped currency (e.g. Wrapped Flare / Wrapped Songbird).
     */
    wrappedNativeName: string;

    /**
     * The symbol of the wrapped currency (e.g. wFLR/wSGB).
     */
    wrappedNativeSymbol: string;

    /**
     * The USD price of native currency at deploy time (in scaled USD: 1 USD = 10^5 USDDec5). 
     * Usually 0, which means that the useful starting price is obtained after first voting.
     */
    initialWnatPriceUSDDec5: integer;

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // Addresses

    /**
     * State connector contract address. State connector is deployed in the genesis block at fixed address "0x1000000000000000000000000000000000000001".
     */
    stateConnectorAddress: string;

    /**
     * Flare daemon contract address. It is deployed in the genesis block with the fixed address "0x1000000000000000000000000000000000000002".
     */
    flareDaemonAddress: string;

    /**
     * Price submiter contract address. It is deployed to the genesis block with the fixed address  "0x1000000000000000000000000000000000000003".
     */
    priceSubmitterAddress: string;

    /**
     * Distribution treasury contract address. It is deployed to the genesis block with the fixed address  "0x1000000000000000000000000000000000000004".
     */
    distributionTreasuryAddress: string;

    /**
     * Incentive pool treasury contract address. It is deployed to the genesis block with the fixed address  "0x1000000000000000000000000000000000000005".
     */
    incentivePoolTreasuryAddress: string;

    /**
     * Initial airdrop contract address. It is deployed to the genesis block with the fixed address  "0x1000000000000000000000000000000000000006".
     */
    initialAirdropAddress: string;

    /**
     * Governance settings contract address. It is deployed to the genesis block with the fixed address  "0x1000000000000000000000000000000000000007".
     */
    governanceSettingsAddress: string;
    
    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // Governance

    /**
     * Deployer private key. Overriden if provided in `.env` file as `DEPLOYER_PRIVATE_KEY`
     */
    deployerPrivateKey: string;

    /**
     * Genesis governance private key (the key used as governance during deploy). 
     * Overriden if set in `.env` file as `GENESIS_GOVERNANCE_PRIVATE_KEY`. 
     */
    genesisGovernancePrivateKey: string;

    /**
     * Governance public key (the key to which governance is transferred after deploy). 
     * Overriden if provided in `.env` file as `GOVERNANCE_PUBLIC_KEY`.
     */
    governancePublicKey: string;

    /**
     * Governance private key (the private part of `governancePublicKey`). 
     * Overriden if provided in `.env` file as `GOVERNANCE_PRIVATE_KEY`.
     * Note: this is only used in test deploys. In production, governance is a multisig address and there is no private key.
     */
    governancePrivateKey: string;

    /**
     * The timelock in seconds to use for all governance operations (the time that has to pass before any governance operation is executed).
     * It safeguards the system against bad governance decisions or hijacked governance.
     */
    governanceTimelock: integer;

    /**
     * The public key of the executor (the account that is allowed to execute governance operations once the timelock expires).
     * Overriden if provided in `.env` file as `GOVERNANCE_EXECUTOR_PUBLIC_KEY`.
     */
    governanceExecutorPublicKey: string;

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // System start and initial airdrop

    /**
     * Unix timestamp of the system's start (inflation - first time slot).
     * Used for calculating various delayed timestamps (e.g. first reward epoch start timestamp).
     * If set to 0, current timestamp at deploy is used.
     */
    systemStart: integer;

    /**
     * Unix timestamp of the initial airdrop start.
     */
    initialAirdropStart: integer;

    /**
     * Unix timestamp of the incentive pool start (first time slot).
     */
    incentivePoolStart: integer;

    /**
     * Unix timestamp of the latest initial airdrop start.
     */
    initialAirdropLatestStart: integer;

    /**
     * Unix timestamp of the latest distribution start.
     */
    distributionLatestEntitlementStart: integer;

    /**
     * Inital airdrop amount, in natural currency Wei.
     * Big integer, formatted as string.
     */
    initialAirdropWei: string;

    /**
     * Incentive pool amount, in natural currency Wei.
     * Big integer, formatted as string.
     */
    incentivePoolWei: string;

    /**
     * Distribution total entitlement, in natural currency Wei.
     * Big integer, formatted as string.
     */
    distributionTotalEntitlementWei: string;

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // Daemon settings

    /**
     * The number of blocks a daemon called contract is skipped if it consumes more than its alloted amount of gas.
     */
    flareDaemonGasExceededHoldoffBlocks: integer;

    /**
     * Gas limit for daemonize calls of on Inflation contract.
     */
    inflationGasLimit: integer;

    /**
     * Gas limit for daemonize calls of on FtsoManager contract.
     */
    ftsoManagerGasLimit: integer;

    /**
     * Gas limit for daemonize calls of on PChainStakeMirror contract.
     */
    pChainStakeMirrorGasLimit: integer;

    /**
     * Gas limit for daemonize calls of on IncentivePool contract.
     */
    incentivePoolGasLimit: integer;

    /**
     * Gas limit for daemonize calls of on DistributionToDelegators contract.
     */
    distributionToDelegatorsGasLimit: integer;

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // Inflation settings

    /**
     * Monthly (FLR) / Yearly (SGB) inflation in BIPS. Every month/year the value changes to the next value in the list (until the list is exhausted, after which the inflation remains constant).
     */
    scheduledInflationPercentageBIPS: integer[];

    /**
     * List of contract names (strings) that are inflation receivers.
     */
    inflationReceivers: string[];

    /**
     * List of inflation sharing percentages in BIPS for inflation receivers. Should match contracts `inflationReceivers`.
     * Should add up to 100% (10000 BIPS).
     */
    inflationSharingBIPS: integer[];

    /**
     * List of inflation top up types for inflation receivers. Should match contracts `inflationReceivers`.
     * Can be 0 or 1 for each receiver  (see the enum TopupType in `RewardService.sol`)
     */
    inflationTopUpTypes: integer[];

    /**
     * List of inflation top up factors for inflation receivers. Should match contracts `inflationReceivers`. E.g. 300 means 3x of expected daily allocation.
     */
    inflationTopUpFactorsx100: integer[];

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // Initial supply settings

    /**
     * Initial total supply of native tokens (FLR/SGB). In whole native units, not Wei.
     */
    totalNativeSupplyNAT: integer;

    /**
     * Non circulating supply that is temporary excluded (escrow, distribution). In whole native units, not Wei.
     */
    totalExcludedSupplyNAT: integer;

    /**
     * List of Foundation addresses whose balance should be excluded from circulating supply.
     */
    foundationAddresses: string[];

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // Deployment options settings

    /**
     * Whether dummy FAsset tokens should be deployed. Only `true` for dev testing deploys.
     */
    deployDummyXAssetTokensAndMinters: boolean;

    /**
     * Whether NAT token FTSO should be deployed.
     */
    deployNATFtso: boolean;

    /**
     * List of multiasset symbols.
     */
    NATMultiAssets: string[];

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // FTSO system settings

    /**
     * Reward epoch duration, in seconds. In production it is 2-7 days (172800-604800 seconds), but for test purposes it's much smaller e.g. 3-7 minutes.
     */
    rewardEpochDurationSeconds: integer;

    /**
     * Price epoch duration, in seconds. Typical production value is 180 seconds (3 minutes).
     */
    priceEpochDurationSeconds: integer;

    /**
     * Reveal epoch duration, in seconds. Usually, it should be at most half of `priceEpochDurationSeconds` (90 seconds).
     */
    revealEpochDurationSeconds: integer;

    /**
     * Offset of the start of the first inflation time slot from the time of deploy (system start parameter), in seconds.
     */
    inflationStartDelaySeconds: integer;

    /**
     * Offset of the start of reward epochs from the time of deploy (system start parameter), in number of price epochs. 
     * Typical production value is 3, so first reward epoch starts after 
     * `rewardEpochsStartDelayPriceEpochs * priceEpochDurationSeconds + revealEpochDurationSeconds` (10.5 minutes).
     */
    rewardEpochsStartDelayPriceEpochs: integer;

    /**
     * Defines interval from which vote power block is randomly selected as a fraction of previous reward epoch. 
     * The new vote power block is randomly chosen during finalization block from the last
     * `(finalization_block_number - start_epoch_block_number) / votePowerIntervalFraction`
     * blocks. Larger value of `votePowerIntervalFraction` means shorter interval, which gives 'fresher' vote power block, but less chance for randomization.
     * For example, if `votePowerIntervalFraction=7` and reward epoch duration is 7 days, vote power block is chosen from the last day of the epoch being finalized.
     */
    votePowerIntervalFraction: integer;

    /**
     * Inital size for voter whitelist for price submission. It can later be changed for each FTSO by the governance.
     */
    defaultVoterWhitelistSize: integer;

    /**
     * Defines high threshold for native token vote power when revealing a price vote. The actual max threshold is calculated as 
     * `total_NAT_vote_power / maxVotePowerNatThresholdFraction`. 
     * Any provider's native token vote power is capped to this max threshold when revealing a price vote. 
     */
    maxVotePowerNatThresholdFraction: integer;

    /**
     * Defines high threshold for asset vote power when revealing a price vote. 
     * The actual max threshold is calculated as `total_NAT_vote_power / maxVotePowerNatThresholdFraction`.
     * Any provider's asset vote power is capped to this max threshold when revealing a price vote. 
     */
    maxVotePowerAssetThresholdFraction: integer;

    /**
     * Low threshold for asset USD value (in scaled USD: 1 USD = 10^5 USDDec5).
     * Determines the weight ratio between native token and asset vote power.
     * Total asset vote power below *lowAssetThreshold* means that only native token vote power is used.
     * For values between *lowAssetThreshold* and *highAssetThreshold*, the asset vote power ratio scales linearly from 5% to 50%.
     * For values above *highAssetThreshold* the asset vote power ratio is 50%.
     * For test purposes we recommend setting `lowAssetThresholdUSDDec5` to 200000000.
     */
    lowAssetThresholdUSDDec5: integer;

    /**
     * High threshold for asset USD value (in scaled USD: 1 USD = 10^5 USDDec5). See `lowAssetThresholdUSDDec5` for explanation.
     * For test purposes we recommend setting `highAssetThresholdUSDDec5` to 3000000000.
     */
    highAssetThresholdUSDDec5: integer;

    /**
     * Threshold for high asset turnout (in BIPS relative to total asset vote power). If the asset vote power turnout
     * is below highAssetTurnoutThreshold, the asset weight based on total asset USD value (as calculated above)
     * is multiplied by `actual_asset_turnout_BIPS / highAssetTurnoutThresholdBIPS`.
     * For test purposes we recommend 100.
     */
    highAssetTurnoutThresholdBIPS: integer;

    /**
     * Threshold for low native token turnout (in BIPS relative to total native token supply).
     * If the turnout is smaller than this parameter, only votes from trusted addresses are used to determine the price.
     * For test purposes we recommend 300.
     */
    lowNatTurnoutThresholdBIPS: integer;

    /**
    * Hybrid reward band, where elasticBandRewardBIPS goes to the elastic band and 10000 - elasticBandRewardBIPS to the IQR. 
     * For test purposes we recommend 0.
     */
    elasticBandRewardBIPS: integer;

    /**
     * The list of addresses used for voting when native token turnout is below *lowNatTurnoutThreshold* or when price deviation is too big.
     * The prices from trusted addresses are also used indepepndently in f-asset system for calculating a second threshold collateral ratio for agent liquidation.
     */
    trustedAddresses: string[];

    /**
     * Threshold (in BIPS) for price change between two epochs. Above this change price calculation switches to trusted votes only.
     */
    priceDeviationThresholdBIPS: integer;

    /**
     * The number of price epochs after which the price information storage is recycled.
     */
    priceEpochCyclicBufferSize: integer;

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // Rewards

    /**
     * Reward fee percentage update timelock measured in reward epochs.
     * The parameter determines in how many reward epochs the new fee percentage submitted by a data provider becomes effective. 
     * For test purposes we recommend 3.
     */
    rewardFeePercentageUpdateOffsetEpochs: integer;

    /**
     * Default value for fee percentage, in BIPS. 
     * If a data provider does not change the fee percentage, this is the default percentage used for fee deduction. 
     * When set to 0, this means there is no fee.
     */
    defaultRewardFeePercentageBIPS: integer;

    /**
     * Reward expiry time in days. After this many days reward epoch funds expire and can not be claimed any more. 
     * If expiry value is 90 days and reward epoch length is 10 days, any reward epoch that was opened more then 90 days ago will expire. 
     */
    ftsoRewardExpiryOffsetDays: number;

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // Executors on PDA

    /**
     * Executor fee value update timelock measured in reward epochs.
     * The parameter determines in how many reward epochs the new fee value submitted by an executor becomes effective. 
     * For test purposes we recommend 3.
     */
    executorFeeValueUpdateOffsetEpochs: integer;

    /**
     * Min allowed executor fee value, in natural currency Wei.
     * Big integer, formatted as string.
     */
    executorMinFeeValueWei: string;

    /**
     * Max allowed executor fee value. In whole native units, not Wei.
     */
    executorMaxFeeValueNAT: integer;

    /**
     * Executor registration fee value. In whole native units, not Wei.
     */
     executorRegisterFeeValueNAT: integer;

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // Other currency settings

    assets: AssetParameters[];

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // Polling Foundation

    /**
     * Array of proposers that can create a proposal
     */
    proposers: string[];

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // Polling Ftso

    /**
     * Address of maintainer of PollingFtso contract.
     */
    maintainer: string;

    /**
     * Period (in seconds) between creation of proposal and voting start time.
     */
    votingDelaySeconds: integer;

    /**
     * Length (in seconds) of voting period.
     */
    votingPeriodSeconds: integer;

    /**
     * Threshold (in BIPS) for proposal to potentially be accepted. If less than thresholdConditionBIPS of total vote power participates in vote, proposal can't be accepted.
     */
    thresholdConditionBIPS: integer;

    /**
     * Majority condition (in BIPS) for proposal to be accepted. If less than majorityConditionBIPS votes in favor, proposal can't be accepted.
     */
    majorityConditionBIPS: integer;

    /**
     * Cost of creating proposal (in NAT). It is paid by the proposer.
     */
    proposalFeeValueNAT: integer;

    /**
     * Number of last consecutive epochs in which data provider needs to earn rewards in order to be accepted to the management group.
     */
    addAfterRewardedEpochs: integer;

    /**
     * Number of last consecutive epochs in which data provider should not be chilled in order to be accepted to the management group.
     */
    addAfterNotChilledEpochs: integer;

    /**
     * Number of last consecutive epochs in which data provider should not earn rewards in order to be eligible for removal from the management group.
     */
    removeAfterNotRewardedEpochs: integer;

    /**
     * Number of last relevant proposals to check for not voting. Proposal is relevant if quorum was achieved and voting has ended.
     */
    removeAfterEligibleProposals: integer;
    /**
     * In how many of removeAfterEligibleProposals proposals should data provider not participate (vote) in order to be eligible for removal from the management group.
     */
    removeAfterNonParticipatingProposals: integer;

    /**
     * Number of days for which member is removed from the management group.
     */
    removeForDays: integer;

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // P-chain stake mirror

    /**
     * Max number of stake ends that Flare daemon will process per block
     */
    maxStakeEndsPerBlock: integer;

    /**
     * Array of voters that can vote for P-chain stake Merkle proofs
     */
    pChainStakeMirrorVoters: string[];

    /**
     * Number of voters that have to agree in order to finalize P-chain stake Merkle proof
     */
    pChainStakeMirrorVotingThreshold: integer;

    /**
     * Min duration of P-chain stake in days, recommended value 14 days
     */
    pChainStakeMirrorMinDurationDays: integer;

    /**
     * Max duration of P-chain stake in days, recommended value 365 days
     */
    pChainStakeMirrorMaxDurationDays: integer;

    /**
     * Min amount of P-chain stake. In whole native units, not Wei. Recommended value 50.000.
     */
    pChainStakeMirrorMinAmountNAT: integer;

    /**
     * Max amount of P-chain stake. In whole native units, not Wei. Recommended value 200.000.000.
     */
    pChainStakeMirrorMaxAmountNAT: integer;
}

export interface AssetParameters {
    /**
     * The currency symbol.
     */
    assetSymbol: string;

    /**
     * Native decimals for the currency - e.g. 8 for Bitcoin, 18 for Ethereum.
     */
    assetDecimals: integer;

    /**
     * Number of decimals in FTSO USD price.
     */
    ftsoDecimals: integer;

    /**
     * Hybrid reward band, prices within elasticBandWidthPPM of median are rewarded (in parts-per-million).
     */
    elasticBandWidthPPM: integer;

    /**
     * The USD price of the asset at deploy time (in scaled USD: 1 USD = 10^5 USDDec5). 
     * Usually 0, which means that the useful starting price is obtained after first voting.
     */
    initialPriceUSDDec5: integer;

    /**
     * The name of the corresponding f-asset.
     */
    xAssetName: string;

    /**
     * The symbol of the corresponding f-asset.
     */
    xAssetSymbol: string;

    /**
     * Only used in dev testing deploys - the max amount minted.
     */
    dummyAssetMinterMax: integer;
}
