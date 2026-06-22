# Extending the Nifty Options Backtester

A practical guide for two kinds of future changes:

- **[Part A — Adding a new dataset](#part-a--adding-a-new-dataset)** (new month/year, or a different underlying). Mostly drop-in, little or no code.
- **[Part B — Adding a new strategy](#part-b--adding-a-new-strategy)** (a new entry signal). A contained code change across ~5 files; the whole results/charts pipeline is reused for free.

> Paths below assume the repo lives at `D:\Moksh\Website`. Run all backend commands from `D:\Moksh\Website\backend` with the venv active:
> ```powershell
> Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
> cd D:\Moksh\Website\backend
> .venv\Scripts\Activate.ps1
> ```

---

## Part A — Adding a new dataset

### How datasets flow through the app

```
raw CSVs  ──(convert_to_parquet)──►  options_<name>.parquet + spot_<name>.parquet
                                          │  (in backend/data/)
                                          ▼
                          GET /api/datasets auto-discovers any <name>
                          that has BOTH files  ──►  shows up in the
                          frontend "Dataset" dropdown automatically
```

There is **no list of datasets to edit anywhere** — the API globs the data folder
(`backend/app/main.py` → `list_datasets`) and the UI reads that list. Add the two
Parquet files and the dataset simply appears.

### Step 1 — Make sure your CSVs have the required columns

Column names are case-insensitive and spaces become underscores during cleaning
(`backend/app/engine/data_manager.py`), so `Strike Price` → `strike_price`.

**Options CSV** must contain:

| Column         | Notes                                              |
|----------------|----------------------------------------------------|
| `datetime`     | Per-minute timestamp (parseable by pandas)         |
| `expiry_date`  | Day-first dates (e.g. `28-12-2023`)                |
| `right`        | `Call` / `Put` (any case)                          |
| `stock_code`   | Used to filter the underlying (e.g. `NIFTY`)       |
| `strike_price` | Numeric                                            |
| `open`         | Used as the entry fill price                       |
| `high`, `low`  | OHLC                                               |
| `close`        | Required; rows with `close <= 0` are dropped       |
| `volume`       | Used for the Wall-Reversion liquidity/fill checks  |

**Spot CSV** must contain: `datetime`, `open`, `high`, `low`, `close` (and `volume`
is fine to include). Rows outside market hours (09:15–15:30) and with `close <= 0`
are dropped automatically.

> If your new data comes from a different vendor with different column names, the
> only code you'd touch is the two cleaning functions `clean_options_frame` /
> `clean_spot_frame` in `data_manager.py` — rename/derive columns there so the rest
> of the engine sees the standard names above.

### Step 2 — Convert to Parquet

Pick a short `--dataset` name (this becomes the dropdown label). For NIFTY data:

```powershell
python -m scripts.convert_to_parquet `
    --options "C:\path\to\your_options.csv" `
    --spot    "C:\path\to\your_spot.csv" `
    --dataset jan2024
```

For a **different underlying**, also pass `--stock-code` (it filters the options by
`stock_code`):

```powershell
python -m scripts.convert_to_parquet `
    --options "C:\path\to\banknifty_options.csv" `
    --spot    "C:\path\to\banknifty_spot.csv" `
    --dataset banknifty_jan2024 `
    --stock-code BANKNIFTY
```

You should see something like
`-> backend\data\options_jan2024.parquet (1,234,567 raw -> 1,200,000 clean rows, 4.5 MB, 6.1s)`.

### Step 3 — Verify

```powershell
# Files exist with the exact naming convention:
dir D:\Moksh\Website\backend\data
#   options_jan2024.parquet   spot_jan2024.parquet

# API sees it (backend must be running):
# open http://127.0.0.1:8000/api/datasets  -> {"datasets":["dec2023","jan2024"]}
```

Then in the UI, refresh the page → your dataset is in the **Dataset** dropdown.
Set the **Start / End date** to dates that exist in the new data and run it.

### Things to watch with bigger data

- **Different underlying → adjust sizing.** In the config form, set the correct
  **Lot size** and **Strike step** for that instrument (NIFTY defaults are 65 / 50).
- **Runtime scales with trading days.** The strategy scans minute-by-minute in
  Python and runs single-threaded (`--pool=solo`). A 19-day month is a few seconds;
  a full year is roughly ~12× that. Still fine for occasional runs — just slower.
- **Memory.** The worker loads the whole Parquet into RAM. A month is small
  (~5–11 MB); a multi-year, multi-symbol set could reach hundreds of MB+. If you go
  that big and it gets sluggish, that's the point to optimise (chunking/vectorising).
- **Market hours / risk-free rate** are constants in `backend/app/engine/constants.py`
  (`MARKET_OPEN/CLOSE`) and `strategy.py` (`r = 0.065`). Fine for Indian index
  options; revisit only if you model something with different conventions.

---

## Part B — Adding a new strategy

Strategies aren't config — they're code. The good news: you only write the **entry
signal** (which legs to open). Everything after that — exits, transaction costs,
analytics, the equity/drawdown/candlestick charts, the metric tiles, and the trade
log — is **strategy-agnostic** and works automatically once your strategy emits
`TradeLeg`s.

### The 5 places you touch

| # | File | What you add |
|---|------|--------------|
| 1 | `backend/app/engine/constants.py` | The strategy's name in the enums |
| 2 | `backend/app/engine/strategy.py` | A `_build_<name>_legs()` method + dispatch |
| 3 | `backend/app/engine/config.py` | Any new tunable parameters |
| 4 | `backend/app/schemas.py` | (only if the request shape needs it — usually nothing) |
| 5 | `frontend/src/components/config-panel.tsx` + `frontend/src/lib/api.ts` | The UI toggle/inputs + matching types |

### Step 1 — Register it in the enums (`constants.py`)

```python
class StrategyType(str, Enum):
    WALL_REVERSION = "Wall Reversion"
    ORB = "Opening Range Breakout"
    MY_STRATEGY = "My Strategy"          # <-- add

class RunMode(str, Enum):
    WALL_ONLY = "WALL_ONLY"
    ORB_ONLY = "ORB_ONLY"
    COMBINED = "COMBINED"
    MY_STRATEGY_ONLY = "MY_STRATEGY_ONLY"   # <-- add (see note on run_mode below)
```

### Step 2 — Write the signal + wire up dispatch (`strategy.py`)

Add a method that returns the legs to open for a given day. Use the `DataManager`
query API (`get_spot_price`, `get_spot_ema`, `get_option_price`,
`get_option_timeseries`, `get_available_expiries`, …) — the same tools the existing
strategies use.

```python
def _build_my_strategy_legs(
    self, date: pd.Timestamp, expiry: pd.Timestamp
) -> List[TradeLeg]:
    """Your entry logic — return a list of TradeLeg objects (or [] for no trade)."""
    legs: List[TradeLeg] = []

    spot = self.dm.get_spot_price(date + pd.Timedelta(hours=9, minutes=20))
    atm = self.get_atm_strike(spot, self.config.strike_step)
    entry_ts = date + pd.Timedelta(hours=9, minutes=20)

    entry_price = self.dm.get_option_price(
        entry_ts, expiry, "Call", atm, price_col="open"
    )
    if not entry_price or entry_price <= 0:
        return []

    # size by risk, exactly like the other strategies
    max_risk = self.config.capital * self.config.risk_per_trade_pct
    risk_per_lot = entry_price * 0.25 * self.config.lot_size
    lots = int(max_risk // risk_per_lot)
    if lots < 1:
        return []

    legs.append(TradeLeg(
        leg_id=f"T{self._trade_counter}_MYS_C_{int(atm)}",
        right=OptionRight.CALL,
        strike=atm,
        expiry=expiry,
        entry_time=entry_ts,
        entry_premium=entry_price,
        lot_size=self.config.lot_size,
        num_lots=lots,
        direction="BUY",
        stop_loss_pct=0.25,
        trailing_sl_pct=0.15,
        margin_blocked=entry_price * self.config.lot_size * lots,
    ))
    return legs
```

Then call it from `build_trade()` (same pattern as the Wall/ORB blocks), respecting
the margin ceiling:

```python
if mode in (RunMode.MY_STRATEGY_ONLY, RunMode.COMBINED):
    for leg in self._build_my_strategy_legs(date, expiry):
        leg.strategy_label = "My Strategy"
        if current_margin_used + leg.margin_blocked <= capital_ceiling:
            trade.legs.append(leg)
            current_margin_used += leg.margin_blocked
            trade.strategy_type = leg.strategy_label
```

> **TradeLeg fields** (`backend/app/engine/models.py`) define entry, sizing, and the
> stop-loss / trailing-stop percentages. The exit engine (`execution.py`) reads those
> and handles square-off, costs, and PnL for you — you don't write exit logic.

### Step 3 — Add any new parameters (`config.py`)

If your strategy has its own knobs, add validated fields to `StrategyConfig`:

```python
my_threshold: float = Field(default=0.5, ge=0.0, le=1.0, description="My signal threshold.")
```

Because `BacktestRequest` embeds `StrategyConfig` directly (`schemas.py`), the new
field is accepted by the API automatically — **no schema edit needed** in most cases.

### Step 4 — Surface it in the UI (`config-panel.tsx` + `api.ts`)

1. In `frontend/src/lib/api.ts`, extend the `RunMode` type and add any new fields to
   `StrategyConfigInput` to mirror the backend:
   ```ts
   export type RunMode = "WALL_ONLY" | "ORB_ONLY" | "COMBINED" | "MY_STRATEGY_ONLY";
   // add: my_threshold: number;  to StrategyConfigInput
   ```
2. In `frontend/src/components/config-panel.tsx`: add a toggle (like the Wall/ORB
   switches), include it in `deriveRunMode()`, and add any slider/input for the new
   parameter. Map it into the `config` object in `submit()`.

### Step 5 — Verify end to end

1. Restart the backend + Celery worker (the **Stop Nifty Backtester** then
   **Start Nifty Backtester** shortcut does this).
2. Toggle your strategy on, run a backtest.
3. The tear sheet, **Charts Explorer**, metric tiles, and trade log all populate from
   the legs your strategy produced — no changes needed there. New rows in the trade
   log will carry your `strategy` label and `leg_id`.

### One refactor worth doing before strategy #3

`run_mode` is currently a fixed enum built for two strategies
(`WALL_ONLY` / `ORB_ONLY` / `COMBINED`). Adding a third works, but the combinations
get awkward (you can't cleanly express "ORB + My Strategy but not Wall"). When you're
ready to go past two, the clean move is to replace `run_mode` with a **list of enabled
strategies** (e.g. `enabled: ["wall", "orb", "my_strategy"]`) and have `build_trade()`
loop over it. That makes every future strategy a pure add — no enum combinatorics.
Ask and this can be refactored in one pass.

---

## Quick reference — files by concern

| Concern | File |
|---------|------|
| Dataset discovery (API) | `backend/app/main.py` → `list_datasets` |
| CSV → Parquet converter | `backend/scripts/convert_to_parquet.py` |
| Data cleaning / column names | `backend/app/engine/data_manager.py` |
| Strategy entry signals | `backend/app/engine/strategy.py` |
| Strategy parameters | `backend/app/engine/config.py` |
| Enums (strategy names, run mode) | `backend/app/engine/constants.py` |
| Exit logic / costs (reused, rarely touched) | `backend/app/engine/execution.py`, `costs.py` |
| Analytics / metrics (reused) | `backend/app/engine/analytics.py` |
| API request/response shapes | `backend/app/schemas.py` |
| UI config form | `frontend/src/components/config-panel.tsx` |
| UI ↔ API types | `frontend/src/lib/api.ts` |
| Charts (strategy-agnostic) | `frontend/src/components/charts-explorer.tsx` |
