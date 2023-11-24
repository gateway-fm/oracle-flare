#!/bin/sh

YELLOW='\033[0;33m'
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

echo "${YELLOW}[.only] test${NC}: ${PWD}"

cd test/unit

if grep -q -R --include *.ts "it.only" ; then
    echo "${RED}Error [it.only] found${NC}${CYAN}"
    grep -R -n --include *.ts "it.only"
    echo "${NC}"
	exit 1
else
    echo "${GREEN}OK no [it.only] found${NC}"
fi

if grep -q -R --include *.ts "describe.only" ; then
    echo "${RED}Error [describe.only] found${NC}${CYAN}"
    grep -R -n --include *.ts "describe.only"
    echo "${NC}"
	exit 1
else
    echo "${GREEN}OK no [describe.only] found${NC}"
fi

exit 0