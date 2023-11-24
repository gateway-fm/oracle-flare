package service

import (
	"fmt"

	"oracle-flare/pkg/logger"
)

func logFatal(msg string, method string) {
	logger.Log().WithField("layer", fmt.Sprintf("Service-%s", method)).Fatal(msg)
}

func logWarn(msg string, method string) {
	logger.Log().WithField("layer", fmt.Sprintf("Service-%s", method)).Warning(msg)
}

func logInfo(msg string, method string) {
	logger.Log().WithField("layer", fmt.Sprintf("Service-%s", method)).Info(msg)
}

func logErr(msg string, method string) {
	logger.Log().WithField("layer", fmt.Sprintf("Service-%s", method)).Error(msg)
}
