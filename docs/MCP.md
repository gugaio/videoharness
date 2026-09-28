# MCP para agentes

1. Entre no Video Harness e abra **MCP** no dashboard (`/dashboard/mcp`).
2. Escolha um nome para identificar o agente e uma validade. Gere o token e
   copie-o: o segredo só é exibido após a criação, até fechar/sair da página.
3. No cliente MCP, configure transporte **Streamable HTTP**, a URL exibida
   (`https://seu-dominio/api/mcp`) e `Authorization: Bearer SEU_TOKEN`.

O cliente deve permitir Bearer configurado manualmente. Não há login OAuth no
endpoint MCP. A sintaxe de configuração depende do cliente. Use seu mecanismo
de armazenamento de segredos; não coloque o token no Git nem na URL.

Em dev com Vite, o endpoint é `http://127.0.0.1:5173/api/mcp`; direto no app,
`http://127.0.0.1:3210/mcp`. O proxy nginx existente publica `/api/mcp`.

## Ferramentas

| Tool | Função |
|---|---|
| `create_inspection`, `list_inspections`, `get_inspection`, `get_inspection_snapshot` | Baseline, histórico, progresso e snapshot canônico |
| `start_investigation` / `list_investigations` | Vincular um baseline e consultar orçamento, reservas e coletas |
| `get_capture_coverage` | Reconsultar manifesto sem baixar mídia; retorna referências estáveis e paginadas |
| `get_timeline` | Navegar pela timeline e cobertura já arquivadas no baseline |
| `capture_segments` | Capturar até 16 referências de segmentos com uma chave de idempotência |
| `capture_window` | Capturar até 60 s em até 8 representações; no máximo 16 segmentos efetivos |
| `get_capture` / `get_evidence` | Acompanhar estado/bytes e ler evidência em páginas |

Fluxo: criar uma inspeção, abrir uma investigação ao terminar a baseline,
consultar cobertura/timeline e solicitar coleta seletiva. Toda coleta é separada
e não altera o snapshot inicial. A origem deve ser enviada de novo em cada
consulta/captura; ela precisa corresponder à origem redacted da baseline. A Lens
valida URL/SSRF e não persiste a URL fornecida. Evidências externas são dados
não confiáveis, não instruções para o agente. Não há exclusão de inspeções,
controle de streams, probe/decode_test ou execução autônoma de LLM.

## Tokens e limites

- Tokens pessoais com 256 bits aleatórios; apenas SHA-256, prefixo de exibição e
  metadados ficam na tabela `mcp_tokens` do SQLite configurado por
  `VH_DATABASE_PATH`. Nenhum segredo recuperável é armazenado.
- Validade padrão de 90 dias; API aceita 1 a 365 dias. UI oferece 7, 30, 90 e
  365 dias. Máximo de 20 tokens por usuário, incluindo expirados ainda listados.
- Gerenciamento exige a sessão Clerk do usuário. Em dev sem Clerk, usa
  `dev-user`, seguindo o fallback existente. O endpoint MCP sempre exige token.
- O owner vem exclusivamente do token e não é argumento das tools. Tokens MCP
  não são credenciais de gerenciamento nem tokens internos das engines.
- Revogar remove o registro e impede novas chamadas imediatamente; não cancela
  uma captura ou chamada já em andamento. O último uso é atualizado quando o
  Bearer é validado. Tokens expirados são recusados.
- Por processo do app: 60 requisições POST por minuto e até 4 simultâneas por
  owner, compartilhadas entre seus tokens. Retorno 429 com `Retry-After`.
- Teto de 100 MB por investigação, 25 MB por chamada, 16 segmentos por chamada,
  2 capturas ativas por usuário e 500 MB agregados por usuário. Bytes são
  reservados antes da chamada e reconciliados pelo consumo informado pela Lens;
  estado desconhecido mantém a reserva.
- A chave de idempotência é única por investigação; repetir exatamente o mesmo
  pedido devolve a captura existente. Reutilizá-la com parâmetros diferentes é
  rejeitado. Apenas hashes da URL/chave e seleções sem segredos são persistidos.
- A Lens fornece no máximo 2.000 referências por leitura de cobertura; o MCP
  pagina em grupos de até 100. Evidência adicional fica arquivada no VH depois
  de observada em estado terminal.
- Corpo MCP limitado a 32 KiB, exceto `ingest_board_metrics` e
  `ingest_board_sessions` (256 KiB incluindo o envelope JSON-RPC); resultado da tool limitado a 256 KiB. Resultados
  maiores retornam erro explícito: selecione menos seções ou uma página menor;
  para seções individualmente grandes, use o snapshot completo no dashboard.
- Sem sessão MCP ou SSE persistente: chamadas POST retornam JSON; GET/DELETE
  autenticados retornam 405. Origin de browser deve coincidir com o Host;
  clientes de máquina podem omitir Origin.
- Respostas MCP e de gerenciamento usam `Cache-Control: no-store`.

