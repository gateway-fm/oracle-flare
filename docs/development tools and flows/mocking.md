class: center, middle

# Solidity Testing Using Javascript Mocks 

???

To run this presentation, go to [remarkjs.com](https://remarkjs.com) and drop this file on to main page.

---

# Agenda

1. Why Mock?
2. Solidity Mocking Techniques
3. Gnosis MockContract
4. Examples
5. What About TypeScript?

---

# Why Mock?

- Isolate external dependencies
- Focus on code being tested
- Enables you to assume your code is broken and dependencies just work
- Might need many different dependency behaviors that may be hard to set up or maintain
- Limit test scope, making test shorter
- Reduce test execution time because dependent code is not executed
- More tests testing one little thing better than fewer tests testing many things
- Promotes code composability and thus testing decomposability

---

# Solidity Mocking Techniques

## Static Mocks

### Create one or more contracts with duplicate interface as original.

#### Problems
--

1. Maintenance burden keeping duplicate interfaces in sync
--

2. Many different contracts (or mocking logic) might be needed to formulate necessary scenarios
--

3. Pollutes production code with mocks
--

4. Security issues if mocks are accidentally deployed
--

5. Temptation might be to avoid mocks and turn unit tests into integration tests; makes tests brittle

---

# Solidity Mocking Techniques

## Dynamic Mocks

### Create contracts with desired behavior dynamically using Javascript.

#### Benefits
--

1. Only define interfaces you need.
--

2. All other callable interfaces stubbed with definable default behaviors automatically.
--

3. Leverage source contract interface in mock definition setup. Reduced duplication.
--

4. Many dependency return scenarios can be defined with a few lines of code.
--

5. No or few mock contracts need to be built.

---

# [Gnosis MockContract](https://github.com/gnosis/mock-contract)

## You can:
- Make dependent contracts return predefined values for different methods and arguments
- Simulate exceptions such as revert and outOfGas
- Assert on how often a dependency is called

Without writing a separate contract...

## Let's Review Example Usage At Gnosis GitHub Site

---

# More Examples

## Problem: I want to mock the FTSO `finalizePriceEpoch` method.

```solidity
    function finalizePriceEpoch(uint256 epochId, bool returnRewardData) 
        external returns(
            address[] memory eligibleAddresses,
            uint64[] memory natWeights,
            uint256 totalNatWeight
    );
```

- It has a tuple return of arrays.
- Example does not show how to do this...

---

# Mock `finalizePriceEpoch`

## Howto
See `RewardManager.js` for full code.

```solidity
    // ftsoInterface is an an instantiated FTSO, 
    // just to get the ABI interface generated
    // Get finalizePriceEpoch interface
    const finalizePriceEpoch = 
      ftsoInterface.contract.methods.finalizePriceEpoch(0, true).encodeABI();

    // Rig the expected return using web3 abi encoder
    const finalizePriceEpochReturn = web3.eth.abi.encodeParameters(
      ['address[]', 'uint64[]', 'uint256'], 
      [[accounts[1], accounts[2]], [25, 75], 100]);

    // associate call interface with return on mock
    // mockFtso is an instantiated MockContract
    await mockFtso.givenMethodReturn(
        finalizePriceEpoch, 
        finalizePriceEpochReturn);
```

---

# Still More Examples

## Problem: I want to count specific calls to `setCurrentVotepowerBlock`.

- In my unit test for `RewardManager`, the point of reward finalization is to set the next vote power block for each ftso.
- The point of an important test is to count the invocations.

---

# Invocation count of `setCurrentVotepowerBlock`

## Howto
See `RewardManager.js` for full code.

```solidity
    // ftsoInterface is an an instantiated FTSO, 
    // just to get the ABI interface generated
    // Get the invocation count for setting new vote power block on mocked FTSO
    // 494 is new expected block
    const setCurrentVotepowerBlock = 
        ftsoInterface.contract.methods.setCurrentVotepowerBlock(494).encodeABI();

    // Get the number of counts to the method regardless of arguments
    // mockFtso is an instantiated MockContract
    const invocationCount = 
        await mockFtso.invocationCountForMethod.call(setCurrentVotepowerBlock);

    // Get the number of counts to the method with the specific argument signature
    const invocationCountToFinalize = 
        await mockFtso.invocationCountForCalldata.call(setCurrentVotepowerBlock);
```

---

# What About TypeScript?

## Waffle has a [mock-contract](https://ethereum-waffle.readthedocs.io/en/latest/mock-contract.html) component
- Syntactically cleaner to use
- Seems dependent on ethers; may not work with web3

---

# Questions?