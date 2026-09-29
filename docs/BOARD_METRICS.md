# Boards agregados de QoE

`aggregate` complementa `sessions`: recebe fatos pré-agregados da fonte, sem
fabricar sessões. Boards antigos continuam legíveis sem reingestão. A migração
SQLite ocorre ao abrir o banco. Owner sempre vem de Clerk ou token MCP.

## Criação e unidades

REST: `POST /v1/boards`. MCP: `create_board`. O nome de integração pode aparecer
como `videoharness_create_board`; o nome registrado pelo servidor é `create_board`.

Exemplo de definição (os SLAs de buffer/join abaixo são os defaults provisórios
solicitados para esta implementação; a API recebe os valores explicitamente):

```json
{
  "board_type": "aggregate",
  "name": "Vivo — POP × mídia",
  "focus": {"type": "isp", "isp": "Vivo"},
  "granularity": "5m",
  "window": {"from": "2026-09-24T18:00:00-03:00", "to": "2026-09-25T00:00:00-03:00"},
  "primary_dimension": "pop",
  "secondary_dimension": "media_id",
  "slas": {
    "startup_error_rate": {"warning": 0.02, "critical": 0.05},
    "buffer_ratio": {"warning": 0.005, "critical": 0.01},
    "join_time_ms": {"warning": 8000, "critical": 15000}
  },
  "source": {
    "system": "npaw",
    "query": "consulta temporal POP × mídia usada na extração",
    "sampling": {"method": "none", "coverage": 1},
    "counting": "touch",
    "join_over_sla_threshold_ms": 5000
  }
}
```

Dimensões: `pop`, `isp`, `state`, `media_id`, `device_type`. Primária e secundária
não podem coincidir. Cada bucket de entidades deve conter ambas quando houver
secundária. `state` pode ser auxiliar; UF é derivada apenas de sufixo reconhecido
do POP quando não fornecida explicitamente. Não há inferência de localização por
nome arbitrário.

Taxas são frações 0..1; tempos são milissegundos. Join time aceita
`join_time_ms` (alias de `join_time_ms_avg`) ou o par exato
`join_time_ms_sum` + `join_time_ms_count`; os dois nomes de média juntos ou
soma sem contagem são rejeitados por item. `join_over_sla_pct` agora é métrica
de view como as demais, com banda opcional: sem banda configurada ela é exibida
mas permanece `unknown` em vez de ser classificada por outra régua. Bandas são
`good` abaixo de warning, `warning` a partir de warning e `bad` a partir de
critical. `bad` é a convenção já usada pelo schema v1. Ausência de métrica é
`unknown`.

`join_over_sla_pct` é uma taxa independente do join médio: a fonte deve indicar
o limiar em `source.join_over_sla_threshold_ms`. Ela não permite inferir média,
p95 nem quantos joins excedem outro limiar.

## Ingestão parcial e identidade

REST: `POST /v1/boards/:id/metrics`. MCP: `ingest_board_metrics`, acrescentando
`board_id` aos argumentos abaixo. O lote ilustrativo é sintético, não é uma
extração observada do caso Vivo:

```json
{
  "buckets": [{
    "dimension": {"pop": "edge-vivo-vm-sp", "media_id": "conteudo-exemplo", "state": "SP"},
    "ts": "2026-09-24T18:05:00-03:00",
    "volume": 412,
    "startup_error_rate": 0.082,
    "buffer_ratio": 0.0071,
    "join_time_ms_avg": 9000,
    "join_time_ms_p50": 7000,
    "join_time_ms_p95": 18000,
    "join_time_ms_p99": 24000,
    "join_over_sla_pct": 0.281
  }],
  "baseline": [{
    "ts": "2026-09-24T18:05:00-03:00",
    "volume": 12000,
    "buffer_ratio": 0.002,
    "join_time_ms_avg": 4000
  }]
}
```

