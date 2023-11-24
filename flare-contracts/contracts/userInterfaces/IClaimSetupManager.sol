// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

import "./IDelegationAccount.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * Public interface for the `ClaimSetupManager contract.
 */
interface IClaimSetupManager {

    event DelegationAccountCreated(address owner, IDelegationAccount delegationAccount);
    event DelegationAccountUpdated(address owner, IDelegationAccount delegationAccount, bool enabled);
    event ClaimExecutorsChanged(address owner, address[] executors);
    event AllowedClaimRecipientsChanged(address owner, address[] recipients);
    event ClaimExecutorFeeValueChanged(address executor, uint256 validFromRewardEpoch, uint256 feeValueWei);
    event ExecutorRegistered(address executor);
    event ExecutorUnregistered(address executor, uint256 validFromRewardEpoch);
    event MinFeeSet(uint256 minFeeValueWei);
    event MaxFeeSet(uint256 maxFeeValueWei);
    event RegisterExecutorFeeSet(uint256 registerExecutorFeeValueWei);
    event SetExecutorsExcessAmountRefunded(address owner, uint256 excessAmount);

    /**
     * Sets the addresses of executors and optionally enables (creates) a
     * [Personal Delegation Account](https://docs.flare.network/tech/personal-delegation-account) (PDA).
     *
     * If any of the executors is a registered executor, some fee needs to be paid.
     * @param _executors The new executors. All old executors will be deleted and replaced by these.
     * @param _enableDelegationAccount Whether the PDA should be enabled.
     */
    function setAutoClaiming(address[] memory _executors, bool _enableDelegationAccount) external payable;

    /**
     * Sets the addresses of executors.
     *
     * If any of the executors is a registered executor, some fee needs to be paid.
     * @param _executors The new executors. All old executors will be deleted and replaced by these.
     */
    function setClaimExecutors(address[] memory _executors) external payable;

    /**
     * Set the addresses of allowed recipients.
     * The reward owner is always an allowed recipient.
     * @param _recipients The new allowed recipients. All old recipients will be deleted and replaced by these.
     */
    function setAllowedClaimRecipients(address[] memory _recipients) external;

    /**
     * Enables (or creates) a
     * [Personal Delegation Account](https://docs.flare.network/tech/personal-delegation-account) (PDA).
     *
     * When using automatic claiming, all airdrops and FTSO rewards will be sent to the PDA, and any rewards
     * accrued by the PDA will be claimed too.
     * @return Address of the delegation account contract.
     */
    function enableDelegationAccount() external returns (IDelegationAccount);

    /**
     * Disables the
     * [Personal Delegation Account](https://docs.flare.network/tech/personal-delegation-account) (PDA).
     *
     * When using automatic claiming, all airdrops and FTSO rewards will be sent to the owner's account.
     * Rewards accrued by the PDA will no longer be automatically claimed.
     *
     * Reverts if there is no PDA.
     */
    function disableDelegationAccount() external;

    /**
     * Registers the caller as an executor and sets its initial fee value.
     *
     * If the executor was already registered, this method only updates the fee, which will take effect after
     * `feeValueUpdateOffset` reward epochs have elapsed.
     *
     * Executor must pay a fee in order to register. See `registerExecutorFeeValueWei`.
     * @param _feeValue Desired fee, in wei. Must be between `minFeeValueWei` and `maxFeeValueWei`. 0 means no fee.
     * @return Reward epoch ID when the changes become effective.
     */
    function registerExecutor(uint256 _feeValue) external payable returns (uint256);

    /**
     * Unregisters the caller as an executor.
     * @return Reward epoch ID when the change becomes effective.
     */
    function unregisterExecutor() external returns (uint256);

    /**
     * Sets the caller's executor fee. The caller must be an executor registered through `registerExecutor`.
     *
     * When called multiple times inside the same reward epoch, only the last value remains.
     * @param _feeValue Desired fee, in wei. Must be between `minFeeValueWei` and `maxFeeValueWei`. 0 means no fee.
     * @return Reward epoch ID when the changes become effective.
     */
    function updateExecutorFeeValue(uint256 _feeValue) external returns(uint256);

    /**
     * Delegates a percentage of the caller's
     * [PDA](https://docs.flare.network/tech/personal-delegation-account)'s voting power to another address.
     * @param _to The address of the recipient.
     * @param _bips The percentage of voting power to be delegated expressed in basis points (1/100 of one percent).
     * Not cumulative: Every call resets the delegation value. A value of 0 revokes delegation.
     */
    function delegate(address _to, uint256 _bips) external;

    /**
     * Undelegates all percentage delegations from the caller's
     * [PDA](https://docs.flare.network/tech/personal-delegation-account) and then delegate to a list of accounts.
     *
     * See `delegate`.
     * @param _delegatees The addresses of the new recipients.
     * @param _bips The percentage of voting power to be delegated to each delegatee, expressed in basis points
     * (1/100 of one percent).
     * Total of all `_bips` values must be lower than 10000.
     */
    function batchDelegate(address[] memory _delegatees, uint256[] memory _bips) external;

    /**
     * Removes all delegations from the caller's [PDA](https://docs.flare.network/tech/personal-delegation-account).
     */
    function undelegateAll() external;

