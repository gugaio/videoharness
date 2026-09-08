"""Ports de persistência temporária."""

from __future__ import annotations

from typing import Protocol

from stream_lens.domain.entities.inspection import Inspection
from stream_lens.domain.value_objects.snapshot import Snapshot


class InspectionRepository(Protocol):
    """Repositório temporário atrás de um TTL (sem banco no MVP)."""

    def save(self, inspection: Inspection, snapshot: Snapshot | None = None) -> None: ...

    def get(self, inspection_id: str) -> Inspection | None: ...

    def get_snapshot(self, inspection_id: str) -> Snapshot | None: ...

    def purge_expired(self, now=None) -> int: ...

    def fail_active(self, stage: str, message: str) -> int: ...
