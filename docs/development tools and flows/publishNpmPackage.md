# Publish demo npm kick off for Price providers

Price provider kick off package [https://www.npmjs.com/package/@flarenetwork/ftso_price_provider_kick_off_package](https://www.npmjs.com/package/@flarenetwork/ftso_price_provider_kick_off_package) only exposes a part of smart contracts repository.
Since npm publish automatically takes `pacakge.json` and `README.md` from root folder and uses full folder, special files are prepared for package publishing and stored in folder `npm-package-data`

## Publishing steps

### Authentication (only needed before first push)

1. Make sure you are logged in npm:
    - run `npm whoami` to see currently logged in user
    - use `npm login` to login as a new user
2. Make sure that the user is added to the `@flarenetwork` organization [https://www.npmjs.com/org/flarenetwork](https://www.npmjs.com/org/flarenetwork).

### Publishing

Since only a subset of files is packed to npm package file some pre-checks have to be made to ensure that all the files are included.
Instructions 3, 4 and 5 check that necessary files are packed.

1. Update version number in `npm-package-data/package.json`. Follow [semantic versioning.](https://semver.org/)
2. Flatten mock contracts using default flatten script.
This ussually fails as hardhat is uncooperative when flattening scripts with cyclic [imports](https://github.com/nomiclabs/truffle-flattener/issues/14). 
This can be mitigated by breaking the cycle by hand, flattening the contract manually and adding contract from removed import. 
As of now, the easiest way to do this is to remove the import `import "./IFtsoManager.sol";` from `IPriceSubmitter.sol` and copy the `IFtsoManager.sol` manually to flattened version of contract.
2. Copy files from `npm-package-data/` to root project folder and REPLACE existing files.
3. Run `npm pack` from root project folder. This creates `flarenetwork-ftso_price_provider_kick_off_package-XX.YY.ZZ.tgz` file in root project directory.
4. Copy and extract `tgz` file to a fresh directory outside the main project. This creates `package` folder with the same contents as the published package will contain.
5. Run `yarn` and `yarn c` in `package` folder. If everything completes successfully also run `yarn test`. This ensures that all the needed files are added. If the compilation fails due to missing files you have to add the needed files to `files` part of `npm-package-data/pacakge.json`.
6. If all the checks succeed, run `npm publish` in root project folder.
7. Revert overwritten files in root project folder with their original content.
