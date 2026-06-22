"use client";

/**
 * ChartsExplorer — an interactive, D3-powered multi-view chart surface.
 *
 * A single prominent dropdown switches between three views that all share one
 * synchronised daily time axis:
 *   • Equity Curve        — cumulative account equity (area + line).
 *   • Max Drawdown Chart  — daily drawdown %, filled below zero, peak marked.
 *   • Spot Price Candles  — OHLC candlesticks for the underlying.
 *
 * Data is generated from the backtest anchors (see lib/charts-data) so the
 * three series are internally consistent. Switching views cross-fades and
 * re-animates; hovering reveals a crosshair + rich tooltip.
 */
import * as d3 from "d3";
import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, CandlestickChart, LineChart, TrendingDown } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ChartAnchors,
  DEFAULT_ANCHORS,
  DayPoint,
  generateChartSeries,
} from "@/lib/charts-data";
import { cn } from "@/lib/utils";

type View = "equity" | "drawdown" | "candlestick";

const VIEW_META: Record<
  View,
  { label: string; icon: React.ComponentType<{ className?: string }>; unit: string }
> = {
  equity: { label: "Equity Curve", icon: LineChart, unit: "Account balance (₹)" },
  drawdown: { label: "Max Drawdown Chart", icon: TrendingDown, unit: "% of capital" },
  candlestick: { label: "Spot Price Candlestick", icon: CandlestickChart, unit: "NIFTY spot (₹)" },
};

const COLOR = {
  up: "#34d399",
  down: "#fb7185",
  grid: "rgba(255,255,255,0.055)",
  axis: "rgba(235,235,245,0.45)",
  zero: "rgba(255,255,255,0.28)",
};

const MARGIN = { top: 18, right: 26, bottom: 38, left: 70 };
const HEIGHT = 384;

const parseDate = d3.timeParse("%Y-%m-%d");
const fmtAxisDate = d3.timeFormat("%b %d");
const fmtFullDate = d3.timeFormat("%a, %b %d %Y");

function inrCompact(v: number): string {
  const a = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (a >= 1e7) return `${sign}₹${(a / 1e7).toFixed(2)}Cr`;
  if (a >= 1e5) return `${sign}₹${(a / 1e5).toFixed(2)}L`;
  if (a >= 1e3) return `${sign}₹${(a / 1e3).toFixed(1)}K`;
  return `${sign}₹${a.toFixed(0)}`;
}
const inrFull = (v: number) =>
  `${v < 0 ? "-" : ""}₹${new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 0,
  }).format(Math.abs(v))}`;

interface ChartsExplorerProps {
  anchors?: ChartAnchors;
  /** Optional real series to anchor the equity/drawdown views to. */
  realDates?: string[];
  realEquity?: number[];
  /** Small "Sample data" hint shown in idle/demo mode. */
  sample?: boolean;
}

