# Test Local flare chain on a virtual machine using multipass

Local unit and integration tests can be perfomed on a 4-node instance spinned out in a virtual machine (VM). To create such a VM, we use `multipass` (similar to Docker, except that we run things in VM instead of container. This enables us to independently change VM's system time)

On Mac OS use default virtualization driver `hyperkit`. It is possible to use `virtualbox`, but it is, as usual, slower on Macs.

## Usage
- Install multipass https://multipass.run/
- Run `yarn vm_launch`. Wait for about 2 minutes.
- Log onto VM shell: `yarn vm_shell`. Run `./launch.sh`. For the first time wait about 2 mins for GO files of Flare Network to compile and run. When 4 network nodes are run one cen use network. To stop network press any button. Keep this console (*console1*) open while testing. 
- Testing. Open another VM shell: `yarn vm-shell`,  call this console *console2*. Move to `cd flare-smart-contracts`. This is the mounted GIT repo from the host, the same one as you are entering from into the VM shell. To run time shifted network tests run `yarn testTimeShift`. To run time waiting network tests run `yarn testTimeWait`
- The adapted tests (e.g. FTSOMedian.ts) should work. Other tests will be adapted eventually.
- To stop testing and exiting VM: `exit` *console2*. Then press any key in *console1* and `exit`. Upon the exit, run `yarn vm_stop` which shuts down the VM.
- Later to work again with VM, just run `yarn vm_start` and repeate the steps for initializing *console1* and *console2*.
- To delete VM from the system, first stop VM and then run `yarn vm_purge`.

## Technical details
For time shifts and testing on the real network two conditions have to be meet.
1. Each transaction has to be wrapped with transaction finalization wrapper helper function (`waitFinalize` for `ethers` and `waitFinalize3` for `web3` transactions).
2. Special timeshift function with forced mining of a block after time change (either shifting or changing) has to bi used. For ethers use `increaseTime` utility function (currently in `test-helpers.ts`)
