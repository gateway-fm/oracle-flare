from typing import List

from web3 import Web3
import eth_abi


def submit_price_hash(price: int, random: int, address: str) -> str:
    return Web3.keccak(eth_abi.encode_abi(
        [ "uint256", "uint256", "address" ], 
        [price, random, address],
    )).hex()

def test_fun(prices: List[int] = list([500, 400, 100]), randoms: List[int] = list([27182, 81828, 45904]), address="0xD7de703D9BBC4602242D0f3149E5fFCD30Eb3ADF") -> List[str]:
    return [
        submit_price_hash(p, r, address) for p, r in zip(prices, randoms)
    ]

print(test_fun())
