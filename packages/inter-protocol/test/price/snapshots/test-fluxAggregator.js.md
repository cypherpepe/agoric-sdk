# Snapshot report for `test/price/test-fluxAggregator.js`

The actual snapshot is saved in `test-fluxAggregator.js.snap`.

Generated by [AVA](https://avajs.dev).

## basic, with snapshot

> Under "published", the "priceAggregator" node is delegated to a tree of price aggregator contract instances.
> The example below illustrates the schema of the data published there.
> 
> See also board marshalling conventions (_to appear_).

    [
      [
        'published.priceAggregator.LINK-USD_price_feed',
        {
          amountIn: {
            brand: {
              iface: 'Alleged: $LINK brand',
            },
            value: 1n,
          },
          amountOut: {
            brand: {
              iface: 'Alleged: $USD brand',
            },
            value: 5000n,
          },
          timer: {
            iface: 'Alleged: ManualTimer',
          },
          timestamp: 6n,
        },
      ],
      [
        'published.priceAggregator.LINK-USD_price_feed.latestRound',
        {
          roundId: 3n,
          startedAt: 5n,
          startedBy: 'agorice1priceOracleC',
        },
      ],
    ]