package service

import (
	"fmt"
	"math/big"
	"time"

	"oracle-flare/pkg/flare/contracts"
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

			sleep, _ := time.ParseDuration(fmt.Sprintf("%vs", epoch.RevealEndTimestamp.Uint64()-epoch.CurrentTimestamp.Uint64()-60))
			random := s.getRandom()

			if err := s.flare.CommitPrices(epoch.EpochID, s.tokens, s.parsePrices(), random); err != nil {
				continue
			}

			timer := time.NewTimer(sleep)
			logInfo(fmt.Sprintf("time for reverl: %v", sleep), "Sender")
			go s.reveal(timer, epoch.EpochID, s.tokens, s.parsePrices(), random)
		}
	}
}

// reveal will wait the sleep time and then call the reveal smart-contract method
func (s *coinAVGPriceSender) reveal(timer *time.Timer, epochID *big.Int, indices []contracts.TokenID, prices []*big.Int, random *big.Int) {
	logInfo(fmt.Sprintf("received for reveal: epochID %v, indices %v, prices %v, random %v", epochID, indices, prices, random), "Sender")
	<-timer.C
	logInfo(fmt.Sprintf("revealing price for the %v epoch", epochID.Int64()), "Sender")
	if err := s.flare.RevealPrices(epochID, indices, prices, random); err != nil {
		logErr("err reveal", "Sender")
	}
}