- Até 500 itens combinando `buckets` e `baseline`; até 256 KiB de corpo REST ou
  do envelope JSON-RPC inteiro. As tools antigas continuam limitadas a 32 KiB.
- Envelope inválido rejeita a chamada. Itens inválidos retornam erros indexados;
  os itens válidos são persistidos juntos. Erro de quota não escreve um prefixo
  arbitrário dos itens válidos.
- `volume` é inteiro seguro obrigatório. Métricas são fornecidas pela fonte;
  não são reconstruídas de amostras de sessões.
- `ts` é o início do bucket. Instantes são normalizados em UTC, alinhados à
  granularidade e contidos na janela `[from,to)`. Um bucket ausente não é zero.
- A identidade é `(board, tupla canônica das dimensões configuradas, ts)`.
  Retry/correção substitui o registro inteiro, nunca soma ao valor anterior.
  O baseline tem namespace separado e não participa da soma das entidades.

Com `touch`, um play pode passar por vários POPs: a soma das linhas representa
contatos e pode superar o total do ISP. O baseline do ISP deve vir de consulta
independente. Mesmo sem amostragem, não chamar contatos de usuários distintos.
`coverage < 1` significa amostra, inclusive em drill-down. `coverage = 1` é uma
declaração da fonte, não uma certificação estatística feita pelo VH.

## Rollups, impacto e resolução

Taxas e médias são ponderadas pelos buckets que fornecem aquela métrica.
Taxas (`startup_error_rate`, `buffer_ratio`, `join_over_sla_pct`) usam
`sum(volume × value) / sum(volume)`. Join time usa `sum(join_time_ms_sum) /
sum(join_time_ms_count)` quando a fonte decompõe soma e contagem — a média só é
exata ponderada pelos joins amostrados; quando só há média por bucket, o peso
recai no `volume`, aproximação válida apenas se todo play contribuiu com um
join. A cobertura da métrica deve acompanhar a comparação. Isso é um indicador
ponderado por plays; não garante a mesma média que uma fonte com denominador
diferente (por exemplo, só startups bem-sucedidos).

Ranking usa impacto estimado: soma de `volume × max(value - warning, 0)`.
Buffer/startup usam plays-equivalentes; join usa play·ms. Não é uma contagem de
usuários impactados. O ranking é específico da métrica selecionada.

Percentis `join_time_ms_p50/p95/p99` são exibidos quando fornecidos e quando o
ponto não combina distribuições. Não existe média de p95; rollup ou coarsening
não fabrica percentis. Agregar distribuições exigiria histogramas/sketches da
fonte, fora deste contrato.

Quotas: 100 boards/owner compartilhados com sessions, 25 mil células no índice
materializado por aggregate, 100 mil contribuições originais por board e
250 mil contribuições originais por owner (incluindo baseline).
Contribuições originais preservam identidade para retries e correções. A
resolução materializada aumenta quando necessário; o resultado informa a
resolução solicitada e a efetiva. A resolução efetiva é ancorada no início da
janela para preservar suas bordas. Métricas são calculadas das contribuições,
com denominador próprio para cada métrica disponível, sem compor percentis.
Cardinalidade que não cabe nem com resolução
maior é rejeitada. Ao esgotar contribuições, produzir uma nova extração em
resolução maior e criar outro board; não apagar contribuições silenciosamente.

## Views e evidência

REST: `POST /v1/boards/:id/view`. MCP: `get_board_view` com `board_id`.
Parâmetros aggregate: `metric` (`startup_error_rate`, `buffer_ratio`,
`join_time_ms_avg`, `join_over_sla_pct`), `dimension`, `filters` (até quatro,
AND), `time_window`, `offset/limit` de entidades e `time_offset/time_limit` de
tempo. A resposta inclui heatmap, ranking, baseline, série, anotações e
proveniência. As páginas temporais preservam lacunas; cores representam as
faixas do SLA. `get_board_view` de sessions aceita o mesmo envelope e devolve o
grafo completo (`metric`/`limit` são exclusivos do aggregate e ignorados nas
sessões).

