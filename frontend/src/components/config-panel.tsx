"use client";

/**
 * ConfigPanel — the StrategyConfig form.
 *
 * Built with React Hook Form + Zod. Strategy selection uses toggles (Wall
 * Reversion / ORB) from which `run_mode` is derived; risk and threshold
 * parameters use sliders; dataset and expiry use selects. On submit it maps the
 * form into a typed `BacktestRequest` and hands it to the parent.
 */
import { zodResolver } from "@hookform/resolvers/zod";
import { Play, RotateCcw } from "lucide-react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { BacktestRequest, RunMode } from "@/lib/api";

const formSchema = z
  .object({
    dataset: z.string().min(1, "Select a dataset"),
    wall_enabled: z.boolean(),
    orb_enabled: z.boolean(),
    start_date: z.string().min(1, "Required"),
    end_date: z.string().min(1, "Required"),
    capital: z.number().positive("Must be > 0"),
    risk_pct: z.number().min(1).max(100),
    lot_size: z.number().int().positive(),
    strike_step: z.number().int().positive(),
    iv_drop_threshold: z.number().min(0).max(0.05),
    required_anomalies: z.number().int().min(1).max(10),
    entry_time: z.string().min(1),
    orb_minutes: z.number().int().min(1).max(120),
    orb_cutoff_time: z.string().min(1),
    exit_time: z.string().min(1),
    expiry_selection: z.string().min(1),
  })
  .refine((v) => v.wall_enabled || v.orb_enabled, {
    message: "Enable at least one strategy",
    path: ["wall_enabled"],
  });

export type ConfigFormValues = z.infer<typeof formSchema>;

const DEFAULTS: ConfigFormValues = {
  dataset: "dec2023",
  wall_enabled: true,
  orb_enabled: true,
  start_date: "2023-12-01",
  end_date: "2023-12-28",
  capital: 1_000_000,
  risk_pct: 15,
  lot_size: 50,
  strike_step: 50,
  iv_drop_threshold: 0.001,
  required_anomalies: 3,
  entry_time: "09:45",
  orb_minutes: 15,
  orb_cutoff_time: "13:30",
  exit_time: "15:15",
  expiry_selection: "nearest",
};

function deriveRunMode(wall: boolean, orb: boolean): RunMode {
  if (wall && orb) return "COMBINED";
  if (orb) return "ORB_ONLY";
  return "WALL_ONLY";
}

function strategyLabel(mode: RunMode): string {
  return mode === "ORB_ONLY" ? "Opening Range Breakout" : "Wall Reversion";
}

interface ConfigPanelProps {
  datasets: string[];
  isRunning: boolean;
  onRun: (request: BacktestRequest) => void;
}

/** Small section heading used between form groups. */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </h3>
  );
}