    /**
     * Revokes all delegation from the caller's [PDA](https://docs.flare.network/tech/personal-delegation-account)
     * to a given account at a given block.
     *
     * Only affects the reads via `votePowerOfAtCached()` in the specified block.
     *
     * This method should be used only to prevent rogue delegate voting in the current voting block.
     * To stop delegating use `delegate` with percentage of 0 or `undelegateAll`.
     * @param _who The account to revoke.
     * @param _blockNumber Block number where the revoking will take place. Must be in the past.
     */
    function revokeDelegationAt(address _who, uint256 _blockNumber) external;

    /**
     * Delegates all the [governance](https://docs.flare.network/tech/governance/) vote power of the caller's
     * [PDA](https://docs.flare.network/tech/personal-delegation-account) to another account.
     * @param _to Address of the recipient of the delegation.
     */
    function delegateGovernance(address _to) external;

    /**
     * Undelegates all [governance](https://docs.flare.network/tech/governance/) vote power currently delegated by
     * the caller's [PDA](https://docs.flare.network/tech/personal-delegation-account).
     */
    function undelegateGovernance() external;

    /**
     * Allows the caller to transfer `WNat` wrapped tokens from their
     * [PDA](https://docs.flare.network/tech/personal-delegation-account) to the owner account.
     * @param _amount Amount of tokens to transfer, in wei.
     */
    function withdraw(uint256 _amount) external;

    /**
     * Allows the caller to transfer ERC-20 tokens from their
     * [PDA](https://docs.flare.network/tech/personal-delegation-account) to the owner account.
     *
     * The main use case is to move ERC-20 tokes received by mistake (by an airdrop, for example) out of the PDA
     * and into the main account, where they can be more easily managed.
     *
     * Reverts if the target token is the `WNat` contract: use method `withdraw` for that.
     * @param _token Target token contract address.
     * @param _amount Amount of tokens to transfer.
     */
    function transferExternalToken(IERC20 _token, uint256 _amount) external;

    /**
     * Gets the [PDA](https://docs.flare.network/tech/personal-delegation-account) of an account.
     * @param _owner Account to query.
     * @return Address of its PDA or `address(0)` if it has not been created yet.
     */
    function accountToDelegationAccount(address _owner) external view returns (address);

    /**
     * Gets [PDA](https://docs.flare.network/tech/personal-delegation-account) data for an account.
     * @param _owner Account to query.
     * @return _delegationAccount Account's PDA address or `address(0)` if it has not been created yet.
     * @return _enabled Whether the PDA is enabled.
     */
    function getDelegationAccountData(
        address _owner
    )
        external view
        returns (IDelegationAccount _delegationAccount, bool _enabled);

    /**
     * Gets the addresses of executors authorized to claim for an account.
     * See `setClaimExecutors`.
     * @param _owner The account to query.
     * @return Addresses of all set executors.
     */
    function claimExecutors(address _owner) external view returns (address[] memory);

    /**
     * Gets the addresses of recipients allowed to receive rewards on behalf of an account.
     * Beside these, the owner of the rewards is always authorized.
     * See `setAllowedClaimRecipients`.
     * @param _rewardOwner The account to query.
     * @return Addresses of all set authorized recipients.
     */
    function allowedClaimRecipients(address _rewardOwner) external view returns (address[] memory);

    /**
     * Returns whether an executor is authorized to claim on behalf of a reward owner.
     * See `setClaimExecutors`.
     * @param _owner The reward owner to query.
     * @param _executor The executor to query.
     */
    function isClaimExecutor(address _owner, address _executor) external view returns(bool);

    /**
     * Returns the list of executors registered through `registerExecutor`.
     * Supports paging.
     * @param _start First executor to return.
     * @param _end Last executor to return.
     * @return _registeredExecutors Addresses of the registered executors.
     * @return _totalLength Total amount of executors.
     */
    function getRegisteredExecutors(
        uint256 _start,
        uint256 _end
    )
        external view
        returns (address[] memory _registeredExecutors, uint256 _totalLength);

    /**
     * Returns information about an executor.
     * @param _executor The executor to query.
     * @return _registered Whether the executor is registered.
     * @return _currentFeeValue Executor's current fee value, if registered.
     */
    function getExecutorInfo(address _executor) external view returns (bool _registered, uint256 _currentFeeValue);

    /**
     * Returns the current fee of a registered executor.
     * Reverts if the executor is not registered.
     * @param _executor The executor to query.
     * @return Fee in wei.
     */
    function getExecutorCurrentFeeValue(address _executor) external view  returns (uint256);

    /**
     * Returns the fee of an executor at a given reward epoch.
     * @param _executor The executor to query.
     * @param _rewardEpoch Reward Epoch ID to query.
     * @return Fee in wei at that reward epoch.
     */
    function getExecutorFeeValue(address _executor, uint256 _rewardEpoch) external view returns (uint256);

    /**
     * Returns the currently scheduled fee changes of an executor.
     * @param _executor Executor to query.
     * @return _feeValue Array of scheduled fees.
     * @return _validFromEpoch Array of reward epochs ID where the scheduled fees will become effective.
     * @return _fixed Array of booleans indicating if an scheduled fee change is fixed or it might still be changed.
     */
    function getExecutorScheduledFeeValueChanges(address _executor)
        external view
        returns (
            uint256[] memory _feeValue,
            uint256[] memory _validFromEpoch,
            bool[] memory _fixed
        );
}
