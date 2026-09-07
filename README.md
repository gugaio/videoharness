# Stream Lens

Ferramenta visual e API para inspecionar streams de vídeo (HLS e DASH; MPEG-TS e
fMP4/CMAF) de forma top-down: informe uma URL de manifesto, capture uma janela
limitada e explore a estrutura do stream com um snapshot JSON canônico versionado,
compartilhável dentro de um TTL.

## Status

**Fase 6 concluída + visualização de frames/samples.** Backend
FastAPI + CLI + frontend React; uma inspeção percorre manifesto, captura uma janela e
analisa cada segmento fMP4/CMAF ou MPEG-TS. O snapshot 1.6 inclui árvore de boxes ou
estatísticas TS, samples fMP4 e unidades PES com tamanho/PTS/DTS. Quando o `ffprobe`
consegue ler o vídeo, inclui também frames I/P/B exatos e seus tempos; essa leitura
permanece opcional e derivada e alimenta um resumo de GOP/keyframes observado. O
snapshot ainda preserva sinal HDR, HDR estático e presença de HDR10+ observados nos
bytes. A captura tem
orçamento padrão de **500 MB** por inspeção e **20 MB** por segmento. URLs `http(s)`
passam pelo safe fetcher (SSRF, redirects revalidados, limites, redaction). Também há
Docker Compose (UI `:8080`, API `:8000`). DASH aceita `SegmentTemplate` com
`$Number$` ou `$Time$`, incluindo `SegmentTimeline` com repetições.

## Quickstart

Requisitos (modo local, sem Docker): Python 3.12+ (`python3`), Node 22.12.0 via nvm (`nvm22`).

```bash
make bootstrap          # venv + deps backend; npm install frontend
make dev                # backend (:8000) + frontend (:5173) juntos, sem Docker
# ou separadamente:
make back               # backend em http://localhost:8000 (--reload)
make front              # frontend em http://localhost:5173 (proxy /api -> 8000)
```

Na UI: use uma URL de manifesto real (ex. `https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_16x9/bipbop_16x9_variant.m3u8`) ou `fixture://hls-ts/master.m3u8`.

```bash
make compose-up         # alternativa com Docker (UI :8080, API :8000)
make test               # backend (pytest) + frontend (vitest)
make lint               # ruff + mypy + tsc + oxlint
make cli inspect url=https://exemplo.com/master.m3u8
```

## Documentação

- `AGENTS.md` — instruções para agentes que trabalham no repositório
- `docs/PRODUCT.md` — problema, usuários, escopo e não objetivos
- `docs/ARCHITECTURE.md` — arquitetura hexagonal e fluxos
- `docs/API.md` — endpoints implementados e planejados
- `docs/SNAPSHOT_SCHEMA.md` — contrato canônico do snapshot
- `docs/ROADMAP.md` — fases, gates e progresso
- `docs/PROJECT_STATE.md` — estado atual e próximo passo
- `docs/OBSERVABILITY.md` — trilha de medições para investigação e otimização
- `docs/TIMELINE_HEALTH.md` — métricas temporais, limites e roteiro de QA
- `docs/adr/` — decisões arquiteturais

## Layout

```
backend/   Python/FastAPI (src/stream_lens: domain, application, adapters, bootstrap)
frontend/  React/TypeScript/Vite (.nvmrc: 22.12.0)
fixtures/  Conteúdo sintético (hls-ts, hls-fmp4, dash-mpd)
skills/    Catálogo de skills para agentes (draft)
docs/      Memória do projeto
```
