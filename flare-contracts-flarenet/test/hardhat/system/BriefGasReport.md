# Gas report

For small users there is a concern that shortening reward epoch will result in gas fees being bigger that what they earn when delegating. For this we need to make quite a few assumptions:
    - Most of users will delegate (if less does everyone that delegates gets a bigger share of reward ergo needs less assets to make up the gas fee)
    - Price providers get roughly 50% of rewards

Note that ATM less than 20% of circulating supply is wrapped.

## Changing to 2 days reward epoch. 

For small users:
    - If 100% delegate 
        - 160 SGB if they claim every 2 days
        - 90 SGB if they claim every 90 days
    - If 50% delegate (exactly half)
        - 80 SGB if they claim every 2 days
        - 45 SGB if they claim every 90 days

For big holder, he can claim 
    - to reach gas of 4m : `at worse every 50 days`
    - to reach gas amount of 7m : `at worse every 85 days`

Note that rewards expire every 90 days so with this configuration rewards will expire before gas limit of 8m is reached. -> Not a problem


## Changing to 1 days reward epoch. 

For small users:
    - If 100% delegate 
        - 320 SGB if they claim every 2 days
        - 180 SGB if they claim every 90 days
    - If 50% delegate (exactly half)
        - 160 SGB if they claim every 2 days
        - 90 SGB if they claim every 90 days


For big holder, he can claim 
    - to reach gas of 4m : `at worse every 25 days`
    - to reach gas amount of 7m : `at worse every 42 days`

This may be a problem, but a big holder will always be able to split this request. And pay some additional gas fee to do so. -> Minor problem 
This becomes a problem if small (personal) users don't claim regularly. Pressing a button on wallet will revert transaction after 1.5 - 2 months since gas fees will be over gas limit. -> Problem!