#!/usr/bin/env bash

if [[ -n "$CI" ]]; then
    echo "this block will only execute in a CI environment"
    nohup ./cmd/single-docker.sh &
    sleep 15
    echo "single node is running" 
    # this is how GitLab expects your entrypoint to end, if provided
    # will execute scripts from stdin
    exec /bin/bash

else
    echo "this block will only execute in NON-CI environments"
    # execute the command as if passed to the container normally
    nohup ./cmd/single-docker.sh &
    sleep 15
    echo "single node is running" 
    exec "$@"
fi
