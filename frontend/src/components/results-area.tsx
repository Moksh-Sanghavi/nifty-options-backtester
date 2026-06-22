"use client";

/**
 * ResultsArea — renders the main content for each backtest phase:
 * idle (empty state), running (animated progress), error, and success
 * (headline performance tiles). The detailed equity/drawdown charts and the
 * trade-log table are layered in during Phase 4.
 */
import {
  AlertTriangle,
  BarChart3,
  Gauge,
  LineChart,
  Loader2,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ChartsExplorer } from "@/components/charts-explorer";
import { TradeLogTable } from "@/components/trade-log-table";
import { DEFAULT_ANCHORS } from "@/lib/charts-data";
import { ProgressInfo, ResultsResponse } from "@/lib/api";
import {
  formatINRCompact,
  formatNumber,
  formatPct,
  formatSigned,
} from "@/lib/format";
import { BacktestPhase } from "@/hooks/use-backtest";
import { cn } from "@/lib/utils";

interface ResultsAreaProps {
  phase: BacktestPhase;
  progress: ProgressInfo | null;
  results: ResultsResponse | null;
  error: string | null;
  onReset: () => void;
}

export function ResultsArea({
  phase,
  progress,
  results,
  error,
  onReset,
}: ResultsAreaProps) {
  if (phase === "idle") return <IdleState />;
  if (phase === "running") return <RunningState progress={progress} />;
  if (phase === "error") return <ErrorState error={error} onReset={onReset} />;
  if (phase === "success" && results) return <SuccessState results={results} />;
  return <IdleState />;
}

/* ── Idle ─────────────────────────────────────────────────────────────── */
function IdleState() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start gap-4">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/20">
          <BarChart3 className="size-6" />
        </div>
        <div>
          <h2 className="text-gradient text-xl font-semibold tracking-tight">
            Performance Explorer
          </h2>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            Configure your strategy on the left and run a simulation to generate
            a live tear sheet. Below is a sample of the interactive charts you’ll
            get — switch between equity, drawdown and spot price.
          </p>
        </div>
      </div>

      <ChartsExplorer anchors={DEFAULT_ANCHORS} sample />
    </div>
  );
}

/* ── Running ──────────────────────────────────────────────────────────── */
function RunningState({ progress }: { progress: ProgressInfo | null }) {
  const percent = progress?.percent ?? 0;
  const hasDays = (progress?.total ?? 0) > 0;

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6">
      <div className="glass-panel w-full max-w-md rounded-2xl p-8">
        <div className="flex items-center gap-3">
          <Loader2 className="size-5 animate-spin text-primary" />
          <div>
            <p className="text-sm font-semibold">Running simulation</p>
            <p className="text-xs text-muted-foreground">
              {hasDays
                ? `Processing day ${progress?.current} of ${progress?.total}`
                : "Queued — warming up the engine…"}
            </p>
          </div>
          <span className="nums font-heading ml-auto text-2xl font-semibold tabular-nums text-primary">
            {Math.round(percent)}%
          </span>
        </div>

        <Progress
          value={percent}
          className={cn("mt-5", !hasDays && "animate-pulse")}
        />
      </div>
    </div>
  );
}

/* ── Error ────────────────────────────────────────────────────────────── */
function ErrorState({
  error,
  onReset,
}: {
  error: string | null;
  onReset: () => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-destructive/10 text-destructive ring-1 ring-destructive/20">
        <AlertTriangle className="size-7" />
      </div>
      <div className="max-w-md">
        <h2 className="text-lg font-semibold">Backtest failed</h2>
        <p className="mt-1 break-words text-sm text-muted-foreground">
          {error ?? "An unexpected error occurred."}
        </p>
      </div>
      <Button variant="outline" onClick={onReset}>
        Dismiss
      </Button>
    </div>
  );
}

/* ── Success ──────────────────────────────────────────────────────────── */
interface TileProps {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "neutral" | "positive" | "negative";
  sub?: string;
}

