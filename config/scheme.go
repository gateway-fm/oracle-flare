package config

// Scheme represents the application configuration scheme.
type Scheme struct {
	// Env is the application environment.
	Env string

	WS    *WS
	Flare *Flare
}

// Flare is a pkg-flare configs
type Flare struct {
	// RegistryContractAddress smart-contract address for flare on-chain infrastructure entry point
	RegistryContractAddress string
	// RpcURL url for rpc-provider
	RpcURL string
	// ChainID for flare smart-contracts. Only 19 (songbird testnet), 16 (coston2 testnet) and 14 (flare mainnet) are supported
	ChainID int
	// SignerPK is a wallet private key. Shall never be hardcoded
	SignerPK string
}

// WS is a pkg ws client configs
type WS struct {
	// URL is a oracle url address
	URL string
}
