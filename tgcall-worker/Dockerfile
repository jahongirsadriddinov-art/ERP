# Keyinchalik serverda (Railway/VPS) ishlatish uchun. Uyda — run-windows.bat.
# ntgcalls glibc >= 2.28 talab qiladi — bookworm-slim (Alpine/musl ishlamaydi).
FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 DATA_DIR=/data
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
RUN useradd -r -u 10001 worker && mkdir -p /data && chown worker /data
USER worker
VOLUME ["/data"]

# Maxfiy kalit va shifrlangan sessiya /data da (doimiy disk ulang). TG_SESSION_KEY — muhit o'zgaruvchisi.
CMD ["python", "-m", "app.main"]
