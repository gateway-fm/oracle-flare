package config

import (
	"github.com/spf13/viper"
)

// init initialize default config params
func init() {
	// environment - could be "local", "prod", "dev"
	viper.SetDefault("env", "prod")

	// WS configurations
	viper.SetDefault("ws.url", "wss://oracle.gateway.fm")

	viper.SetDefault("flare.chainid", 114)
	// 14 - flare chain mainnet
	// 114 - coston2 chain testnet
	// 19 - songbird chain net

	viper.SetDefault("flare.rpcurl", "https://flare-coston2.eu-north-2.gateway.fm/ext/bc/C/rpc")

	// Registry contract is a one address for every chain ID
	viper.SetDefault("flare.registrycontractaddress", "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019")

	// It is a wallet private key. Shall never be hardcoded
	viper.SetDefault("flare.signerpk", "")
}
