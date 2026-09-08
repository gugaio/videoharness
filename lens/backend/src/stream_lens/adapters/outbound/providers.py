"""Implementações concretas de Clock e IdGenerator."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4


class SystemClock:
    def now(self) -> datetime:
        return datetime.now(UTC)


class UuidIdGenerator:
    """ID aleatório e não previsível (UUIDv4). O ID é a inspeção, não a URL."""

    def new_id(self) -> str:
        return str(uuid4())
