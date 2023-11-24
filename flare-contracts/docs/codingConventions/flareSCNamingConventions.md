# Flare **smart contracts** naming conventions
 
- function input / output parameters must be prefixed with an underscore.
- internal / private functions must be prefixed with an underscore.
- Follow solidity [style guide](https://docs.soliditylang.org/en/v0.6.7/style-guide.html) for solidity coding.
- Always use full type name for uint256 (avoid using unit)
 
### Examples
> function setValue(uint256 _myValue) external;
> function getValue() external view returns(uint256 _theValue);
> function _privateFunction(uint256 _someValue) private returns(_otherValue);
 
 ## Parameter names
 Each parameter that deals with amounts, like token amounts, or time frames the name must include the denomination / units being used.
 ### Example:
 - priceEpochTimeFrameSec
 - tokenAmountWei 

 * note for vote power. the denomination is always the token balance.

## Solidity Interfaces
For solidity interface files the name should start with a capital I, followed by the name of the contract that implements this interface Example: 'IFtso'.
User facing interfaces will be placed in folder: contracts/userInterfaces while internal interfaces should be placed in folder, contracts/"module folder"/interface.
User facing interfaces should only hold functions and events that a "normal" user would use when connecting to Flare. An advanced user would have to browse the internal interface folder.
When updating a user facing interface, Flare should create a public announcement, internal interfaces are seen as more flexible.
