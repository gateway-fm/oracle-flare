# Gas report

## The setup

The setup is tha same for all durations

We have 4 delegators (d1-d4) and 4 price providers (p1-p4)
d1: wraps 300000 Nat and delegates 50% to p1
d2: wraps 300000 Nat and delgates 50% to p1 and 50% to p2
d3: wraps 3000000 Nat and delegates 50% to P3
d4: wraps 3000000 Nat and delegates 100% to p4 and 

in some tests we add 

d5: wraps 300000 Nat and delgates 50% to p1 and 50% to p2
d6: wraps 300000 Nat and delgates 50% to p3 and 50% to p4

Price providers 


For each we interpolate the measured findings with linear regression and then calculate using that interpolation what gas amounths are gonna be with certian ammounth of reward epochs


## 1 Day long reward epoch

```
    "rewardEpochDurationSeconds": 86400,
    "revealEpochDurationSeconds": 90,
    "priceEpochDurationSeconds": 180,
``` 

### Data

Gas amount with 1 price epoch in reward epoch

1: [ 236214, 271639, 202014, 199688 ]
5 : [ 708110, 929651, 605510, 593880 ]
15: [ 1888047, 2575016, 1614447, 1579557 ]
30: [ 3658487, 5043960, 3128387, 3049117 ]

Interpolated gas usages
Table of reward epoch claim amount

|  | 1.0|7.0|14.0|20.0|25.0|30.0|35.0|40.0|45.0|50.0|55.0|60.0|65.0|70.0|75.0|80.0|
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| d1 | 236093.9|944155.5|1770227.3|2478288.9|3068340.2|3658391.5|4248442.9|4838494.2|5428545.5|6018596.8|6608648.1|7198699.5|7788750.8|8378802.1|8968853.4|9558904.7|
| d2 | 271436.7|1258822.1|2410771.8|3398157.2|4220978.4|5043799.6|5866620.8|6689442.0|7512263.2|8335084.4|9157905.6|9980726.8|10803548.0|11626369.2|12449190.4|13272011.5|
| d3 | 201893.9|807355.5|1513727.3|2119188.9|2623740.2|3128291.5|3632842.9|4137394.2|4641945.5|5146496.8|5651048.1|6155599.5|6660150.8|7164702.1|7669253.4|8173804.7|
| d4 | 201036.6|790580.7|1478382.2|2067926.3|2559213.0|3050499.8|3541786.5|4033073.3|4524360.0|5015646.7|5506933.5|5998220.2|6489507.0|6980793.7|7472080.5|7963367.2|
| min | 201036.6|790580.7|1478382.2|2067926.3|2559213.0|3050499.8|3541786.5|4033073.3|4524360.0|5015646.7|5506933.5|5998220.2|6489507.0|6980793.7|7472080.5|7963367.2|
| max | 271436.7|1258822.1|2410771.8|3398157.2|4220978.4|5043799.6|5866620.8|6689442.0|7512263.2|8335084.4|9157905.6|9980726.8|10803548.0|11626369.2|12449190.4|13272011.5|
| avr | 227615.3|950228.5|1793277.2|2515890.3|3118068.0|3720245.6|4322423.3|4924600.9|5526778.6|6128956.2|6731133.8|7333311.5|7935489.1|8537666.8|9139844.4|9742022.1|


## 2 Day long reward epoch

```
    "rewardEpochDurationSeconds": 172800,
    "revealEpochDurationSeconds": 90,
    "priceEpochDurationSeconds": 180,
``` 

Tested gas usages
1 : [ 236214, 271639, 202014, 199688 ]
4 : [ 590132, 765141, 504632, 495328 ]
30 : [ 3658487, 5043960, 3128387, 3049117 ]
8 : [ 1062061, 1423210, 908161, 889553 ]


Interpolated gas usages
Table of reward epoch claim amount

|  | 1.0|7.0|14.0|20.0|25.0|30.0|35.0|40.0|45.0|50.0|55.0|60.0|65.0|70.0|75.0|80.0|
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| d1 | 236024.2|944117.6|1770226.7|2478320.1|3068398.0|3658475.9|4248553.8|4838631.7|5428709.5|6018787.4|6608865.3|7198943.2|7789021.1|8379099.0|8969176.8|9559254.7|
| d2 | 271318.9|1258758.0|2410770.3|3398209.5|4221075.4|5043941.4|5866807.3|6689673.2|7512539.2|8335405.1|9158271.1|9981137.0|10804003.0|11626868.9|12449734.8|13272600.8|
| d3 | 201824.2|807317.6|1513726.7|2119220.1|2623798.0|3128375.9|3632953.8|4137531.7|4642109.5|5146687.4|5651265.3|6155843.2|6660421.1|7164999.0|7669576.8|8174154.7|
| d4 | 201370.3|790583.7|1477999.3|2067212.7|2558223.9|3049235.0|3540246.2|4031257.3|4522268.5|5013279.6|5504290.7|5995301.9|6486313.0|6977324.2|7468335.3|7959346.5|
| min | 201370.3|790583.7|1477999.3|2067212.7|2558223.9|3049235.0|3540246.2|4031257.3|4522268.5|5013279.6|5504290.7|5995301.9|6486313.0|6977324.2|7468335.3|7959346.5|
| max | 271318.9|1258758.0|2410770.3|3398209.5|4221075.4|5043941.4|5866807.3|6689673.2|7512539.2|8335405.1|9158271.1|9981137.0|10804003.0|11626868.9|12449734.8|13272600.8|
| avr | 227634.4|950194.3|1793180.8|2515740.6|3117873.8|3720007.0|4322140.2|4924273.5|5526406.7|6128539.9|6730673.1|7332806.3|7934939.5|8537072.7|9139206.0|9741339.2|


