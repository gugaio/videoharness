"""Port para materializar bytes capturados como evidência da inspeção."""

from __future__ import annotations

from pathlib import Path
from typing import Protocol

from stream_lens.application.ports.segment_fetcher import FetchedBytes
from stream_lens.domain.value_objects.segments import CapturedSegment, PlannedSegment


class SegmentStore(Protocol):
    """Persiste uma resposta de segmento e devolve seu registro declarativo."""

    def store(
        self,
        inspection_id: str,
        position: int,
        planned: PlannedSegment,
        fetched: FetchedBytes,
        workspace: Path,
        fetched_at,
    ) -> CapturedSegment: ...
