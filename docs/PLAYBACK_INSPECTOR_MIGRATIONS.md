# Plano de migrações SQLite do Playback Inspector

Nenhuma das migrações deste documento é aplicada na Fase 0. Elas são o
contrato para as fases que passam a persistir telemetria.

## Estratégia

- Somente adicionar tabelas, índices e colunas nullable.
- Cada migração deve ser transacional e idempotente.
- Rollback de aplicação é compatível: o binário anterior ignora tabelas e
  colunas novas. Down migrations removem índices/tabelas exclusivas; colunas
  adicionadas em `proxy_requests` podem permanecer para evitar reconstrução de
  tabela SQLite durante um rollback operacional.
- Retenção precisa remover dependentes de `proxy_requests` na mesma transação;
  não depender de foreign keys enquanto o banco existente não as habilita.

## Fase 1 — CMCD e sessão lazy

Adicionar colunas nullable a `proxy_requests`:

```sql
ALTER TABLE proxy_requests ADD COLUMN started_at_ms INTEGER;
ALTER TABLE proxy_requests ADD COLUMN completed_at_ms INTEGER;
```

Criar a sessão mínima antes de persistir o request CMCD:

```sql
CREATE TABLE playback_sessions (
  id TEXT PRIMARY KEY,
  workspace_slug TEXT NOT NULL,
  stream_id TEXT NOT NULL,
  cmcd_sid TEXT NOT NULL,
  content_id TEXT,
  cmcd_version INTEGER NOT NULL,
  player_name TEXT,
  player_version TEXT,
  user_agent TEXT,
  initial_preset TEXT NOT NULL,
  observer_connected INTEGER NOT NULL DEFAULT 0,
  started_at_ms INTEGER NOT NULL,
  last_seen_at_ms INTEGER NOT NULL,
  ended_at_ms INTEGER,
  created_at_ms INTEGER NOT NULL,
  UNIQUE(workspace_slug, stream_id, cmcd_sid)
);

CREATE INDEX idx_playback_sessions_workspace_recent
  ON playback_sessions(workspace_slug, last_seen_at_ms DESC);
```

Criar a projeção v1, com todas as métricas opcionais como `NULL`:

```sql
CREATE TABLE request_cmcd (
  request_id INTEGER PRIMARY KEY,
  session_id TEXT,
  version INTEGER NOT NULL,
  valid INTEGER NOT NULL,
  sid TEXT,
  cid TEXT,
  ot TEXT,
  sf TEXT,
  st TEXT,
  br_kbps INTEGER,
  tb_kbps INTEGER,
  mtp_kbps INTEGER,
  rtp_kbps INTEGER,
  bl_ms INTEGER,
  dl_ms INTEGER,
  object_duration_ms INTEGER,
  playback_rate REAL,
  startup INTEGER,
  buffer_starvation INTEGER,
  raw_value TEXT,
  canonical_value TEXT,
  extra_json TEXT,
  validation_errors_json TEXT NOT NULL DEFAULT '[]'
);

CREATE INDEX idx_request_cmcd_session ON request_cmcd(session_id, request_id);
```

`InsertProxyRequest` deverá evoluir para uma operação transacional que cria o
request, obtém seu `id`, faz upsert da sessão quando há `sid` e insere
`request_cmcd`. Requests sem `sid` continuam com `session_id = NULL`.

## Fase 3 — timings causais

Adicionar apenas colunas nullable a `proxy_requests` para DNS, TCP, TLS, TTFB,
relay e duração de latência artificial. Para clones locais, as fases de origem
ficam `NULL`, nunca `0`.

## Fase 4 — eventos do Observer

```sql
CREATE TABLE playback_events (
  id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  sequence_number INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  wall_time_ms INTEGER NOT NULL,
  monotonic_ms INTEGER NOT NULL,
  media_time_ms INTEGER,
  buffer_ahead_ms INTEGER,
  bitrate_kbps INTEGER,
  throughput_kbps INTEGER,
  payload_json TEXT,
  received_at_ms INTEGER NOT NULL,
  PRIMARY KEY (session_id, id)
);

CREATE INDEX idx_playback_events_timeline
  ON playback_events(session_id, wall_time_ms, sequence_number);
```

## Retenção

- `request_cmcd` é removida junto do request bruto, após 24 horas ou ao aplicar
  o limite de requests.
- Eventos brutos também expiram em 24 horas.
- Sessões sem dados brutos podem permanecer por 7 dias.
- Aplicar 1.000 requests, 5.000 eventos por sessão e 100 sessões por workspace
  em transações separadas, sempre apagando dependentes antes do pai.
