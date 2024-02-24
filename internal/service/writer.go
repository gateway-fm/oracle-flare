package service

import (
	"fmt"
	"math/big"
	"time"

	"oracle-flare/pkg/flare/contracts"
	"oracle-flare/pkg/wsClient"
)

// runWriter is used to run the writer flow
func (s *coinAveragePriceSender) runWriter() {
	go s.listenAndWrite(s.tokenNames(), s.id, 90000, s.stream, s.stopWriter)

	if err := s.subscribeCoinAveragePrice(s.tokenNames(), s.id, 90000, s.stream); err != nil {
		s.close()
	}
}

// listenAndWrite is used to listen to the CoinAveragePriceStream chanel and write it to the coinAveragePriceSender struct
func (s *coinAveragePriceSender) listenAndWrite(tokens []string, id int, freq int, stream chan *wsClient.CoinAveragePriceStream, stop chan struct{}) {
	for {
		select {
		case <-stop:
			logTrace("stop...", "listenAndWrite")
			return
		case <-s.resubscribe:
			logTrace("resubscribing...", "listenAndWrite")
			if err := s.subscribeCoinAveragePrice(tokens, id, freq, stream); err != nil {
				logErr(fmt.Sprintln("err resubscribe:", err.Error()), "listenAndWrite")
				return
			}
		case data := <-stream:
			logTrace(fmt.Sprintf("received data on the %s coin", data.Coin), "listenAndWrite")

			tokenID := contracts.GetTokenIDFromName(data.Coin)
			if tokenID == contracts.UnknownToken && tokenID.Index().Int64() < 0 {
				logErr("received unknown token tokenID", "listenAndWrite")
				continue
			}

			price := big.NewFloat(data.Value)
			price = price.Mul(price, big.NewFloat(100000))
			integer, _ := price.Int64()

			s.mu.Lock()
			s.prices[tokenID] = big.NewInt(integer)
			s.mu.Unlock()
		}
	}
}

// subscribeCoinAveragePrice is used to send subscribe message to the ws server
func (s *coinAveragePriceSender) subscribeCoinAveragePrice(tokens []string, id int, freq int, stream chan *wsClient.CoinAveragePriceStream) error {
	if err := s.wsClient.SubscribeCoinAveragePrice(tokens, id, freq, stream); err != nil {
		time.Sleep(time.Second * 5)
		return s.subscribeCoinAveragePrice(tokens, id, freq, stream)
	}

	return nil
}
