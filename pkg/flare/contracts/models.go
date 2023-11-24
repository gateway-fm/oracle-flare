package contracts

import "math/big"

type PriceEpochData struct {
	EpochID            *big.Int
	StartTimestamp     *big.Int
	EndTimestamp       *big.Int
	RevealEndTimestamp *big.Int
	CurrentTimestamp   *big.Int
}
