# 0.2.0 (2022-02-20)

### PriceSubmitter:

- Updated the reveal commit scheme to use a single random number.

# 0.0.23 (2021-08-31)

### FTSO:

- Price providers are now limited to ONE submit per ftso per price epoch. This prevents the price providers from speculatively submitting prices.

### PriceSubmitter:

- Price submission now requires an additional argument `epochId` corresponding to the epoch in which is submitted. This enables price submitters to control which epoch they are submitting prices for and correct for time drift.
- Price submission and reveal now revert on the first encountered error. This simplifies debugging and prevents the price submitter from having to handle errors in a different way.

### General:

Rename:

- `WFLR` was renamed to `WNAT` (Native token, which can either be `FLR` or `SGB`).
- `fAssets` were renamed to `assets` or `xAsset`.
