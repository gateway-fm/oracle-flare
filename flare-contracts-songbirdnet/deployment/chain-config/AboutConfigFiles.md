# ABOUT CONFIG FILES

This document describes the use cases of different json config files for different networks and users

## scedv.json

A configuration to be used when deploying contracts on local scdev network. 

Use cases:
    * testing deploys locally
    * playing with conracts on local network
    * ...

## songbird.json

A config file that was/is used on Songbird canary network

## staging.json

A config file used on staging network

## endToEndHardhat.json

A config used for end-to-end tests. Please don't change the parameters here since other tests may depend on configuration and may break if it is changed.

