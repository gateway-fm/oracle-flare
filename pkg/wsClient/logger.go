package wsClient

import (
	"fmt"

	"oracle-flare/pkg/logger"
)

func logFatal(msg string, method string) {
	logger.Log().WithField("layer", fmt.Sprintf("WSClient-%s", method)).Fatal(msg)
}

func logWarn(msg string, method string) {
	logger.Log().WithField("layer", fmt.Sprintf("WSClient-%s", method)).Warning(msg)
}

func logInfo(msg string, method string) {
	logger.Log().WithField("layer", fmt.Sprintf("WSClient-%s", method)).Info(msg)
}

func logErr(msg string, method string) {
	logger.Log().WithField("layer", fmt.Sprintf("WSClient-%s", method)).Error(msg)
}

func logDebug(msg string, method string) {
	logger.Log().WithField("layer", fmt.Sprintf("WSClient-%s", method)).Debug(msg)
}
