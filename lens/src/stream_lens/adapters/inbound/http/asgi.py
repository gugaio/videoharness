"""Ponto de entrada ASGI: uvicorn stream_lens.adapters.inbound.http.asgi:app"""

from __future__ import annotations

from stream_lens.adapters.inbound.http.app import create_app
from stream_lens.bootstrap import build_container

app = create_app(build_container())
