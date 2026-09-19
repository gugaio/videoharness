"""Port: fila de execução de inspeções."""

from __future__ import annotations

from typing import Protocol


class JobQueue(Protocol):
    """Submete a execução assíncrona de uma inspeção já criada."""

    def submit(self, inspection_id: str, url: str) -> None: ...
