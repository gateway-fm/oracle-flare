package service

import (
	"fmt"
	"math/big"
	"time"

	"oracle-flare/pkg/flare/contracts"
	"oracle-flare/pkg/wsClient"
)

// run is used to run reveal-submit flow
func (s *coinAVGPriceSender) runWriter() {
	logInfo("start", "Writer")
	go s.listenAndSendARGPrice(s.tokenNames(), s.id, 90000, s.stream, s.stopWriter)

	if err := s.subscribeCoinAveragePrice(s.tokenNames(), s.id, 90000, s.stream); err != nil {
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
func (s *coinAVGPriceSender) listenAndSendARGPrice(tokens []string, id int, freq int, stream chan *wsClient.CoinAveragePriceStream, stopWriter chan struct{}) {
	for {
		select {
		case <-stopWriter:
			logInfo("stop...", "Writer")
			return
		case <-s.resubscribe:
			if err := s.subscribeCoinAveragePrice(tokens, id, freq, stream); err != nil {
				logErr(fmt.Sprintln("err resubscribe:", err.Error()), "Writer")
				return
			}
		case data := <-stream:
			logInfo(fmt.Sprintf("received data on the %s coin", data.Coin), "Writer")

			tokenID := contracts.GetTokenIDFromName(data.Coin)
			if tokenID == contracts.UnknownToken && tokenID.Index().Int64() < 0 {
				logErr("received unknown tokenID", "Writer")
				continue
			}

			price := big.NewFloat(data.Value)
			price = price.Mul(price, big.NewFloat(100000))
			integer, _ := price.Int64()

			s.prices.Store(tokenID, big.NewInt(integer))
		}
	}
}
