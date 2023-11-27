package contracts

import "math/big"

// IPriceSubmitter is an interface for the PriceSubmitter smart-contract
type IPriceSubmitter interface {
	// CommitPrices is used to commit prices on-chain
	CommitPrices(epochID *big.Int, indices []TokenID, prices []*big.Int, random *big.Int) error
	// RevealPrices is used to reveal previously committed prices on-chain
	RevealPrices(epochID *big.Int, indices []TokenID, prices []*big.Int, random *big.Int) error
}

// IFTSOManager is an interface for the FtsoManager smart-contract
type IFTSOManager interface {
	// GetCurrentPriceEpochData is used to get current epoch data
	GetCurrentPriceEpochData() (*PriceEpochData, error)
}

// IFTSORegistry is an interface for the FtsoRegistry smart-contract
type IFTSORegistry interface {
	// GetSupportedIndicesAndSymbols is used to get supported indices and symbols
	GetSupportedIndicesAndSymbols() (*IndicesAndSymbols, error)
}
