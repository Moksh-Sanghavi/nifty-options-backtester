"""
CSV → Parquet converter.

Reads the raw options + spot CSVs, applies the engine's standard cleaning, and
writes compressed Parquet files into the data directory using the naming
convention the API expects: ``options_<dataset>.parquet`` / ``spot_<dataset>.parquet``.

Run from the ``backend`` directory:

    python -m scripts.convert_to_parquet \
        --options "D:/Moksh/Options Bakctester/full_options_dec2023.csv" \
        --spot    "D:/Moksh/Options Bakctester/spot_dec2023.csv" \
        --dataset dec2023
"""
from __future__ import annotations

import argparse
import time
from pathlib import Path

import pandas as pd

from app.config import settings
from app.engine.data_manager import clean_options_frame, clean_spot_frame

# Defaults point at the original source CSVs on this machine.
DEFAULT_SRC = Path("D:/Moksh/Options Bakctester")
DEFAULT_OPTIONS = DEFAULT_SRC / "full_options_dec2023.csv"
DEFAULT_SPOT = DEFAULT_SRC / "spot_dec2023.csv"


def _convert(csv_path: Path, parquet_path: Path, clean_fn, **kwargs) -> None:
    """Read, clean and write a single CSV → Parquet, logging row counts & timing."""
    t0 = time.perf_counter()
    print(f"Reading {csv_path} ...")
    df = pd.read_csv(csv_path, low_memory=False)
    raw_rows = len(df)
    df = clean_fn(df, **kwargs)
    parquet_path.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(parquet_path, engine="pyarrow", compression="snappy", index=False)
    dt = time.perf_counter() - t0
    print(
        f"  -> {parquet_path}  ({raw_rows:,} raw -> {len(df):,} clean rows, "
        f"{parquet_path.stat().st_size / 1e6:.1f} MB, {dt:.1f}s)"
    )


def main() -> None:
    """Parse arguments and convert both datasets."""
    parser = argparse.ArgumentParser(description="Convert options/spot CSVs to Parquet.")
    parser.add_argument("--options", type=Path, default=DEFAULT_OPTIONS, help="Options CSV path.")
    parser.add_argument("--spot", type=Path, default=DEFAULT_SPOT, help="Spot CSV path.")
    parser.add_argument("--dataset", default="dec2023", help="Dataset name (output suffix).")
    parser.add_argument("--out-dir", type=Path, default=settings.data_dir, help="Output dir.")
    parser.add_argument("--stock-code", default="NIFTY", help="Stock code to filter options.")
    args = parser.parse_args()

    options_out = args.out_dir / f"options_{args.dataset}.parquet"
    spot_out = args.out_dir / f"spot_{args.dataset}.parquet"

    _convert(args.options, options_out, clean_options_frame, stock_code=args.stock_code)
    _convert(args.spot, spot_out, clean_spot_frame)

    print(f"\nDone. Dataset '{args.dataset}' written to {args.out_dir}")


if __name__ == "__main__":
    main()
