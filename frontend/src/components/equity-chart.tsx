"use client";

/**
 * EquityChart — TradingView Lightweight Charts (v5) visualisation of the daily
 * equity curve with a synced drawdown panel beneath it. The two charts share a
 * logical time range and a fixed price-scale width so their x-axes stay aligned.
 */
import {
  AreaSeries,
  ColorType,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type Time,
  createChart,
} from "lightweight-charts";
import { useEffect, useRef } from "react";

import { EquityPoint } from "@/lib/api";

const POSITIVE = "#34d399";
const NEGATIVE = "#fb7185";
const PRICE_SCALE_WIDTH = 72;

interface EquityChartProps {
  data: EquityPoint[];
}

/** Common chart options for the dark terminal theme. */
function baseOptions(height: number) {
  return {
    height,
    layout: {
      background: { type: ColorType.Solid, color: "transparent" },
      textColor: "rgba(235,235,245,0.55)",
      fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
      fontSize: 11,
      attributionLogo: false,
    },
    grid: {
      vertLines: { color: "rgba(255,255,255,0.04)" },
      horzLines: { color: "rgba(255,255,255,0.05)" },
    },
    rightPriceScale: {
      borderColor: "rgba(255,255,255,0.08)",
      minimumWidth: PRICE_SCALE_WIDTH,
    },
    timeScale: {
      borderColor: "rgba(255,255,255,0.08)",
      fixLeftEdge: true,
      fixRightEdge: true,
    },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: "rgba(255,255,255,0.2)", labelBackgroundColor: "#1f2430" },
      horzLine: { color: "rgba(255,255,255,0.2)", labelBackgroundColor: "#1f2430" },
    },
  };
}

export function EquityChart({ data }: EquityChartProps) {
  const equityRef = useRef<HTMLDivElement>(null);
  const drawdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const equityEl = equityRef.current;
    const drawdownEl = drawdownRef.current;
    if (!equityEl || !drawdownEl || data.length === 0) return;

    const equityChart: IChartApi = createChart(equityEl, {
      ...baseOptions(260),
      width: equityEl.clientWidth,
    });
    const drawdownChart: IChartApi = createChart(drawdownEl, {
      ...baseOptions(140),
      width: drawdownEl.clientWidth,
    });

    const equitySeries: ISeriesApi<"Area"> = equityChart.addSeries(AreaSeries, {
      lineColor: POSITIVE,
      lineWidth: 2,
      topColor: "rgba(52,211,153,0.28)",
      bottomColor: "rgba(52,211,153,0.0)",
      priceFormat: { type: "price", precision: 0, minMove: 1 },
    });
    const drawdownSeries: ISeriesApi<"Area"> = drawdownChart.addSeries(AreaSeries, {
      lineColor: NEGATIVE,
      lineWidth: 2,
      topColor: "rgba(251,113,133,0.0)",
      bottomColor: "rgba(251,113,133,0.3)",
      invertFilledArea: true,
      priceFormat: { type: "price", precision: 2, minMove: 0.01 },
    });

    equitySeries.setData(
      data.map((p) => ({ time: p.date as Time, value: p.equity })),
    );
    drawdownSeries.setData(
      data.map((p) => ({ time: p.date as Time, value: p.drawdown_pct })),
    );

    equityChart.timeScale().fitContent();
    drawdownChart.timeScale().fitContent();

    // Keep the two time scales in sync when panning / zooming.
    const eqTs = equityChart.timeScale();
    const ddTs = drawdownChart.timeScale();
    let syncing = false;
    const sync = (from: IChartApi, to: IChartApi) => {
      const range = from.timeScale().getVisibleLogicalRange();
      if (!range || syncing) return;
      syncing = true;
      to.timeScale().setVisibleLogicalRange(range);
      syncing = false;
    };
    eqTs.subscribeVisibleLogicalRangeChange(() => sync(equityChart, drawdownChart));
    ddTs.subscribeVisibleLogicalRangeChange(() => sync(drawdownChart, equityChart));

    const resize = () => {
      equityChart.applyOptions({ width: equityEl.clientWidth });
      drawdownChart.applyOptions({ width: drawdownEl.clientWidth });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(equityEl);
    observer.observe(drawdownEl);

    return () => {
      observer.disconnect();
      equityChart.remove();
      drawdownChart.remove();
    };
  }, [data]);

  return (
    <div className="flex flex-col gap-3">
      <div className="elevated rounded-xl border border-border bg-card/60 p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Equity Curve</h3>
          <span className="text-xs text-muted-foreground">Account balance (₹)</span>
        </div>
        <div ref={equityRef} className="w-full" />
      </div>

      <div className="elevated rounded-xl border border-border bg-card/60 p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Drawdown</h3>
          <span className="text-xs text-muted-foreground">% from peak equity</span>
        </div>
        <div ref={drawdownRef} className="w-full" />
      </div>
    </div>
  );
}
