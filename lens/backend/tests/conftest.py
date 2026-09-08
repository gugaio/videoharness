"""Fixtures compartilhadas dos testes backend."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
FIXTURES_ROOT = REPO_ROOT / "fixtures"


class FrozenClock:
    """Clock determinístico para testes."""

    def __init__(self, base: datetime | None = None) -> None:
        self._base = base or datetime(2026, 1, 1, tzinfo=UTC)

    def now(self) -> datetime:
        return self._base

    def advance(self, seconds: int) -> None:
        from datetime import timedelta

        self._base += timedelta(seconds=seconds)


class SequentialIdGenerator:
    def __init__(self) -> None:
        self._counter = 0

    def new_id(self) -> str:
        self._counter += 1
        return f"00000000-0000-0000-0000-{self._counter:012d}"


@pytest.fixture
def frozen_clock() -> FrozenClock:
    return FrozenClock()


@pytest.fixture
def sequential_ids() -> SequentialIdGenerator:
    return SequentialIdGenerator()


@pytest.fixture
def fixtures_root() -> Path:
    return FIXTURES_ROOT
