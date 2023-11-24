package contracts

import "math/big"

type PriceEpochData struct {
	EpochID    *big.Int
	SubmitTime *big.Int
	RevealTime *big.Int
	VotePower  *big.Int
	Fallback   bool
}
