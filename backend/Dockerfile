# ──────────────────────────────────────────────────────────────────────────
#  Backend image — shared by the FastAPI API server and the Celery worker.
#  The two services differ only by their `command` in docker-compose.yml.
# ──────────────────────────────────────────────────────────────────────────
FROM python:3.12-slim

# Faster, quieter Python in containers
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Install deps first for better layer caching
COPY requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt

# Application code
COPY . .

EXPOSE 8000

# Default command runs the API; the worker overrides this in compose.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
