FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 HOST=0.0.0.0 PORT=8000
WORKDIR /app
COPY requirements.txt requirements-web.txt ./
RUN pip install --no-cache-dir -r requirements-web.txt \
    && useradd --create-home --uid 10001 qrg
COPY qrg.py qrg_web.py ./
COPY web/ ./web/
COPY assets/icon.png ./assets/icon.png
COPY script/serve-web ./script/serve-web
USER qrg
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD python -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:' + os.environ.get('PORT', '8000') + '/healthz', timeout=2)" || exit 1
CMD ["./script/serve-web"]
