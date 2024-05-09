package service

import (
	"fmt"
	"math/big"
	"oracle-flare/pkg/flare/contracts"
	"time"
)

func (s *coinAVGPriceSender) runSender() {
	for {
		select {
		case <-s.stopSender:
			logInfo("stop...", "Sender")
			return
		case <-s.ticker.C:
			logInfo(fmt.Sprintf("commiting price"), "Sender")

			epoch, err := s.flare.GetCurrentPriceEpochData()
			if err != nil {
				logErr(fmt.Sprintln("err get epoch:", err.Error()), "Sender")
				continue
			}

			logInfo(fmt.Sprintf("epochID: %v current: %v reveal end: %v", epoch.EpochID, epoch.CurrentTimestamp, epoch.RevealEndTimestamp), "Sender")

			//sleep, _ := time.ParseDuration(fmt.Sprintf("%vs", epoch.RevealEndTimestamp.Uint64()-epoch.CurrentTimestamp.Uint64()-60))
			random := s.getRandom()

			if err := s.flare.CommitPrices(epoch.EpochID, s.tokens, s.parsePrices(), random); err != nil {
				continue
			}

			//timer := time.NewTimer(sleep)
			//logInfo(fmt.Sprintf("time for reverl: %v", sleep), "Sender")

			timer := time.NewTimer(time.Second * 300)
			ticker := time.NewTicker(time.Second * 30)
			go s.reveal(ticker, timer, epoch.EpochID, s.tokens, s.parsePrices(), random)
		}
	}
}

// reveal will wait the sleep time and then call the reveal smart-contract method
func (s *coinAVGPriceSender) reveal(ticker *time.Ticker, timer *time.Timer, epochID *big.Int, indices []contracts.TokenID, prices []*big.Int, random *big.Int) {
	for {
		select {
		case <-timer.C:
			ticker.Stop()
			logErr(fmt.Sprintf("epochID: %v never success", epochID), "Sender")
			return
		case <-ticker.C:
			if err := s.flare.RevealPrices(epochID, indices, prices, random); err == nil {
				ticker.Stop()
				timer.Stop()
				return
			}
		}
	}
}
