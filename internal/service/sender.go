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
	logDebug(fmt.Sprintf("end epoch in %v seconds", dur), "SendCoinAveragePrice")

	go s.sendARGPrice(s.stopSender)
}

// sendARGPrice is used to send data to the flare smart contracts.
// Sending flow is based on Flare documentation. Price data is sent each 3 minutes and reveal is send in the reveal timing
// received from the flare smart-contract
func (s *coinAveragePriceSender) sendARGPrice(stop chan struct{}) {
	for {
		select {
		case <-stop:
			logInfo("stop...", "sendARGPrice")
			return
		default:
			go s.send()
			time.Sleep(time.Minute * 3)
		}
	}
}

func (s *coinAveragePriceSender) send() {
	logInfo("sending prices...", "send")
	epoch, err := s.flare.GetCurrentPriceEpochData()
	if err != nil {
		logErr(fmt.Sprintln("err get epoch:", err.Error()), "send")
		time.Sleep(time.Second * 1)
		return
	}

	sleep, _ := time.ParseDuration(fmt.Sprintf("%vs", epoch.RevealEndTimestamp.Uint64()-epoch.CurrentTimestamp.Uint64()-60))
	random := s.getRandom()

	prices := s.currentPrices()

	logTrace(fmt.Sprintf("commiting prices"), "send")
	if err := s.flare.CommitPrices(epoch.EpochID, s.tokens, prices, random); err != nil {
		time.Sleep(time.Second * 1)
		return
	}

	go s.reveal(sleep, epoch.EpochID, s.tokens, prices, random)
}

// reveal will wait the sleep time and then call the reveal smart-contract method
func (s *coinAveragePriceSender) reveal(sleep time.Duration, epochID *big.Int, indices []contracts.TokenID, prices []*big.Int, random *big.Int) {
	logDebug(fmt.Sprintf("received for reveal: epochID %v, indices %v, prices %v, random %v", epochID, indices, prices, random), "reveal")
	logDebug(fmt.Sprintln("sleep for:", sleep), "reveal")
	time.Sleep(sleep)
	logTrace(fmt.Sprintf("revealing price for the %v epoch", epochID.Int64()), "reveal")
	if err := s.flare.RevealPrices(epochID, indices, prices, random); err != nil {
		logErr("err reveal", "reveal")
	}
}
