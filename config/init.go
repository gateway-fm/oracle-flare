package config

import (
	"github.com/spf13/viper"
)

// init initialize default config params
func init() {
	// environment - could be "local", "prod", "dev"
	viper.SetDefault("env", "prod")

	viper.SetDefault("ws.url", "wss://oracle.gateway.fm")
}
