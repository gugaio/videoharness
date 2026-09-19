# ARCHITECTURE.md

## Visão

Arquitetura hexagonal (Ports and Adapters) **leve**: o padrão é instrumento de separação, não cerimônia. Nenhuma abstração é criada apenas para parecer sofisticada; um port existe quando há fronteira externa, efeito colateral ou implementação substituível relevante.

## Regras de dependência

- Dependências apontam para dentro (domínio ← aplicação ← adapters).
- O domínio **não importa** FastAPI, filesystem, HTTP client, subprocess ou Pydantic.
- Casos de uso coordenam serviços da aplicação; fronteiras externas usam ports (`typing.Protocol`).
- `application/manifest_inspector.py` e `application/container_analyzer.py`
  selecionam parsers. `parsers/` transforma texto/bytes em modelos do domínio,
  sem I/O e sem importar application ou adapters (ADR-0007).
- Adapters implementam ports; a composição acontece em um **composition root explícito** (`bootstrap.py`). Sem framework de DI no MVP.
- Clientes (orquestrador, agentes) consomem o **mesmo** contrato público (mesmos endpoints/DTOs). Não existe caminho de dados privativo de nenhuma interface.
- CLI e FastAPI chamam os mesmos casos de uso; nada de parsing ou regra de negócio duplicada nos adapters de entrada.

## Organização da API

```
src/stream_lens/
├── domain/            # entidades, value objects, serviços puros
│   ├── entities/
│   ├── value_objects/
│   └── services/
├── application/       # coordenação, casos de uso, contratos e DTOs
│   ├── manifest_inspector.py  # seleção HLS/DASH
│   ├── container_analyzer.py  # seleção fMP4/MPEG-TS
│   ├── use_cases/
│   ├── ports/
│   └── dto/
├── parsers/           # hls.py, dash.py, fmp4.py, mpegts.py; sem I/O
├── adapters/
│   ├── inbound/
│   │   ├── http/      # FastAPI
│   │   └── cli/       # CLI (ex.: `stream-lens inspect <url>`)
│   └── outbound/
│       ├── fetching/     # dispatcher por esquema + safe HTTP fetcher (SSRF, limites) + fixtures locais
│       ├── segments/     # planejamento da janela + captura de bytes + serialização
│       ├── ffprobe.py    # execução de subprocess, evidência derivada
│       ├── filesystem/   # repositório + serialização de manifestos e containers
│       ├── jobs/         # JobQueue (in-process)
│       └── providers.py  # implementações concretas para o composition root
└── bootstrap.py      # composition root
```

Serviço headless (ADR-0005): API FastAPI + CLI, sem frontend. Skills: `skills/` (ver `docs/ROADMAP.md` Fase 7).

## Contratos internos e fronteiras externas

`ManifestInspector` e `ContainerAnalyzer` são contratos internos dos serviços
da aplicação, preservados para injeção e testes; não representam saída para
infraestrutura. `ManifestFetcher`, `SegmentFetcher`, `MediaProbe`,
`InspectionRepository` e `JobQueue` descrevem fronteiras externas.
`Clock`/`IdGenerator` permitem determinismo nos testes.

O fluxo de parsing é `RunInspection → inspector/analyzer → parsers → modelos
do domínio`. A biblioteca `m3u8` fica encapsulada em `parsers/hls.py`; importar
uma biblioteca de parsing não implica I/O. A captura existente ainda combina
planejamento e escrita em `adapters/outbound/segments/capture_service.py`;
sua separação não faz parte deste refactor.

## Fluxo de execução alvo

1. Usuário informa URL → API valida e cria `inspection_id` (aleatório, não previsível).
2. API responde rápido (202) com `status_url` e `view_url`.
3. Job assíncrono captura e analisa janela limitada, persistindo progresso.
4. Snapshot escrito de forma **atômica**; clientes acompanham por polling (SSE opcional).
5. Clientes navegam para `/inspect/{id}` e consomem os mesmos endpoints JSON.
6. Resultado expira após TTL.

Estados: `queued → fetching_manifest → parsing_manifest → resolving_segments → capturing_segments → inspecting_containers → building_snapshot → completed | partial | failed`, mais `expired`. Resultado parcial nunca é apresentado como completo; erros são preservados por estágio. Detalhes no ciclo de vida de `docs/API.md`.

## Repositório temporário (sem banco)

```
<workspace>/<inspection_id>/
├── status.json    # estado do ciclo de vida (escrita atômica)
├── snapshot.json  # snapshot canônico (escrita atômica)
└── segments/      # bytes capturados da janela limitada
```

Escrita atômica, TTL configurável, limpeza de expirados, limites explícitos (duração, segmentos, bytes, tempo). O ID representa uma inspeção/snapshot, não uma URL — a mesma URL pode gerar snapshots diferentes (live). Múltiplas réplicas exigirão adapter compartilhado no futuro (ver `docs/SECURITY.md` e ADRs).

## Decisões registradas

Ver `docs/adr/`. Nenhuma biblioteca crítica é escolhida silenciosamente.

- ADR-0007: seleção de parsers na aplicação e parsing puro em `parsers/`;
  supera a localização dos parsers em outbound definida no ADR-0002.

- ADR-0006: projeto Python na raiz da Lens (`src/`, `tests/`, pyproject,
  requirements e Dockerfile), sem o nível redundante `backend/`.

- ADR-0004: o MediaProbe associa frames a pacotes por stream/posição únicos com
  PTS e tamanho conferidos. DTS vem do pacote; ausência de evidência retorna null.
