# # Dockerfile for single non-bootstrapped node
# # Primarily used for system testing

# # To Use
# # Build: docker build -t <image tag name> -f scdev.Dockerfile .
# # Run: docker run -dit --name <container name> -p 127.0.0.1:9650:9650/tcp <image name>

# # There are two stages...the compilation stage, which uses a golang image, drags down all the dependencies and source,
# # and runs the build scripts. Then there is a cleanup stage, which uses a small Debian image and just the built
# # binaries and necessary config and script directories.

# =============== Compilation Stage ==================

FROM golang:1.15.14-buster AS builder

# The default genesis file is genesis_scdev.go
ARG GENESIS=scdev

# Update apt and get dependencies, then remove apt cruft
RUN curl -sS http://dl.yarnpkg.com/debian/pubkey.gpg | apt-key add - &&\
    echo "deb http://dl.yarnpkg.com/debian/ stable main" | tee /etc/apt/sources.list.d/yarn.list
RUN apt-get update && apt-get install -y \
  jq \
  sudo \
  nodejs \
  yarn \
  && rm -rf /var/lib/apt/lists/*

# Copy source code into the container
RUN git clone https://gitlab.com/flarenetwork/flare.git flare
WORKDIR flare
RUN git pull
RUN git checkout docker-scdev-04-07-2022

# Do the build
RUN ./compile.sh $GENESIS

# =============== Cleanup Stage ==================
FROM debian:11.1-slim AS execution

# # Update apt and get dependencies, then remove apt cruft
RUN apt-get update && apt-get install -y \
  curl \
  gnupg

RUN curl -sS http://dl.yarnpkg.com/debian/pubkey.gpg | apt-key add - &&\
    echo "deb http://dl.yarnpkg.com/debian/ stable main" | tee /etc/apt/sources.list.d/yarn.list
RUN apt-get update && apt-get install -y \
  jq \
  sudo \
  nodejs \
  yarn \
  && rm -rf /var/lib/apt/lists/*

# Create dir to hold binaries
RUN mkdir -p /flare/build
WORKDIR /flare/build

# Copy the binaries into the container
COPY --from=builder /go/src/github.com/ava-labs/avalanchego/build .

# Create scripts dir
RUN mkdir -p /flare/cmd
WORKDIR /flare/cmd

# Copy scripts
COPY --from=builder /go/flare/cmd .

# Create conf dir
RUN mkdir -p /flare/conf
WORKDIR /flare/conf

# Copy configuration
COPY --from=builder /go/flare/conf .

WORKDIR /flare
COPY ./scdev.sh .
# ============== Run Command =====================
ENTRYPOINT bash scdev.sh