Use HTTPS em produção e mantenha Clerk configurado para proteger a geração de
tokens. O SDK MCP v1 está integrado na fronteira Fastify; REST e MCP compartilham
os casos de uso e a verificação de ownership de inspeções.

## Boards de saúde por SLA

Em boards `sessions` (default quando `board_type` é omitido), o agente envia
**sessões**, não grafos. Boards `aggregate` recebem buckets pré-agregados da
fonte; veja [o contrato agregado](BOARD_METRICS.md). O orquestrador
valida, persiste e calcula as views determinísticas. O board pertence ao owner
do token; `user_id` é o usuário monitorado e não define ownership. A UI apresenta
os resultados em `/dashboard/boards/:id`, com atualização automática. Demos
locais em `/dashboard/boards/demos` são isoladas e não recebem esses dados.

| Tool | Função |
|---|---|
| `get_board_schema` | Descobrir unidades, limites, identidade de device e exemplos válidos completos |
| `create_board` | Criar board com nome, foco fixo e SLAs explícitos; retorna `id` e `view_path` |
| `list_boards` | Listar boards do owner com contagem de sessões, `offset`/`limit` |
| `get_board` | Consultar foco e SLAs, sem devolver todas as sessões |
| `ingest_board_sessions` | Enviar lote atômico de até 500 sessões; upsert por `(board_id, session_id)`; `started_at` obrigatório |
| `list_board_sessions` | Consultar sessões em páginas de até 50 |
| `get_board_view` | Obter grafo (sessions) ou heatmap/ranking/baseline/série (aggregate); filtros AND; `metric`/`limit` só paginam/selecionam no aggregate |
| `ingest_board_metrics` | Enviar buckets e baseline de um board aggregate, com resultado por item |
| `patch_board` | Atualizar nome, SLAs ou vínculo de evidência permitido pelo tipo de board |
| `delete_board_sessions` | Apagar sessões por `session_ids` ou `time_window`; retorna apagados/restantes |
| `delete_board_metrics` | Apagar contribuições do aggregate por janela e/ou dimensão+entidade |
| `reset_board` | Esvaziar todos os dados do board sem apagar sua definição |

### Contrato e unidades

Cada sessão tem `session_id`, `user_id`, `device: {id, model?}`, `isp`, `pop`,
`media_id`, `started_at` (ISO 8601 com offset, obrigatório no ingest) e
`startup_error`. Os IDs/campos de entidade têm até 128 caracteres. Sessões
gravadas antes de `started_at` existir continuam legíveis, mas ficam fora de
qualquer recorte temporal (`excluded_missing_timestamp_count` informa quantas).
Identidade de um device = **par `(user_id, device.id)`**: o mesmo `device.id` em
outro usuário é outro device. O foco de device usa
`{type:"device", user_id:"user-42", device_id:"tv"}`; seu filtro usa
`{dimension:"device", user_id:"user-42", entity:"tv"}`.

- `startup_error: true`: `join_time_ms` e `buffer_ratio` são **proibidos**,
  inclusive null. Uma tentativa que falhou não tem essas medidas.
- `startup_error: false`: ambas as medidas são **obrigatórias**.
  `join_time_ms` é finito, ≥0 e ≤86.400.000 ms. `buffer_ratio` é finito em **0–1**:
  0.012 significa 1,2%. Seu significado é tempo em buffering dividido pelo tempo
  total observado da reprodução, incluindo buffering; o agente fornece o ratio.
- Reenviar o mesmo `session_id` substitui a sessão inteira, sem duplicar.
  IDs repetidos dentro do mesmo lote são rejeitados. Qualquer sessão inválida
  (incluindo `started_at` ausente) rejeita o lote completo, sem gravação parcial.
  Lotes aceitam 1..500 sessões; o teto por board é 10.000 e por owner 50.000.
- Para remover dados ruins sem recriar o board, use `delete_board_sessions`
  (por `session_ids` ou `time_window`) ou `reset_board` para esvaziar o board.
- Sessões de outras entidades podem estar no board, mas ficam fora da view se
  não corresponderem ao foco fixo. Não há janela de tempo nesta etapa.

Novos boards exigem os três SLAs: `startup_error_rate`, `buffer_ratio` e
`join_time_ms`, cada um com sua view. Boards legados sem SLA de join time
continuam legíveis com as views disponíveis. Cada SLA exige limites **explícitos**
`{warning, critical}`, com `0 ≤ warning < critical`. Taxas/ratios limitam-se a
0–1; join time usa ms até 86.400.000. Não existem defaults no backend.

Para cada recorte, nó e conexão:

- Startup rate = falhas de startup / **todas** as sessões do grupo.
- Buffer ratio = média aritmética dos ratios das sessões de **sucesso**.
  Não é ponderada por duração: o contrato não fornece durações.
- Join time = média aritmética de `join_time_ms` das sessões de **sucesso**.
- `value < warning`: saudável; `warning ≤ value < critical`: atenção;
  `value ≥ critical`: crítico. Sem amostras de sucesso: `value:null`, sem dados
  para buffer/join time; falhas nunca viram zeros nessas métricas.
