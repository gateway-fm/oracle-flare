package service

import (
	"fmt"
	"math/big"
	"oracle-flare/pkg/flare/contracts"
	"time"
)

type epochData struct {
	id     *big.Int
	random *big.Int
	tokens []contracts.TokenID
	prices []*big.Int
}

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

			epochID := epoch.EpochID
			random := s.getRandom()
			tokens := s.tokens
			prices := s.parsePrices()

			logInfo(fmt.Sprintf("epochID: %v current: %v reveal end: %v", epochID, epoch.CurrentTimestamp, epoch.RevealEndTimestamp), "Sender")

			sleepS := epoch.EndTimestamp.Uint64() - epoch.CurrentTimestamp.Uint64()
			sleepS += 30
			sleep, _ := time.ParseDuration(fmt.Sprintf("%vs", sleepS))

			timer := time.NewTimer(sleep)
			logInfo(fmt.Sprintf("time for reverl: %v", sleep), "Sender")
			go s.reveal(timer, epochID, tokens, prices, random)

			if err := s.flare.CommitPrices(epochID, tokens, prices, random); err != nil {
				continue
			}
		}
	}
}

// reveal will wait the sleep time and then call the reveal smart-contract method
func (s *coinAVGPriceSender) reveal(timer *time.Timer, epochID *big.Int, indices []contracts.TokenID, prices []*big.Int, random *big.Int) {
	logInfo(fmt.Sprintf("received for reveal: epochID %v, indices %v, prices %v, random %v", epochID, indices, prices, random), "Sender")
	<-timer.C
	logInfo(fmt.Sprintf("revealing price for the epochID: %v", epochID.Int64()), "Sender")
	if err := s.revealRetries(epochID, indices, prices, random, 0); err != nil {
		logErr("err reveal", "Sender")
	}
}

func (s *coinAVGPriceSender) revealRetries(epochID *big.Int, indices []contracts.TokenID, prices []*big.Int, random *big.Int, attempts int) error {
	if err := s.flare.RevealPrices(epochID, indices, prices, random); err != nil {
		if attempts == 10 {
			return err
		}

		sleep, _ := time.ParseDuration(fmt.Sprintf("%vms", attempts*500))

		logWarn(fmt.Sprintf("err reveal: epochID %v, attempt %v, retry in %v: %s", epochID, attempts, sleep, err.Error()), "Sender")

		time.Sleep(sleep)
		attempts++
		return s.revealRetries(epochID, indices, prices, random, attempts)
	}

	return nil
}
