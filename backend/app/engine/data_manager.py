"""
Data layer: loads, cleans, indexes and serves options + spot market data.

`DataManager` reads **Parquet** by default (substantially faster than CSV) but
transparently falls back to CSV when given a ``.csv`` path. The cleaning
routines are exposed at module level so the CSV→Parquet converter and the
manager share identical logic.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import List, Optional

import pandas as pd

from .constants import MARKET_CLOSE, MARKET_OPEN

logger = logging.getLogger("OptionsBacktester.DataManager")


# ── Shared cleaning routines ────────────────────────────────────────────────
def clean_options_frame(df: pd.DataFrame, stock_code: str = "NIFTY") -> pd.DataFrame:
    """Normalise, type, filter and sort a raw options frame.

    Applies the same transformations the original engine performed on load:
    lower-cased columns, parsed datetimes, capitalised right, stock-code filter,
    NaN/zero-price removal, market-hours window, and chronological sort.
    """
    df = df.copy()
    df.columns = df.columns.str.strip().str.lower().str.replace(" ", "_")
    df["datetime"] = pd.to_datetime(df["datetime"]).dt.floor("min")
    df["expiry_date"] = pd.to_datetime(df["expiry_date"], dayfirst=True)
    df["right"] = df["right"].astype(str).str.strip().str.capitalize()

    df = df[df["stock_code"].astype(str).str.upper() == stock_code.upper()].copy()
    df.dropna(subset=["datetime", "strike_price", "close"], inplace=True)
    df = df[df["close"] > 0]
    df = df[(df["datetime"].dt.time >= MARKET_OPEN) & (df["datetime"].dt.time <= MARKET_CLOSE)]

    df.sort_values("datetime", inplace=True)
    df.reset_index(drop=True, inplace=True)
    return df


def clean_spot_frame(df: pd.DataFrame) -> pd.DataFrame:
    """Normalise, filter and sort a raw spot frame."""
    df = df.copy()
    df.columns = df.columns.str.strip().str.lower().str.replace(" ", "_")
    df["datetime"] = pd.to_datetime(df["datetime"]).dt.floor("min")
    df.dropna(subset=["datetime", "close"], inplace=True)
    df = df[df["close"] > 0]
    df = df[(df["datetime"].dt.time >= MARKET_OPEN) & (df["datetime"].dt.time <= MARKET_CLOSE)]
    df.sort_values("datetime", inplace=True)
    df.reset_index(drop=True, inplace=True)
    return df


class DataManager:
    """Loads, validates, cleans, and indexes options + spot data."""

    def __init__(
        self,
        options_path: str,
        spot_path: str,
        stock_code: str = "NIFTY",
    ) -> None:
        self.options_path = Path(options_path)
        self.spot_path = Path(spot_path)
        self.stock_code = stock_code.upper()

        self.options_df: pd.DataFrame = pd.DataFrame()
        self.spot_df: pd.DataFrame = pd.DataFrame()

        logger.info("DataManager initialising. Loading data...")
        self._load_and_clean()
        logger.info(
            f"Loaded {len(self.options_df):,} option rows and {len(self.spot_df):,} spot rows."
        )

    # ── Loading ─────────────────────────────────────────────────────────────
    @staticmethod
    def _read(path: Path) -> pd.DataFrame:
        """Read a frame from Parquet or CSV based on file suffix."""
        if path.suffix.lower() == ".parquet":
            return pd.read_parquet(path)
        return pd.read_csv(path, low_memory=False)

    def _load_and_clean(self) -> None:
        if not self.options_path.exists():
            raise FileNotFoundError(f"Options data not found: {self.options_path}")
        if not self.spot_path.exists():
            raise FileNotFoundError(f"Spot data not found: {self.spot_path}")

        logger.info(f"Reading options data: {self.options_path}")
        opts = self._read(self.options_path)
        # Parquet produced by our converter is already cleaned; CSV is raw.
        if self.options_path.suffix.lower() != ".parquet":
            opts = clean_options_frame(opts, self.stock_code)
        self.options_df = opts

        logger.info(f"Reading spot data: {self.spot_path}")
        spot = self._read(self.spot_path)
        if self.spot_path.suffix.lower() != ".parquet":
            spot = clean_spot_frame(spot)
        self.spot_df = spot

        if self.options_df.empty:
            raise ValueError("Options dataset is empty after cleaning.")
        if self.spot_df.empty:
            raise ValueError("Spot dataset is empty after cleaning.")

        self._build_option_index()

    def _build_option_index(self) -> None:
        df = self.options_df.copy()
        df["date"] = df["datetime"].dt.normalize()
        df["minute"] = df["datetime"].dt.floor("min")

        df.set_index(["date", "expiry_date", "right", "strike_price"], inplace=True)
        df.sort_index(inplace=True)
        self._indexed_options = df
        self.options_df["date"] = self.options_df["datetime"].dt.normalize()
        logger.info("Option index built.")

    # ── Query API ───────────────────────────────────────────────────────────
    def get_spot_price(self, timestamp: pd.Timestamp) -> float:
        """Last known spot close at or before ``timestamp``."""
        idx = self.spot_df["datetime"].searchsorted(timestamp, side="right") - 1
        if idx < 0:
            raise ValueError(f"No spot data before {timestamp}")
        return float(self.spot_df.iloc[idx]["close"])

    def get_spot_ema(self, timestamp: pd.Timestamp, period: int = 20) -> float:
        """Intraday EMA of spot close up to ``timestamp`` (since session open)."""
        date = timestamp.normalize()
        mask = (self.spot_df["datetime"] >= date) & (self.spot_df["datetime"] <= timestamp)
        morning_data = self.spot_df[mask]

        if len(morning_data) < period:
            return float(morning_data["close"].iloc[-1]) if not morning_data.empty else 0.0

        ema = morning_data["close"].ewm(span=period, adjust=False).mean()
        return float(ema.iloc[-1])

    def get_option_price(
        self,
        timestamp: pd.Timestamp,
        expiry_date: pd.Timestamp,
        right: str,
        strike: float,
        price_col: str = "open",
    ) -> Optional[float]:
        """Price for a contract at ``timestamp``.

        Uses ``price_col`` on an exact-minute match, otherwise the last known
        close. Returns None when the contract has no data up to that time.
        """
        date = timestamp.normalize()
        try:
            sub = self._indexed_options.loc[(date, expiry_date, right.capitalize(), float(strike))]
            if isinstance(sub, pd.Series):
                sub = sub.to_frame().T

            valid_bars = sub[sub["datetime"] <= timestamp]
            if valid_bars.empty:
                return None

            is_exact_match = valid_bars.iloc[-1]["datetime"] == timestamp
            target_col = price_col if is_exact_match else "close"
            return float(valid_bars.iloc[-1][target_col])
        except KeyError:
            return None

    def get_option_timeseries(
        self,
        date: pd.Timestamp,
        expiry_date: pd.Timestamp,
        right: str,
        strike: float,
    ) -> pd.DataFrame:
        """Full intraday OHLCV series for a single contract on ``date``."""
        mask = (
            (self.options_df["date"] == date)
            & (self.options_df["expiry_date"] == expiry_date)
            & (self.options_df["right"] == right.capitalize())
            & (self.options_df["strike_price"] == float(strike))
        )
        return self.options_df[mask].copy()

    def get_available_expiries(self, date: pd.Timestamp) -> List[pd.Timestamp]:
        """Sorted unique expiries available on ``date``."""
        mask = self.options_df["date"] == date
        return sorted(self.options_df[mask]["expiry_date"].unique().tolist())

    def get_available_strikes(
        self,
        date: pd.Timestamp,
        expiry_date: pd.Timestamp,
        right: str,
    ) -> List[float]:
        """Sorted unique strikes for a right/expiry on ``date``."""
        mask = (
            (self.options_df["date"] == date)
            & (self.options_df["expiry_date"] == expiry_date)
            & (self.options_df["right"] == right.capitalize())
        )
        return sorted(self.options_df[mask]["strike_price"].unique().tolist())

    def trading_dates(self) -> List[pd.Timestamp]:
        """All trading dates present in the options dataset."""
        return sorted(self.options_df["date"].unique().tolist())