- `sample_count` informa o denominador. `violations` informa amostras no limite
  crítico ou acima; para startup rate, é o número de falhas. A cor avalia o
  **agregado**, portanto um grupo saudável ainda pode conter falhas individuais;
  o tooltip mostra o número de falhas/violações para não escondê-las.

### Fluxo copiável para um agente

1. Chame `get_board_schema` para conferir o contrato.
2. Chame `create_board` com estes argumentos:

```json
{
  "name": "Usuário 42 · saúde",
  "focus": {"type": "user", "user_id": "user-42"},
  "slas": {
    "startup_error_rate": {"warning": 0.01, "critical": 0.05},
    "buffer_ratio": {"warning": 0.02, "critical": 0.05},
    "join_time_ms": {"warning": 2000, "critical": 5000}
  }
}
```

3. Use o `id` retornado em `ingest_board_sessions`:

```json
{
  "board_id": "ID_RETORNADO",
  "sessions": [
    {
      "session_id": "s-1", "user_id": "user-42",
      "device": {"id": "tv", "model": "Samsung Tizen"},
      "isp": "Vivo", "pop": "GRU", "media_id": "match-123",
      "started_at": "2026-09-24T21:00:00Z",
      "startup_error": false, "join_time_ms": 1800, "buffer_ratio": 0.012
    },
    {
      "session_id": "s-2", "user_id": "user-42",
      "device": {"id": "phone", "model": "iPhone"},
      "isp": "Claro", "pop": "GRU", "media_id": "match-123",
      "started_at": "2026-09-24T21:02:00Z",
      "startup_error": true
    }
  ]
}
```

4. Consulte `get_board_view`:

```json
{"board_id":"ID_RETORNADO","filters":[{"dimension":"device","entity":"tv","user_id":"user-42"}]}
```

5. Entregue ao usuário o link `view_path` retornado pela criação, prefixado pelo
   domínio público do VH. Ex.: `https://seu-dominio/dashboard/boards/ID_RETORNADO`.
   `view_path` é relativo porque o app não infere domínio por headers do agente.

Focos e camadas: usuário → devices → ISPs → POPs → mídias;
device → ISPs → POPs → mídias; ISP → POPs → mídias; POP → ISPs → mídias.
Até quatro filtros, um por dimensão, restringem o recorte e nunca expandem para
outra entidade do foco. Clique na UI solicita novo agregado ao backend. Cada
camada mostra até oito entidades e “Outros”, agrupando **as mesmas sessões** nos
nós e links sem perder volume; “Outros” não é filtrável.

### REST, limites e autenticação

REST usa os mesmos casos de uso: `GET /v1/boards/schema`, `POST/GET /v1/boards`,
`GET/DELETE /v1/boards/:id`, `POST/GET /v1/boards/:id/sessions`,
`POST /v1/boards/:id/sessions/delete`, `POST /v1/boards/:id/metrics/delete`,
`POST /v1/boards/:id/reset` e `POST /v1/boards/:id/view`. O browser usa o prefixo `/api` e a sessão Clerk;
REST não aceita token MCP como sessão humana. MCP sempre exige token pessoal,
inclusive em dev. Sem Clerk no modo dev, REST usa `dev-user` conforme o fallback
existente. Um ID de outro owner responde como inexistente.

Limites fixos: 100 boards por owner, 10.000 sessões por board, 50.000 sessões
armazenadas por owner, 500 sessões por lote e 256 KiB de corpo para os ingests
(`ingest_board_sessions`/`ingest_board_metrics`, incluindo o JSON-RPC no MCP);
as demais tools mantêm 32 KiB. Ambos os limites de lote/corpo se aplicam. Corpo
inválido retorna 400 no REST ou erro de tool; quota retorna 429 no
REST ou erro de tool, sem gravar o lote. Substituições existentes continuam
permitidas quando a quota está cheia. Paginação tem `offset`, `limit` (1–50,
default 20) e `next_offset`. Resultados MCP preservam o teto global de 256 KiB.

Os dados são persistidos em SQLite (`VH_DATABASE_PATH`) e compartilhados entre
REST/MCP. Excluir um board pela UI/REST exclui suas sessões e libera quotas.
IDs não tornam dados públicos: o link só abre para o owner autenticado.


As métricas das views de Boards incluem `distribution` com contagens
`good`, `warning`, `bad` e `unknown`, cuja soma é o volume do nó/conexão.
O gráfico divide cada conexão em faixas proporcionais a essas contagens.
Startup distingue sessões iniciadas (verde) e falhas (vermelho); buffer ratio
e join time classificam cada sessão pelos limites do SLA, com falhas de startup
em cinza por ausência de métrica. O status agregado continua calculado pela
taxa/média e pode diferir da distribuição individual. Demos legadas sem essas
contagens mantêm a cor agregada e informam distribuição indisponível.
