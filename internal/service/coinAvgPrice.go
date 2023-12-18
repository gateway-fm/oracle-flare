package service

import (
	"crypto/rand"
	"fmt"
	"math/big"
	"time"

	"oracle-flare/pkg/flare"
	"oracle-flare/pkg/flare/contracts"
	"oracle-flare/pkg/wsClient"
)

// SendCoinAveragePrice is used to subscribe on the avg price and send results to the flare smart contracts
func (s *service) SendCoinAveragePrice(tokens []string) {
	parsedTokens := []contracts.TokenID{}

	for _, t := range tokens {
		parsedTokens = append(parsedTokens, contracts.GetTokenIDFromName(t))
	}

	sender := newCoinAvgPriceSender(len(s.avgPriceSenders), s.flare, s.wsClient, parsedTokens)
	s.avgPriceSenders = append(s.avgPriceSenders, sender)

	sender.run()
}

// coinAVGPriceSender is a struct of the coin average prices sender
type coinAVGPriceSender struct {
	// id is a WS id
	id int

	flare    flare.IFlare
	wsClient wsClient.IWSClient

	stream      chan *wsClient.CoinAveragePriceStream
	stop        chan struct{}
	resubscribe chan struct{}

	// tokens are the tokens for each submit-reveal flow
	tokens []contracts.TokenID
	// prices are the prices for next submit-reveal flow
	prices map[contracts.TokenID]*big.Int
}

// newCoinAvgPriceSender is used to get new coinAVGPriceSender instance
func newCoinAvgPriceSender(id int, flare flare.IFlare, ws wsClient.IWSClient, tokens []contracts.TokenID) *coinAVGPriceSender {
	return &coinAVGPriceSender{
		id:          id,
		flare:       flare,
		wsClient:    ws,
		stream:      make(chan *wsClient.CoinAveragePriceStream),
		stop:        make(chan struct{}),
		resubscribe: make(chan struct{}),
		tokens:      tokens,
		prices:      make(map[contracts.TokenID]*big.Int),
	}
}

// run is used to run reveal-submit flow
func (s *coinAVGPriceSender) run() {
	epoch, err := s.flare.GetCurrentPriceEpochData()
	if err != nil {
		logErr(fmt.Sprintln("err get epoch:", err.Error()), "SendCoinAveragePrice")
	}

	dur := epoch.EndTimestamp.Uint64() - epoch.CurrentTimestamp.Uint64()
	logDebug(fmt.Sprintf("end epoch in %v seconds", dur), "SendCoinAveragePrice")

	go s.listenAndSendARGPrice(s.tokenNames(), s.id, 180000, s.stream, s.stop)

	if err := s.subscribeCoinAveragePrice(s.tokenNames(), s.id, 180000, s.stream); err != nil {
		s.close()
	}
}

// subscribeCoinAveragePrice is used to send subscribe message to the ws server
func (s *coinAVGPriceSender) subscribeCoinAveragePrice(tokens []string, id int, freq int, stream chan *wsClient.CoinAveragePriceStream) error {
	if err := s.wsClient.SubscribeCoinAveragePrice(tokens, id, freq, stream); err != nil {
		time.Sleep(time.Second * 5)
		return s.subscribeCoinAveragePrice(tokens, id, freq, stream)
	}

	return nil
}

// listenAndSendARGPrice is used to listen to the CoinAveragePriceStream chanel and send data to the flare smart contracts.
// Sending flow is based on Flare documentation. Price data is sent each 3 minutes and reveal is send in the reveal timing
// received from the flare smart-contract
func (s *coinAVGPriceSender) listenAndSendARGPrice(tokens []string, id int, freq int, stream chan *wsClient.CoinAveragePriceStream, stop chan struct{}) {
	for {
		select {
		case <-stop:
			return
		case <-s.resubscribe:
			if err := s.subscribeCoinAveragePrice(tokens, id, freq, stream); err != nil {
				logErr(fmt.Sprintln("err resubscribe:", err.Error()), "listenAndSendARGPrice")
				return
			}
		case data := <-stream:
			logTrace(fmt.Sprintf("received data on the %s coin", data.Coin), "listenAndSendARGPrice")

			id := contracts.GetTokenIDFromName(data.Coin)
			if id == contracts.UnknownToken && id.Index().Int64() < 0 {
				logErr("received unknown token id", "listenAndSendARGPrice")
				continue
			}

			price := big.NewInt(int64(data.Value))
			s.prices[id] = price

			if len(s.prices) != len(s.tokens) {
				logTrace(fmt.Sprint("wahiting for all coin prices..."), "listenAndSendARGPrice")
				continue
			}

			epoch, err := s.flare.GetCurrentPriceEpochData()
			if err != nil {
				logErr(fmt.Sprintln("err get epoch:", err.Error()), "listenAndSendARGPrice")
				s.resetPrices()
				continue
			}

			// sleep is calculated as the <reveal end timestamp> - <current block timestamp> - 2 seconds in ms
			sleep, _ := time.ParseDuration(fmt.Sprintf("%vs", epoch.RevealEndTimestamp.Uint64()-epoch.CurrentTimestamp.Uint64()-60))
			random := s.getRandom()

			logTrace(fmt.Sprintf("commiting price ont the %s coin", data.Coin), "listenAndSendARGPrice")
			if err := s.flare.CommitPrices(epoch.EpochID, s.tokens, s.parsePrices(), random); err != nil {
				s.resetPrices()
				continue
			}

			go s.reveal(sleep, epoch.EpochID, s.tokens, s.parsePrices(), random)
			s.resetPrices()
		}
	}
}

// reveal will wait the sleep time and then call the reveal smart-contract method
func (s *coinAVGPriceSender) reveal(sleep time.Duration, epochID *big.Int, indices []contracts.TokenID, prices []*big.Int, random *big.Int) {
	logDebug(fmt.Sprintln("sleep for:", sleep), "reveal")
	time.Sleep(sleep)
	logTrace(fmt.Sprintf("revealing price for the %v epoch", epochID.Int64()), "reveal")
	if err := s.flare.RevealPrices(epochID, indices, prices, random); err != nil {
		logErr("err reveal", "reveal")
	}
}

// resetPrices is used to reset prices after all token prices are collected in the submit-reveal flow
func (s *coinAVGPriceSender) resetPrices() {
	for _, t := range s.tokens {
		s.prices[t] = nil
	}
}

// parsePrices is used to get big int prices from the prices map
func (s *coinAVGPriceSender) parsePrices() (prices []*big.Int) {
	for _, t := range s.tokens {
		prices = append(prices, s.prices[t])
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
	close(s.stop)
}
