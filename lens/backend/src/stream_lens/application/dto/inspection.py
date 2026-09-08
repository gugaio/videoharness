"""DTOs de entrada/saída dos casos de uso (contrato público).

Frontend e agentes consomem exatamente estas formas via HTTP; a CLI usa
os mesmos objetos.
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from stream_lens.domain.value_objects.manifest_summary import ManifestSummary


class CreateInspectionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    url: str = Field(min_length=1, description="URL do manifesto. Na v0.1 apenas fixture://…")


class InspectionResponse(BaseModel):
    """Resposta imediata da criação (o snapshot pode ainda não existir)."""

    inspection_id: str
    status: str
    status_url: str
    view_url: str
    expires_at: datetime


class ManifestSummaryDTO(BaseModel):
    protocol: str
    kind: str
    is_live: bool
    variant_count: int | None = None
    segment_count: int | None = None
    rendition_count: int | None = None

    @classmethod
    def from_domain(cls, summary: ManifestSummary) -> ManifestSummaryDTO:
        return cls(
            protocol=summary.protocol.value,
            kind=summary.kind.value,
            is_live=summary.is_live,
            variant_count=summary.variant_count,
            segment_count=summary.segment_count,
            rendition_count=summary.rendition_count,
        )


class InspectionDetail(BaseModel):
    """Estado atual da inspeção (sem o snapshot completo)."""

    inspection_id: str
    status: str
    created_at: datetime
    expires_at: datetime
    protocol: str | None = None
    manifest: ManifestSummaryDTO | None = None
    error_stage: str | None = None
    error_message: str | None = None
    segments_planned: int | None = None
    segments_captured: int | None = None
    segments_failed: int | None = None
    snapshot_url: str | None = None
