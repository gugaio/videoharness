# Stream Lens — API; contexto do build: raiz da Lens.
FROM python:3.14-slim

# ffprobe alimenta o media probe opcional (frames, GOP, sincronismo A/V).
# Sem ele o backend funciona, mas o snapshot sai sem a camada derivada.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# código (src layout + pyproject para empacotar stream_lens)
COPY pyproject.toml ./
COPY src ./src
RUN pip install --no-cache-dir -e .

# fixtures servem como fonte fixture:// também no container
COPY fixtures /app/fixtures

ENV STREAM_LENS_WORKSPACE=/data/inspections \
    STREAM_LENS_FIXTURES=/app/fixtures \
    PYTHONUNBUFFERED=1

RUN mkdir -p /data/inspections
VOLUME ["/data/inspections"]

EXPOSE 8000

# sem --reload em produção-like; workers=1 porque jobs são in-process
CMD ["uvicorn", "stream_lens.adapters.inbound.http.asgi:app", "--host", "0.0.0.0", "--port", "8000"]
