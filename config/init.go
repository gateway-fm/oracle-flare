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

	// Set songbird testnet data
	viper.SetDefault("flare.chainid", 19)
	viper.SetDefault("flare.rpcurl", "https://songbird-api.flare.network/ext/C/rpc")
	// Registry contract is a one address for every chain ID
	viper.SetDefault("flare.registrycontractaddress", "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019")
}
