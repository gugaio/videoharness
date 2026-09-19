"""Caso de uso: criar uma inspeção e submetê-la à fila (POST assíncrono)."""

from __future__ import annotations

from datetime import timedelta

from stream_lens.application.ports.jobs import JobQueue
from stream_lens.application.ports.providers import Clock, IdGenerator
from stream_lens.application.ports.repositories import InspectionRepository
from stream_lens.domain.entities.inspection import Inspection, InspectionStatus
from stream_lens.domain.services.url_validation import InvalidManifestUrl, validate_manifest_url


class InspectionError(Exception):
    """Falha de inspeção conhecida (URL inválida, fetch falhou, parse falhou)."""

    def __init__(self, stage: str, message: str) -> None:
        super().__init__(message)
        self.stage = stage
        self.message = message


class CreateInspection:
    """Valida a URL, cria a inspeção em `queued` e submete o job.

    A execução em si é responsabilidade de `RunInspection` — usado tanto
    pelo JobQueue (HTTP) quanto pela CLI, sem duplicação de regras.
    """

    def __init__(
        self,
        repository: InspectionRepository,
        jobs: JobQueue,
        ids: IdGenerator,
        clock: Clock,
        ttl_seconds: int = 3600,
    ) -> None:
        self._repository = repository
        self._jobs = jobs
        self._ids = ids
        self._clock = clock
        self._ttl = timedelta(seconds=ttl_seconds)

    def execute(self, url: str) -> Inspection:
        try:
            validate_manifest_url(url)
        except InvalidManifestUrl as exc:
            raise InspectionError("validation", str(exc)) from exc

        now = self._clock.now()
        inspection = Inspection(
            inspection_id=self._ids.new_id(),
            status=InspectionStatus.QUEUED,
            created_at=now,
            expires_at=now + self._ttl,
        )
        self._repository.save(inspection)
        self._jobs.submit(inspection.inspection_id, url)
        return inspection
