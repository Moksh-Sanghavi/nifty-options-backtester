"""Refactored Nifty options backtesting engine (modular, config-driven)."""
from __future__ import annotations

from .analytics import PerformanceTracker
from .backtester import Backtester
from .config import StrategyConfig
from .constants import LegStatus, OptionRight, RunMode, StrategyType
from .data_manager import DataManager
from .execution import ExecutionHandler
from .models import Trade, TradeLeg
from .strategy import Strategy

__all__ = [
    "Backtester",
    "DataManager",
    "ExecutionHandler",
    "PerformanceTracker",
    "Strategy",
    "StrategyConfig",
    "Trade",
    "TradeLeg",
    "LegStatus",
    "OptionRight",
    "RunMode",
    "StrategyType",
]