Para interpretar POP × mídia, a fonte precisa fornecer buckets cruzados dessas
dimensões. Totais POP sem mídia não permitem diagnosticar concentração por
conteúdo. Baseline do focus continua independente de filtros nas entidades.

REST `PATCH /v1/boards/:id` / MCP `patch_board` permite nome, SLAs e vínculo
`linked_sessions_board_id` em boards aggregate. O vínculo deve apontar para um
board de sessões do mesmo owner; `null` remove o vínculo. Não muda janela,
dimensões ou proveniência do aggregate.

A ponte usa sessões reais com `started_at` (obrigatório em todo ingest novo;
linhas antigas sem timestamp continuam legíveis, mas fora de recortes
temporais) e dimensões compatíveis. Recortes de sessões aceitam `time_window`
e `quality`; sem timestamp, a sessão permanece na view tradicional, mas não
entra no recorte temporal. O clique não consulta NPAW: o agente deve extrair e
ingerir a evidência antes de vinculá-la. Uma extração só de sessões com erro é
evidência selecionada, não amostra representativa para recalcular a saúde do ISP.

## Remoção e reset

REST `POST /v1/boards/:id/sessions/delete` / MCP `delete_board_sessions`
apaga sessões por `session_ids` (1..500) ou por `time_window` sobre
`started_at` — exatamente um seletor, com retorno `{deleted, remaining}`.
REST `POST /v1/boards/:id/metrics/delete` / MCP `delete_board_metrics` apaga
contribuições do aggregate por janela e/ou dimensão+entidade; com dimensão só
linhas de entidade saem, e o baseline só sai por janela sem dimensão. A
rematerialização roda após a remoção. `POST /v1/boards/:id/reset` / MCP
`reset_board` esvazia todos os dados mantendo definição, SLAs e vínculo.
Apagar o inexistente não é erro: a operação é idempotente.

## Exemplo canônico de transformação NPAW

Consulta de referência fornecida para o caso de uso:

```text
select views, bufferRatio, join_over_sla_metric
where datetime between '...' and isp = 'Vivo'
group by extraparam15
```

Mapeamento: `views → volume`, `bufferRatio / 100 → buffer_ratio`,
`extraparam15 → dimension.pop`. Normalizar a coluna de joins acima de 5 s para
fração 0..1 **conforme a unidade retornada pela fonte** e registrar o limiar.
Não dividir novamente uma coluna que já esteja em fração.

Essa consulta agrupada apenas por POP produz totais por POP. Para um heatmap de
5 minutos, consultar cada janela ou usar o agrupamento temporal suportado pela
fonte; para o toggle, acrescentar o agrupamento por mídia. Fazer consulta
separada do ISP para `baseline`. Preservar a consulta efetivamente executada em
`source.query`. Este repositório não implementa cliente autenticado NPAW nem
certifica sintaxe/API de terceiros.

Os números fornecidos para 24/09/2026 18h–0h BRT (425.757 plays no ISP,
64.852 no vm-sp, buffer 0,699%, 28,1% dos joins >5 s; 111.844 no jg-sp com
buffer 0,169%) não contêm distribuição temporal ou por mídia. Não dividi-los
artificialmente em 72 buckets. Com os defaults atualizados, buffer vm-sp é
**warning**, jg-sp é **good**; a taxa de joins >5 s não determina o status da
média com warning de 8 s. O aceite temporal e a ponte para as 919 sessões
exigem exports reais. Fixtures de teste são identificadas como sintéticas.

## Boards de incidente (coorte de usuários × dias)

`incident` acompanha, dia a dia, um conjunto fixo de user IDs afetados por um
incidente. O VH não consulta o NPAW: o agente registra o incidente, envia a
lista de usuários e depois as contagens diárias. A UI mostra uma grade com um
usuário por linha e um dia por coluna.

