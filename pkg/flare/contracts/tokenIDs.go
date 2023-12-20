package contracts

import (
	"math/big"
)

// TokenID is a flare token id type
type TokenID int

// $ADA, $ALGO, $ARB, $AVAX, $BNB, $BTC, $DOGE, $ETH, $FIL, $FLR, $LTC, $MATIC, $SOL, $USDC, $USDT, $XDC, $XLM, $XRP.
const (
	UnknownToken TokenID = iota
	ADA
	ALGO
	ARB
	AVAX
	BNB
	BTC
	DOGE
	ETH
	FIL
	FLR
	LTC
	MATIC
	SOL
	USDC
	USDT
	XDC
	XLM
	XRP
)

// TokenIDWSNames are the names for WS service
var TokenIDWSNames = [...]string{
	UnknownToken: "UnknownToken",
	ADA:          "ADA",
	ALGO:         "ALGO",
	ARB:          "ARB",
	AVAX:         "AVAX",
	BNB:          "BNB",
	BTC:          "BTC",
	DOGE:         "DOGE",
	ETH:          "ETH",
	FIL:          "FIL",
	FLR:          "FLR",
	LTC:          "LTC",
	MATIC:        "MATIC",
	SOL:          "SOL",
	USDC:         "USDC",
	USDT:         "USDT",
	XDC:          "XDC",
	XLM:          "XLM",
	XRP:          "XRP",
}

// TokenIDSymbol are the names for smart-contract. Filled on init depends on the chain ID
var TokenIDSymbol = [...]string{
	UnknownToken: "UnknownToken",
	ADA:          "ADA",
	ALGO:         "ALGO",
	ARB:          "ARB",
	AVAX:         "AVAX",
	BNB:          "BNB",
	BTC:          "BTC",
	DOGE:         "DOGE",
	ETH:          "ETH",
	FIL:          "FIL",
	FLR:          "FLR",
	LTC:          "LTC",
	MATIC:        "MATIC",
	SOL:          "SOL",
	USDC:         "USDC",
	USDT:         "USDT",
	XDC:          "XDC",
	XLM:          "XLM",
	XRP:          "XRP",
}

var TokenIDIndices = []*big.Int{
	UnknownToken: big.NewInt(-1),
	ADA:          big.NewInt(-1),
	ALGO:         big.NewInt(-1),
	ARB:          big.NewInt(-1),
	AVAX:         big.NewInt(-1),
	BNB:          big.NewInt(-1),
	BTC:          big.NewInt(-1),
	DOGE:         big.NewInt(-1),
	ETH:          big.NewInt(-1),
	FIL:          big.NewInt(-1),
	FLR:          big.NewInt(-1),
	LTC:          big.NewInt(-1),
	MATIC:        big.NewInt(-1),
	SOL:          big.NewInt(-1),
	USDC:         big.NewInt(-1),
	USDT:         big.NewInt(-1),
	XDC:          big.NewInt(-1),
	XLM:          big.NewInt(-1),
	XRP:          big.NewInt(-1),
}

// FillTokenIDAndNames is used to fill the TokenIDIndices with on-chain values and names depend on the chain id
func FillTokenIDAndNames(data *IndicesAndSymbols, isTestNet bool) {
	if isTestNet {
		TokenIDSymbol[ADA] = "testADA"
		TokenIDSymbol[ALGO] = "testALGO"
		TokenIDSymbol[ARB] = "testARB"
		TokenIDSymbol[AVAX] = "testAVAX"
		TokenIDSymbol[BNB] = "testBNB"
		TokenIDSymbol[BTC] = "testBTC"
		TokenIDSymbol[DOGE] = "testDOGE"
		TokenIDSymbol[ETH] = "testETH"
		TokenIDSymbol[FIL] = "testFIL"
		TokenIDSymbol[FLR] = "testFLR"
		TokenIDSymbol[LTC] = "testLTC"
		TokenIDSymbol[MATIC] = "testMATIC"
		TokenIDSymbol[SOL] = "testSOL"
		TokenIDSymbol[USDC] = "testUSDC"
		TokenIDSymbol[USDT] = "testUSDT"
		TokenIDSymbol[XDC] = "testXDC"
		TokenIDSymbol[XLM] = "testXLM"
		TokenIDSymbol[XRP] = "testXRP"
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
	case ADA.Name():
		return ADA
	case ALGO.Name():
		return ALGO
	case ARB.Name():
		return ARB
	case AVAX.Name():
		return AVAX
	case BNB.Name():
		return BNB
	case BTC.Name():
		return BTC
	case DOGE.Name():
		return DOGE
	case ETH.Name():
		return ETH
	case FIL.Name():
		return FIL
	case FLR.Name():
		return FLR
	case LTC.Name():
		return LTC
	case MATIC.Name():
		return MATIC
	case SOL.Name():
		return SOL
	case USDC.Name():
		return USDC
	case USDT.Name():
		return USDT
	case XDC.Name():
		return XDC
	case XLM.Name():
		return XLM
	case XRP.Name():
		return XRP
	default:
		return UnknownToken
	}
}

// GetTokenIDFromSymbol is used to parse string to the TokenID from given smart-contract symbol
func GetTokenIDFromSymbol(s string) TokenID {
	switch s {
	case ADA.Symbol():
		return ADA
	case ALGO.Symbol():
		return ALGO
	case ARB.Symbol():
		return ARB
	case AVAX.Symbol():
		return AVAX
	case BNB.Symbol():
		return BNB
	case BTC.Symbol():
		return BTC
	case DOGE.Symbol():
		return DOGE
	case ETH.Symbol():
		return ETH
	case FIL.Symbol():
		return FIL
	case FLR.Symbol():
		return FLR
	case LTC.Symbol():
		return LTC
	case MATIC.Symbol():
		return MATIC
	case SOL.Symbol():
		return SOL
	case USDC.Symbol():
		return USDC
	case USDT.Symbol():
		return USDT
	case XDC.Symbol():
		return XDC
	case XLM.Symbol():
		return XLM
	case XRP.Symbol():
		return XRP
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
