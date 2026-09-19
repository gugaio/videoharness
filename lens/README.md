# Stream Lens

Serviço headless (API + CLI) para inspecionar streams de vídeo (HLS e DASH;
MPEG-TS e fMP4/CMAF) de forma top-down: informe uma URL de manifesto, capture
uma janela limitada e explore a estrutura do stream com um snapshot JSON
canônico versionado, compartilhável dentro de um TTL.

## Status

**Fase 6 concluída + extensões de observabilidade. Serviço headless: API
FastAPI + CLI** — o frontend foi removido (ADR-0005); a visualização cabe aos
clientes do snapshot canônico, como o orquestrador do Video Harness. Uma
inspeção percorre manifesto, captura uma janela e analisa cada segmento
fMP4/CMAF ou MPEG-TS. O snapshot 1.13 inclui árvore de boxes ou estatísticas
TS, samples fMP4 e unidades PES com tamanho/PTS/DTS. Quando o `ffprobe` consegue
ler o vídeo, inclui também frames I/P/B exatos e seus tempos; essa leitura
permanece opcional e derivada e alimenta um resumo de GOP/keyframes observado.
O snapshot também compara o alinhamento ABR, calcula bitrate por segmento a
partir de bytes e duração, pareia ABR por sequência de segmento (sem confundir
janelas live deslocadas) e expõe TTFB, download, throughput, redirects e sinais
seguros de cache quando a captura HTTP os observa. Para HLS live, preserva
janela/sequence da playlist e só calcula distância da borda com
`PROGRAM-DATE-TIME`; não confunde essa amostra com telemetria do player. Também
expõe a configuração efetiva que o `ffprobe` observou por segmento
(codec/profile/level, pixel format, vídeo e áudio), mudanças entre segmentos e o
delta A/V calculado por PTS de apresentação dentro do mesmo container, sem
prometer compatibilidade de device ou sincronismo percebido. O snapshot ainda
preserva sinal HDR, HDR estático e presença de HDR10+ observados nos bytes. A
captura tem orçamento padrão de **500 MB** por inspeção e **20 MB** por
segmento. URLs `http(s)` passam pelo safe fetcher (SSRF, redirects revalidados,
limites, redaction). Também há Docker Compose (API `:8000`). DASH aceita
`SegmentTemplate` com `$Number$` ou `$Time$`, incluindo `SegmentTimeline` com
repetições. Para DASH, o snapshot estrutura as declarações DRM do MPD por
escopo, sistema, KID e resumo seguro de PSSH, sem alegar teste de licença ou
compatibilidade do dispositivo.

> **Nota**: docs temáticos podem mencionar a UI original da Lens como racional
> histórico das entregas; a interface foi removida (ADR-0005) e o snapshot
> canônico alimenta clientes externos (ex.: orquestrador do Video Harness).

## Quickstart

Requisitos (modo local, sem Docker): Python 3.12+ (`python3`).

```bash
make bootstrap          # venv + dependências
make dev                # API em http://localhost:8000 (--reload)
# ou com Docker:
make compose-up         # API :8000 (docs em /docs)
```

Use a CLI ou os endpoints HTTP — `make cli inspect url=fixture://hls-ts/master.m3u8`
ou uma URL real (ex. `https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_16x9/bipbop_16x9_variant.m3u8`).

```bash
make test               # testes da API, CLI e análise (pytest)
make lint               # ruff + mypy
make cli inspect url=https://exemplo.com/master.m3u8
```

## Documentação

- `AGENTS.md` — instruções para agentes que trabalham no repositório
- `docs/PRODUCT.md` — problema, usuários, escopo e não objetivos
- `docs/ARCHITECTURE.md` — arquitetura hexagonal e fluxos
- `docs/HLS_PARSER.md` — fluxo e mapeamento do parser HLS
- `docs/API.md` — endpoints implementados e planejados
- `docs/SNAPSHOT_SCHEMA.md` — contrato canônico do snapshot
- `docs/ROADMAP.md` — fases, gates e progresso
- `docs/PROJECT_STATE.md` — estado atual e próximo passo
- `docs/OBSERVABILITY.md` — trilha de medições para investigação e otimização
- `docs/TIMELINE_HEALTH.md` — métricas temporais, limites e roteiro de QA
- `docs/ABR_ALIGNMENT.md` — evidências de alinhamento para troca adaptativa
- `docs/BITRATE_PER_SEGMENT.md` — taxa calculada, distribuição de payload e roteiro de QA
- `docs/HTTP_LIVE_DELIVERY.md` — entrega HTTP, live edge, limites e roteiro de QA
- `docs/BITSTREAM_OBSERVABILITY.md` — configuração efetiva, delta A/V, limites e roteiro de QA
- `docs/DASH_DRM.md` — DRM declarado no DASH, modelo mental, limites e roteiro de QA
- `docs/adr/` — decisões arquiteturais

## Layout

```
src/stream_lens/  API, CLI e análise (domain, application, parsers, adapters, bootstrap)
tests/     Testes unitários e de integração
fixtures/  Conteúdo sintético (hls-ts, hls-fmp4, dash-mpd)
skills/    Catálogo de skills para agentes (draft)
docs/      Memória do projeto
pyproject.toml / requirements*.txt  Configuração Python e dependências
Dockerfile / compose.yaml / Makefile  Build e execução
```

Todos os comandos partem da raiz da Lens (`cd lens` no Video Harness).
O layout foi simplificado no ADR-0006; o serviço standalone do Compose é `api`.
No ADR-0007, a seleção de parsers fica na aplicação e a interpretação de
HLS/DASH/fMP4/MPEG-TS em `parsers/`, sem I/O. Adapters cuidam das integrações,
como fetch HTTP, persistência e execução de ffprobe.
O `CapturePlan` e o serviço de captura ficam na aplicação; os adapters só
buscam e persistem os bytes via ports (ADR-0008).
