"""Adapter CLI: exercita os mesmos casos de uso do HTTP (sem duplicar regras).

Uso:
    stream-lens inspect <url> --output snapshot.json
    stream-lens purge-expired

A CLI cria a inspeção com CreateInspection (validação + TTL + ID) e a executa
com RunInspection — exatamente o que o JobQueue faz para o HTTP.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

from stream_lens.adapters.outbound.filesystem.inspection_repository import (
    snapshot_to_dict,
)
from stream_lens.application.use_cases.create_inspection import InspectionError
from stream_lens.bootstrap import build_container


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="stream-lens",
        description="Stream Lens — inspeção de streams HLS/DASH",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    inspect = sub.add_parser("inspect", help="cria uma inspeção a partir de uma URL de manifesto")
    inspect.add_argument("url", help="URL do manifesto (fixture://, http:// ou https://)")
    inspect.add_argument("--output", type=Path, default=None, help="grava o snapshot em JSON")

    sub.add_parser("purge-expired", help="remove inspeções expiradas do workspace")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    container = build_container()

    if args.command == "purge-expired":
        removed = container.repository.purge_expired()
        print(f"removidas {removed} inspeções expiradas")
        return 0

    return asyncio.run(_inspect(container, args.url, args.output))


async def _inspect(container, url: str, output: Path | None) -> int:
    try:
        inspection = container.create_inspection.execute(url)
    except InspectionError as exc:
        print(f"erro: {exc.stage}: {exc.message}", file=sys.stderr)
        return 1

    await container.run_inspection.execute(inspection.inspection_id, url)
    inspection = container.repository.get(inspection.inspection_id)
    if inspection is None:  # pragma: no cover - defensive
        print("erro: estado da inspeção perdido", file=sys.stderr)
        return 1

    if inspection.status.value == "failed":
        print(
            f"erro: {inspection.error_stage}: {inspection.error_message}",
            file=sys.stderr,
        )
        return 1

    snapshot = container.repository.get_snapshot(inspection.inspection_id)
    if snapshot is None:
        print(f"erro: inspeção {inspection.inspection_id} não produziu snapshot", file=sys.stderr)
        return 1

    payload = snapshot_to_dict(snapshot)
    if output:
        output.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"inspeção {inspection.inspection_id} concluída; snapshot em {output}")
    else:
        print(json.dumps(payload, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
