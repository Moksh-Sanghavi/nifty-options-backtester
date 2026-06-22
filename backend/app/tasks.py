"""Celery task that runs a backtest asynchronously and stores the results."""
from __future__ import annotations

import logging
from typing import Any, Dict

from celery import Task

from .celery_app import celery
from .config import settings
from .engine.backtester import Backtester
from .engine.config import StrategyConfig

logger = logging.getLogger("OptionsBacktester.Task")


@celery.task(bind=True, name="app.tasks.run_backtest")
def run_backtest(self: Task, payload: Dict[str, Any]) -> Dict[str, Any]:
    """Execute a backtest from a serialised request payload.

    Args:
        payload: JSON dict with keys ``config`` (StrategyConfig fields),
            ``start_date``, ``end_date`` and ``dataset``.

    Returns:
        The full results dict (metrics, summary, equity_curve, trade_log).

    Raises:
        FileNotFoundError: when the dataset's Parquet files are missing.
    """
    config = StrategyConfig(**payload.get("config", {}))
    dataset = payload.get("dataset", "dec2023")
    start_date = payload.get("start_date")
    end_date = payload.get("end_date")

    options_path, spot_path = settings.dataset_paths(dataset)
    if not options_path.exists() or not spot_path.exists():
        raise FileNotFoundError(
            f"Dataset '{dataset}' not found. Expected {options_path.name} and "
            f"{spot_path.name} in {settings.data_dir}. Run the Parquet converter first."
        )

    self.update_state(state="PROGRESS", meta={"current": 0, "total": 0, "percent": 0.0})

    backtester = Backtester(
        options_path=str(options_path),
        spot_path=str(spot_path),
        config=config,
        stock_code=settings.stock_code,
    )

    def on_progress(current: int, total: int) -> None:
        """Relay simulation progress to Celery state for the status endpoint."""
        percent = round(current / total * 100, 1) if total else 0.0
        self.update_state(
            state="PROGRESS", meta={"current": current, "total": total, "percent": percent}
        )

    tracker = backtester.run(
        start_date=start_date, end_date=end_date, progress_callback=on_progress
    )
    return tracker.build_results(initial_capital=config.capital)
