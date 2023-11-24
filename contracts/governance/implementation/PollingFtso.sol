// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import "../../userInterfaces/IPollingFtso.sol";
import "../../addressUpdater/implementation/AddressUpdatable.sol";
import "../../userInterfaces/IVoterWhitelister.sol";
import "../../userInterfaces/IFtsoRewardManager.sol";
import "../../utils/implementation/SafePct.sol";
import "./Governed.sol";
import "../../utils/implementation/AddressSet.sol";

/**
 * @title Polling FTSO
 * @notice A contract manages membership of the FTSO Management Group,
 * enables users of the group to create proposals and vote on them.
 */
//solhint-disable-next-line max-states-count
contract PollingFtso is IPollingFtso, AddressUpdatable, Governed {
    using SafePct for uint256;
    using AddressSet for AddressSet.State;
    using SafeMath for uint256;

    uint256 internal constant MAX_BIPS = 1e4;
    address payable constant internal BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;
    uint256 internal constant DAY_TO_SECOND = 1 days;

    mapping(uint256 => Proposal) internal proposals;
    mapping(uint256 => ProposalVoting) internal proposalVotings;
    // mapping provider address => its proxy address
    mapping(address => address) public providerToProxy;
    // mapping proxy address => its provider address
    mapping(address => address) public proxyToProvider;
    // timestamp at which member was removed from the management group
    mapping(address => uint256) public memberRemovedAtTs;
    // id of the last created proposal at the moment member was added to the management group
    mapping (address => uint256) public memberAddedAtProposal;
    // epoch in which member was added
    mapping (address => uint256) public memberAddedAtRewardEpoch;

    // providers eligible to participate (create proposals and vote)
    AddressSet.State private managementGroupMembers;
    // address of voter whitelister contract
    IVoterWhitelister public voterWhitelister;
    // address of ftso reward manager contract
    IFtsoRewardManager public ftsoRewardManager;

    //// voting parameters
    // period between proposal creation and start of the vote, in seconds
    uint256 public votingDelaySeconds;
    // length of voting period in seconds
    uint256 public votingPeriodSeconds;
    // share of total vote power (in BIPS) required to participate in vote for proposal to pass
    uint256 public thresholdConditionBIPS;
    // share of participating vote power (in BIPS) required to vote in favor for proposal to pass
    uint256 public majorityConditionBIPS;
    // fee value (in wei) that proposer must pay to submit a proposal
    uint256 public proposalFeeValueWei;

    // number of created proposals
    uint256 public idCounter = 0;
    // maintainer of this contract; can change parameters and create proposals
    address public maintainer;

    //// parameters for adding and removing members
    // number of last consecutive epochs with earned rewards to be added
    uint256 public addAfterRewardedEpochs;
    // number of last consecutive epochs without chill to be added
    uint256 public addAfterNotChilledEpochs;
    // number of last consecutive epochs without reward to be removed
    uint256 public removeAfterNotRewardedEpochs;
    // number of last proposals to check for not voting
    uint256 public removeAfterEligibleProposals;
    // in how many of removeAfterEligibleProposals
    // should member not participate in vote in order to be removed from the management group
    uint256 public removeAfterNonParticipatingProposals;
    // number of days for which member is removed from the management group
    uint256 public removeForDays;


    modifier onlyMaintainer {
        require(msg.sender == maintainer, "only maintainer");
        _;
    }

    /**
     * @notice Initializes the contract with default parameters
     * @param _governance                   Address identifying the governance address
     * @param _addressUpdater               Address identifying the address updater contract
     */
    constructor(
        address _governance,
        address _addressUpdater
    )
        Governed(_governance)
        AddressUpdatable(_addressUpdater)
    {
    }

    /**
     * @notice Sets maintainer of this contract
     * @param _newMaintainer                Address identifying the governance address
     * @dev Only governance can call this.
     */
    function setMaintainer(
        address _newMaintainer
    )
        external onlyGovernance
    {
        require(_newMaintainer != address(0), "zero address");
        maintainer = _newMaintainer;
        emit MaintainerSet(_newMaintainer);
    }

    /**
     * @notice Sets (or changes) contract's parameters. It is called after deployment of the contract
     * and every time one of the parameters changes
     * @dev Only maintainer can call this
     */
    function setParameters(
        uint256 _votingDelaySeconds,
        uint256 _votingPeriodSeconds,
        uint256 _thresholdConditionBIPS,
        uint256 _majorityConditionBIPS,
        uint256 _proposalFeeValueWei,
        uint256 _addAfterRewardedEpochs,
        uint256 _addAfterNotChilledEpochs,
        uint256 _removeAfterNotRewardedEpochs,
        uint256 _removeAfterEligibleProposals,
        uint256 _removeAfterNonParticipatingProposals,
        uint256 _removeForDays
    )
        external override onlyMaintainer
    {
        require(
            _votingPeriodSeconds > 0 &&
            _thresholdConditionBIPS <= MAX_BIPS &&
            _majorityConditionBIPS <= MAX_BIPS &&
            _addAfterRewardedEpochs > _removeAfterNotRewardedEpochs,
            "invalid parameters"
        );

        votingDelaySeconds = _votingDelaySeconds;
        votingPeriodSeconds = _votingPeriodSeconds;
        thresholdConditionBIPS = _thresholdConditionBIPS;
        majorityConditionBIPS = _majorityConditionBIPS;
        proposalFeeValueWei = _proposalFeeValueWei;
        addAfterRewardedEpochs = _addAfterRewardedEpochs;
        addAfterNotChilledEpochs = _addAfterNotChilledEpochs;
        removeAfterNotRewardedEpochs = _removeAfterNotRewardedEpochs;
        removeAfterEligibleProposals = _removeAfterEligibleProposals;
        removeAfterNonParticipatingProposals = _removeAfterNonParticipatingProposals;
        removeForDays = _removeForDays;

        emit ParametersSet(
            _votingDelaySeconds,
            _votingPeriodSeconds,
            _thresholdConditionBIPS,
            _majorityConditionBIPS,
            _proposalFeeValueWei,
            _addAfterRewardedEpochs,
            _addAfterNotChilledEpochs,
            _removeAfterNotRewardedEpochs,
            _removeAfterEligibleProposals,
            _removeAfterNonParticipatingProposals,
            _removeForDays
        );
    }

    /**
     * @notice Changes list of management group members
     * @param _providersToAdd       Array of addresses to add to the list
     * @param _providersToRemove    Array of addresses to remove from the list
     * @dev This operation can only be performed through a maintainer
     * (mostly used for manually adding KYCed providers)
     */
    function changeManagementGroupMembers(
        address[] memory _providersToAdd,
        address[] memory _providersToRemove
    )
        external override onlyMaintainer
    {
        for (uint256 i = 0; i < _providersToRemove.length; i++) {
            address providerToRemove = _providersToRemove[i];
            require(managementGroupMembers.index[providerToRemove] != 0,
                "account is not a member of the management group");
            _removeMember(providerToRemove);
        }
        uint256 currentRewardEpoch = ftsoRewardManager.getCurrentRewardEpoch();
        for (uint256 i = 0; i < _providersToAdd.length; i++) {
            address providerToAdd = _providersToAdd[i];
            require(managementGroupMembers.index[providerToAdd] == 0,
                "account is already a member of the management group");
            _addMember(providerToAdd, currentRewardEpoch);
        }
    }

    /**
     * @notice Creates a new proposal
     * @param _description          String description of the proposal
     * @return _proposalId          Unique identifier of the proposal
     * @notice Emits a FtsoProposalCreated event
     * @dev Can only be called by members of the management group, their proxies or the maintainer of the contract
     * @dev Caller needs to pay a `proposalFeeValueWei` fee to create a proposal
     */
    function propose(
        string memory _description
    )
        external payable override returns (uint256 _proposalId)
    {
        // management group member (or his proxy address) and maintainer can submit a proposal
        address proposerAccount = _getOperatingAccount(msg.sender);
        require(_canPropose(proposerAccount), "submitter is not eligible to submit a proposal");

        require(proposalFeeValueWei == msg.value, "proposal fee invalid");

        idCounter += 1;
        _proposalId = idCounter;
        Proposal storage proposal = proposals[_proposalId];

        // store proposal
        proposal.proposer = proposerAccount;
        proposal.voteStartTime = block.timestamp + votingDelaySeconds;
        proposal.voteEndTime = proposal.voteStartTime + votingPeriodSeconds;
        proposal.thresholdConditionBIPS = thresholdConditionBIPS;
        proposal.majorityConditionBIPS = majorityConditionBIPS;
        proposal.description = _description;
        address[] memory members = managementGroupMembers.list;
        proposal.noOfEligibleMembers = members.length;

        for (uint256 i = 0; i < members.length ; i++) {
            proposal.isEligible[members[i]] = true;
        }

        emit FtsoProposalCreated(
            _proposalId,
            proposal.proposer,
            _description,
            proposal.voteStartTime,
            proposal.voteEndTime,
            proposal.thresholdConditionBIPS,
            proposal.majorityConditionBIPS,
            managementGroupMembers.list
        );

        //slither-disable-next-line arbitrary-send-eth
        BURN_ADDRESS.transfer(msg.value);
    }

    /**
     * @notice Cancels an existing proposal
     * @param _proposalId           Unique identifier of a proposal
     * @notice Emits a ProposalCanceled event
     * @dev Can be called by proposer of the proposals or its proxy only before voting starts
     */
    function cancel(uint256 _proposalId) external override {
        Proposal storage proposal = proposals[_proposalId];

        require(!proposal.canceled, "proposal is already canceled");
        require(proposal.proposer == _getOperatingAccount(msg.sender),
            "proposal can only be canceled by its proposer or his proxy address");
        require(block.timestamp < proposal.voteStartTime, "proposal can only be canceled before voting starts");

        proposal.canceled = true;

        emit ProposalCanceled(_proposalId);
    }

    /**
     * @notice Casts a vote on a proposal
     * @param _proposalId           Id of the proposal
     * @param _support              A value indicating vote type (against, for)
     * @notice Emits a VoteCast event
     * @dev Can only be called by members of the management group and their proxies for active proposals
     */
    function castVote(
        uint256 _proposalId,
        uint8 _support
    )
        external override
    {
        Proposal storage proposal = proposals[_proposalId];
        require(_state(_proposalId, proposal) == ProposalState.Active, "proposal not active");

        address voterAccount = _getOperatingAccount(msg.sender);

        // check if an account is eligible to cast a vote
        require(_canVote(voterAccount, _proposalId), "address is not eligible to cast a vote");

        ProposalVoting storage voting = _storeVote(_proposalId, voterAccount, _support);

        emit VoteCast(voterAccount, _proposalId, _support, voting.forVotePower, voting.againstVotePower);
    }

    /**
     * @notice Sets a proxy voter for data provider (i.e. address that can vote in his name)
     * @param _proxyVoter           Address to register as a proxy (use address(0) to remove proxy)
     * @notice Emits a ProxyVoterSet event
     * @dev An address can be proxy only for a single address (member)
     */
    function setProxyVoter(
        address _proxyVoter
    )
        external override
    {
        address currentProxy = providerToProxy[msg.sender];
        delete proxyToProvider[currentProxy];
        if (_proxyVoter != address(0)) { // update only if not removing proxy
            require(proxyToProvider[_proxyVoter] == address(0),
                "address is already a proxy of some data provider");
            proxyToProvider[_proxyVoter] = msg.sender;
        }
        providerToProxy[msg.sender] = _proxyVoter;
        emit ProxyVoterSet(msg.sender, _proxyVoter);
    }

    /**
     * @notice Adds msg.sender to the management group
     * @dev Can be called by accounts that fulfill all conditions and are not already members of the group
     * @dev If msg.sender is proxy of some provider (and is not a member of the group), he is adding his provider
     */
    function addMember() external override {
        // if msg.sender is proxy and is not member of the group, he is adding his provider
        address dataProvider = _getOperatingAccount(msg.sender);
        require(managementGroupMembers.index[dataProvider] == 0,
            "account is already a member of the management group");

        uint256 currentRewardEpoch = ftsoRewardManager.getCurrentRewardEpoch();

        // check if provider was removed from the management group in the last days
        if (block.timestamp < memberRemovedAtTs[dataProvider] + removeForDays * DAY_TO_SECOND) {
            revert("recently removed");
        }

        // check if provider was chilled in last reward epochs
        if (voterWhitelister.chilledUntilRewardEpoch(dataProvider) >=
            currentRewardEpoch.sub(addAfterNotChilledEpochs)) {
            revert("recently chilled");
        }

        // check if provider was receiving rewards in all of the last reward epochs
        for (uint256 i = currentRewardEpoch; i > currentRewardEpoch.sub(addAfterRewardedEpochs); i--) {
            (uint256 rewardAmount, ) = ftsoRewardManager.getDataProviderPerformanceInfo(i - 1, dataProvider);
            if (rewardAmount == 0) {
                revert("no rewards");
            }
        }

        _addMember(dataProvider, currentRewardEpoch);
    }

    /**
     * @notice Removes member from the management group
     * @param _account              Account to remove from the management group
     * @dev Can be called only by current members of the management group
     * @dev Can only remove a member which no longer fulfills the conditions
     */
    function removeMember(address _account) external override {

        require(managementGroupMembers.index[_account] != 0, "account is not a member of the management group");

        uint256 currentRewardEpoch = ftsoRewardManager.getCurrentRewardEpoch();

        ///// check if provider didn't receive rewards in the last reward epochs

        if (currentRewardEpoch > memberAddedAtRewardEpoch[_account] + removeAfterNotRewardedEpochs) {
            uint256 sumRewards;
            for (uint256 i = currentRewardEpoch; i > currentRewardEpoch.sub(removeAfterNotRewardedEpochs); i--) {
                (uint256 rewardAmount, ) = ftsoRewardManager.getDataProviderPerformanceInfo(i - 1, _account);
                sumRewards += rewardAmount;
            }
            // provider didn't receive any rewards
            if (sumRewards == 0) {
                _removeMember(_account);
                return;
            }
        }

        //// check if provider didn't participate in past proposals
        uint256 lastProposalId = idCounter;
        uint256 firstProposalId = memberAddedAtProposal[_account];
        uint256 didNotVote = 0;         // number of proposals in which provider didn't participate
        uint256 relevantProposals = 0;  // finished proposals where quorum was met

        // check if there are enough proposals to remove member
        if (lastProposalId - firstProposalId >= removeAfterEligibleProposals) {

            for (uint256 id = lastProposalId; id > firstProposalId; id--) {

                // enough relevant proposals have already been found
                if (relevantProposals == removeAfterEligibleProposals) {
                    break;
                }

                // check if vote for proposal ended and if quorum was met
                Proposal storage proposal = proposals[id];
                ProposalState proposalState = _state(id, proposal);
                if (_quorum(id, proposal) && (proposalState == ProposalState.Defeated ||
                    proposalState == ProposalState.Succeeded)) {
                    relevantProposals += 1;

                    if (!hasVoted(id, _account)) {
                        didNotVote += 1;
                    }
                    if (didNotVote >= removeAfterNonParticipatingProposals) {
                        _removeMember(_account);
                        return;
                    }
                }
            }
        }
        revert("cannot remove member");
    }

    /**
     * @notice Returns information about the specified proposal
     * @param _proposalId               Id of the proposal
     * @return _description             Description of the proposal
     * @return _proposer                Address of the proposal submitter
     * @return _voteStartTime           Start time (in seconds from epoch) of the proposal voting
     * @return _voteEndTime             End time (in seconds from epoch) of the proposal voting
     * @return _thresholdConditionBIPS  Total number of cast votes, as a percentage in BIPS of the
     total vote power, required for the proposal to pass (quorum)
     * @return _majorityConditionBIPS   Number of FOR votes, as a percentage in BIPS of the
     total cast votes, requires for the proposal to pass
     * @return _noOfEligibleMembers     Number of members that are eligible to vote in the specified proposal
     */
    function getProposalInfo(
        uint256 _proposalId
    )
        external view override
        returns (
            string memory _description,
            address _proposer,
            uint256 _voteStartTime,
            uint256 _voteEndTime,
            uint256 _thresholdConditionBIPS,
            uint256 _majorityConditionBIPS,
            uint256 _noOfEligibleMembers
        )
    {
        Proposal storage proposal = proposals[_proposalId];
        _proposer = proposal.proposer;
        _voteStartTime = proposal.voteStartTime;
        _voteEndTime = proposal.voteEndTime;
        _thresholdConditionBIPS = proposal.thresholdConditionBIPS;
        _majorityConditionBIPS = proposal.majorityConditionBIPS;
        _description = proposal.description;
        _noOfEligibleMembers = proposal.noOfEligibleMembers;
    }

    /**
     * @notice Returns the description string that was supplied when the specified proposal was created
     * @param _proposalId               Id of the proposal
     * @return _description             Description of the proposal
     */
    function getProposalDescription(
        uint256 _proposalId
    )
        external view override
        returns (
            string memory _description
        )
    {
        Proposal storage proposal = proposals[_proposalId];
        _description = proposal.description;
    }

    /**
     * @notice Returns id and description of the last created proposal
     * @return _proposalId              Id of the last proposal
     * @return _description             Description of the last proposal
     */
    function getLastProposal() external view override
        returns (
            uint256 _proposalId,
            string memory _description
        )
    {
        _proposalId = idCounter;
        Proposal storage proposal = proposals[_proposalId];
        _description = proposal.description;
    }

    /**
     * @notice Returns list of current management group members
     * @return _list             List of management group members
     */
    function getManagementGroupMembers() external view override returns (address[] memory _list) {
        _list = managementGroupMembers.list;
    }

    /**
     * @notice Returns whether an account can create proposals
     * @notice An address can make proposals if it is a member of the management group,
     * one of their proxies or the maintainer of the contract
     * @param _account              Address of the queried account
     * @return True if the queried account can propose, false otherwise
     */
    function canPropose(address _account) external view override returns (bool) {
        return _canPropose(_getOperatingAccount(_account));
    }

    /**
     * @notice Returns whether an account is member of the management group
     * @param _account              Address of the queried account
     * @return True if the queried account is member, false otherwise
     */
    function isMember(address _account) external view override returns (bool) {
        return managementGroupMembers.index[_account] != 0;
    }

    /**
     * @notice Returns whether an account can vote for a given proposal
     * @param _account              Address of the queried account
     * @param _proposalId           Id of the queried proposal
     * @return True if account is eligible to vote, and false otherwise
     */
    function canVote(address _account, uint256 _proposalId) external view override returns (bool) {
        return _canVote(_getOperatingAccount(_account), _proposalId);
    }

    /**
     * @notice Returns the current state of a proposal
     * @param _proposalId           Id of the proposal
     * @return ProposalState enum
     */
    function state(uint256 _proposalId) public view override returns (ProposalState) {
        return _state(_proposalId, proposals[_proposalId]);
    }

    /**
     * @notice Returns whether a voter has cast a vote on a specific proposal
     * @param _proposalId           Id of the proposal
     * @param _voter                Address of the voter
     * @return True if the voter has cast a vote on the proposal, and false otherwise
     */
    function hasVoted(uint256 _proposalId, address _voter) public view override returns (bool) {
        return proposalVotings[_proposalId].hasVoted[_voter];
    }

    /**
     * @notice Returns number of votes for and against the specified proposal
     * @param _proposalId           Id of the proposal
     * @return _for                 Accumulated vote power for the proposal
     * @return _against             Accumulated vote power against the proposal
     */
    function getProposalVotes(
        uint256 _proposalId
    )
        public view override
        returns (
            uint256 _for,
            uint256 _against
        )
    {
        ProposalVoting storage voting = proposalVotings[_proposalId];
        _for = voting.forVotePower;
        _against = voting.againstVotePower;
    }

    /**
     * @notice Changes list of eligible management group members
     * @param _providerToAdd        Address to add to the list
     * @notice Emits a ManagementGroupMemberAdded event
     */
    function _addMember(
        address _providerToAdd,
        uint256 _currentRewardEpoch
    )
        internal
    {
        emit ManagementGroupMemberAdded(_providerToAdd);
        managementGroupMembers.add(_providerToAdd);
        // id of the last created proposal
        memberAddedAtProposal[_providerToAdd] = idCounter;
        memberAddedAtRewardEpoch[_providerToAdd] = _currentRewardEpoch;
        delete memberRemovedAtTs[_providerToAdd];
    }

    /**
     * @notice Changes list of eligible management group members
     * @param _providerToRemove     Address to remove from the list
     * @notice Emits a ManagementGroupMemberRemoved event
     */
    function _removeMember(
        address _providerToRemove
    )
        internal
    {
        emit ManagementGroupMemberRemoved(_providerToRemove);
        managementGroupMembers.remove(_providerToRemove);
        delete memberAddedAtProposal[_providerToRemove];
        delete memberAddedAtRewardEpoch[_providerToRemove];
        memberRemovedAtTs[_providerToRemove] = block.timestamp;
    }


    /**
     * @notice Stores a proposal vote
     * @param _proposalId           Id of the proposal
     * @param _voter                Address of the voter
     * @param _support              Parameter indicating the vote type
     */
    function _storeVote(
        uint256 _proposalId,
        address _voter,
        uint8 _support
    )
        internal returns (ProposalVoting storage _voting)
    {
        _voting = proposalVotings[_proposalId];

        require(!_voting.hasVoted[_voter], "vote already cast");
        _voting.hasVoted[_voter] = true;

        if (_support == uint8(VoteType.Against)) {
            _voting.againstVotePower += 1;
        } else if (_support == uint8(VoteType.For)) {
            _voting.forVotePower += 1;
        } else {
            revert("invalid value for enum VoteType");
        }
    }

    /**
     * @notice Implementation of the AddressUpdatable abstract method.
     */
    function _updateContractAddresses(
        bytes32[] memory _contractNameHashes,
        address[] memory _contractAddresses
    )
        internal virtual override
    {
        voterWhitelister = IVoterWhitelister(
            _getContractAddress(_contractNameHashes, _contractAddresses, "VoterWhitelister"));

        ftsoRewardManager = IFtsoRewardManager(
            _getContractAddress(_contractNameHashes, _contractAddresses, "FtsoRewardManager"));
    }

    /**
     * @notice Determines if a quorum has been reached
     * @param _proposalId           Id of a proposal
     * @return True if quorum has been reached, false otherwise
     */
    function _quorum(uint256 _proposalId, Proposal storage _proposal) internal view returns(bool) {
        (uint256 forVotes, uint256 againstVotes) = getProposalVotes(_proposalId);
        return forVotes + againstVotes >=
            _proposal.thresholdConditionBIPS.mulDivRoundUp(_proposal.noOfEligibleMembers, MAX_BIPS);
    }

    /**
     * @notice Determines operating account
     * @param _account              Address of a queried account
     * @return Address of a queried account or its provider if queried account is proxy
     */
    function _getOperatingAccount(address _account) internal view returns (address) {
        if (_account == maintainer) {
            return _account;
        }
        // account is member of the management group
        if (managementGroupMembers.index[_account] != 0) {
            return _account;
        }
        // account is proxy voter for another account
        address provider = proxyToProvider[_account];
        if (provider != address(0)) {
            return provider;
        }
        return _account;
    }

    /**
     * @notice Determines if an account can create a proposal
     * @param _account              Address of a queried account
     * @return True if a queried account can propose, false otherwise
     */
    function _canPropose(address _account) internal view returns (bool) {
        return managementGroupMembers.index[_account] != 0 || _account == maintainer;
    }

    /**
     * @notice Determines if an account can vote for a given proposal
     * @param _account              Address of a queried account
     * @param _proposalId           Id of a queried proposal
     * @return True if an account is eligible to vote, and false otherwise
     */
    function _canVote(address _account, uint256 _proposalId) internal view returns (bool) {
        Proposal storage proposal = proposals[_proposalId];
        return proposal.isEligible[_account];
    }

    /**
     * @notice Returns the current state of a proposal
     * @param _proposalId           Id of the proposal
     * @param _proposal             Proposal object
     * @return ProposalState enum
     */
    function _state(
        uint256 _proposalId,
        Proposal storage _proposal
    )
        internal view returns (ProposalState)
    {

        if (_proposal.canceled) {
            return ProposalState.Canceled;
        }

        if (_proposal.voteStartTime == 0) {
            revert("unknown proposal id");
        }

        if (_proposal.voteStartTime > block.timestamp) {
            return ProposalState.Pending;
        }

        if (_proposal.voteEndTime > block.timestamp) {
            return ProposalState.Active;
        }

        if (_proposalSucceeded(_proposalId, _proposal)) {
            return ProposalState.Succeeded;
        }

        return ProposalState.Defeated;
    }

    /**
     * @notice Determines if a proposal has been successful
     * @param _proposalId           Id of the proposal
     * @param _proposal             Proposal
     * @return True if proposal succeeded and false otherwise
     */
    function _proposalSucceeded(uint256 _proposalId, Proposal storage _proposal) internal view virtual returns (bool) {
        ProposalVoting storage voting = proposalVotings[_proposalId];

        if (voting.forVotePower + voting.againstVotePower <
            _proposal.thresholdConditionBIPS.mulDivRoundUp(_proposal.noOfEligibleMembers, MAX_BIPS)) {
            return false;
        }

        if (voting.forVotePower <=
            _proposal.majorityConditionBIPS.mulDiv(voting.forVotePower + voting.againstVotePower, MAX_BIPS)) {
            return false;
        }

        return true;
    }

}
