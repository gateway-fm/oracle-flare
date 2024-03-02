package service

import (
	"fmt"
	"math/big"
	"time"

	"oracle-flare/pkg/flare/contracts"
)

// runSender is used to run reveal-submit flow
func (s *coinAveragePriceSender) runSender() {
	epoch, err := s.flare.GetCurrentPriceEpochData()
	if err != nil {
		logErr(fmt.Sprintln("err get epoch:", err.Error()), "SendCoinAveragePrice")
	}

	dur := epoch.EndTimestamp.Uint64() - epoch.CurrentTimestamp.Uint64()
	logInfo(fmt.Sprintf(
		"epoch ID: %v, end epoch: %v, current timestamp: %v, %vs till end",
		epoch.EpochID,
		time.Unix(int64(epoch.EndTimestamp.Uint64()), 0),
		time.Unix(int64(epoch.CurrentTimestamp.Uint64()), 0),
		dur,
	), "runSender")

	if dur < 60 {
		wait, _ := time.ParseDuration(fmt.Sprintf("%vs", dur+90))
		logInfo(fmt.Sprintf("wait for %v seconds before start", wait), "SendCoinAveragePrice")
		time.Sleep(wait)
	}

	ticker := time.NewTicker(time.Minute * 3)
	logInfo("ticker set to 3 minutes", "SendCoinAveragePrice")

	go s.sendARGPrice(s.stopSender, ticker)
}

// sendARGPrice is used to send data to the flare smart contracts.
// Sending flow is based on Flare documentation. Price data is sent each 3 minutes and reveal is send in the reveal timing
// received from the flare smart-contract
func (s *coinAveragePriceSender) sendARGPrice(stop chan struct{}, ticker *time.Ticker) {
	logInfo("starting send loop...", "sendARGPrice")
	for {
		select {
		case <-stop:
			logInfo("stop...", "sendARGPrice")
			ticker.Stop()
			return
		case <-ticker.C:
			logInfo("ticker signal", "sendARGPrice")
			go s.send()
		}
	}
}

func (s *coinAveragePriceSender) send() {
	epoch, err := s.flare.GetCurrentPriceEpochData()
	if err != nil {
		logErr(fmt.Sprintln("err get epoch:", err.Error()), "send")
		return
	}

	logInfo(fmt.Sprintf(
		"epoch ID: %v, end epoch: %v, end reveal: %v, current timestamp: %v, %vs till end, %vs till reveal",
		epoch.EpochID,
		time.Unix(int64(epoch.EndTimestamp.Uint64()), 0),
		time.Unix(int64(epoch.RevealEndTimestamp.Uint64()), 0),
		time.Unix(int64(epoch.CurrentTimestamp.Uint64()), 0),
		epoch.EndTimestamp.Uint64()-epoch.CurrentTimestamp.Uint64(),
		epoch.RevealEndTimestamp.Uint64()-epoch.CurrentTimestamp.Uint64(),
	), "runSender")

	logInfo(fmt.Sprintf("calculate timer duration to %vs", epoch.RevealEndTimestamp.Uint64()-epoch.CurrentTimestamp.Uint64()-60), "send")
	sleep, _ := time.ParseDuration(fmt.Sprintf("%vs", epoch.RevealEndTimestamp.Uint64()-epoch.CurrentTimestamp.Uint64()-60))
	random := s.getRandom()

	prices := s.currentPrices()

	if err := s.flare.CommitPrices(epoch.EpochID, s.tokens, prices, random); err != nil {
		return
	}

	timer := time.NewTimer(sleep)

	go s.reveal(timer, epoch.EpochID, s.tokens, prices, random)
}

// reveal will wait the sleep time and then call the reveal smart-contract method
func (s *coinAveragePriceSender) reveal(timer *time.Timer, epochID *big.Int, indices []contracts.TokenID, prices []*big.Int, random *big.Int) {
	logInfo(fmt.Sprintf("received for reveal: epochID %v, indices %v, prices %v, random %v", epochID, indices, prices, random), "reveal")
	<-timer.C
	logInfo(fmt.Sprintf("revealing price for the %v epoch", epochID.Int64()), "reveal")
	if err := s.flare.RevealPrices(epochID, indices, prices, random); err != nil {
		logErr("err reveal", "reveal")
	}
}
