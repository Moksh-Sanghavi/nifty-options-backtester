/**
 * Typed client for the FastAPI backtest API.
 *
 * Mirrors the Pydantic schemas in `backend/app/schemas.py`. The base URL is
 * read from `NEXT_PUBLIC_API_BASE_URL` (falls back to the local dev server).
 */

// Empty by default → calls are same-origin (`/api/...`) and the Next server
// proxies them to the backend (see `rewrites` in next.config.ts). This keeps
// the browser talking to a single origin, so one tunnel/host serves the whole
// app with no CORS setup. Override with NEXT_PUBLIC_API_BASE_URL to hit a
// backend directly.
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

/** Run mode selecting which strategies execute. */
export type RunMode = "WALL_ONLY" | "ORB_ONLY" | "COMBINED";

/** Strategy parameters sent to the engine (mirrors engine StrategyConfig). */
export interface StrategyConfigInput {
  run_mode: RunMode;
  strategy_type: string;
  entry_time: string;
  exit_time: string;
  expiry_selection: string;
  orb_minutes: number;
  orb_cutoff_time: string;
  iv_drop_threshold: number;
  required_anomalies: number;
  capital: number;
  risk_per_trade_pct: number;
  lot_size: number;
  strike_step: number;
}

/** Body for POST /api/backtest/start. */
export interface BacktestRequest {
  config: StrategyConfigInput;
  start_date: string | null;
  end_date: string | null;
  dataset: string;
}

export interface StartResponse {
  task_id: string;
  status: string;
}

export interface ProgressInfo {
  current: number;
  total: number;
  percent: number;
}

export type TaskState =
  | "PENDING"
  | "STARTED"
  | "PROGRESS"
  | "SUCCESS"
  | "FAILURE"
  | "RETRY"
  | "REVOKED";

export interface StatusResponse {
  task_id: string;
  status: TaskState;
  progress: ProgressInfo | null;
  error: string | null;
}

export interface EquityPoint {
  date: string;
  pnl: number;
  cumulative_pnl: number;
  equity: number;
  drawdown: number;
  drawdown_pct: number;
}

export interface TradeLogRow {
  trade_id: number;
  strategy: string;
  date: string;
  leg_id: string;
  right: string;
  strike: number;
  direction: string;
  expiry: string;
  entry_time: string | null;
  exit_time: string | null;
  entry_premium: number;
  exit_premium: number;
  premium_change: number;
  lots: number;
  lot_size: number;
  margin_blocked: number;
  net_pnl_inr: number;
  exit_reason: string;
}

export interface BacktestSummary {
  total_pnl: number;
  total_pnl_points: number;
  max_drawdown_inr: number;
  max_drawdown_pct: number;
  trade_win_rate: number;
  daily_win_rate: number;
  sharpe: number;
  profit_factor: number | null;
  total_trades: number;
  total_days: number;
  return_on_capital_pct: number;
  initial_capital: number;
  final_equity: number;
}

export interface ResultsResponse {
  task_id: string;
  status: string;
  metrics: Record<string, number | string | null>;
  summary: BacktestSummary;
  equity_curve: EquityPoint[];
  trade_log: TradeLogRow[];
}

/** Parse a JSON error body from FastAPI into a readable message. */
async function toError(res: Response): Promise<Error> {
  let detail = `Request failed (${res.status})`;
  try {
    const body = await res.json();
    if (typeof body?.detail === "string") {
      detail = body.detail;
    } else if (Array.isArray(body?.detail)) {
      // FastAPI-style validation error array: [{ loc, msg }, ...]
      detail = body.detail
        .map((e: { loc?: unknown[]; msg?: string }) => {
          const loc = (e.loc ?? []).filter((p) => p !== "body").join(" → ");
          return loc ? `${loc}: ${e.msg}` : e.msg;
        })
        .join("; ");
    }
  } catch {
    /* non-JSON error body — keep the default message */
  }
  return new Error(detail);
}

/** GET the list of available dataset names. */
export async function fetchDatasets(): Promise<string[]> {
  const res = await fetch(`${API_BASE_URL}/api/datasets`, { cache: "no-store" });
  if (!res.ok) throw await toError(res);
  const data = (await res.json()) as { datasets: string[] };
  return data.datasets;
}

/** POST a backtest request and return the enqueued task id. */
export async function startBacktest(
  request: BacktestRequest,
): Promise<StartResponse> {
  const res = await fetch(`${API_BASE_URL}/api/backtest/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!res.ok) throw await toError(res);
  return res.json();
}

/** GET the current status / progress of a task. */
export async function getBacktestStatus(
  taskId: string,
): Promise<StatusResponse> {
  const res = await fetch(`${API_BASE_URL}/api/backtest/status/${taskId}`, {
    cache: "no-store",
  });
  if (!res.ok) throw await toError(res);
  return res.json();
}

/** GET the completed results of a task. */
export async function getBacktestResults(
  taskId: string,
): Promise<ResultsResponse> {
  const res = await fetch(`${API_BASE_URL}/api/backtest/results/${taskId}`, {
    cache: "no-store",
  });
  if (!res.ok) throw await toError(res);
  return res.json();
}
