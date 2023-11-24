# Set APP to the name of the application
APP:=oracle-flare

# Set APP_ENTRY_POINT to the main Go file for the application
APP_ENTRY_POINT:=cmd/oracle-flare.go

# Set BUILD_OUT_DIR to the directory where the built executable should be placed
BUILD_OUT_DIR:=./

# path to versioner package
GITVER_PKG:=github.com/misnaged/annales/versioner

# Set GOOS and GOARCH to the current system values using the go env command
GOOS=$(shell go env GOOS)
GOARCH=$(shell go env GOARCH)

# set git related vars for versioning
TAG 		:= $(shell git describe --abbrev=0 --tags)
COMMIT		:= $(shell git rev-parse HEAD)
BRANCH		?= $(shell git rev-parse --abbrev-ref HEAD)
REMOTE		:= $(shell git config --get remote.origin.url)
BUILD_DATE	:= $(shell date +'%Y-%m-%dT%H:%M:%SZ%Z')

# Set RELEASE to either the current TAG or COMMIT
RELEASE :=
ifeq ($(TAG),)
	RELEASE := $(COMMIT)
else
	RELEASE := $(TAG)
endif

# append versioner vars to ldflags
LDFLAGS += -X $(GITVER_PKG).ServiceName=$(APP)
LDFLAGS += -X $(GITVER_PKG).CommitTag=$(TAG)
LDFLAGS += -X $(GITVER_PKG).CommitSHA=$(COMMIT)
LDFLAGS += -X $(GITVER_PKG).CommitBranch=$(BRANCH)
LDFLAGS += -X $(GITVER_PKG).OriginURL=$(REMOTE)
LDFLAGS += -X $(GITVER_PKG).BuildDate=$(BUILD_DATE)

# The all target runs the tidy, build, and test targets
all: tidy build test

# The tidy target runs go mod tidy
tidy:
	go mod tidy

# The update target runs go get -u
update:
	go get -u ./...

# The update-subtree-flare pulls flare contracts repository
update-subtree-flare:
	git subtree pull --prefix=flare-contracts https://gitlab.com/flarenetwork/flare-smart-contracts.git master --squash

# The update-subtree-flare-flarenet pull flare contracts repository on flare_network_deployed_code branch
update-subtree-flare-flarenet:
	git subtree pull --prefix=flare-contracts-flarenet https://gitlab.com/flarenetwork/flare-smart-contracts.git flare_network_deployed_code --squash

# The update-subtree-flare-songbirdnet pull flare contracts repository on songbird_network_deployed_code branch
update-subtree-flare-songbirdnet:
	git subtree pull --prefix=flare-contracts-songbirdnet https://gitlab.com/flarenetwork/flare-smart-contracts.git songbird_network_deployed_code --squash

# The run target runs the application with race detection enabled
run:
	GODEBUG=xray_ptrace=1 go run -race $(APP_ENTRY_POINT) serve

# The build target builds the application for the current system
build:
	env CGO_ENABLED=0 GOOS=$(GOOS) GOARCH=$(GOARCH) go build -ldflags="-w -s ${LDFLAGS}" -o $(BUILD_OUT_DIR)/$(APP) $(APP_ENTRY_POINT)

# The generate-ftso-contract-songbirdnet generates abi file for FtsoManager smart-contract on the songbird net
generate-ftso-contract-songbirdnet:
	solc --abi ./flare-contracts-songbirdnet/contracts/userInterfaces/IFtsoManager.sol -o ./abis/songbird

# The generate-ftso-contract-flarenet generates abi file for FtsoManager smart-contract on the flare net
generate-ftso-contract-flarenet:
	solc --abi ./flare-contracts-flarenet/contracts/userInterfaces/IFtsoManager.sol -o ./abis/flare

# The generate-submitter-contract-songbirdnet generates abi file for PriceSumbmitter smart-contract on the songbird net
generate-submitter-contract-songbirdnet:
	solc --abi ./flare-contracts-songbirdnet/contracts/userInterfaces/IPriceSubmitter.sol -o ./abis/songbird

# The generate-submitter-contract-flarenet generates abi file for PriceSumbmitter smart-contract on the flare net
generate-submitter-contract-flarenet:
	solc --abi ./flare-contracts-flarenet/contracts/userInterfaces/IPriceSubmitter.sol -o ./abis/flare

# The generate-registry-contract generates abi file for ContractRegistry smart-contract
generate-registry-contract:
	solc --abi ./flare-contracts/contracts/userInterfaces/IFlareContractRegistry.sol -o ./abis

# The test target runs go test
test:
	go test ./...

run-ws-example:
	go run ./pkg/wsClient/example/wsClientExample.go

# The clean target deletes the build output file
clean:
	rm $(BUILD_OUT_DIR)/$(APP)

# The test-coverage target runs go test with coverage enabled and generates a coverage report
test-coverage:
	go test -coverprofile=coverage.out ./...
	go tool cover -html=coverage.out

# The lint target runs golint to check for common style issues
lint:
	golint ./......