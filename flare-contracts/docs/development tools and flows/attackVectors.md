 
# Attack Vectors
 
This file will be used for any research around attack vectors.
 
## Resources
- Attack list for distributing the work amongst our team is [here](https://blog.sigmaprime.io/solidity-security.html). Lists AV (attack vectors) by name. Gives a clear example for each AV.
 
- Consensys known attacks [list](https://consensys.github.io/smart-contract-best-practices/known_attacks/). Well maintained list with many relevant neauncens per attack.
 
Please only add high value resources and write a short orientation note stating the contents and added value of this resource.
 
## Best practice lists
- Consensys security best practices [here](https://consensys.github.io/smart-contract-best-practices/recommendations/)
 
## Reviewed Attacks
 
A list of attacks one of the devs reviewed against existing code base.
- Please add comments per attack
 
#### Re Entrancy attack - Alen
 
One of problematic things with reentry attacks is discrepancy between the actual system currency amount on the contract and the balance maintained in the variable(s) in the contract (e.g. DAO hack).
One efficient remedy is verification differences before and the end of an execution of a sensitive API call.
See (https://www.frontiersin.org/articles/10.3389/fcomp.2021.598780/full)
 
#### Default Visibility - Chuck
 
#### UnExpected Ether (native token) - Jan
 
#### Arithmetic over / under flow - Bostjan
 
 
#### DelegateCall and default visibility - Ilan
references:
- Famous [parity multisig bug](https://blog.comae.io/the-280m-ethereums-bug-f28e5de43513) AKA 'I Accidently killed it'
- section 2 in [this article](https://medium.com/loom-network/how-to-secure-your-smart-contracts-6-solidity-vulnerabilities-and-how-to-avoid-them-part-1-c33048d4d17d)
 
Two separate issues that can create hidden attacks.
- Default visibility is public. must be aware and always set visiblity.
- DelegateCall can potentially reach any function in calling contract.
 
The discussed attacks are not relevant to our code:
 - we don't use libraries that are contracts. No conflicting storage positions.
 - Default visibility should fail with linter.
 
## References
List of good references.
 
- [attack registry](https://swcregistry.io/)
- [Common atack list](https://medium.com/coinmonks/common-attacks-in-solidity-and-how-to-defend-against-them-9bc3994c7c18)
 
## Non reviewed attacks + Reason
If any attack is skipped. Please list it here and state why.
