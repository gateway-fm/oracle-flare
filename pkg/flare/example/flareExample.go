package main

import (
	"log"
	"oracle-flare/config"
	"oracle-flare/pkg/flare"
)

func main() {
	f := flare.NewFlare(&config.Flare{
		RegistryContractAddress: "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019",
		RpcURL:                  "https://flare-coston2.eu-north-2.gateway.fm/",
		ChainID:                 114,
	})

	epochData, err := f.GetCurrentPriceEpochData()
	if err != nil {
		log.Fatal(err)
	}

	log.Printf(
		"start timestamp: %s end timestamp: %s reveal timestamp: %s",
		epochData.StartTimestamp, epochData.EndTimestamp, epochData.RevealEndTimestamp,
	)

	f.Close()
}
