package main

import (
	"oracle-flare/cmd/whitelist"
	"os"

	"github.com/misnaged/annales/logger"

	"oracle-flare/cmd/root"
	"oracle-flare/cmd/serve"
	"oracle-flare/internal"
)

// main is the entry point of the application
// It creates an instance of the internal application and adds
// the "serve" command to the root command. Then it executes
// the root command. If any error occurs, it logs the error and
// exits the application with status code 1.
func main() {
	app, err := internal.NewApplication()
	if err != nil {
		logger.Log().Infof("An error occurred: %s", err.Error())
		os.Exit(1)
	}

	rootCmd := root.Cmd(app)
	rootCmd.AddCommand(serve.Cmd(app))
	wlCMD := whitelist.Cmd(app)

	wlCMD.Flags().String("address", "", "wallet address for whitelist")
	wlCMD.Flags().String("token", "", "token symbol for whitelist")
	rootCmd.AddCommand(wlCMD)

	if err := rootCmd.Execute(); err != nil {
		logger.Log().Infof("An error occurred: %s", err.Error())
		os.Exit(1)
	}
}
