package flare

import (
	"fmt"
	"oracle-flare/pkg/logger"
)

func logFatal(msg string, method string) {
	logger.Log().WithField("layer", fmt.Sprintf("Flare-%s", method)).Fatal(msg)
}

//func logWarn(msg string, method string) {
//	logger.Log().WithField("layer", fmt.Sprintf("Flare-%s", method)).Warning(msg)
//}

func logInfo(msg string, method string) {
	logger.Log().WithField("layer", fmt.Sprintf("Flare-%s", method)).Info(msg)
}

//func logErr(msg string, method string) {
//	logger.Log().WithField("layer", fmt.Sprintf("Flare-%s", method)).Error(msg)
//}
