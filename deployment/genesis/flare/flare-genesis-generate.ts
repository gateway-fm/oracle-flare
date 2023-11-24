// NOTE: We assume both repos, this one `flare-smart-contracts` and Flare Network repo (`flare`) are in the same parent folder.
// Here we are actually reading template from `flare` repo and writing back genesis file.
import { genesisGenerate } from "../genesis-lib";
import { flareGenesisAccountDefinitions, flarePChainFunds, flareTargetTotalSupply } from "./flare-genesis-accounts-definitions";

const fs = require('fs');

genesisGenerate("flare", flareGenesisAccountDefinitions, flareTargetTotalSupply.sub(flarePChainFunds));