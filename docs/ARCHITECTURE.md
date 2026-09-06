# ARCHITECTURE.md

## Visão

Arquitetura hexagonal (Ports and Adapters) **leve**: o padrão é instrumento de separação, não cerimônia. Nenhuma abstração é criada apenas para parecer sofisticada; um port existe quando há fronteira externa, efeito colateral ou implementação substituível relevante.

## Regras de dependência

- Dependências apontam para dentro (domínio ← aplicação ← adapters).
- O domínio **não importa** FastAPI, filesystem, HTTP client, subprocess ou Pydantic.
- Casos de uso dependem de ports (`typing.Protocol`).
- Adapters implementam ports; a composição acontece em um **composition root explícito** (`bootstrap.py`). Sem framework de DI no MVP.
- Frontend e agentes consomem o **mesmo** contrato público (mesmos endpoints/DTOs). Não existe caminho de dados privativo da UI.
- CLI e FastAPI chamam os mesmos casos de uso; nada de parsing ou regra de negócio duplicada nos adapters de entrada.

## Organização alvo do backend

```
backend/src/stream_lens/
├── domain/            # entidades, value objects, serviços puros
│   ├── entities/
│   ├── value_objects/
│   └── services/
├── application/       # casos de uso + ports + DTOs
│   ├── use_cases/
│   ├── ports/
│   └── dto/
├── adapters/
│   ├── inbound/
│   │   ├── http/      # FastAPI
│   │   └── cli/       # CLI (ex.: `stream-lens inspect <url>`)
│   └── outbound/
│       ├── fetching/     # dispatcher por esquema + safe HTTP fetcher (SSRF, limites) + fixtures locais
│       ├── manifests/    # parsers HLS/DASH + serialização (ver ADR-0002)
│       ├── segments/     # planejamento da janela + captura de bytes + serialização
│       ├── containers/   # análise estrutural fMP4/MPEG-TS + adapter ffprobe + serialização
│       ├── filesystem/   # repositório temporário de inspeções
│       ├── jobs/         # JobQueue (in-process)
│       └── providers.py  # implementações concretas para o composition root
└── bootstrap.py      # composition root
```

Frontend: `frontend/` (React + TypeScript + Vite, TanStack Query). Skills: `skills/` (ver `docs/ROADMAP.md` Fase 7).

## Ports inicialmente esperados

`ManifestFetcher`, `ManifestParser` (ou registry de parsers), `SegmentResolver`, `SegmentFetcher`, `ContainerAnalyzer` (ou registry), `MediaProbe`, `InspectionRepository`, `SnapshotRepository`, `JobQueue`. `Clock`/`IdGenerator` apenas se trouxerem determinismo real aos testes.

## Fluxo de execução alvo

1. Usuário informa URL → API valida e cria `inspection_id` (aleatório, não previsível).
2. API responde rápido (202) com `status_url` e `view_url`.
3. Job assíncrono captura e analisa janela limitada, persistindo progresso.
4. Snapshot escrito de forma **atômica**; frontend acompanha por polling (SSE opcional).
5. Frontend navega para `/inspect/{id}`; agentes consomem os mesmos endpoints JSON.
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