## Questions

Q: Is the amount of delegated tokens connected to gas amount?

Tested with 2 accounts that delegate the same to same price providers
A: Yes

Tested with 2 accounts that delegate the same, but to different providers
A: No

Q: Is the number of price epochs per reward epoch connected to gas amount?
A: No

Q: Is the number of price epochs we participate in per reward epoch connected to gas amount?
A: No (as long as we get some reward)

Q: Is gas amount of price provider claim dependent on how many people delegate to them
A: 

Q: Does it matter if delegators claim their rewards before price providers? If so how does the order effect the gas amount?
A: Yes, se table bellow. If all delegators of price provider claim, then climing for price provider is cheaper.

Gas amount for 1 reward epoch  2 days long reward epoch configuration
delegators then price providers
```
Tax amount per claim for delegator
[ 236214, 271639, 202014, 199688, 271639, 271639 ]
Tax amount per claim for price provider
[ 134345, 134345, 134345, 134333 ]
```

price providers then delegators
```
Tax amount per claim for delegator
[ 202014, 271639, 202014, 199688, 211225, 211225 ]
Tax amount per claim for price provider
[ 198752, 164552, 164552, 164540 ]
```

all delegators but 1 (price provider 1 gas cost for claim is higher)
```
Tax amount per claim for delegator
[ 305839, 202014, 199688, 271639, 271639 ]
Tax amount per claim for price provider
[ 164552, 134345, 134345, 134333 ]
```

Q: Does state of claims of other delegators in reward epoch effect other delegators that delegated to the same price provider?
A: Yes, thi first one to claim will pay extra gas.


## Effect of this change for gas usage in network

Lets say we have 10 000 addresses delegating and claiming
If we assume that average user will claim once per 2 weeks, some will delegate to 1 price provider and some will delegate to two. We assume average costs. From Alen we know network can do ~21Mgas/sec. We assume we have 100 price providers that claim every reward epoch. 

Gas network can handle (in 14 days)
`25 401 600 000 000`


### 1 day Reward epoch model

Gas used by claiming of users (in 14 days)
```
1 800 000 (average 14 reward epochs claim) * 10 000 = 18 000 000 000
``` 
Gas used by price providers (in 14 days)
```
200 000 * 100 * 14 = 280 000 000
```

Total gas consumption
```
18 000 000 000 + 280 000 000 = 18 280 000 000

18 280 000 000 / 25 401 600 000 000 = 0.00072 ~ 0.072% ~ 0.1%
```

### 2 day Reward epoch model

Gas used by claiming of users (in 14 days)
```
950 194 ~= 1 000 000 (average 14 days claim)
1 000 000 * 10 000 = 10 000 000 000
``` 
Gas used by price providers (in 14 days)
```
200 000 * 100 * 7 = 140 000 000
```

Total gas consumption
```
10 000 000 000 + 140 000 000 = 10 140 000 000

10 140 000 000 / 25 401 600 000 000 = 0.00040 ~ 0.04%
```


### 7 day (current) Reward epoch model

Gas used by claiming of users (in 14 days)
```
348 050 ~= 400 000 (average 14 days claim)
400 000 * 10 000 = 4 000 000 000
``` 

Gas used by price providers (in 14 days)
```
200 000 * 100 * 2 = 40 000 000
```

Total gas consumption
```
4 000 000 000 + 40 000 000 = 4 040 000 000

4 040 000 000 / 25 401 600 000 000 = 0.00016 ~ 0.016% ~ 0.02%
```

## Minimal delegation amount so its worth claiming

* Minimal gas price 225 000 000 000 Wei
* Assuming 50% accuracy on price provider (just so we claim the full inflation percentage)
* Assuming 20% price provider fee
* Assuming `300 000 gas` cost for claim
* Price of claim: `0.0675 NAT ~ 0.07 NAT`
* Current wNat amount: `1 677 308 207`
* Songbird circulating supply ~ `9 400 000 000`

Year 1 (10% inflation) :  `9 400 000 000 * 0,1 = 940 000 000`
### 1 day Reward epoch model


1 reward epoch inflation : `940 000 000 / 365 =~ 2 575 000`

Now
```
((0.07 * 9 400 000 000) / (0.8 * 2 575 000))/5,8 = 55 NAT
```

If all wrap and delegate
```
(0.07 * 9 400 000 000) / (0.8 * 2 575 000) = 319 NAT
```


### 2 day Reward epoch model

1 reward epoch inflation : `940 000 000 / 365 * 2 =~ 5 000 000`

Now
```
((0.07 * 9 400 000 000) / (0.8 * 5 000 000))/5,8 = 23 NAT
```

If all wrap and delegate
```
(0.07 * 9 400 000 000) / (0.8 * 5 000 000) = 160 NAT
```

### current 7 day Reward epoch model

1 reward epoch inflation : `940 000 000 / 365 * 7 =~ 17 500 000`

Now
```
((0.07 * 9 400 000 000) / (0.8 * 17 500 000))/5,8 = 8 NAT
```

If all wrap and delegate
```
(0.07 * 9 400 000 000) / (0.8 * 17 500 000) = 47 NAT
```
