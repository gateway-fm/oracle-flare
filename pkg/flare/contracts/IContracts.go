package contracts

import "math/big"

type IPriceSubmitter interface {
	CommitPrices(epochID *big.Int, indices []*big.Int, prices []*big.Int, random *big.Int) error
	RevealPrices(epochID *big.Int, indices []*big.Int, prices []*big.Int, random *big.Int) error
}

type IFTSOManager interface {
	GetCurrentPriceEpochData() (*PriceEpochData, error)
}
