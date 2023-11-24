package config

// Scheme represents the application configuration scheme.
type Scheme struct {
	// Env is the application environment.
	Env string

	WS *WS
}

type WS struct {
	URL string
}
