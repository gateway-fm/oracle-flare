package contracts

import "math/big"

// PriceEpochData is a getCurrentPriceEpochData method response model
type PriceEpochData struct {
	EpochID            *big.Int
	StartTimestamp     *big.Int
	EndTimestamp       *big.Int
	RevealEndTimestamp *big.Int
	CurrentTimestamp   *big.Int
}

// IndicesAndSymbols is a getIndicesAndSymbols method response model
type IndicesAndSymbols struct {
	Indices []*big.Int
	Symbols []string
}
