"""Application settings, loaded from environment variables / .env."""
from __future__ import annotations

from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration for the API and Celery worker."""

    redis_url: str = Field(
        default="redis://localhost:6379/0",
        validation_alias="REDIS_URL",
        description="Redis URL used as Celery broker and result backend.",
    )
    data_dir: Path = Field(
        default=Path(__file__).resolve().parent.parent / "data",
        validation_alias="DATA_DIR",
        description="Directory containing the .parquet datasets.",
    )
    stock_code: str = Field(default="NIFTY", validation_alias="STOCK_CODE")

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    def dataset_paths(self, dataset: str) -> tuple[Path, Path]:
        """Return (options_path, spot_path) for a named dataset.

        Convention: ``options_<dataset>.parquet`` and ``spot_<dataset>.parquet``
        inside ``data_dir``.
        """
        options = self.data_dir / f"options_{dataset}.parquet"
        spot = self.data_dir / f"spot_{dataset}.parquet"
        return options, spot


settings = Settings()
