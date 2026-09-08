"""JobQueue em processo: asyncio tasks com controle de concorrência.

Sem broker externo (sem banco no MVP). Jobs vivem no processo: um restart
perde os jobs em andamento, e o sweep de startup (bootstrap/app lifespan)
marca essas inspeções como failed — comportamento documentado em
docs/PROJECT_STATE.md e SECURITY.md.
"""

from __future__ import annotations

import asyncio

from stream_lens.application.use_cases.run_inspection import RunInspection


class InProcessJobQueue:
    """Executa inspeções como tasks asyncio, com limite de concorrência."""

    def __init__(self, runner: RunInspection, max_concurrency: int = 4) -> None:
        self._runner = runner
        self._semaphore = asyncio.Semaphore(max_concurrency)
        self._tasks: set[asyncio.Task[None]] = set()

    def submit(self, inspection_id: str, url: str) -> None:
        task = asyncio.ensure_future(self._run(inspection_id, url))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _run(self, inspection_id: str, url: str) -> None:
        async with self._semaphore:
            await self._runner.execute(inspection_id, url)

    async def wait_all(self) -> None:
        """Usado por testes e pelo encerramento gracioso."""
        if self._tasks:
            await asyncio.gather(*self._tasks)
