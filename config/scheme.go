package config

// Scheme represents the application configuration scheme.
type Scheme struct {
	// Env is the application environment.
	Env string

	WS    *WS
	Flare *Flare
}

type Flare struct {
	RegistryContractAddress string
	RpcURL                  string
	ChainID                 int
}

type WS struct {
	URL string
}
