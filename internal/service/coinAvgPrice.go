package service

import (
	"fmt"
	"math/big"
	"time"

	"oracle-flare/pkg/flare/contracts"
	"oracle-flare/pkg/wsClient"
)

// SendCoinAveragePrice is used to subscribe on the avg price and send results to the flare smart contracts
func (s *service) SendCoinAveragePrice(token contracts.TokenID) {
	stream := make(chan *wsClient.CoinAveragePriceStream)
	id := s.getNextID()
	stop := make(chan struct{})
	s.stopChans[id] = stop

	epoch, err := s.flare.GetCurrentPriceEpochData()
	if err != nil {
		logErr(fmt.Sprintln("err get epoch:", err.Error()), "listenAndSendARGPrice")
	}

	dur := epoch.EndTimestamp.Uint64() - epoch.CurrentTimestamp.Uint64()
	logDebug(fmt.Sprintf("end epoch in %v seconds", dur), "SendCoinAveragePrice")

	go s.listenAndSendARGPrice([]string{token.Name()}, id, 5000, stream, stop)

	// price symbols should be set here. Check if symbols are supported in the pkg-flare-contracts-tokenIDs 180 000
	if err := s.subscribeCoinAveragePrice([]string{token.Name()}, id, 5000, stream); err != nil {
		close(stop)
	}
}

// subscribeCoinAveragePrice is used to send subscribe message to the ws server
func (s *service) subscribeCoinAveragePrice(tokens []string, id int, freq int, stream chan *wsClient.CoinAveragePriceStream) error {
	if err := s.wsClient.SubscribeCoinAveragePrice(tokens, id, freq, stream); err != nil {
		time.Sleep(time.Second * 5)
		return s.subscribeCoinAveragePrice(tokens, id, freq, stream)
	}

	return nil
}

// TODO: refactor flow for several token IDs. Contract method should be called once for each epoch

// listenAndSendARGPrice is used to listen to the CoinAveragePriceStream chanel and send data to the flare smart contracts.
// Sending flow is based on Flare documentation. Price data is sent each 3 minutes and reveal is send in the reveal timing
// received from the flare smart-contract
func (s *service) listenAndSendARGPrice(tokens []string, id int, freq int, stream chan *wsClient.CoinAveragePriceStream, stop chan struct{}) {
	for {
		select {
		case <-s.stopAll:
			return
		case <-stop:
			return
		case <-s.resubscribe:
			if err := s.subscribeCoinAveragePrice(tokens, id, freq, stream); err != nil {
				logErr(fmt.Sprintln("err resubscribe:", err.Error()), "listenAndSendARGPrice")
				return
			}
		case data := <-stream:
			logTrace(fmt.Sprintf("received data on the %s coin", data.Coin), "listenAndSendARGPrice")
			epoch, err := s.flare.GetCurrentPriceEpochData()
			if err != nil {
				logErr(fmt.Sprintln("err get epoch:", err.Error()), "listenAndSendARGPrice")
			}

			// sleep is calculated as the <reveal end timestamp> - <current block timestamp> - 2 seconds in ms
			sleep, _ := time.ParseDuration(fmt.Sprintf("%vs", epoch.RevealEndTimestamp.Uint64()-epoch.CurrentTimestamp.Uint64()-60))
			price := big.NewInt(int64(data.Value * 1000))
			random := s.getRandom()

			id := contracts.GetTokenIDFromName(data.Coin)
			if id == contracts.UnknownToken && id.Index().Int64() < 0 {
				logErr("received unknown token id", "listenAndSendARGPrice")
				continue
			}

			logTrace(fmt.Sprintf("commiting price ont the %s coin", data.Coin), "listenAndSendARGPrice")
			if err := s.flare.CommitPrices(epoch.EpochID, []contracts.TokenID{id}, []*big.Int{price}, random); err != nil {
				continue
			}

			go s.reveal(sleep, epoch.EpochID, []contracts.TokenID{id}, []*big.Int{price}, random)
		}
	}
}

// reveal will wait the sleep time and then call the reveal smart-contract method
func (s *service) reveal(sleep time.Duration, epochID *big.Int, indices []contracts.TokenID, prices []*big.Int, random *big.Int) {
	logDebug(fmt.Sprintln("sleep for:", sleep), "reveal")
	time.Sleep(sleep)
	logTrace(fmt.Sprintf("revealing price for the %v epoch", epochID.Int64()), "reveal")
	if err := s.flare.RevealPrices(epochID, indices, prices, random); err != nil {
		logErr("err reveal", "reveal")
	}
}
