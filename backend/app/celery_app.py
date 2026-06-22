"""Celery application instance (Redis broker + result backend)."""
from __future__ import annotations

from celery import Celery

from .config import settings

celery = Celery(
    "backtester",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=["app.tasks"],
)

celery.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    result_expires=3600,            # results live in Redis for 1 hour
    task_track_started=True,
    worker_send_task_events=True,
    timezone="Asia/Kolkata",
    enable_utc=True,
)
