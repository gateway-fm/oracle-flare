// NOTE: We assume both repos, this one `flare-smart-contracts` and Flare Network repo (`flare`) are in the same parent folder.
// Here we are actually reading template from `flare` repo and writing back genesis file.
import { genesisGenerate } from "../genesis-lib";
import { songbirdGenesisAccountDefinitions, songbirdTargetTotalSupply } from "./songbird-genesis-accounts-definitions";

const fs = require('fs');
const PATH_TO_TEMPLATE = "../flare/src/genesis/genesis_songbird_template.go"
const PATH_TO_GENESIS_FILE = "../flare/src/genesis/genesis_songbird.go"

genesisGenerate("songbird", songbirdGenesisAccountDefinitions, songbirdTargetTotalSupply, PATH_TO_TEMPLATE, PATH_TO_GENESIS_FILE);