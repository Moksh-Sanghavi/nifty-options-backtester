/** Number / currency formatting helpers for the dashboard. */

/** Format an INR amount with the ₹ symbol and thousands grouping. */
export function formatINR(value: number, fractionDigits = 0): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits,
  }).format(value);
}

/** Compact INR for headline cards (e.g. ₹1.66L, ₹2.3Cr). */
export function formatINRCompact(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

/** Format a plain number with grouping. */
export function formatNumber(value: number, fractionDigits = 2): string {
  return new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits,
  }).format(value);
}

/** Format a percentage value (already in percent units). */
export function formatPct(value: number, fractionDigits = 2): string {
  return `${value >= 0 ? "" : ""}${formatNumber(value, fractionDigits)}%`;
}

/** Signed value with explicit + / − prefix. */
export function formatSigned(value: number, fractionDigits = 0): string {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${formatINR(Math.abs(value), fractionDigits)}`;
}
