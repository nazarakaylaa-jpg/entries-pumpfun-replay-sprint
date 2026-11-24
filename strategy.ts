// Spike rider for agent-fun/replay/v2 (pump.fun bonding curves).
//
// Measured on the kit's dev window (1222 coins, 126,801 trades, 35 completions) before this bot
// was written; see STRATEGY.md. The facts that shape it:
//
// 1. The 2-slot fill latency eats the opening spike. From the moment a coin's real SOL first
//    crosses 1 SOL, the price moves +12% (median) before a buy decided on that batch fills, and
//    the forward 50-slot return from the fill price is -3.7% (median). Buying the launch after
//    the spike, chasing momentum, or buying dips are all structurally negative on dev — the pilot
//    sniper (-0.49 SOL), momentum (-9.66 SOL) and reversion (-4.08 SOL) bots all lose for exactly
//    this reason.
// 2. One pocket survives the latency, measured from the fill price (first trade >= decision + 2
//    slots), not from the decision price: coins whose price ran up >= 100% inside their create
//    slot hit +15% before -8% on 56% of coins (first passage from the fill price). They are
//    lottery tickets: most dump, a third spike again — and a tight stop with a 3:1 payoff makes
//    the trade positive. The edge strengthens with the run-up: at >= 200% the win rate is 67%.
//    The full slot-0 tape is visible in the create batch, so the bot decides on that batch and
//    the fill lands 2 slots later, still inside the spike's second leg.
//
// The bot therefore buys only on the create batch, only coins whose slot-0 tape ran up >= 100%,
// sized by the run-up (0.05 SOL, or 0.10 SOL at >= 200%), and exits whole on take-profit +20%,
// stop-loss -5%, a 300-slot time limit, or a creator sale. At most 5 open positions, at most 2
// entries per coin, 300-slot cooldown after an exit. Buys go out at 500 bps slippage so a fill
// that jumps more than 5% in the latency is refused instead of chased.
//
// Pure function of the batches the harness sends: no clock, no randomness, no I/O, iteration
// only over insertion-ordered maps fed by the batch stream, so the two graded executions agree.

import type { Batch, Bot, BotState, OrderInput, Pubkey } from './vendor/makefun-bot.ts';

export interface Params {
  /** Minimum price run-up inside the create slot (fraction over create price). */
  spikeMinRunup: number;
  /** SOL per first buy at the base tier. */
  spikeSize: number;
  /** Run-up at which the bigger tier applies, and its size. */
  spikeRunup2: number;
  spikeSize2: number;
  /** Take-profit / stop-loss on value vs cost (fractions). */
  spikeTp: number;
  spikeSl: number;
  /** Exit after this many slots held. */
  spikeHold: number;
  /** Smallest buy worth sending (tx fee is 105k lamports per order). */
  minBuySol: number;
  /** Slippage allowed on buys (bps); sells always go out at 10000. */
  buySlipBps: number;
  /** Exit at once when the creator sells while held. */
  exitOnDevSell: boolean;
  /** Slots to wait after an exit before the same coin may be bought again. */
  cooldown: number;
  /** Most entries per coin over the run. */
  maxEntries: number;
  /** Most SOL deployed at cost across all positions at once. */
  maxExposureSol: number;
}

export const DEFAULT_PARAMS: Params = {
  spikeMinRunup: 1.0,
  spikeSize: 0.05,
  spikeRunup2: 2.0,
  spikeSize2: 0.1,
  spikeTp: 0.2,
  spikeSl: 0.05,
  spikeHold: 300,
  minBuySol: 0.01,
  buySlipBps: 500,
  exitOnDevSell: true,
  cooldown: 300,
  maxEntries: 2,
  maxExposureSol: 1.0,
};

const LAMPORTS = 1e9;
const CURVE_FEE = 0.0125;

interface Trade {
  slot: number;
  buy: boolean;
  sol: number;
  user: string;
  price: number;
}

interface Tape {
  created: number | null;
  creator: string | null;
  createPrice: number;
  /** The create slot's trades, kept until the slot ends so the entry can read them. */
  slot0: Trade[];
  entries: number;
  lastExit: number;
  devSold: boolean;
}

interface Held {
  opened: number;
  buys: number;
  exiting: boolean;
  filled: boolean;
}

