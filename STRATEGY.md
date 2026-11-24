# Strategy: slot-0 spike rider

Measured on the kit's dev window (1222 coins, 126,801 trades, 35 completions, 24h of pump.fun
bonding-curve data) before the bot was written. Every number below is measured from the fill
price — the price of the first trade at least 2 slots after the decision, the price a bot
actually gets — never from the decision price.

## What the data says

- **The 2-slot latency eats the opening spike.** From the moment a coin's real SOL first
  crosses 1 SOL, the price moves +12% (median) before a buy decided on that batch fills, and
  the forward 50-slot return from the fill price is -3.7% (median). Buying the launch after
  the spike, chasing momentum, or buying dips are all structurally negative on dev.
- **The pilot bots all lose on dev for exactly this reason** (full-window local sim):
  momentum -9.66 SOL, reversion -4.08 SOL, sniper -0.49 SOL. An earlier draft of this bot
  (rolling 30-slot momentum entry, trailing stop, 1500-slot hold) lost -1.47 SOL.
- **One pocket survives the latency.** Coins whose price ran up >= 100% inside their create
  slot hit +15% before -8% on 56% of coins (first passage from the fill price). They are
  lottery tickets: most dump, a third spike again — and a tight stop with a 3:1 payoff makes
  the trade positive. The edge strengthens with the run-up: at >= 150% the win rate is 58%,
  at >= 200% it is 67%. The full slot-0 tape is visible in the create batch, so the bot
  decides on that batch and the fill lands 2 slots later, still inside the spike's second leg.
- **Completions are a mirage for a latency-2 bot.** The median completer completes in the
  same slot it is created (7 trades, real SOL 0 to 85 in one slot). Only ~10% take 100+ slots.
  Riding to completion is not a strategy here.
- **Fees.** A round trip costs ~2.5% in curve fees (95 + 30 bps per side) plus 0.00021 SOL of
  tx fees. At 0.05 SOL a round trip costs ~2.9%; at 0.10 SOL ~2.7%. The 1%-of-real-reserve
  buy cap rarely binds for these coins (their real SOL at the close of slot 0 is usually
  10-85 SOL), so 0.05-0.10 SOL positions are feasible.

## Rules

Entry — on the create batch only, when the coin's slot-0 tape shows:
- price run-up >= 100% over the create price (last trade of slot 0);
- curve not already complete (instant completers are skipped);
- creator has not sold in slot 0.
- Size: 0.05 SOL, or 0.10 SOL when the run-up is >= 200%, capped at 97% of the
  1%-of-real-reserve limit. Buys go out at 500 bps slippage, so a fill that jumps more than
  5% in the latency is refused instead of chased. At most 5 open positions, at most 1.0 SOL
  deployed at cost, at most 2 entries per coin, 300-slot cooldown after an exit.

Exits — whole position, sells at 10000 bps slippage:
- take-profit at +20% of cost; stop-loss at -5% of cost;
- time limit 300 slots; creator sells while held: exit at once.

## Results (full-window local sim, the kit pilot's engine port)

- Defaults: +0.16 SOL net, 85-93 round trips, 46-47% win rate, max drawdown 0.019.
- The profit scales with size at a stable per-trade edge (~+4.7% of position); size is kept at
  0.05/0.10 SOL rather than pushed further, so that a weaker final window costs little.
- Guardrails: 85+ coins with >= 0.01 SOL round trips (bar: 20), max drawdown 0.019 (limit:
  0.50). Deterministic: pure function of the batch stream — no clock, no randomness, no I/O.

## What was tried and dropped

- Rolling-window momentum entries (any age up to 600 slots): -1.47 SOL.
- Dip-buying after the opening dump (15-30% below the 20-slot peak): ~breakeven gross, negative
  after fees.
- "Quiet launch" drift (coins with < 1 SOL net in slot 0, bought when real SOL first crossed
  1 SOL): -0.045 SOL on its own leg — dropped.
- Buying coins whose real SOL crossed 10/20/30 SOL to ride completion: -0.41 to -1.47 SOL —
  after the crossing the median coin dumps 65% before recovering, and stops get hit first.