export function ConfigPanel({ datasets, isRunning, onRun }: ConfigPanelProps) {
  const {
    control,
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<ConfigFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { ...DEFAULTS, dataset: datasets[0] ?? DEFAULTS.dataset },
  });

  const wallEnabled = watch("wall_enabled");
  const orbEnabled = watch("orb_enabled");

  const submit = (values: ConfigFormValues) => {
    const run_mode = deriveRunMode(values.wall_enabled, values.orb_enabled);
    const request: BacktestRequest = {
      dataset: values.dataset,
      start_date: values.start_date || null,
      end_date: values.end_date || null,
      config: {
        run_mode,
        strategy_type: strategyLabel(run_mode),
        entry_time: values.entry_time,
        exit_time: values.exit_time,
        expiry_selection: values.expiry_selection,
        orb_minutes: values.orb_minutes,
        orb_cutoff_time: values.orb_cutoff_time,
        iv_drop_threshold: values.iv_drop_threshold,
        required_anomalies: values.required_anomalies,
        capital: values.capital,
        risk_per_trade_pct: values.risk_pct / 100,
        lot_size: values.lot_size,
        strike_step: values.strike_step,
      },
    };
    onRun(request);
  };

  return (
    <Card className="glass-panel flex h-full flex-col gap-0 overflow-hidden p-0">
      <CardHeader className="border-b border-border px-5 py-4">
        <CardTitle className="font-heading text-base">Strategy Configuration</CardTitle>
        <CardDescription>Tune parameters, then run the simulation.</CardDescription>
      </CardHeader>

      <CardContent className="flex-1 overflow-y-auto px-5 py-4">
        <form
          id="config-form"
          onSubmit={handleSubmit(submit)}
          className="flex flex-col gap-5"
        >
          {/* ── Run ─────────────────────────────────────────────── */}
          <div className="flex flex-col gap-3">
            <SectionLabel>Run</SectionLabel>

            <div className="grid gap-1.5">
              <Label htmlFor="dataset">Dataset</Label>
              <Controller
                control={control}
                name="dataset"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="dataset" className="w-full">
                      <SelectValue placeholder="Select dataset" />
                    </SelectTrigger>
                    <SelectContent>
                      {(datasets.length ? datasets : [DEFAULTS.dataset]).map((d) => (
                        <SelectItem key={d} value={d}>
                          {d}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="start_date">Start date</Label>
                <Input id="start_date" type="date" {...register("start_date")} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="end_date">End date</Label>
                <Input id="end_date" type="date" {...register("end_date")} />
              </div>
            </div>
          </div>

          <Separator />

          {/* ── Strategies (toggles) ────────────────────────────── */}
          <div className="flex flex-col gap-3">
            <SectionLabel>Strategies</SectionLabel>

            <Controller
              control={control}
              name="wall_enabled"
              render={({ field }) => (
                <label className="flex cursor-pointer items-center justify-between rounded-lg border border-border bg-card/40 px-3 py-2.5">
                  <div>
                    <p className="text-sm font-medium">Wall Reversion</p>
                    <p className="text-xs text-muted-foreground">IV anomaly reversion</p>
                  </div>
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                </label>
              )}
            />
            <Controller
              control={control}
              name="orb_enabled"
              render={({ field }) => (
                <label className="flex cursor-pointer items-center justify-between rounded-lg border border-border bg-card/40 px-3 py-2.5">
                  <div>
                    <p className="text-sm font-medium">Opening Range Breakout</p>
                    <p className="text-xs text-muted-foreground">ORB with asymmetric sizing</p>
                  </div>
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                </label>
              )}
            />
            {errors.wall_enabled && (
              <p className="text-xs text-destructive">{errors.wall_enabled.message}</p>
            )}
          </div>

          <Separator />

          {/* ── Capital & Risk ──────────────────────────────────── */}
          <div className="flex flex-col gap-3">
            <SectionLabel>Capital &amp; Risk</SectionLabel>

            <div className="grid gap-1.5">
              <Label htmlFor="capital">Capital (₹)</Label>
              <Input
                id="capital"
                type="number"
                step={50000}
                {...register("capital", { valueAsNumber: true })}
              />
            </div>

            <Controller
              control={control}
              name="risk_pct"
              render={({ field }) => (
                <div className="grid gap-2">
                  <div className="flex items-center justify-between">
                    <Label>Risk per trade</Label>
                    <span className="nums text-sm font-medium text-primary">
                      {field.value}%
                    </span>
                  </div>
                  <Slider
                    min={1}
                    max={50}
                    step={1}
                    value={field.value}
                    onValueChange={(v) =>
                      field.onChange(Array.isArray(v) ? v[0] : v)
                    }
                  />
                </div>
              )}
            />

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="lot_size">Lot size</Label>
                <Input
                  id="lot_size"
                  type="number"
                  {...register("lot_size", { valueAsNumber: true })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="strike_step">Strike step</Label>
                <Input
                  id="strike_step"
                  type="number"
                  {...register("strike_step", { valueAsNumber: true })}
                />
              </div>
            </div>
          </div>

          {/* ── Wall Reversion params ───────────────────────────── */}
          {wallEnabled && (
            <>
              <Separator />
              <div className="flex flex-col gap-3">
                <SectionLabel>Wall Reversion</SectionLabel>

                <Controller
                  control={control}
                  name="iv_drop_threshold"
                  render={({ field }) => (
                    <div className="grid gap-2">
                      <div className="flex items-center justify-between">
                        <Label>IV drop threshold</Label>
                        <span className="nums text-sm font-medium text-primary">
                          {field.value.toFixed(3)}
                        </span>
                      </div>
                      <Slider
                        min={0}
                        max={0.02}
                        step={0.001}
                        value={field.value}
                        onValueChange={(v) =>
                          field.onChange(Array.isArray(v) ? v[0] : v)
                        }
                      />
                    </div>
                  )}
                />

                <Controller
                  control={control}
                  name="required_anomalies"
                  render={({ field }) => (
                    <div className="grid gap-2">
                      <div className="flex items-center justify-between">
                        <Label>Required anomalies</Label>
                        <span className="nums text-sm font-medium text-primary">
                          {field.value}
                        </span>
                      </div>
                      <Slider
                        min={1}
                        max={10}
                        step={1}
                        value={field.value}
                        onValueChange={(v) =>
                          field.onChange(Array.isArray(v) ? v[0] : v)
                        }
                      />
                    </div>
                  )}
                />

                <div className="grid gap-1.5">
                  <Label htmlFor="entry_time">Scan start time</Label>
                  <Input id="entry_time" type="time" {...register("entry_time")} />
                </div>
              </div>
            </>
          )}

          {/* ── ORB params ──────────────────────────────────────── */}
          {orbEnabled && (
            <>
              <Separator />
              <div className="flex flex-col gap-3">
                <SectionLabel>Opening Range Breakout</SectionLabel>

                <Controller
                  control={control}
                  name="orb_minutes"
                  render={({ field }) => (
                    <div className="grid gap-2">
                      <div className="flex items-center justify-between">
                        <Label>Opening range</Label>
                        <span className="nums text-sm font-medium text-primary">
                          {field.value} min
                        </span>
                      </div>
                      <Slider
                        min={1}
                        max={60}
                        step={1}
                        value={field.value}
                        onValueChange={(v) =>
                          field.onChange(Array.isArray(v) ? v[0] : v)
                        }
                      />
                    </div>
                  )}
                />

                <div className="grid gap-1.5">
                  <Label htmlFor="orb_cutoff_time">Breakout cutoff</Label>
                  <Input id="orb_cutoff_time" type="time" {...register("orb_cutoff_time")} />
                </div>
              </div>
            </>
          )}

          <Separator />

          {/* ── Session ─────────────────────────────────────────── */}
          <div className="flex flex-col gap-3">
            <SectionLabel>Session</SectionLabel>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="exit_time">Square-off</Label>
                <Input id="exit_time" type="time" {...register("exit_time")} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="expiry_selection">Expiry</Label>
                <Controller
                  control={control}
                  name="expiry_selection"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="expiry_selection" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="nearest">Nearest</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
            </div>
          </div>
        </form>
      </CardContent>

      <div className="flex items-center gap-2 border-t border-border px-5 py-3">
        <Button
          type="submit"
          form="config-form"
          size="lg"
          disabled={isRunning}
          className="flex-1"
        >
          <Play className="size-4" />
          {isRunning ? "Running…" : "Run Backtest"}
        </Button>
        <Button
          type="button"
          size="lg"
          variant="outline"
          disabled={isRunning}
          onClick={() => reset({ ...DEFAULTS, dataset: datasets[0] ?? DEFAULTS.dataset })}
          title="Reset to defaults"
        >
          <RotateCcw className="size-4" />
        </Button>
      </div>
    </Card>
  );
}
