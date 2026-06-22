"""Domain dataclasses: a single option leg (`TradeLeg`) and a multi-leg `Trade`."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional

import pandas as pd

from .constants import LegStatus, OptionRight
from .costs import compute_transaction_cost


@dataclass
class TradeLeg:
    """Represents a single option leg in a strategy."""

    leg_id: str
    right: OptionRight
    strike: float
    expiry: str
    entry_time: pd.Timestamp
    entry_premium: float
    lot_size: int
    num_lots: int
    direction: str = "BUY"

    strategy_label: str = ""

    reentries_left: int = 0
    parent_leg_id: Optional[str] = None

    # Risk parameters
    stop_loss_pct: float = 0.25
    trailing_sl_pct: float = 0.15
    take_profit_pct: float = 999.0

    # State
    status: LegStatus = field(default=LegStatus.OPEN)
    exit_time: Optional[pd.Timestamp] = None
    exit_premium: float = 0.0
    stop_loss_level: float = field(init=False, default=0.0)
    take_profit_level: float = field(init=False, default=0.0)
    trailing_peak: float = field(init=False, default=0.0)
    margin_blocked: float = 0.0
    net_pnl: float = 0.0
    exit_reason: str = ""
    bars_held: int = 0

    def __post_init__(self) -> None:
        """Initialise stop-loss / take-profit levels based on trade direction."""
        if self.direction == "SELL":
            self.stop_loss_level = self.entry_premium * (1 + self.stop_loss_pct)
            self.take_profit_level = self.entry_premium * (1 - self.take_profit_pct)
        else:
            self.stop_loss_level = self.entry_premium * (1 - self.stop_loss_pct)
            self.take_profit_level = self.entry_premium * (1 + self.take_profit_pct)

        self.trailing_peak = self.entry_premium

    @property
    def total_lots(self) -> int:
        """Number of lots in this leg."""
        return self.num_lots

    @property
    def entry_value(self) -> float:
        """Notional premium paid/received at entry."""
        return self.entry_premium * self.lot_size * self.num_lots

    def update_trailing_stop(self, current_premium: float) -> None:
        """Advance the trailing stop using the risk-free-runner logic.

        For BUY legs: once +1R (stop_loss_pct) profit is reached, the stop is
        shifted to breakeven and thereafter trails the peak by trailing_sl_pct.
        """
        if self.direction == "SELL":
            if current_premium < self.trailing_peak:
                self.trailing_peak = current_premium
                new_sl = self.trailing_peak + (self.entry_premium * self.trailing_sl_pct)
                if new_sl < self.stop_loss_level:
                    self.stop_loss_level = new_sl
        else:
            # --- BUY SIDE: RISK-FREE RUNNER LOGIC ---
            if current_premium > self.trailing_peak:
                self.trailing_peak = current_premium

                # Check if the trade has achieved 1R (+stop_loss_pct profit)
                if self.trailing_peak >= self.entry_premium * (1 + self.stop_loss_pct):

                    # 1. Breakeven shift: secure entry price as the floor.
                    if self.stop_loss_level < self.entry_premium:
                        self.stop_loss_level = self.entry_premium

                    # 2. Activate trailing stop from the peak.
                    new_sl = self.trailing_peak - (self.entry_premium * self.trailing_sl_pct)

                    # Only move the stop up, never down.
                    if new_sl > self.stop_loss_level:
                        self.stop_loss_level = new_sl

    def is_stop_triggered(self, current_premium: float) -> bool:
        """Whether the current premium has breached the stop-loss level."""
        if self.direction == "SELL":
            return current_premium >= self.stop_loss_level
        return current_premium <= self.stop_loss_level

    def close(
        self, exit_time: pd.Timestamp, exit_premium: float, reason: str = "Normal Exit"
    ) -> None:
        """Close the leg, recording exit details and net PnL after costs."""
        self.exit_time = exit_time
        self.exit_premium = exit_premium
        self.exit_reason = reason
        self.status = LegStatus.STOPPED if "Stop" in reason else LegStatus.CLOSED

        if self.direction == "SELL":
            raw_pnl = (self.entry_premium - self.exit_premium) * self.lot_size * self.num_lots
        else:
            raw_pnl = (self.exit_premium - self.entry_premium) * self.lot_size * self.num_lots

        txn_cost = compute_transaction_cost(
            premium=exit_premium, lot_size=self.lot_size, num_lots=self.num_lots, is_entry=False
        )
        entry_txn = compute_transaction_cost(
            premium=self.entry_premium, lot_size=self.lot_size, num_lots=self.num_lots, is_entry=True
        )
        self.net_pnl = raw_pnl - txn_cost - entry_txn


@dataclass
class Trade:
    """A complete multi-leg options trade for a single trading day."""

    trade_id: int
    strategy_type: str
    date: pd.Timestamp
    legs: List[TradeLeg] = field(default_factory=list)

    @property
    def is_open(self) -> bool:
        """True while any leg remains open."""
        return any(leg.status == LegStatus.OPEN for leg in self.legs)

    @property
    def total_pnl(self) -> float:
        """Sum of net PnL across all closed legs."""
        return sum(leg.net_pnl for leg in self.legs if leg.status != LegStatus.OPEN)

    @property
    def total_margin(self) -> float:
        """Total margin blocked across legs."""
        return sum(leg.margin_blocked for leg in self.legs)

    @property
    def total_premium_collected(self) -> float:
        """Total notional premium across legs."""
        return sum(leg.entry_value for leg in self.legs)
