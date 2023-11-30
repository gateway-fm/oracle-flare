package songbird_abi

import _ "embed"

//go:embed IFtsoManager.abi
var IFtsoManager string

//go:embed IFtsoRegistry.abi
var IFtsoRegistry string

//go:embed IPriceSubmitter.abi
var IPriceSubmitter string
