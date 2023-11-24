#!/bin/bash

INSTANCE=flare
echo "Launching Ubuntu 20.04 instance. It may take about 2 minutes ..."
multipass launch \
  --name $INSTANCE \
  --cpus 1 \
  --mem 4G \
  --cloud-init ./scripts/local-flare-chain-vm/cloud-init.yaml

multipass mount . $INSTANCE:/home/ubuntu/flare-smart-contracts



