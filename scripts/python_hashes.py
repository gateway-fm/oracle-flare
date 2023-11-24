from typing import List

from web3 import Web3
import eth_abi


def submit_price_hash(ftsoIndices: List[int], prices: List[int], random: int, address: str) -> str:
    assert len(ftsoIndices) == len(prices)
    assert list(sorted(ftsoIndices)) == ftsoIndices and len(set(ftsoIndices)) == len(ftsoIndices), "Indices are non increasing"
    return Web3.keccak(eth_abi.encode_abi(
        ["uint256[]", "uint256[]", "uint256", "address"], 
        [ftsoIndices, prices, random, address],
    )).hex()

def test_fun(prices: List[int], random: int, address="0xD7de703D9BBC4602242D0f3149E5fFCD30Eb3ADF") -> List[str]:
    return submit_price_hash(list(range(len(prices))), prices, random, address)


addrs = ["0xD7de703D9BBC4602242D0f3149E5fFCD30Eb3ADF", "0xEa960515F8b4C237730F028cBAcF0a28E7F45dE0", "0x3d91185a02774C70287F6c74Dd26d13DFB58ff16"]
prices = [0, 1, 2, 3, 5, 10, 50, 100, 101, 10**5 + 1, 10**8]
randoms = [0, 1, 100, 101, 100000000000000000000]

for addr in addrs:
    print(f"Address: {addr}")
    for rand in randoms:
        print(f"  Random: {rand}")
        print("    hash:", test_fun(prices, rand, addr))
    print()