export function createStrategy(p: Params = DEFAULT_PARAMS): Bot {
  const tapes = new Map<Pubkey, Tape>();
  const held = new Map<Pubkey, Held>();

  const tapeOf = (mint: Pubkey): Tape => {
    let t = tapes.get(mint);
    if (t === undefined) {
      t = { created: null, creator: null, createPrice: 0, slot0: [], entries: 0, lastExit: -1e12, devSold: false };
      tapes.set(mint, t);
    }
    return t;
  };

  return {
    onBatch(state: BotState, batch: Batch): OrderInput[] {
      const now = batch.slot;
      const createdNow: Pubkey[] = [];
      for (const e of batch.events) {
        if (e.event === 'CreateEvent') {
          const t = tapeOf(e.mint);
          t.created = e.slot;
          t.creator = e.creator;
          t.createPrice = Number(e.virtual_quote_reserves) / Number(e.virtual_token_reserves);
          createdNow.push(e.mint);
        } else if (e.event === 'TradeEvent') {
          const t = tapeOf(e.mint);
          const sol = Number(e.sol_amount) / LAMPORTS;
          t.slot0.push({
            slot: e.slot,
            buy: e.is_buy,
            sol,
            user: e.user,
            price: Number(e.virtual_quote_reserves) / Number(e.virtual_token_reserves),
          });
          if (t.creator !== null && !e.is_buy && e.user === t.creator) t.devSold = true;
        }
      }
      const marks = new Map(batch.marks.map((m) => [m.mint, m] as const));
      const pendingByMint = new Map<Pubkey, number>();
      for (const po of state.pending.values()) {
        pendingByMint.set(po.order.mint, (pendingByMint.get(po.order.mint) ?? 0) + 1);
      }

      const orders: OrderInput[] = [];
      const cap = state.hello.caps.max_orders_per_batch;
      const tx = Number(state.txFeeLamports()) / LAMPORTS;

      // Exits first.
      for (const [mint, h] of held) {
        const pos = state.positions.get(mint);
        const curve = state.curves.get(mint);
        if (pos === undefined) {
          if (!pendingByMint.has(mint)) {
            held.delete(mint);
            const t = tapeOf(mint);
            if (h.filled) t.lastExit = now;
            else t.entries--;
          }
          continue;
        }
        h.filled = true;
        if (curve === undefined || curve.complete) continue;
        const mk = marks.get(mint);
        const vq = mk ? Number(mk.virtual_quote_reserves) : Number(curve.virtual_quote_reserves);
        const vt = mk ? Number(mk.virtual_token_reserves) : Number(curve.virtual_token_reserves);
        const tokens = Number(pos.token_amount);
        const value = ((tokens * vq) / (vt + tokens) / LAMPORTS) * (1 - CURVE_FEE) - tx;
        const cost = Number(pos.cost_lamports) / LAMPORTS + h.buys * tx;
        const t = tapeOf(mint);
        let exit = h.exiting;
        if (!exit && value >= cost * (1 + p.spikeTp)) exit = true;
        if (!exit && value <= cost * (1 - p.spikeSl)) exit = true;
        if (!exit && now - h.opened > p.spikeHold) exit = true;
        if (!exit && p.exitOnDevSell && t.devSold) exit = true;
        if (!exit) continue;
        h.exiting = true;
        if (pendingByMint.has(mint)) {
          let sellPending = false;
          for (const po of state.pending.values()) {
            if (po.order.mint === mint && po.order.side === 'sell') sellPending = true;
          }
          if (sellPending) continue;
        }
        if (orders.length >= cap) break;
        orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: 10_000 });
      }

      // Entries: coins created in this batch whose slot-0 tape already ran up.
      let free = Number(state.freeCashLamports()) / LAMPORTS;
      let slotsLeft = state.hello.caps.max_open_positions - state.committedPositionCount();
      let exposure = 0;
      for (const mint of held) {
        exposure += Number(state.positions.get(mint)?.cost_lamports ?? 0n) / LAMPORTS;
      }
      for (const mint of createdNow) {
        if (orders.length >= cap || slotsLeft <= 0) break;
        if (held.has(mint) || pendingByMint.has(mint)) continue;
        const curve = state.curves.get(mint);
        if (curve === undefined || curve.complete) continue;
        const t = tapes.get(mint)!;
        if (t.entries >= p.maxEntries || now - t.lastExit < p.cooldown) continue;
        if (t.slot0.length === 0) continue;
        const lastPrice = t.slot0[t.slot0.length - 1]!.price;
        const runup0 = t.createPrice > 0 ? lastPrice / t.createPrice - 1 : 0;
        if (runup0 < p.spikeMinRunup) continue;
        if (t.devSold) continue;
        const want = runup0 >= p.spikeRunup2 ? p.spikeSize2 : p.spikeSize;
        const capSol = Math.floor(Number(state.maxBuyLamports(mint)) * 0.97) / LAMPORTS;
        let amount = Math.min(capSol, want, p.maxExposureSol - exposure);
        if (amount > free - tx) amount = free - tx;
        if (amount < p.minBuySol) continue;
        orders.push({ side: 'buy', mint, quote_lamports: BigInt(Math.floor(amount * LAMPORTS)), max_slippage_bps: p.buySlipBps });
        free -= amount + tx;
        exposure += amount;
        held.set(mint, { opened: now, buys: 1, exiting: false, filled: false });
        t.entries++;
        slotsLeft--;
      }
      return orders;
    },
  };
}
