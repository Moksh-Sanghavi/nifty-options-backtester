"""
Strategy engine: builds the day's `Trade` from Wall Reversion (IV anomaly) and
Opening Range Breakout setups, governed by the configured run mode.
"""
from __future__ import annotations

import logging
from typing import List, Optional

import pandas as pd

from .config import StrategyConfig
from .constants import OptionRight, RunMode
from .data_manager import DataManager
from .iv import implied_volatility_call, implied_volatility_put
from .models import Trade, TradeLeg

logger = logging.getLogger("OptionsBacktester.Strategy")


class Strategy:
    """Builds trades for Wall Reversion and Opening Range Breakout setups."""

    def __init__(self, config: StrategyConfig, data_manager: DataManager) -> None:
        self.config = config
        self.dm = data_manager
        self._trade_counter = 0
        logger.info(f"Strategy Engine initialised: {config.strategy_type.value}")

    @staticmethod
    def get_atm_strike(spot_price: float, step: int = 50) -> float:
        """Round spot to the nearest strike step (ATM strike)."""
        return round(spot_price / step) * step

    def _get_expiry(self, date: pd.Timestamp) -> Optional[pd.Timestamp]:
        """Resolve the expiry to trade for ``date`` per ``expiry_selection``."""
        available = self.dm.get_available_expiries(date)
        if not available:
            return None
        if self.config.expiry_selection == "nearest":
            future = [e for e in available if e >= date]
            return future[0] if future else available[-1]
        target = pd.Timestamp(self.config.expiry_selection)
        if target in available:
            return target
        return min(available, key=lambda e: abs(e - target))

    def build_trade(self, date: pd.Timestamp) -> Optional[Trade]:
        """Orchestrate leg construction for the day, honouring the run mode."""
        self._trade_counter += 1

        entry_h, entry_m = map(int, self.config.entry_time.split(":"))
        entry_ts = date + pd.Timedelta(hours=entry_h, minutes=entry_m)
        expiry = self._get_expiry(date)

        if expiry is None:
            return None

        trade = Trade(trade_id=self._trade_counter, strategy_type="PENDING", date=date)

        capital_ceiling = self.config.capital * 0.95
        current_margin_used = 0.0
        mode = self.config.run_mode

        # PRIORITY 1: Wall Reversion
        if mode in (RunMode.WALL_ONLY, RunMode.COMBINED):
            wall_legs = self._build_wall_reversion_legs(date, entry_ts, expiry)
            for leg in wall_legs:
                leg.strategy_label = "Wall Reversion"
                if current_margin_used + leg.margin_blocked <= capital_ceiling:
                    trade.legs.append(leg)
                    current_margin_used += leg.margin_blocked
                    trade.strategy_type = leg.strategy_label
                else:
                    logger.warning(f"  Wall Reversion Leg {leg.leg_id} skipped: Margin limit hit.")

        # PRIORITY 2: ORB
        if mode in (RunMode.ORB_ONLY, RunMode.COMBINED):
            orb_legs = self._build_orb_legs(date, expiry)
            for leg in orb_legs:
                leg.strategy_label = "ORB"
                if current_margin_used + leg.margin_blocked <= capital_ceiling:
                    trade.legs.append(leg)
                    current_margin_used += leg.margin_blocked

                    if trade.strategy_type == "Wall Reversion":
                        trade.strategy_type = "COMBINED"
                    else:
                        trade.strategy_type = leg.strategy_label
                else:
                    logger.warning(f"  ORB Leg {leg.leg_id} skipped: Margin limit hit.")

        if not trade.legs:
            return None

        logger.info(
            f"Trade #{trade.trade_id} | {date.date()} | Strategy: {trade.strategy_type} | "
            f"Margin Used: ₹{current_margin_used:,.0f} | Total Legs: {len(trade.legs)}"
        )
        return trade

    def _build_wall_reversion_legs(
        self, date: pd.Timestamp, start_entry_ts: pd.Timestamp, expiry: pd.Timestamp
    ) -> List[TradeLeg]:
        """Scan the IV curve for volatility anomalies and build reversion legs."""
        mask = (self.dm.spot_df["datetime"] >= start_entry_ts) & (
            self.dm.spot_df["datetime"].dt.date == date.date()
        )
        valid_minutes = self.dm.spot_df[mask]["datetime"].tolist()

        r = 0.065
        scans = [
            (OptionRight.CALL, 1, 300, implied_volatility_call),
            (OptionRight.PUT, -1, -300, implied_volatility_put),
        ]

        iv_drop_threshold = self.config.iv_drop_threshold
        required_anomalies = self.config.required_anomalies
        ema_period = 20

        legs: List[TradeLeg] = []
        last_entry_time = {OptionRight.CALL: None, OptionRight.PUT: None}
        cooldown_minutes = 30

        daily_margin_used = 0.0
        max_daily_margin = self.config.capital * 0.95

        for current_ts in valid_minutes:
            spot = self.dm.get_spot_price(current_ts)
            ema = self.dm.get_spot_ema(current_ts, period=ema_period)
            atm = self.get_atm_strike(spot, self.config.strike_step)

            exact_expiry = expiry + pd.Timedelta(hours=15, minutes=30)
            seconds_to_expiry = max(1.0, (exact_expiry - current_ts).total_seconds())
            T = seconds_to_expiry / (365.0 * 86400.0)

            for right, step_dir, target_offset, iv_calc in scans:
                if right == OptionRight.CALL and spot <= ema:
                    continue
                if right == OptionRight.PUT and spot >= ema:
                    continue

                if last_entry_time[right] is not None:
                    minutes_since_last = (current_ts - last_entry_time[right]).total_seconds() / 60.0
                    if minutes_since_last < cooldown_minutes:
                        continue

                valid_iv_curve = []
                for i in range(1, 11):
                    strike = atm + (i * step_dir * self.config.strike_step)
                    price = self.dm.get_option_price(
                        current_ts, expiry, right.value, strike, price_col="close"
                    )

                    if price is not None and price > 0.50:
                        iv = iv_calc(spot, strike, T, r, price)
                        if iv > 0.005:
                            valid_iv_curve.append((strike, iv))

                abnormalities = 0
                for j in range(1, len(valid_iv_curve)):
                    prev_iv = valid_iv_curve[j - 1][1]
                    curr_iv = valid_iv_curve[j][1]
                    if curr_iv <= (prev_iv - iv_drop_threshold):
                        abnormalities += 1

                if abnormalities >= required_anomalies:
                    target_strike = atm + target_offset
                    entry_price = self.dm.get_option_price(
                        current_ts, expiry, right.value, target_strike, price_col="open"
                    )

                    if entry_price is not None and entry_price > 0:
                        max_risk_amount = self.config.capital * self.config.risk_per_trade_pct
                        risk_per_lot = entry_price * 0.25 * self.config.lot_size

                        if risk_per_lot <= 0:
                            continue

                        dynamic_lots = int(max_risk_amount // risk_per_lot)
                        if dynamic_lots < 1:
                            continue

                        participation = 0.10
                        fill_window = 5
                        entry_min_vol = 50
                        vbar = self.dm.get_option_timeseries(
                            date, expiry, right.value, target_strike
                        )

                        ebar = vbar[vbar["datetime"] == current_ts]
                        entry_bar_vol = float(ebar["volume"].iloc[-1]) if not ebar.empty else 0.0
                        if entry_bar_vol < entry_min_vol:
                            continue

                        win = vbar[
                            (vbar["datetime"] <= current_ts)
                            & (vbar["datetime"] > current_ts - pd.Timedelta(minutes=fill_window))
                        ]
                        avail_vol = float(win["volume"].sum())
                        max_lots_liq = int((avail_vol * participation) // self.config.lot_size)
                        dynamic_lots = min(dynamic_lots, max_lots_liq)
                        if dynamic_lots < 1:
                            continue

                        margin = entry_price * self.config.lot_size * dynamic_lots

                        if daily_margin_used + margin > max_daily_margin:
                            remaining_margin = max_daily_margin - daily_margin_used
                            dynamic_lots = int(
                                remaining_margin // (entry_price * self.config.lot_size)
                            )
                            if dynamic_lots < 1:
                                continue
                            margin = entry_price * self.config.lot_size * dynamic_lots

                        daily_margin_used += margin

                        leg = TradeLeg(
                            leg_id=(
                                f"T{self._trade_counter}_{right.value[:1]}{int(target_strike)}"
                                f"_PURE_IV_{current_ts.strftime('%H%M')}"
                            ),
                            right=right,
                            strike=target_strike,
                            expiry=expiry,
                            entry_time=current_ts,
                            entry_premium=entry_price,
                            lot_size=self.config.lot_size,
                            num_lots=dynamic_lots,
                            direction="BUY",
                            stop_loss_pct=0.25,
                            trailing_sl_pct=0.15,
                            margin_blocked=margin,
                            reentries_left=0,
                        )
                        logger.info(
                            f"  PURE IV TRIGGER @ {current_ts.time()} | {right.value} | "
                            f"Buying {int(target_strike)} @ ₹{entry_price:.2f} | "
                            f"Lots: {dynamic_lots} | Spot: {spot:.2f} | EMA: {ema:.2f}"
                        )

                        legs.append(leg)
                        last_entry_time[right] = current_ts

        return legs

    def _build_orb_legs(self, date: pd.Timestamp, expiry: pd.Timestamp) -> List[TradeLeg]:
        """Detect the first opening-range breakout and build an ATM leg."""
        market_open_ts = date + pd.Timedelta(hours=9, minutes=15)
        orb_end_ts = market_open_ts + pd.Timedelta(minutes=self.config.orb_minutes)

        mask = self.dm.spot_df["datetime"].dt.date == date.date()
        day_spot = self.dm.spot_df[mask]

        if day_spot.empty:
            return []

        orb_window = day_spot[day_spot["datetime"] <= orb_end_ts]
        if orb_window.empty:
            return []

        orb_high = float(orb_window["high"].max())
        orb_low = float(orb_window["low"].min())

        post_orb = day_spot[day_spot["datetime"] > orb_end_ts]

        for _, row in post_orb.iterrows():
            current_ts = row["datetime"]
            spot_close = float(row["close"])

            is_call_breakout = spot_close > orb_high
            is_put_breakout = spot_close < orb_low

            if is_call_breakout or is_put_breakout:
                right = OptionRight.CALL if is_call_breakout else OptionRight.PUT
                atm_strike = self.get_atm_strike(spot_close, self.config.strike_step)

                entry_price = self.dm.get_option_price(
                    current_ts, expiry, right.value, atm_strike, price_col="open"
                )

                if entry_price is None or entry_price <= 0:
                    continue

                # Asymmetric sizing: full risk if trend-aligned, half if counter-trend.
                ema_20 = self.dm.get_spot_ema(current_ts, period=20)
                is_trend_aligned = (is_call_breakout and spot_close > ema_20) or (
                    is_put_breakout and spot_close < ema_20
                )

                active_risk_pct = (
                    self.config.risk_per_trade_pct
                    if is_trend_aligned
                    else (self.config.risk_per_trade_pct / 2.0)
                )

                max_risk_amount = self.config.capital * active_risk_pct
                risk_per_lot = entry_price * 0.25 * self.config.lot_size

                if risk_per_lot <= 0:
                    continue
                dynamic_lots = int(max_risk_amount // risk_per_lot)
                if dynamic_lots < 1:
                    continue

                margin = entry_price * self.config.lot_size * dynamic_lots

                leg = TradeLeg(
                    leg_id=f"T{self._trade_counter}_ORB_{right.value[:1]}_{int(atm_strike)}",
                    right=right,
                    strike=atm_strike,
                    expiry=expiry,
                    entry_time=current_ts,
                    entry_premium=entry_price,
                    lot_size=self.config.lot_size,
                    num_lots=dynamic_lots,
                    direction="BUY",
                    stop_loss_pct=0.25,
                    trailing_sl_pct=0.15,
                    margin_blocked=margin,
                )

                alignment_str = (
                    "TREND ALIGNED (full risk)" if is_trend_aligned else "COUNTER-TREND (half risk)"
                )
                logger.info(
                    f"  ORB BREAKOUT @ {current_ts.time()} | {right.value} | {alignment_str}\n"
                    f"    Spot: {spot_close:.2f} | EMA: {ema_20:.2f} | "
                    f"Buying {dynamic_lots} Lots @ ₹{entry_price:.2f}"
                )

                return [leg]

        return []
