package internal

import (
	"fmt"
	"os"
	"os/signal"
	"syscall"

	version "github.com/misnaged/annales/versioner"

	"oracle-flare/config"
	"oracle-flare/internal/service"
	"oracle-flare/pkg/flare"
	"oracle-flare/pkg/wsClient"
)

// App is main microservice application instance that
// have all necessary dependencies inside structure
type App struct {
	// application configuration
	config *config.Scheme

	ws      wsClient.IWSClient
	fl      flare.IFlare
	srv     service.IService
	version *version.Version
}

// NewApplication create new App instance
func NewApplication() (app *App, err error) {
	ver, err := version.NewVersion()
	if err != nil {
		return nil, fmt.Errorf("init app version: %w", err)
	}

	return &App{
		config:  &config.Scheme{},
		version: ver,
	}, nil
}

// Init initialize application and all necessary instances
func (app *App) Init() error {

	app.ws = wsClient.NewClient(app.config.WS)
	app.fl = flare.NewFlare(app.config.Flare)
	app.srv = service.NewService(app.ws, app.fl)

	return nil
}

// InitForWhiteList initialize application and all necessary instances for whitelist command
func (app *App) InitForWhiteList() error {
	app.fl = flare.NewFlare(app.config.Flare)
	app.srv = service.NewService(nil, app.fl)

	return nil
}

// WhiteListAddress is used to run for whitelist command
func (app *App) WhiteListAddress(address string, token string) error {
	_, err := app.srv.WhiteListAddress(address, []string{token})
	if err != nil {
		app.Stop()
		return err
	}

	app.Stop()
	return nil
}

// WhiteListAddressAll is used to run for whitelistall command
func (app *App) WhiteListAddressAll(address string) error {
	_, err := app.srv.WhiteListAddress(address, app.config.Tokens)
	if err != nil {
		app.Stop()
		return err
	}

	app.Stop()
	return nil
}

// Serve start serving Application service
func (app *App) Serve() error {
	go app.srv.SendCoinAveragePrice(app.config.Tokens)

	// Gracefully shutdown the server
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM, syscall.SIGQUIT)

	<-quit

	app.Stop()
	return nil
}

// Stop shutdown the application
func (app *App) Stop() {
	logInfo("app stop...", "Stop")
	if app.srv != nil {
		app.srv.Close()
	}

	if app.fl != nil {
		app.fl.Close()
	}

	if app.ws != nil {
		app.ws.Close()
	}
}

// Config return App config Scheme
func (app *App) Config() *config.Scheme {
	return app.config
}

// Version return application current version
func (app *App) Version() string {
	return app.version.String()
}

// CreateAddr is create address string from host and port
func CreateAddr(host string, port int) string {
	return fmt.Sprintf("%s:%v", host, port)
}
