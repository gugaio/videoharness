# ADR-0002 — Parsers de manifesto e container: lógica central pura, não adapters de bibliotecas

Status: aceito (confirmado na Fase 3) · Data: 2026-09-05

## Contexto

Precisamos de parsing de HLS (M3U8), DASH (MPD XML), MPEG-TS e ISOBMFF/fMP4. A pergunta da Fase 0: parsers são núcleo puro ou adapters de bibliotecas externas? O prompt pede que essa decisão não seja tomada silenciosamente.

## Pesquisa de opções (a validar na instalação, Fase 1+)

- **HLS**: lib `m3u8` (Python, madura, foco em parsing) vs parser próprio. Formato de texto simples; parser próprio é viável, mas `m3u8` cobre muitas tags de borda (EXT-X-PART, BYTERANGE, I-FRAME STREAM INF).
- **DASH**: sem equivalente tão maduro quanto `m3u8`; candidatos: `ffprobe` (parcial), `xml.etree` + modelo próprio, ou libs menores (ex.: `dash-mpd`, menos consolidado).
- **MPEG-TS / ISOBMFF**: sem bibliotecas Python dominantes para inspeção estrutural (não demux completo); candidatos: parsers próprios (formatos binários bem especificados e razoavelmente pequenos para o escopo) + `ffprobe` como MediaProbe complementar. Na família Go do autor há precedentes (Stream Mock), mas sem reuso de código.

## Decisão

- **Modelo normalizado é domínio puro** (dataclasses/enums, sem I/O).
- **Parsers moram em `adapters/outbound/manifests|isobmff|mpegts` atrás de ports** (`ManifestParser` registry, `ContainerAnalyzer` registry), porque podem ser substituídos por bibliotecas e porque leem bytes/strings vindos de I/O.
- **Estratégia por formato**:
  - HLS: começar com lib `m3u8` (se compatível com 3.14) mapeando para o modelo comum; fallback parser próprio.
  - DASH: parser próprio com `xml.etree` + Pydantic para validação leve (lib dominante não existe).
  - MPEG-TS e ISOBMFF: parsers próprios, incrementais, orientados à árvore/estatísticas que a UI precisa (não demux completo); ffprobe via adapter para o que for derivado (codec, profile, frames).
- A decisão final de cada biblioteca crítica ganha ADR próprio na fase em que for adotada, com trade-offs.

## Consequências

- Controle do modelo comum sem equivalências forçadas; custo de manutenção dos parsers próprios de TS/fMP4 mitigado pelo escopo (boxes/PIDs alvo da Fase 5, não o padrão inteiro).
- Risco: `m3u8` pode atrasar o suporte a tags novas; mitigado pelo mapping fino e por tests de fixtures.
- Domínio permanece puro e testável sem I/O.

## Confirmação na Fase 3 (2026-09-05)

- **`m3u8==6.0.0` validado no Python 3.14** (venv do projeto); pinado em `backend/requirements.txt`, stubs `types-m3u8` em `requirements-dev.txt`. Nenhum fallback próprio necessário até o momento.
- DASH: parser próprio com `xml.etree` (`adapters/outbound/manifests/dash_parser.py`), agnóstico a namespace (MPDs sem `xmlns` também parseiam). Pydantic não foi usado no parser (validação leve ficou desnecessária; modelo é domínio puro).
- O mapping HLS/DASH → modelo unificado vive nos adapters; `protocol_specific` preserva o que não tem equivalência.
