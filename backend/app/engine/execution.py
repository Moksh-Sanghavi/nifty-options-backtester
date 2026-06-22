"""
Execution handler: the intraday event loop that walks each leg's bars, manages
trailing stops, time-based exits, and end-of-day square-off.
"""
from __future__ import annotations

import logging
from datetime import time
from typing import Dict

import pandas as pd

from .config import StrategyConfig
from .constants import LegStatus
from .costs import compute_transaction_cost
from .data_manager import DataManager
from .models import Trade, TradeLeg

logger = logging.getLogger("OptionsBacktester.Execution")


class ExecutionHandler:
    """Intraday event loop verifying execution compliance and protective stops."""

    def __init__(self, config: StrategyConfig, data_manager: DataManager) -> None:
        self.config = config
        self.dm = data_manager
        logger.info("ExecutionHandler initialised.")

    def run_trade(self, trade: Trade) -> Trade:
        """Simulate the full intraday lifecycle of every leg in ``trade``."""
        exit_h, exit_m = map(int, self.config.exit_time.split(":"))
        date = trade.date

        leg_ts: Dict[str, pd.DataFrame] = {}
        for leg in trade.legs:
            ts = self.dm.get_option_timeseries(
                date=date,
                expiry_date=leg.expiry,
                right=leg.right.value,
                strike=leg.strike,
            )
            if not ts.empty:
                leg_ts[leg.leg_id] = ts.set_index("datetime").sort_index()

        all_timestamps = sorted(set().union(*[df.index.tolist() for df in leg_ts.values()])) if leg_ts else []

        for ts in all_timestamps:
            current_time = ts.time()

            if current_time >= time(exit_h, exit_m):
                self._close_all_legs(trade, ts, leg_ts, reason="Exit Time")
                break

            for leg in trade.legs:
                if leg.status != LegStatus.OPEN or leg.leg_id not in leg_ts:
                    continue

                ts_df = leg_ts[leg.leg_id]
                if ts not in ts_df.index:
                    continue

                if ts < leg.entry_time:
                    continue

                bar_high = float(ts_df.loc[ts, "high"])
                bar_low = float(ts_df.loc[ts, "low"])
                bar_close = float(ts_df.loc[ts, "close"])

                if bar_close <= 0:
                    continue

                leg.bars_held += 1

                if leg.direction == "BUY":
                    leg.update_trailing_stop(bar_high)

                    if leg.bars_held >= 45:
                        self._close_leg(leg, ts, bar_close, reason="Time Decay Force Exit")
                        continue

                    if leg.is_stop_triggered(bar_low):
                        fill_price = max(bar_low, leg.stop_loss_level * 0.99)
                        if leg.stop_loss_level > leg.entry_premium:
                            sl_reason = "Trailing Stop (Profit)"
                        else:
                            sl_reason = "Long Stop Loss Hit"
                        self._close_leg(leg, ts, fill_price, reason=sl_reason)

        for leg in trade.legs:
            if leg.status == LegStatus.OPEN:
                last_price = self._get_last_price(leg, leg_ts)
                self._close_leg(
                    leg,
                    all_timestamps[-1] if all_timestamps else date,
                    last_price,
                    reason="EOD Force Close",
                )

        return trade

    def _close_all_legs(
        self,
        trade: Trade,
        ts: pd.Timestamp,
        leg_ts: Dict[str, pd.DataFrame],
        reason: str,
    ) -> None:
        for leg in trade.legs:
            if leg.status != LegStatus.OPEN:
                continue
            price = self._get_price_at(leg, ts, leg_ts)
            self._close_leg(leg, ts, price, reason)

    def _close_leg(
        self,
        leg: TradeLeg,
        ts: pd.Timestamp,
        price: float,
        reason: str,
    ) -> None:
        if leg.status != LegStatus.OPEN:
            return

        if price <= 0:
            if reason in ["Exit Time", "EOD Force Close"]:
                price = 0.05
            else:
                return

        if leg.direction == "BUY":
            raw_pnl = (price - leg.entry_premium) * leg.lot_size * leg.num_lots
            leg.exit_time = ts
            leg.exit_premium = price
            leg.exit_reason = reason
            leg.status = LegStatus.CLOSED
            leg.net_pnl = (
                raw_pnl
                - compute_transaction_cost(price, leg.lot_size, leg.num_lots, is_entry=False)
                - compute_transaction_cost(
                    leg.entry_premium, leg.lot_size, leg.num_lots, is_entry=True
                )
            )
        else:
            leg.close(ts, price, reason)

    def _get_price_at(
        self,
        leg: TradeLeg,
        ts: pd.Timestamp,
        leg_ts: Dict[str, pd.DataFrame],
    ) -> float:
        if leg.leg_id not in leg_ts:
            return leg.entry_premium * 0.05
        df = leg_ts[leg.leg_id]
        if ts in df.index:
            return float(df.loc[ts, "close"])
        return self._get_last_price(leg, leg_ts)

    def _get_last_price(self, leg: TradeLeg, leg_ts: Dict[str, pd.DataFrame]) -> float:
        if leg.leg_id not in leg_ts:
            return leg.entry_premium * 0.05
        df = leg_ts[leg.leg_id]
        return float(df["close"].iloc[-1]) if not df.empty else leg.entry_premium * 0.05

    def check_capital_sufficiency(self, trade: Trade, available_capital: float) -> bool:
        """Whether the account can fund the trade's total margin."""
        required = trade.total_margin
        if required > available_capital:
            logger.warning(
                f"Trade #{trade.trade_id} | SKIPPED: "
                f"Required ₹{required:,.0f} > Available ₹{available_capital:,.0f}"
            )
            return False
        return True
