# API.md

Contrato atual do backend. **Fase 6 concluída + extensões de observabilidade (v1.0)**: captura limitada de
segmentos, timeline normalizada e inspeção estrutural de containers no snapshot
**schema 1.14**. O estágio `inspecting_containers` ocorre depois da captura; o
resultado inclui análise determinística fMP4/MPEG-TS, samples/PES temporizados e
frames I/P/B, resumo de GOP derivado, Timeline Health, matriz ABR e bitrate calculado
por segmento, evidência de entrega HTTP/live limitada à captura e configuração
efetiva derivada de bitstream/áudio por segmento e sinalização DRM estruturada
para DASH.
Inspeções assíncronas com polling, manifestos remotos `http(s)` via safe fetcher
(SSRF, redirects, limites, redaction) e fixtures locais `fixture://`. O contrato
completo do snapshot está em [SNAPSHOT_SCHEMA.md](SNAPSHOT_SCHEMA.md).

## Endpoints implementados

| Método | Caminho | Status | Descrição |
|---|---|---|---|
| GET | `/health` | 200 | Liveness |
| GET | `/ready` | 200/503 | Workspace gravável |
| POST | `/api/v1/inspections` | 202 | Cria a inspeção e enfileira o job |
| GET | `/api/v1/inspections/{id}` | 200/404/410 | Estado atual + resumo do manifesto |
| GET | `/api/v1/inspections/{id}/snapshot` | 200/404/410 | Snapshot canônico completo |
| POST | `/api/v1/inspections/{id}/coverage` | 200 | Resolve cobertura da origem sem baixar mídia |
| POST | `/api/v1/inspections/{id}/captures/{capture_id}` | 202/409 | Enfileira coleta adicional idempotente |
| GET | `/api/v1/inspections/{id}/captures/{capture_id}` | 200/404/410 | Estado e consumo da coleta adicional |
| GET | `/api/v1/inspections/{id}/captures/{capture_id}/evidence` | 200/404/409/410 | Evidência terminal daquela coleta |

## Cobertura e captura adicional

Uma coleta adicional fica vinculada à inspeção base e não reescreve seu snapshot.
As capturas adicionais e seus bytes são armazenados em
`<workspace>/<inspection_id>/captures/<capture_id>/` e expiram com a inspeção.
Se o processo reiniciar durante a tarefa, o estado vira `failed` com consumo
desconhecido.

`POST /coverage` recebe `{ "source_url": "…" }`. A URL precisa redigir para a
mesma origem do snapshot baseline. A Lens relê o manifesto e, para HLS master,
as playlists de representação limitadas por `STREAM_LENS_MAX_PLAYLISTS`; não
baixa segmentos de mídia. Retorna referências `seg_…`, representação, sequence,
índice, posição/duração e estado `available`, paginados no máximo em 2.000 itens
por resposta (`truncated` indica corte). O agente reenvia a URL em cada chamada;
ela é usada em memória e não persistida.

O corpo de `POST /captures/{capture_id}` aceita exatamente uma seleção:

```json
{
  "source_url": "https://cdn.example/master.m3u8?token=…",
  "segment_refs": ["seg_0123456789abcdef01234567"],
  "max_bytes": 25000000,
  "max_segments": 16
}
```

Ou uma janela `{ representation_ids, start_seconds, duration_seconds }`, com
duração até 60 s. A Lens só aceita referências resolvidas no manifesto atual;
em live, referências que saíram da janela DVR aparecem como indisponíveis. Para
fMP4, o segmento init da representação é incluído automaticamente quando
declarado. Limites absolutos da chamada: 100 MB, 16 segmentos de mídia e 8
representações; o cap global/por segmento já configurado continua valendo.
O fetcher recebe o saldo antes de cada leitura e interrompe o streaming quando
atinge o limite, registrando bytes recebidos mesmo em falhas.

O `capture_id` UUID é a chave idempotente ponta a ponta. Repetir o mesmo ID e os
mesmos parâmetros devolve o estado existente; alterar parâmetros retorna 409.
O status fica em `queued`, `running`, `completed`, `partial` ou `failed`.
Evidência adicional inclui segmentos, timeline e containers com a mesma
proveniência e redaction do snapshot canônico.

