"""Persistência atômica das coletas adicionais sob o TTL da inspeção base."""

from __future__ import annotations

import contextlib
import json
import os
import tempfile
from pathlib import Path


class FilesystemSupplementalCaptureRepository:
    def __init__(self, workspace: Path) -> None:
        self._workspace = workspace

    def get(self, inspection_id: str, capture_id: str) -> dict | None:
        path = self._path(inspection_id, capture_id)
        if not path.is_file():
            return None
        return json.loads(path.read_text(encoding="utf-8"))

    def save(self, inspection_id: str, capture_id: str, record: dict) -> None:
        path = self._path(inspection_id, capture_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, temp_name = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(record, handle, ensure_ascii=False, indent=2)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temp_name, path)
        except BaseException:
            with contextlib.suppress(FileNotFoundError):
                os.unlink(temp_name)
            raise

    def fail_active(self, message: str) -> int:
        changed = 0
        if not self._workspace.is_dir():
            return changed
        for path in self._workspace.glob("*/captures/*/capture.json"):
            record = json.loads(path.read_text(encoding="utf-8"))
            if record.get("status") in {"queued", "running"}:
                record["status"] = "failed"
                record["error"] = message
                _atomic_write(path, record)
                changed += 1
        return changed

    def _path(self, inspection_id: str, capture_id: str) -> Path:
        return self._workspace / inspection_id / "captures" / capture_id / "capture.json"


def _atomic_write(path: Path, record: dict) -> None:
    fd, temp_name = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(record, handle, ensure_ascii=False, indent=2)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_name, path)
    except BaseException:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(temp_name)
        raise
