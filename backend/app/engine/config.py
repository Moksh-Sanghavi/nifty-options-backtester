"""
Pydantic strategy configuration.

`StrategyConfig` replaces the original hard-coded dataclass so that every
strategy parameter can be supplied dynamically (e.g. from an API request body)
with validation. The engine reads attributes off this model exactly as it did
the dataclass.
"""
from __future__ import annotations

from pydantic import BaseModel, Field

from .constants import NIFTY_LOT_SIZE, NIFTY_STRIKE_STEP, RunMode, StrategyType


class StrategyConfig(BaseModel):
    """All user-configurable strategy parameters (validated)."""

    strategy_type: StrategyType = Field(
        default=StrategyType.WALL_REVERSION,
        description="Primary strategy family label.",
    )
    run_mode: RunMode = Field(
        default=RunMode.COMBINED,
        description="Which strategies to run: WALL_ONLY, ORB_ONLY, or COMBINED.",
    )

    entry_time: str = Field(default="09:20", description="HH:MM scan start time.")
    exit_time: str = Field(default="15:15", description="HH:MM forced square-off time.")
    expiry_selection: str = Field(
        default="nearest",
        description="'nearest' or an explicit expiry date (YYYY-MM-DD).",
    )

    # ── Opening Range Breakout ──────────────────────────────────────────────
    orb_minutes: int = Field(default=15, ge=1, le=120, description="Opening range length (min).")
    orb_cutoff_time: str = Field(default="13:30", description="HH:MM latest breakout entry.")

    # ── Wall Reversion (IV anomaly) ─────────────────────────────────────────
    iv_drop_threshold: float = Field(
        default=0.001, ge=0.0, le=1.0, description="Min IV drop between strikes to count as anomaly."
    )
    required_anomalies: int = Field(
        default=3, ge=1, le=10, description="Number of anomalies required to trigger entry."
    )

    # ── Capital allocation & sizing ─────────────────────────────────────────
    capital: float = Field(default=1_000_000.0, gt=0, description="Account capital (INR).")
    risk_per_trade_pct: float = Field(
        default=0.15, gt=0, le=1.0, description="Fraction of capital risked per trade."
    )
    lot_size: int = Field(default=NIFTY_LOT_SIZE, gt=0, description="Contract lot size.")
    strike_step: int = Field(default=NIFTY_STRIKE_STEP, gt=0, description="Strike interval.")

    model_config = {"use_enum_values": False}
