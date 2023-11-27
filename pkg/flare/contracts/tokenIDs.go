package contracts

import "math/big"

// TokenID is a flare token id type
type TokenID int

const (
	UnknownToken TokenID = iota
	ETH
)

var TokenIDStrings = [...]string{
	UnknownToken: "UnknownToken",
	ETH:          "ETH",
}

var TokenIDIndices = []*big.Int{
	UnknownToken: big.NewInt(-1),
	ETH:          big.NewInt(-1),
}

// FillTokenIDs is used to fill the TokenIDIndices with on-chain values
func FillTokenIDs(data *IndicesAndSymbols) {
	for i, s := range data.Symbols {
		id := GetTokenIDFromString(s)
		if id != UnknownToken {
			TokenIDIndices[id] = data.Indices[i]
		}
	}
}

// GetTokenIDFromString is used to parse string to the TokenID
func GetTokenIDFromString(s string) TokenID {
	switch s {
	case "ETH":
		return ETH
	default:
		return UnknownToken
	}
}

// Symbol is used to get TokenID string value
func (i TokenID) Symbol() string {
	return TokenIDStrings[i]
}

// Index is used to get TokenID flare index
func (i TokenID) Index() *big.Int {
	return TokenIDIndices[i]
}