REST: `POST /v1/boards` (criação), `POST /v1/boards/:id/users`,
`/users/delete`, `/user-days`, `/user-days/delete` e `/view`. MCP:
`create_incident_board`, `add_incident_users`, `remove_incident_users`,
`ingest_incident_user_days`, `delete_incident_user_days` e
`get_incident_board_view`. Owner sempre vem de Clerk ou do token MCP.

```json
{
  "board_type": "incident",
  "name": "Incidente POP vm-sp",
  "incident": {"started_at": "2026-09-24T18:00:00-03:00", "ended_at": "2026-09-24T21:00:00-03:00", "description": "Buffering elevado"},
  "window": {"from_day": "2026-09-21", "to_day": "2026-09-27"},
  "slas": {
    "startup_error": {"warning": 0.1, "critical": 0.3},
    "buffer": {"warning": 0.1, "critical": 0.3}
  },
  "source": {"system": "npaw", "query": "consulta por userId e dia usada na extração", "buffer_ratio_session_threshold": 0.01}
}
```

- Dias são `YYYY-MM-DD` no fuso America/Sao_Paulo (UTC-3 fixo), no máximo 31
  dias por board. `started_at`/`ended_at` marcam o(s) dia(s) do incidente na UI.
- As faixas `warning`/`critical` são **frações 0..1 das sessões do usuário no
  dia que estão ruins**, não valores de métrica. `buffer_ratio_session_threshold`
  é o `buffer_ratio` (0..1) a partir do qual o agente contou uma sessão como
  ruim; o VH só o registra como proveniência.
- Item diário: `user_id`, `day`, `sessions`, `startup_error_sessions`,
  `buffer_over_sla_sessions` e, opcionalmente, `buffer_ratio_avg` e
  `join_time_ms_avg` (exibidos no detalhe). `startup_error_sessions ≤ sessions`
  e `buffer_over_sla_sessions ≤ sessions − startup_error_sessions`.
- Base de cada métrica: **startup_error** = `startup_error_sessions / sessions`;
  **buffer** = `buffer_over_sla_sessions / (sessions − startup_error_sessions)`,
  como no board de sessões, onde falhas de startup não têm buffer. Denominador 0
  é sem dados (cinza).
- Cor: `bad_share` abaixo de `warning` é saudável, a partir de `warning` é
  atenção e a partir de `critical` é crítico. A intensidade contínua vale 0 com
  0%, 0,5 em `warning` e 1 em `critical` ou mais; a UI interpola verde → amarelo
  → vermelho. Dias sem dados ficam cinza e não entram no resumo diário.
- O resumo diário (rodapé) conta atenção + crítico sobre os usuários **com dados**
  no dia, em toda a coorte e não só na página exibida.
- Ingestão por item, como no aggregate: usuário fora da coorte, dia fora da janela,
  contagens inconsistentes e duplicata `(user_id, dia)` no lote são devolvidos
  em `errors[]` sem rejeitar os itens válidos. Reenviar `(user_id, dia)` substitui
  o registro inteiro. Lotes de 1..500 itens (256 KiB), coorte de até 1.000 usuários
  por board e 250 mil dias de usuário por owner.
- `remove_incident_users` apaga também os dados diários do usuário;
  `delete_incident_user_days` mantém a coorte; `reset_board` apaga só os dados
  diários e preserva definição e coorte. Todas são idempotentes.
- User IDs são identificadores de clientes: armazene-os apenas no board, com
  isolamento por owner, e envie hashes se a fonte permitir; remova o board
  quando o incidente for encerrado.

Receita NPAW: agrupar a consulta por `userId` e por dia BRT e mapear as colunas
para `sessions`, `startup_error_sessions` e `buffer_over_sla_sessions`, fixando o
limiar de buffer em `source.buffer_ratio_session_threshold` e preservando a
consulta executada em `source.query`.
