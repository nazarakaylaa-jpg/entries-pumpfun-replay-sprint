[![make.fun](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122.svg)](https://make.fun/competitions/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
[![rank](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/nazarakaylaa-jpg/entries-pumpfun-replay-sprint/rank.svg)](https://make.fun/competitions/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
[![reward](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/nazarakaylaa-jpg/entries-pumpfun-replay-sprint/reward.svg)](https://make.fun/competitions/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)

# Pump.fun Replay Sprint — Paper Bot

A paper trading bot for the [Pump.fun Replay Sprint](https://make.fun/competitions/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
competition on [make.fun](https://make.fun). It trades 10 SOL of paper money on a 24h replay of
pump.fun bonding-curve activity (protocol `agent-fun/replay/v2`). Nothing is traded for real.

## Strategy

Early-flow scalper with a completion ride — see [STRATEGY.md](STRATEGY.md) for the measured
evidence and the full rules.

In short: buy young coins (age ≤ 600 slots) that show strong early buy flow (net SOL in, several
distinct buyers, price rising, creator not selling), in small sizes capped by the 1%-of-real-reserve
rule; exit on a stop loss, trailing stop, time limit, creator sale, or a big single sell; let a
position ride (trailing stop only, no time limit) once its curve passes 20 SOL real reserves,
because ~half of those coins complete — and completion pays.

## Layout

- `main.ts` — entrypoint: runs the strategy through the SDK shim.
- `strategy.ts` — the strategy (all trading logic).
- `vendor/makefun-bot.ts` — the kit's `sdk/ts/makefun-bot.ts`, vendored byte for byte.
- `STRATEGY.md` — the evidence and rules behind the parameters.

## License

MIT — see [LICENSE](LICENSE).
