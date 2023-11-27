# Prerequisites for running tests in ./test/system

1. `git clone https://gitlab.com/flarenetwork/flare`
2. Install dependencies listed in README.md. In particular, install the requisite version of Go. GVM can be helpful.
```
bash < <(curl -s -S -L https://raw.githubusercontent.com/moovweb/gvm/master/binscripts/gvm-installer)
```
3. From the root of the project, `yarn`.
4. To start the chain used by the system tests (scdev), `yarn start1`. Or if you are starting the validator multiple times and do not want to recompile the validator each time, `yarn start1-existing`.
5. From this project's root, `yarn test_system_scdev`.
