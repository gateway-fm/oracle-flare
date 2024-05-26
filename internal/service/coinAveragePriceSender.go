package service

import (
	"crypto/rand"
	"fmt"
	"math/big"
	"time"

	"golang.org/x/sync/syncmap"

	"oracle-flare/pkg/flare"
	"oracle-flare/pkg/flare/contracts"
	"oracle-flare/pkg/wsClient"
)

// SendCoinAveragePrice is used to subscribe on the avg price and send results to the flare smart contracts
func (s *service) SendCoinAveragePrice(tokens []string) {
	parsedTokens := []contracts.TokenID{}

	for _, t := range tokens {
		parsedToken := contracts.GetTokenIDFromName(t)
		if parsedToken == contracts.UnknownToken {
			logWarn(fmt.Sprintln("received unknown token:", t), "SendCoinAveragePrice")
		} else {
			parsedTokens = append(parsedTokens, parsedToken)
		}
	}

	if len(parsedTokens) == 0 {
		logErr("all tokens are invalid", "SendCoinAveragePrice")
		return
	}

	sender := newCoinAvgPriceSender(len(s.avgPriceSenders), s.flare, s.wsClient, parsedTokens)
	s.avgPriceSenders = append(s.avgPriceSenders, sender)

	go sender.runWriter()

	sender.ticker = time.NewTicker(time.Minute * 3)
	logInfo("set ticker for sender to 3m", "SendCoinAveragePrice")
	go sender.runSender()
}

// coinAVGPriceSender is a struct of the coin average prices sender
type coinAVGPriceSender struct {
	// id is a WS id
	id int

	flare    flare.IFlare
	wsClient wsClient.IWSClient

	stream      chan *wsClient.CoinAveragePriceStream
	stopWriter  chan struct{}
	stopSender  chan struct{}
	resubscribe chan struct{}

	ticker *time.Ticker

	// tokens are the tokens for each submit-reveal flow
	tokens []contracts.TokenID
	// prices are the prices for next submit-reveal flow
	prices *syncmap.Map
}

// newCoinAvgPriceSender is used to get new coinAVGPriceSender instance
func newCoinAvgPriceSender(id int, flare flare.IFlare, ws wsClient.IWSClient, tokens []contracts.TokenID) *coinAVGPriceSender {
	return &coinAVGPriceSender{
		id:          id,
		flare:       flare,
		wsClient:    ws,
		stream:      make(chan *wsClient.CoinAveragePriceStream),
		stopWriter:  make(chan struct{}),
		stopSender:  make(chan struct{}),
		resubscribe: make(chan struct{}),
		tokens:      tokens,
		prices:      &syncmap.Map{},
	}
}

// parsePrices is used to get big int prices from the prices map
func (s *coinAVGPriceSender) parsePrices() (prices []*big.Int) {
	for _, t := range s.tokens {
		p := big.NewInt(0)
		pp, ok := s.prices.Load(t)
		if ok {
			pb, ok := pp.(*big.Int)
			if ok {
				p = pb
			}
		}
		prices = append(prices, p)
	}

	return prices
}

// getRandom is used to update random arg and return it
func (s *coinAVGPriceSender) getRandom() *big.Int {
	random, err := rand.Prime(rand.Reader, 130)
	if err != nil {
		return s.getRandom()
	}

	return random
}

// tokenNames is used to get token names string from the tokens struct
func (s *coinAVGPriceSender) tokenNames() []string {
	tokenNames := []string{}

	for _, t := range s.tokens {
		tokenNames = append(tokenNames, t.Name())
	}

	return tokenNames
}

// close is used to close coin average price sender
func (s *coinAVGPriceSender) close() {
	close(s.stopWriter)
	close(s.stopSender)
}
