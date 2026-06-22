"""Transaction-cost engine modelling realistic NSE/NFO option charges."""
from __future__ import annotations

from .constants import (
    BROKERAGE_PER_ORDER,
    EXCHANGE_TXNCHARGE,
    GST_RATE,
    SEBI_TURNOVER_FEE,
    STAMP_DUTY,
    STT_RATE_SELL,
)


def compute_transaction_cost(
    premium: float,
    lot_size: int,
    num_lots: int,
    is_entry: bool,
) -> float:
    """Compute realistic NSE/NFO transaction costs for one option order.

    Args:
        premium:  Option premium (per unit) for the order.
        lot_size: Contract lot size.
        num_lots: Number of lots traded.
        is_entry: True for the entry (buy) order, False for the exit (sell).

    Returns:
        Total transaction cost in INR (brokerage + exchange + GST + SEBI +
        STT on sells + stamp duty on buys).
    """
    turnover = premium * lot_size * num_lots
    brokerage = min(BROKERAGE_PER_ORDER, turnover * 0.0003)
    exchange_chg = turnover * EXCHANGE_TXNCHARGE
    gst = (brokerage + exchange_chg) * GST_RATE
    sebi = turnover * SEBI_TURNOVER_FEE

    stt = turnover * STT_RATE_SELL if not is_entry else 0.0
    stamp = turnover * STAMP_DUTY if is_entry else 0.0

    return brokerage + exchange_chg + gst + sebi + stt + stamp
