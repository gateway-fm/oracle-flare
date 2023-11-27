#!/usr/bin/env node
const fse = require('fs-extra');
const path = require('path');

async function copyData(){
    const dir = `${__dirname}/../`;  
    await fse.copy(path.join(dir, "contracts"), "./contracts", {overwrite: true});
    await fse.copy(path.join(dir, "docs"), "./docs", {overwrite: true});
    await fse.copy(path.join(dir, "test"), "./test", {overwrite: true});
    await fse.copy(path.join(dir, "deployment"), "./deployment", {overwrite: true});
    await fse.copy(path.join(dir, "scripts"), "./scripts", {overwrite: true});
    await fse.copy(path.join(dir, "tsconfig.json"), "tsconfig.json", {overwrite: true});
    await fse.copy(path.join(dir, "hardhat.config.ts"), "hardhat.config.ts", {overwrite: true});
    await fse.copy(path.join(dir, "hardhatSetup.config.ts"), "hardhatSetup.config.ts", {overwrite: true});
    await fse.copy(path.join(dir, "package.json"), "package.json", {overwrite: true});
    await fse.copy(path.join(dir, "test-1020-accounts.json"), "test-1020-accounts.json", {overwrite: true});
    await fse.copy(path.join(dir, "yarn.lock"), "yarn.lock", {overwrite: true});
}

async function main() {
    console.log("Preparing data...");
    await copyData();
    console.log("Finshed. Flare is ready!");
}

main()
    .then(() => process.exit(process.exitCode))
    .catch((error) => {
    console.error(error);
    process.exit(1);
});
