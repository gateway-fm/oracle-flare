package contracts

import (
	"math/big"
)

// TokenID is a flare token id type
type TokenID int

const (
	UnknownToken TokenID = iota
	ETH
	BTC
)

// TokenIDWSNames are the names for WS service
var TokenIDWSNames = [...]string{
	UnknownToken: "UnknownToken",
	ETH:          "ETH",
	BTC:          "BTC",
}

// TokenIDSymbol are the names for smart-contract. Filled on init depends on the chain ID
var TokenIDSymbol = [...]string{
	UnknownToken: "UnknownToken",
	ETH:          "ETH",
	BTC:          "BTC",
}

var TokenIDIndices = []*big.Int{
	UnknownToken: big.NewInt(-1),
	ETH:          big.NewInt(-1),
	BTC:          big.NewInt(-1),
}

// FillTokenIDAndNames is used to fill the TokenIDIndices with on-chain values and names depend on the chain id
func FillTokenIDAndNames(data *IndicesAndSymbols, isTestNet bool) {
	if isTestNet {
		TokenIDSymbol[ETH] = "testETH"
		TokenIDSymbol[BTC] = "testBTC"
	}

	for i, s := range data.Symbols {
		id := GetTokenIDFromSymbol(s)
		if id != UnknownToken {
			TokenIDIndices[id] = data.Indices[i]
		}
	}
}

// GetTokenIDFromName is used to parse string to the TokenID from given WS name
func GetTokenIDFromName(s string) TokenID {
	switch s {
	case ETH.Name():
		return ETH
	case BTC.Name():
		return BTC
	default:
		return UnknownToken
	}
}

// GetTokenIDFromSymbol is used to parse string to the TokenID from given smart-contract symbol
func GetTokenIDFromSymbol(s string) TokenID {
	switch s {
	case ETH.Symbol():
		return ETH
	case BTC.Symbol():
		return BTC
	default:
		return UnknownToken
	}
}

// Name is used to get TokenID string value for the WS service
func (i TokenID) Name() string {
	return TokenIDWSNames[i]
}

// Symbol is used to get TokenID string value for the smart-contract
func (i TokenID) Symbol() string {
	return TokenIDSymbol[i]
}

// Index is used to get TokenID flare index
func (i TokenID) Index() *big.Int {
	return TokenIDIndices[i]
}
