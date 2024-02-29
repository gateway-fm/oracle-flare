package service

import (
	"crypto/rand"
	"math/big"
	"sync"

	"oracle-flare/pkg/flare"
	"oracle-flare/pkg/flare/contracts"
	"oracle-flare/pkg/wsClient"
)

// coinAveragePriceSender is a struct of the coin average prices sender
type coinAveragePriceSender struct {
	// id is a WS id
	id int

	flare    flare.IFlare
	wsClient wsClient.IWSClient

	stopWriter  chan struct{}
	stopSender  chan struct{}
	stream      chan *wsClient.CoinAveragePriceStream
	resubscribe chan struct{}

	// tokens are the tokens for each submit-reveal flow
	tokens []contracts.TokenID
	// prices are the prices for next submit-reveal flow
	prices sync.Map
}

// newCoinAveragePriceSender is used to get new coinAveragePriceSender instance
func newCoinAveragePriceSender(
	id int,
	flare flare.IFlare,
	ws wsClient.IWSClient,
	tokens []contracts.TokenID,
) *coinAveragePriceSender {
	return &coinAveragePriceSender{
		id:          id,
		flare:       flare,
		wsClient:    ws,
		stopWriter:  make(chan struct{}),
		stopSender:  make(chan struct{}),
		stream:      make(chan *wsClient.CoinAveragePriceStream),
		resubscribe: make(chan struct{}),
		tokens:      tokens,
		prices:      sync.Map{},
	}
}

// tokenNames is used to get token names string from the tokens struct
func (s *coinAveragePriceSender) tokenNames() []string {
	tokenNames := []string{}

	for _, t := range s.tokens {
		tokenNames = append(tokenNames, t.Name())
	}

	return tokenNames
}

func (s *coinAveragePriceSender) currentPrices() []*big.Int {
	prices := []*big.Int{}

	for _, t := range s.tokens {
		price := big.NewInt(0)

		p, ok := s.prices.Load(t)
		if ok {
			pb, ok := p.(*big.Int)
			if ok {
				price = pb
			}
		}

		prices = append(prices, price)
	}

	return prices
}

// getRandom is used to update random arg and return it
func (s *coinAveragePriceSender) getRandom() *big.Int {
	random, err := rand.Prime(rand.Reader, 130)
	if err != nil {
		return s.getRandom()
	}

	return random
}

// close is used to close coin average price writer
func (s *coinAveragePriceSender) close() {
	close(s.stopSender)
	close(s.stopWriter)
}
