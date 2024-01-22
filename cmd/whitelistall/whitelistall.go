package whitelistall

import (
	"fmt"

	"github.com/spf13/cobra"

	"oracle-flare/internal"
	"oracle-flare/pkg/logger"
)

// Cmd returns the "whitelist" command of the application.
// This command is responsible for initializing and adding given address for given token to the smart-contract whitelist
func Cmd(app *internal.App) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "whitelistall",
		Short: "Whitelist address for all tokens in the config file",
		RunE: func(cmd *cobra.Command, args []string) error {
			address, err := cmd.Flags().GetString("address")
			if err != nil {
				return fmt.Errorf("err get address flag: %w", err)
			}

			if err := app.InitForWhiteList(); err != nil {
				return fmt.Errorf("application initialisation: %w", err)
			}

			return app.WhiteListAddressAll(address)
		},
		PreRun: func(cmd *cobra.Command, args []string) {
			logger.Log().Info(app.Version())
		},
	}

	cmd.Flags().String("address", "", "wallet address for whitelist")

	return cmd
}
