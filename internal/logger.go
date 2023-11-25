package internal

import (
	"fmt"

	"oracle-flare/pkg/logger"
)

//func logFatal(msg string, method string) {
//	logger.Log().WithField("layer", fmt.Sprintf("App-%s", method)).Fatal(msg)
//}
//
//func logWarn(msg string, method string) {
//	logger.Log().WithField("layer", fmt.Sprintf("App-%s", method)).Warning(msg)
//}

func logInfo(msg string, method string) {
	logger.Log().WithField("layer", fmt.Sprintf("App-%s", method)).Info(msg)
}

//func logErr(msg string, method string) {
//	logger.Log().WithField("layer", fmt.Sprintf("App-%s", method)).Error(msg)
//}