OpenAPI: `GET /openapi.json` (docs interativas em `/docs` quando o servidor sobe).

## Ciclo de vida (polling)

```
queued → fetching_manifest → parsing_manifest → resolving_segments
        → capturing_segments (progresso: segments_*) → inspecting_containers
        → building_snapshot
        → completed | partial (falha de segmento) | failed (estágio)
        (após TTL) → expired (HTTP 410)
```

`POST` retorna imediatamente `202` com `status: "queued"`; o cliente acompanha
via `GET status_url` até estado terminal (`completed` | `partial` | `failed`).
Snapshot disponível somente em estados terminais de sucesso.

## Criar inspeção

```
POST /api/v1/inspections
Content-Type: application/json

{ "url": "https://example.com/master.m3u8" }
```

`202 Accepted`:

```json
{
  "inspection_id": "5d05591c-…",
  "status": "queued",
  "status_url": "/api/v1/inspections/5d05591c-…",
  "view_url": "/inspect/5d05591c-…",
  "expires_at": "2026-09-05T19:37:03Z"
}
```

Erros: `422` (corpo inválido), `400` (URL inválida — esquema, userinfo,
fragmento; mensagem com estágio, sem segredos), `404`, `410`.

### URLs aceitas

- `http://` e `https://` — passam pelo safe fetcher: DNS resolvido e validado
  contra loopback/private/link-local/multicast/reserved/unspecified; redirects
  seguidos com limite e revalidação completa do destino; timeouts; limite de
  bytes; sem userinfo; sem cookies/headers arbitrários.
- `fixture://<nome>/<caminho>` — fixtures locais (dev/testes).
- Query string é aceita na entrada mas **nunca persistida** (snapshot carrega
  `display_url` redacted).

## Snapshot

```json
{
  "schema_version": "1.14",
  "analyzer_version": "1.7.0",
  "inspection_id": "…",
  "created_at": "ISO-8601",
  "expires_at": "ISO-8601",
  "source": { "display_url": "https://cdn.exemplo.com/live/master.m3u8", "protocol": "HLS", "is_live": false },
  "manifest": {
    "protocol": "HLS",
    "kind": "hls_master_playlist",
    "is_live": false,
    "variant_count": 6,
    "segment_count": null,
    "rendition_count": 10
  },
  "warnings": []
}
```

O contrato completo — incluindo `media`, `capture`, `segments`, `timeline` e
`containers` — está em [SNAPSHOT_SCHEMA.md](SNAPSHOT_SCHEMA.md). O snapshot é
público dentro do TTL e pode ser baixado por qualquer cliente, sem contrato
privativo.

## Comportamento operacional

- **TTL**: limpeza periódica em background (`STREAM_LENS_PURGE_INTERVAL_SECONDS`,
  default 60s) + `make clean-expired`.
- **Restart**: jobs são in-process; no startup, inspeções ativas órfãs são
  marcadas `failed` com `error_stage: "job_lost"`.
- **Concorrência**: limite de jobs simultâneos (`STREAM_LENS_MAX_CONCURRENCY`, default 4).

## CLI (mesmos casos de uso)

```
make cli inspect url=https://exemplo.com/master.m3u8
make cli inspect url=fixture://hls-ts/master.m3u8
# direto:
PYTHONPATH=src .venv/bin/python -m stream_lens.adapters.inbound.cli inspect <url> --output snapshot.json
```

## Endpoints planejados (não implementados)

```
GET /api/v1/inspections/{id}/events                    (SSE opcional, futura)
GET /api/v1/inspections/{id}/manifest                  (Fase 3)
GET /api/v1/inspections/{id}/representations/{rep_id}  (Fase 3)
GET /api/v1/inspections/{id}/segments/{seg_id}         (Fase 4)
GET /api/v1/inspections/{id}/containers/{ctr_id}       (futuro; o snapshot contém a coleção nesta fase)
GET /api/v1/skills…                                     (Fase 7)
```