function MetricTile({ label, value, icon: Icon, tone = "neutral", sub }: TileProps) {
  return (
    <div className="glass-card group rounded-xl p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <span
          className={cn(
            "flex size-7 items-center justify-center rounded-lg ring-1 transition-colors",
            tone === "positive" && "bg-positive/10 text-positive ring-positive/20",
            tone === "negative" && "bg-negative/10 text-negative ring-negative/20",
            tone === "neutral" && "bg-muted/40 text-muted-foreground ring-border",
          )}
        >
          <Icon className="size-4" />
        </span>
      </div>
      <p
        className={cn(
          "nums font-heading mt-2.5 text-2xl font-semibold tracking-tight",
          tone === "positive" && "text-positive",
          tone === "negative" && "text-negative",
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function SuccessState({ results }: { results: ResultsResponse }) {
  const s = results.summary;

  // A valid run that simply produced no trades for the chosen parameters.
  if (!s || s.total_trades === undefined || results.trade_log.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
        <div className="flex size-16 items-center justify-center rounded-2xl bg-muted/40 text-muted-foreground ring-1 ring-border">
          <BarChart3 className="size-7" />
        </div>
        <div className="max-w-sm">
          <h2 className="text-lg font-semibold">No trades generated</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The backtest completed but produced no executions for these
            parameters or date range. Try widening the dates or relaxing the
            entry thresholds.
          </p>
        </div>
      </div>
    );
  }

  const pnlTone = s.total_pnl >= 0 ? "positive" : "negative";

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-gradient text-xl font-semibold tracking-tight">
          Performance Tear Sheet
        </h2>
        <p className="text-sm text-muted-foreground">
          {s.total_days} trading days · {s.total_trades} executions
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricTile
          label="Total PnL"
          value={formatSigned(s.total_pnl)}
          sub={`${formatNumber(s.total_pnl_points, 0)} pts`}
          icon={pnlTone === "positive" ? TrendingUp : TrendingDown}
          tone={pnlTone}
        />
        <MetricTile
          label="Return on Capital"
          value={formatPct(s.return_on_capital_pct)}
          sub={`Final ${formatINRCompact(s.final_equity)}`}
          icon={TrendingUp}
          tone={s.return_on_capital_pct >= 0 ? "positive" : "negative"}
        />
        <MetricTile
          label="Max Drawdown"
          value={formatINRCompact(s.max_drawdown_inr)}
          sub={formatPct(s.max_drawdown_pct)}
          icon={TrendingDown}
          tone="negative"
        />
        <MetricTile
          label="Sharpe (daily)"
          value={formatNumber(s.sharpe, 2)}
          icon={Gauge}
        />
        <MetricTile
          label="Trade Win Rate"
          value={formatPct(s.trade_win_rate)}
          icon={BarChart3}
        />
        <MetricTile
          label="Daily Win Rate"
          value={formatPct(s.daily_win_rate)}
          icon={BarChart3}
        />
        <MetricTile
          label="Profit Factor"
          value={s.profit_factor === null ? "∞" : formatNumber(s.profit_factor, 2)}
          icon={Gauge}
        />
        <MetricTile
          label="Initial Capital"
          value={formatINRCompact(s.initial_capital)}
          icon={LineChart}
        />
      </div>

      <ChartsExplorer
        anchors={{
          initialCapital: s.initial_capital,
          totalPnl: s.total_pnl,
          maxDrawdown: Math.abs(s.max_drawdown_inr),
        }}
        realDates={results.equity_curve.map((p) => p.date)}
        realEquity={results.equity_curve.map((p) => p.equity)}
      />

      <DetailedMetrics metrics={results.metrics} />

      <TradeLogTable rows={results.trade_log} />
    </div>
  );
}

/* ── Detailed metrics ─────────────────────────────────────────────────── */
function DetailedMetrics({
  metrics,
}: {
  metrics: Record<string, number | string | null>;
}) {
  const entries = Object.entries(metrics);
  if (entries.length === 0) return null;

  const render = (v: number | string | null) =>
    v === null
      ? "∞"
      : typeof v === "number"
        ? new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(v)
        : v;

  return (
    <div className="glass-surface rounded-xl p-4">
      <h3 className="mb-3 text-sm font-semibold">All Metrics</h3>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {entries.map(([key, value]) => (
          <div
            key={key}
            className="flex items-baseline justify-between gap-3 border-b border-border/40 py-1"
          >
            <dt className="text-xs text-muted-foreground">{key}</dt>
            <dd className="nums text-sm font-medium">{render(value)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
