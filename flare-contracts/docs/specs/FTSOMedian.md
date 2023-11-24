# Formal definition of median price and rewarded votes
## Calculating the median price
Starting with a sequence of pairs (votes) of the form `(price, weight)` let `totalWeight` be the sum of all weights in the sequence.
The "gold standard" algorithm that shows how weighted median price and rewarded votes should be calculated is as follows:
- Sort the list of votes by prices in ascending order. Note that there could be multiple valid sort orders if prices repeat. Furthermore, all sort orders can be obtained by finding one order and then permuting the votes with the same price.
- Take any sort order S (as a sequence). Construct the sequence L by taking the elements from the beginning of S until the sum `floor(totalWeight/2)` is reached in the case of totalWeight being even. If `totalWeight is odd`, the sum will be floor`(totalWeight/2) + 1`. These can both be simplified as: `M = floor(totalWeight/2) + (totalWeight % 2)`.
- Let `(p, w)` be the last element of `L`, and `SM(L)` be the sum of weights in `L`. Then `SM(L) >= M` and `SM(L) - w < M`.
- If `SM(L) == M` and totalWeight is even, then let `(p1, w1)` be the successor vote of `(p, w)` in `S`. Note that `p1 >= p`. In this scenario, the median price is `floor((p + p1)/2)`.
- If `SM(L) == M` and totalWeight is odd, then the median price is `p`.
- Otherwise, it follows that `SM(L) > M` and `M` is attained by adding a fraction of the weight `w` to `SM(L) - w`, hence the median price is `p`.
- Note that the (weighted) median price is uniquely defined. The only "variable" component in the algorithm is the initial sort order `S`. If all the prices are mutually different, then there is only one order `S`, and the median price is straightforward. There are different possible sort orders when some prices repeat. In any such sort order, the same prices appear in connected subsequences. Construct the sequence `S'` in which any such maximal subsequence,say `(p, w1), (p, w2), ..., (p, wk)`, is substituted with a single "vote"  `(p, w1 + w2 + ... + wk)`. Then all the prices in `S'` are mutually different and hence the median price is unique to a ‘single’ vote. Note that working with `S'` is equivalent to simultaneously allowing and considering all possible permutations within subsequences of votes with the same price. 
## Quartile calculations
- Take any sort order `S` and start collecting votes from `S` from right to left to obtain the sequence `R`, until the sum of the weights `SM(R`) reaches `totalWeight - floor(totalWeight/4)`. Let `(p, w)` be the last added element to `R`. Then `SM(R) >= totalWeight - floor(totalWeight/4)`, but `SM(R) - w < totalWeight - floor(totalWeight/4)`. The first quartile price (or lowest reward price) equals `p`.
- Take any sort order `S` and start collecting votes from `S` from left to right to obtain the sequence `L`, until the sum of the weights `SM(L)` reaches `totalWeight - floor(totalWeight/4)`. Let `(p, w)` be the last added element to `L`. Then `SM(L) >= totalWeight - floor(totalWeight/4)`, but `SM(L) - w < totalWeight - floor(totalWeight/4)`. The last quartile price (or highest reward price) equals `p`.

Note that while median price, lowest reward price, and highest reward price are uniquely defined, the corresponding indices of votes depend on a sort order and are not unique over all possible sort orders.

The final set of rewarded votes is defined as a subset of votes `(price, weight)`, such that

`lowest rewarded price <= price <= highest rewarded price`

with the condition that the submissions that are on the lower and upper edge are selected pseudorandomly: for each vote that satisfies either `price = lowest reward price` or
`price = highest rewarded price`, a random number `x` is computed as `x = keccak256(random, vote address)`, where `random` is the FTSO random number for the current reward
epoch, computed from all the submissions. If `x` is odd, the vote is included in the final set of rewarded votes, otherwise not.

Hence the sum of weights of the rewarded votes can be in range from `0` to `totalWeight` (with only one vote, the former clearly happens when the computed value `x` is even and
the latter happens when `x` is odd, but other cases can be constructed that achieve an arbitrary weight of the rewarded votes between these two extremes). On average, there will be
several hundred votes and the proportion of the votes that are exactly on the edge should be small, so that the sum of weights of the rewarded vodes is roughly `totalWeight/2`.

