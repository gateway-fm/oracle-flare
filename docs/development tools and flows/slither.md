# Slither

Slither is a static analysis tool for Solidity code, developed by Trail of Bits.

## Installation

Slither requires python 3 and pip. On Ubuntu/Debian you can install prerequisutes  with commands

    sudo apt update
    sudo apt install python3 python3-pip
    
and then install Slither with
    
    sudo pip3 install slither-analyzer
    
## Usage

Simply run

    yarn slither

to get list of issues in the terminal.

For interactive work, it may be easier to install vscode extension for slither (the name is just *Slither*, also developed by Trail of Bits). It allows you to group errors by type or severity and to selectively show/hide error types.

Alternatively, you can run `slither .`, but the original formatting is quite unreadable, so I added script `scripts/slither-parse.js` which parses slither's json output and reformats it (`yarn slither` just runs `slither` with json output, followed by `slither-parse.js`). Another advantage of `slither-parse.js` is that it returns error status only when there are high-impact issues, while original `slither` returns error status for any issue (which is a problem for CI).

For more documentation, see Slither github page <https://github.com/crytic/slither> or its wiki page <https://github.com/crytic/slither/wiki>.

## Configuration

Slither configuration is in the file `slither.config.json` in the project root. Currently, the configuration disables checking files in any `mock` subdirectory and it disables the check for variable naming conventions (which differs from ours, so it gives tons of false positives). All configuration options are explained in <https://github.com/crytic/slither/wiki/Usage#configuration-file>.
