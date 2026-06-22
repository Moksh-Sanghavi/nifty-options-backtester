"""
FastAPI application exposing the asynchronous backtest API.

Routes:
    GET  /api/health                       — liveness probe
    GET  /api/datasets                     — available Parquet datasets
    POST /api/backtest/start               — enqueue a backtest, return task_id
    GET  /api/backtest/status/{task_id}    — poll task status / progress
    GET  /api/backtest/results/{task_id}   — fetch completed results
"""
from __future__ import annotations

import logging

from celery.result import AsyncResult
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .celery_app import celery
from .config import settings
from .schemas import (
    BacktestRequest,
    ResultsResponse,
    StartResponse,
    StatusResponse,
)
from .tasks import run_backtest

logger = logging.getLogger("OptionsBacktester.API")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)

app = FastAPI(
    title="Nifty Options Backtester API",
    version="1.0.0",
    description="Asynchronous backtesting service for Wall Reversion + ORB strategies.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    """Flatten Pydantic validation errors into a single readable message."""
    parts = []
    for err in exc.errors():
        loc = " → ".join(str(p) for p in err.get("loc", []) if p != "body")
        parts.append(f"{loc}: {err.get('msg')}" if loc else str(err.get("msg")))
    return JSONResponse(status_code=422, content={"detail": "; ".join(parts)})


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Catch-all so unexpected server errors return JSON, not an HTML 500."""
    logger.exception("Unhandled error on %s", request.url.path)
    return JSONResponse(
        status_code=500, content={"detail": "Internal server error. Please try again."}
    )


@app.get("/api/health", tags=["meta"])
def health() -> dict:
    """Liveness probe."""
    return {"status": "ok"}


@app.get("/api/datasets", tags=["meta"])
def list_datasets() -> dict:
    """List dataset names that have both options and spot Parquet files."""
    data_dir = settings.data_dir
    if not data_dir.exists():
        return {"datasets": []}
    options = {p.stem.removeprefix("options_") for p in data_dir.glob("options_*.parquet")}
    spots = {p.stem.removeprefix("spot_") for p in data_dir.glob("spot_*.parquet")}
    return {"datasets": sorted(options & spots)}


@app.post("/api/backtest/start", response_model=StartResponse, tags=["backtest"])
def start_backtest(request: BacktestRequest) -> StartResponse:
    """Validate the config, enqueue the Celery task, and return its id."""
    options_path, spot_path = settings.dataset_paths(request.dataset)
    if not options_path.exists() or not spot_path.exists():
        raise HTTPException(
            status_code=404,
            detail=(
                f"Dataset '{request.dataset}' not found. Expected "
                f"{options_path.name} and {spot_path.name} in {settings.data_dir}."
            ),
        )

    task = run_backtest.delay(request.model_dump(mode="json"))
    return StartResponse(task_id=task.id, status="PENDING")


@app.get("/api/backtest/status/{task_id}", response_model=StatusResponse, tags=["backtest"])
def backtest_status(task_id: str) -> StatusResponse:
    """Report the current state (and progress) of a backtest task."""
    result = AsyncResult(task_id, app=celery)
    state = result.state

    response = StatusResponse(task_id=task_id, status=state)

    if state == "PROGRESS" and isinstance(result.info, dict):
        response.progress = {
            "current": result.info.get("current", 0),
            "total": result.info.get("total", 0),
            "percent": result.info.get("percent", 0.0),
        }
    elif state == "FAILURE":
        response.error = str(result.info)

    return response


@app.get("/api/backtest/results/{task_id}", response_model=ResultsResponse, tags=["backtest"])
def backtest_results(task_id: str) -> ResultsResponse:
    """Return completed results, or an error if the task isn't done."""
    result = AsyncResult(task_id, app=celery)
    state = result.state

    if state == "FAILURE":
        raise HTTPException(status_code=500, detail=str(result.info))
    if state != "SUCCESS":
        raise HTTPException(
            status_code=409, detail=f"Results not ready (task state: {state})."
        )

    data = result.result
    return ResultsResponse(
        task_id=task_id,
        status=state,
        metrics=data.get("metrics", {}),
        summary=data.get("summary", {}),
        equity_curve=data.get("equity_curve", []),
        trade_log=data.get("trade_log", []),
    )