export function ChartsExplorer({
  anchors = DEFAULT_ANCHORS,
  realDates,
  realEquity,
  sample = false,
}: ChartsExplorerProps) {
  const [view, setView] = useState<View>("equity");
  const [width, setWidth] = useState(720);
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const series = useMemo(
    () => generateChartSeries(anchors, { realDates, realEquity }),
    [anchors, realDates, realEquity],
  );

  // Responsive width.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(w);
    });
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Draw / redraw whenever data, view, or width changes.
  useEffect(() => {
    const svg = d3.select(svgRef.current);
    const tooltip = d3.select(tooltipRef.current);
    if (!svgRef.current || width <= 0) return;

    const innerW = Math.max(40, width - MARGIN.left - MARGIN.right);
    const innerH = HEIGHT - MARGIN.top - MARGIN.bottom;
    const pts = series.points;

    svg.selectAll("*").remove();
    const defs = svg.append("defs");

    const root = svg
      .append("g")
      .attr("transform", `translate(${MARGIN.left},${MARGIN.top})`);

    // Cross-fade the whole plot in on every (re)render → smooth view switches.
    root.attr("opacity", 0).transition().duration(420).attr("opacity", 1);

    // Shared band scale → identical daily axis across all three views.
    const x = d3
      .scaleBand<string>()
      .domain(pts.map((p) => p.date))
      .range([0, innerW])
      .paddingInner(0.32)
      .paddingOuter(0.18);
    const cx = (d: DayPoint) => (x(d.date) ?? 0) + x.bandwidth() / 2;

    // X axis (shared) — label every ~Nth day to avoid crowding.
    const step = Math.ceil(pts.length / 8);
    const xTickVals = pts.filter((_, i) => i % step === 0).map((p) => p.date);
    const xAxis = root
      .append("g")
      .attr("transform", `translate(0,${innerH})`)
      .call(
        d3
          .axisBottom(x)
          .tickValues(xTickVals)
          .tickSize(0)
          .tickPadding(10)
          .tickFormat((d) => {
            const dt = parseDate(d as string);
            return dt ? fmtAxisDate(dt) : (d as string);
          }),
      );
    xAxis.select(".domain").attr("stroke", "rgba(255,255,255,0.1)");
    xAxis.selectAll("text").attr("fill", COLOR.axis).attr("font-size", 11);

    const horizontalGrid = (y: d3.ScaleLinear<number, number>) => {
      const ticks = y.ticks(6);
      root
        .append("g")
        .attr("class", "grid")
        .selectAll("line")
        .data(ticks)
        .join("line")
        .attr("x1", 0)
        .attr("x2", innerW)
        .attr("y1", (d) => y(d))
        .attr("y2", (d) => y(d))
        .attr("stroke", COLOR.grid)
        .attr("stroke-dasharray", "3 4");
    };

    const yAxisLeft = (
      y: d3.ScaleLinear<number, number>,
      fmt: (v: number) => string,
    ) => {
      const g = root.append("g").call(
        d3
          .axisLeft(y)
          .ticks(6)
          .tickSize(0)
          .tickPadding(12)
          .tickFormat((d) => fmt(d as number)),
      );
      g.select(".domain").remove();
      g.selectAll("text").attr("fill", COLOR.axis).attr("font-size", 11);
      return g;
    };

    // Overlay + tooltip helpers (line views) -------------------------------
    const showTooltip = (html: string, px: number, py: number) => {
      tooltip
        .style("opacity", "1")
        .html(html)
        .style("left", `${px}px`)
        .style("top", `${py}px`);
    };
    const hideTooltip = () => tooltip.style("opacity", "0");

    /* ── Equity Curve ─────────────────────────────────────────────────── */
    if (view === "equity") {
      const y = d3
        .scaleLinear()
        .domain([
          (d3.min(pts, (p) => p.equity) ?? 0) * 0.985,
          (d3.max(pts, (p) => p.equity) ?? 1) * 1.012,
        ])
        .range([innerH, 0]);

      horizontalGrid(y);
      yAxisLeft(y, inrCompact);

      const grad = defs
        .append("linearGradient")
        .attr("id", "eqGrad")
        .attr("x1", "0").attr("y1", "0").attr("x2", "0").attr("y2", "1");
      grad.append("stop").attr("offset", "0%").attr("stop-color", COLOR.up).attr("stop-opacity", 0.42);
      grad.append("stop").attr("offset", "100%").attr("stop-color", COLOR.up).attr("stop-opacity", 0);

      const area = d3
        .area<DayPoint>()
        .x(cx)
        .y0(innerH)
        .y1((d) => y(d.equity))
        .curve(d3.curveMonotoneX);
      const line = d3
        .line<DayPoint>()
        .x(cx)
        .y((d) => y(d.equity))
        .curve(d3.curveMonotoneX);

      root
        .append("path")
        .datum(pts)
        .attr("fill", "url(#eqGrad)")
        .attr("d", area)
        .attr("opacity", 0)
        .transition()
        .delay(180)
        .duration(500)
        .attr("opacity", 1);

      const path = root
        .append("path")
        .datum(pts)
        .attr("fill", "none")
        .attr("stroke", COLOR.up)
        .attr("stroke-width", 2.25)
        .attr("stroke-linejoin", "round")
        .attr("d", line);
      const total = (path.node() as SVGPathElement).getTotalLength();
      path
        .attr("stroke-dasharray", `${total} ${total}`)
        .attr("stroke-dashoffset", total)
        .transition()
        .duration(900)
        .ease(d3.easeCubicInOut)
        .attr("stroke-dashoffset", 0);

      // Final point marker.
      const last = pts[series.lastIndex];
      root
        .append("circle")
        .attr("cx", cx(last))
        .attr("cy", y(last.equity))
        .attr("r", 0)
        .attr("fill", COLOR.up)
        .attr("stroke", "rgba(0,0,0,0.4)")
        .attr("stroke-width", 1.5)
        .transition()
        .delay(900)
        .duration(300)
        .attr("r", 5);

      bindCrosshair(pts, cx, (d) => y(d.equity), (d) =>
        `<div class="ce-tt-date">${fmtFullDate(parseDate(d.date)!)}</div>
         <div class="ce-tt-row"><span>Equity</span><b>${inrFull(d.equity)}</b></div>
         <div class="ce-tt-row"><span>Drawdown</span><b style="color:${COLOR.down}">${d.drawdownPct.toFixed(2)}%</b></div>`,
      );
    }

    /* ── Max Drawdown Chart ───────────────────────────────────────────── */
    if (view === "drawdown") {
      const minDd = d3.min(pts, (p) => p.drawdownPct) ?? -1;
      const y = d3
        .scaleLinear()
        .domain([minDd * 1.18, 0])
        .range([innerH, 0])
        .nice();

      horizontalGrid(y);
      yAxisLeft(y, (v) => `${v.toFixed(0)}%`);

      const grad = defs
        .append("linearGradient")
        .attr("id", "ddGrad")
        .attr("x1", "0").attr("y1", "0").attr("x2", "0").attr("y2", "1");
      grad.append("stop").attr("offset", "0%").attr("stop-color", COLOR.down).attr("stop-opacity", 0.05);
      grad.append("stop").attr("offset", "100%").attr("stop-color", COLOR.down).attr("stop-opacity", 0.4);

      const area = d3
        .area<DayPoint>()
        .x(cx)
        .y0(y(0))
        .y1((d) => y(d.drawdownPct))
        .curve(d3.curveMonotoneX);
      const line = d3
        .line<DayPoint>()
        .x(cx)
        .y((d) => y(d.drawdownPct))
        .curve(d3.curveMonotoneX);

      // Emphasised zero line.
      root
        .append("line")
        .attr("x1", 0).attr("x2", innerW)
        .attr("y1", y(0)).attr("y2", y(0))
        .attr("stroke", COLOR.zero)
        .attr("stroke-width", 1);

      root
        .append("path")
        .datum(pts)
        .attr("fill", "url(#ddGrad)")
        .attr("d", area)
        .attr("opacity", 0)
        .transition().delay(160).duration(500).attr("opacity", 1);

      const path = root
        .append("path")
        .datum(pts)
        .attr("fill", "none")
        .attr("stroke", COLOR.down)
        .attr("stroke-width", 2.25)
        .attr("d", line);
      const total = (path.node() as SVGPathElement).getTotalLength();
      path
        .attr("stroke-dasharray", `${total} ${total}`)
        .attr("stroke-dashoffset", total)
        .transition().duration(900).ease(d3.easeCubicInOut)
        .attr("stroke-dashoffset", 0);

      // Peak drawdown marker + callout.
      const trough = pts[series.troughIndex];
      const tx = cx(trough);
      const ty = y(trough.drawdownPct);
      const marker = root.append("g").attr("opacity", 0);
      marker.transition().delay(950).duration(350).attr("opacity", 1);
      marker
        .append("line")
        .attr("x1", tx).attr("x2", tx)
        .attr("y1", y(0)).attr("y2", ty)
        .attr("stroke", COLOR.down)
        .attr("stroke-width", 1)
        .attr("stroke-dasharray", "2 3");
      marker
        .append("circle")
        .attr("cx", tx).attr("cy", ty).attr("r", 5)
        .attr("fill", COLOR.down)
        .attr("stroke", "rgba(0,0,0,0.45)").attr("stroke-width", 1.5);
      const labelText = `Max DD ${trough.drawdownPct.toFixed(1)}%`;
      const labelW = labelText.length * 6.4 + 16;
      const lx = Math.min(Math.max(tx - labelW / 2, 0), innerW - labelW);
      const lg = marker.append("g").attr("transform", `translate(${lx},${ty + 14})`);
      lg.append("rect")
        .attr("width", labelW).attr("height", 22).attr("rx", 6)
        .attr("fill", "rgba(20,16,18,0.92)")
        .attr("stroke", COLOR.down).attr("stroke-opacity", 0.5);
      lg.append("text")
        .attr("x", labelW / 2).attr("y", 15)
        .attr("text-anchor", "middle")
        .attr("fill", COLOR.down)
        .attr("font-size", 11).attr("font-weight", 600)
        .text(labelText);

      bindCrosshair(pts, cx, (d) => y(d.drawdownPct), (d) =>
        `<div class="ce-tt-date">${fmtFullDate(parseDate(d.date)!)}</div>
         <div class="ce-tt-row"><span>Drawdown</span><b style="color:${COLOR.down}">${d.drawdownPct.toFixed(2)}%</b></div>
         <div class="ce-tt-row"><span>From peak</span><b>${inrFull(d.drawdownInr)}</b></div>`,
      );
    }

    /* ── Spot Price Candlestick ───────────────────────────────────────── */
    if (view === "candlestick") {
      const y = d3
        .scaleLinear()
        .domain([
          (d3.min(pts, (p) => p.low) ?? 0) - 60,
          (d3.max(pts, (p) => p.high) ?? 1) + 60,
        ])
        .range([innerH, 0]);

      horizontalGrid(y);
      yAxisLeft(y, (v) => v.toFixed(0));

      const candleW = Math.min(x.bandwidth(), 22);
      const g = root
        .append("g")
        .selectAll("g")
        .data(pts)
        .join("g")
        .attr("transform", (d) => `translate(${cx(d)},0)`)
        .style("cursor", "crosshair");

      const isLast = (_d: DayPoint, i: number) => i === series.lastIndex;
      const color = (d: DayPoint) => (d.close >= d.open ? COLOR.up : COLOR.down);

      // Wicks.
      g.append("line")
        .attr("x1", 0).attr("x2", 0)
        .attr("y1", (d) => y(d.high)).attr("y2", (d) => y(d.high))
        .attr("stroke", color)
        .attr("stroke-width", (d, i) => (isLast(d, i) ? 1.6 : 1.1))
        .transition().delay((_d, i) => 120 + i * 22).duration(260)
        .attr("y2", (d) => y(d.low));

      // Bodies (grow from open price).
      g.append("rect")
        .attr("x", -candleW / 2)
        .attr("width", candleW)
        .attr("rx", 1.5)
        .attr("y", (d) => y(d.open))
        .attr("height", 0)
        .attr("fill", color)
        .attr("fill-opacity", (d, i) => (isLast(d, i) ? 1 : 0.85))
        .attr("stroke", (d, i) => (isLast(d, i) ? "#fff" : color(d)))
        .attr("stroke-opacity", (d, i) => (isLast(d, i) ? 0.85 : 0.3))
        .attr("stroke-width", (d, i) => (isLast(d, i) ? 1.4 : 0.8))
        .transition().delay((_d, i) => 120 + i * 22).duration(300)
        .attr("y", (d) => y(Math.max(d.open, d.close)))
        .attr("height", (d) => Math.max(1.5, Math.abs(y(d.open) - y(d.close))));

      // Highlight ring + label on the final candle.
      const last = pts[series.lastIndex];
      const fg = root
        .append("g")
        .attr("transform", `translate(${cx(last)},0)`)
        .attr("opacity", 0);
      fg.transition().delay(120 + pts.length * 22).duration(350).attr("opacity", 1);
      fg.append("rect")
        .attr("x", -candleW / 2 - 4)
        .attr("width", candleW + 8)
        .attr("y", y(Math.max(last.high)) - 4)
        .attr("height", Math.abs(y(last.high) - y(last.low)) + 8)
        .attr("rx", 4)
        .attr("fill", "none")
        .attr("stroke", "#fff")
        .attr("stroke-opacity", 0.25)
        .attr("stroke-dasharray", "3 3");

      // Per-candle hover tooltip.
      g.on("pointerenter", function (event, d) {
        d3.select(this).select("rect").attr("fill-opacity", 1);
        const [mx, my] = d3.pointer(event, containerRef.current);
        showTooltip(
          `<div class="ce-tt-date">${fmtFullDate(parseDate(d.date)!)}</div>
           <div class="ce-tt-ohlc">
             <span>O</span><b>${d.open.toFixed(1)}</b>
             <span>H</span><b style="color:${COLOR.up}">${d.high.toFixed(1)}</b>
             <span>L</span><b style="color:${COLOR.down}">${d.low.toFixed(1)}</b>
             <span>C</span><b>${d.close.toFixed(1)}</b>
           </div>`,
          mx + 16,
          my + 12,
        );
      })
        .on("pointermove", function (event) {
          const [mx, my] = d3.pointer(event, containerRef.current);
          tooltip.style("left", `${mx + 16}px`).style("top", `${my + 12}px`);
        })
        .on("pointerleave", function (_e, d) {
          const i = pts.indexOf(d);
          d3.select(this).select("rect").attr("fill-opacity", i === series.lastIndex ? 1 : 0.85);
          hideTooltip();
        });
    }

    /* Shared crosshair binding for the two line views. */
    function bindCrosshair(
      data: DayPoint[],
      cxFn: (d: DayPoint) => number,
      cyFn: (d: DayPoint) => number,
      htmlFn: (d: DayPoint) => string,
    ) {
      const focus = root.append("g").attr("opacity", 0);
      const vline = focus
        .append("line")
        .attr("y1", 0).attr("y2", innerH)
        .attr("stroke", "rgba(255,255,255,0.22)")
        .attr("stroke-dasharray", "3 3");
      const dot = focus
        .append("circle")
        .attr("r", 4.5)
        .attr("fill", "#fff")
        .attr("stroke", "rgba(0,0,0,0.5)")
        .attr("stroke-width", 1.5);

      const positions = data.map(cxFn);
      root
        .append("rect")
        .attr("width", innerW)
        .attr("height", innerH)
        .attr("fill", "transparent")
        .style("cursor", "crosshair")
        .on("pointermove", (event) => {
          const [mx, my] = d3.pointer(event);
          // Nearest day by x.
          let nearest = 0;
          let best = Infinity;
          positions.forEach((p, i) => {
            const dist = Math.abs(p - mx);
            if (dist < best) {
              best = dist;
              nearest = i;
            }
          });
          const d = data[nearest];
          focus.attr("opacity", 1);
          vline.attr("x1", cxFn(d)).attr("x2", cxFn(d));
          dot.attr("cx", cxFn(d)).attr("cy", cyFn(d));
          showTooltip(htmlFn(d), cxFn(d) + MARGIN.left + 16, cyFn(d) + MARGIN.top - 8);
          void my;
        })
        .on("pointerleave", () => {
          focus.attr("opacity", 0);
          hideTooltip();
        });
    }
  }, [series, view, width]);

  const meta = VIEW_META[view];

  return (
    <div className="glass-surface overflow-hidden rounded-2xl p-5">
      {/* ── Top controls ─────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-xl bg-primary/12 text-primary ring-1 ring-primary/25">
            <Activity className="size-4" />
          </div>
          <div>
            <h3 className="font-heading text-[15px] font-semibold leading-tight">
              Charts Explorer
            </h3>
            <p className="text-xs text-muted-foreground">
              {meta.unit}
              {sample && (
                <span className="ml-2 rounded-full bg-muted/50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Sample
                </span>
              )}
            </p>
          </div>
        </div>

        <Select value={view} onValueChange={(v) => setView(v as View)}>
          <SelectTrigger
            id="chart-view-select"
            size="default"
            className="h-10 w-full min-w-[230px] rounded-xl border-white/12 bg-white/5 px-3.5 text-sm font-medium backdrop-blur-md sm:w-[230px]"
          >
            <span className="flex items-center gap-2">
              <meta.icon
                className={cn(
                  "size-4",
                  view === "drawdown" ? "text-negative" : "text-primary",
                )}
              />
              <SelectValue>
                {(v) => VIEW_META[(v as View) ?? "equity"]?.label ?? meta.label}
              </SelectValue>
            </span>
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(VIEW_META) as View[]).map((v) => {
              const Icon = VIEW_META[v].icon;
              return (
                <SelectItem key={v} value={v} data-testid={`view-${v}`}>
                  <Icon className="size-4 text-muted-foreground" />
                  {VIEW_META[v].label}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>

      {/* ── Plot ─────────────────────────────────────────────────────── */}
      <div ref={containerRef} className="relative mt-4 w-full">
        <svg
          ref={svgRef}
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={`${meta.label} chart`}
          className="block overflow-visible"
        />
        <div
          ref={tooltipRef}
          className="ce-tooltip pointer-events-none absolute left-0 top-0 z-20 opacity-0"
        />
      </div>

      {/* Legend / footer. */}
      <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block size-2 rounded-full"
            style={{ background: view === "drawdown" ? COLOR.down : COLOR.up }}
          />
          {meta.label}
        </span>
        <span>19 trading days · synchronised daily axis</span>
      </div>
    </div>
  );
}
