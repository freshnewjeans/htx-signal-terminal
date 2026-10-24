# HTX Futures Signal Terminal

A real-time crypto trading signal terminal for **HTX USDT-margined perpetual futures**, built as a single self-contained HTML app. It runs entirely in your browser and pulls live market data straight from the HTX public API — no server or install needed.

Designed & Created by **Kevin Lim Fung Yen**.

## Features

- **Live data** from HTX USDT-margined perpetuals (REST API), auto-refreshed every 25s.
- **Signal engine** — EMA 9/21/50 golden/death-cross detection plus candlestick patterns (Hammer, Shooting Star, Bullish/Bearish Engulfing, Piercing Line, Dark Cloud, Morning/Evening Star, Three White Soldiers/Crows, Doji).
- **Confirmation → retrace → rejection entry model**:
  1. Confirm the direction (EMA cross or pattern aligned with the trend).
  2. Wait for a pullback into the Fibonacci retrace of the swing.
  3. Enter only when the pullback prints a **rejection** (pin bar / engulfing) at the level.
  - Entry rejections are only valid on **4H and above** (configurable).
- **Stop loss & take profit** — stop at the swing extreme ± ATR(14) buffer; target at a risk–reward multiple (default 2R).
- **Multi-timeframe** — main chart with 1m–1W tabs plus an 8-timeframe mini-chart grid; click any mini-chart to make it the main view.
- **macOS-themed UI** — dark glass design, EMA overlays, Entry/SL/TP price lines, signal markers, live bias, EMA status, and a signal log filterable by **Entries** (actionable) vs **All** (confirmations).
- **Configurable** — EMA periods, retrace %, RR target, SL buffer, and the minimum entry-rejection timeframe.

## How to run

Just open **`HTX-Futures-Signal-Terminal.html`** in a browser (Chrome recommended).

Or serve it locally:

```bash
python -m http.server 8000
# then open http://localhost:8000
```

Enter any contract, e.g. `BTC-USDT`, `ETH-USDT`, `SOL-USDT`, `PEPE-USDT`.

## Strategy note

This is a signal reference tool — it identifies setups and marks the entry, stop and target. It does **not** place orders automatically. You execute trades manually on HTX when the app confirms an entry.