## Implementation in smart contract
The actual algorithm does not use the sorting function, but a variant (extension) of a well known QuickSelect algorithm, which in the original version, searches for a `k`-th element (ordering by price) in an unordered list without actually ordering the list. The most important result of the QuickSelect algorithm is actually reordering the sequence in such a way that the `k`-th element ends up on the `k`-th index. To the left of it are elements that have smaller or equal price and to the right of it are elements that have greater or equal price. Note that standard QuickSelect is basically the weighted version with all weights equal to 1. The weighted version is a straightforward extension. Instead of the `k`-th element, we are seeking for the element in which it would be true in the ordered list that the sum of weights of the elements left of the chosen element and the very element itself would reach a certain fraction of the total sum of weights `(totalWeight)`. When calculating the median, the fraction is `floor(totalWeight/2) + (totalWeight % 2)`. When finding the third quartile price, we are targeting the fraction `(totalWeight) - floor(totalWeight/4)`. For the first quartile price we are targeting the same thing, but with the sum from right to left.

Note that QuickSelect does not order the list, and hence it has O(n) average time complexity instead of O(n log n), which is best known for general sorting.

## Applied Scenarios
### Question 1: In the situation listed below, which votes are expected to be rewarded according to the algorithm?

        (vote, vote power) - same notation as docs

        Votes: (1, 2), (1, 2), (2, 1), (3, 2), (3, 2), (3,1), (4, 1), (5, 5)

        total vote power = 16
### Answer
Here we have a sequence that is already sorted according to the prices, and `totalWeight = 16`. Median weight equals `floor(16/2) + 16%2 = 8 + 0 = 8`. The sum of 8 in weights is reached by elements   `(1, 2), (1, 2), (2, 1), (3, 2), (3, 2)`, where the last vote `(3, 2)` gets us to a sum of 9, where without it we are on 7. So the "middle weight" is within the last element, and the median price is 3. 

To find the first quartile price, we have to target `totalWeight - floor(totalWeight/4) = 16 - 4 = 12`. Starting from the right, we collect the elements 
 
`(2, 1), (3, 2), (3, 2), (3,1), (4, 1), (5, 5)`
 
whose sum is exactly 12. The leftmost (and lastly added) has price 2. Therefore, the lowest rewarded price is 2. The first two elements which are both of price 1 are not rewarded.

Similarly, we target the left sum 12 for the third quartile price. From the left we collect the following votes 

`(1, 2), (1, 2), (2, 1), (3, 2), (3, 2), (3,1), (4, 1), (5, 5)`
 
which actually amounts to all votes. Namely the last vote, `(5, 5)`, is the one we need to achieve (overcome) 12. So the highest reward price is 5. All the votes with prices from 2 to 5 get rewards.

### Question 2: What is the expected behavior between these two scenarios given the same vote, but different voting power? What are their median values?

        A: `(1, 2), (1, 2), (2, 1), (3, 2), (3, 2), (3,1), (4, 1), (5, 12)`
        B: `(1, 2), (1, 2), (2, 1), (3, 2), (3, 2), (3,1), (4, 1), (5, 15)`
### Answer
### A) 

`totalWeight = 23`

`M = floor(23/2) + 23%2 = 11 + 1 = 12`

`totalWeight - floor(totalWeight/4) = 23 - 5 = 18`

`L` for median: `(1, 2), (1, 2), (2, 1), (3, 2), (3, 2), (3,1), (4, 1), (5, 12)`

Median price: 5

`R` for first quartile: `(3, 2), (3, 2), (3,1), (4, 1), (5, 12)`

Lowest rewarded price: 3

`L` for last quartile: `(1, 2), (1, 2), (2, 1), (3, 2), (3, 2), (3,1), (4, 1), (5, 12)`

Highest rewarded price: 5

### B) 
`totalWeight = 26`

`M = floor(26/2) + 26%2 = 13 + 0 = 13`

`totalWeight - floor(totalWeight/4) = 26 - 6 = 20`

`L` for median: `(1, 2), (1, 2), (2, 1), (3, 2), (3, 2), (3,1), (4, 1), (5, 15)`

Median price: 5

`R` for first quartile: `(3, 2), (3, 2), (3,1), (4, 1), (5, 15)`

Lowest rewarded price: 3

`L` for last quartile: `(1, 2), (1, 2), (2, 1), (3, 2), (3, 2), (3,1), (4, 1), (5, 15)`

Highest rewarded price: 5

Both scenarios are largely the same. The vote of 5 in both A and B has remarkable voting power in which the weighted median price is also 5 despite it being the highest vote.

