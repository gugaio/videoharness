"""Port de persistência de pedidos de captura adicional."""

from __future__ import annotations

from typing import Protocol


class SupplementalCaptureRepository(Protocol):
    def get(self, inspection_id: str, capture_id: str) -> dict | None: ...

    def save(self, inspection_id: str, capture_id: str, record: dict) -> None: ...

    def fail_active(self, message: str) -> int: ...
