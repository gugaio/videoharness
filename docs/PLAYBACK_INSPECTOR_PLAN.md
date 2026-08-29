# Plano de desenvolvimento — Playback Inspector

Status: aprovado para implementação incremental  
Escopo ativo: fases 0 a 4  
Última atualização: 2026-08-29

## 1. Objetivo

Evoluir o StreamMock de um proxy com simulação de falhas e histórico de requests
para uma ferramenta de investigação causal da experiência de playback.

O Playback Inspector deve responder não apenas **o que aconteceu** — startup
lento, rebuffer, erro ou troca de qualidade — mas principalmente **por que
aconteceu**, relacionando:

1. o estado informado pelo player no momento de cada request;
2. a resposta e os tempos observados pelo proxy;
3. as intervenções aplicadas pelo StreamMock;
4. os eventos reais do elemento de mídia e da biblioteca do player.

O resultado esperado é uma timeline capaz de produzir diagnósticos como:

> O segmento foi solicitado com 800 ms de buffer e deadline de 700 ms. O
> StreamMock adicionou 2,1 s de latência, a resposta terminou 1,5 s após o
> deadline e o player entrou em rebuffer 180 ms depois.

## 2. Escopo deste plano

As fases 0 a 4 formam o programa inicial de desenvolvimento:

- Fase 0 — fundação, contratos e conformidade;
- Fase 1 — CMCD v1 em Request Mode por query string;
- Fase 2 — sessões, correlações e primeira interface do Inspector;
- Fase 3 — timings causais do proxy e motor de diagnósticos;
- Fase 4 — Observer JavaScript core e adapter para HLS.js.

Ficam adiados, mas registrados para planejamento futuro:

- Fase 5 — adapter para Shaka Player;
- Fase 6 — CMCD Request Mode por headers;
- Fase 7 — CMCD v2, Structured Fields e Event Mode.

O Observer para HLS.js vem antes do suporte por headers porque ele adiciona
novos sinais de experiência e causalidade. Headers oferecem principalmente um
segundo transporte para dados que já podem ser enviados por query string.

## 3. Princípios do produto

### 3.1 Explicação antes de score

O primeiro corte não terá um score proprietário de QoE. Findings determinísticos,
com evidências e grau de confiança, são mais úteis para investigação e mais
alinhados ao propósito do StreamMock.

### 3.2 Três planos de verdade

| Plano | Fonte | O que informa |
| --- | --- | --- |
| Player request | CMCD | Buffer, bitrate, throughput estimado, deadline, urgência e starvation |
| Delivery | StreamMock e origem | Status, bytes, timings, Range, falha ou latência injetada |
| Playback | Observer | Primeiro frame, rebuffer, seek, append, ABR, decoder e erros |

Nenhum plano isolado deve ser tratado como explicação completa.

### 3.3 Fail-open para telemetria

CMCD ausente ou inválido e falhas de ingestão do Observer nunca podem impedir a
reprodução. O request é servido normalmente e o problema de telemetria fica
visível como finding de conformidade.

### 3.4 Unidades explícitas

- Tempos persistidos em milissegundos.
- Bitrates e throughput CMCD em kbps decimais.
- Bytes em inteiros.
- Tempos do browser carregam wall clock e relógio monotônico.
- Campos desconhecidos nunca recebem valor `0` para representar ausência.

### 3.5 Privacidade e limites

- `sid` e `cid` são identificadores técnicos, não identidades de usuário.
- Limitar o valor CMCD bruto a 8 KiB no MVP.
- Limitar quantidade e tamanho de chaves customizadas.
- Não registrar tokens de ingestão em logs.
- Aplicar TTL, limites por sessão e rate limiting.
- Permitir futura desativação da retenção do payload CMCD bruto.

## 4. Decisões sobre CMCD

### 4.1 Versões

A revisão corrente do padrão é CTA-5004-B. O MVP implementará o formato CMCD
v1 em Request Mode por query string, que possui suporte maduro e evita os
preflights causados por headers customizados em browsers.

O modelo interno deve aceitar evolução para os valores por tipo de objeto do
CMCD v2. Campos como `br`, `bl` e `mtp` não devem ser projetados de forma que
impeça representar áudio e vídeo separadamente no futuro.

### 4.2 Política padrão do proxy

```text
capture: true
forwardToOrigin: false
includeInStreamIdentity: false
retainRaw: true
```

No MVP:

- ler `CMCD` da URL recebida pelo StreamMock;
- persistir a forma normalizada e, quando permitido, o valor bruto;
- não anexar CMCD à URL da origem;
- não considerar CMCD no ID determinístico do stream ou clone;
- não falhar o playback quando o valor não puder ser interpretado.

A arquitetura atual já ajuda a cumprir essa política: recursos proxy usam a URL
da origem codificada no path e o backend constrói um novo request outbound a
partir dessa URL. A política ainda precisa ser formalizada e testada.

### 4.3 Parser

Não implementar parsing CMCD diretamente nos handlers HTTP.

Criar um pacote interno com contrato próprio:

```go
type Decoder interface {
	DecodeRequest(*http.Request) (NormalizedCMCD, error)
}
```

Para o MVP, avaliar e fixar uma versão de
`github.com/untangledco/streaming/cmcd`, que oferece parsing v1 de query e
headers. Como a biblioteca ainda é pré-1.0, ela deve ficar encapsulada e ser
validada por testes de conformidade independentes.

Usar `@svta/cml-cmcd` somente em tooling/testes para gerar fixtures válidos e
inválidos; ele não deve criar uma dependência Node no caminho de requests do
backend Go.

### 4.4 Correlação

`sid` é a chave primária de correlação enviada pelo player.

- Criar sessão automaticamente no primeiro request com um novo `sid`.
- Escopo de unicidade: `(workspace_slug, stream_id, cmcd_sid)`.
- Guardar requests sem `sid`, mas marcá-los como não correlacionados.
- Usar `cid` como identificador de conteúdo, nunca como substituto de `sid`.
- O Observer deve usar exatamente o mesmo `sid` configurado no CMCD.

## 5. Arquitetura-alvo

```text
Player
  ├─ media requests + CMCD ──► proxy engine ──► proxy_requests
  │                                      └────► request_cmcd
  └─ observer event batches ─► ingest API ────► playback_events

proxy_requests + request_cmcd + playback_events
                         │
                         ▼
                diagnostic engine
                         │
                         ▼
          session summary + synchronized timeline
```

### 5.1 Componentes backend

- `internal/cmcd`: extração, parsing, normalização e validação.
- `internal/telemetry`: sessões, eventos e contratos de ingestão.
- `internal/diagnostics`: regras causais, severidade e confiança.
- `internal/proxy`: captura de timings e associação ao request.
- `internal/db`: persistência, retenção e consultas da timeline.
- `cmd/server`: APIs autenticadas de leitura e endpoint de ingestão.

Os nomes finais podem ser ajustados durante a Fase 0, mas as responsabilidades
devem permanecer separadas.

### 5.2 Componentes frontend

- Lista e seletor de sessões no dashboard.
- Resumo de métricas da sessão.
- Timeline sincronizada.
- Waterfall de requests.
- Painel de findings “Why was playback bad?”.
- Request inspector com CMCD bruto e normalizado.

### 5.3 SDK JavaScript

Criar um pacote independente e reutilizável:

```text
@streammock/playback-observer
  core/
  adapters/hlsjs/
  transports/http/
```

O pacote não deve exigir React nem depender da UI do StreamMock.

## 6. Modelo de dados proposto

### 6.1 `playback_sessions`

- `id`: UUID interno.
- `workspace_slug`.
- `stream_id`.
- `cmcd_sid`.
- `content_id`.
- `cmcd_version`.
- `player_name` e `player_version`, quando conhecidos.
- `user_agent`.
- `active_preset`.
- `observer_connected`.
- `started_at`, `last_seen_at` e `ended_at`.
- `created_at`.

### 6.2 `request_cmcd`

Relação 1:1 com `proxy_requests`:

- `request_id`.
- `version`.
- `sid`, `cid`, `ot`, `sf` e `st`.
- `br_kbps`, `tb_kbps`, `mtp_kbps` e `rtp_kbps`.
- `bl_ms`, `dl_ms` e `object_duration_ms`.
- `playback_rate`.
- `startup` e `buffer_starvation`.
- `raw_value`.
- `extra_json` para chaves customizadas.
- `parse_error`.

O modelo Go normalizado deve permitir listas tipadas futuramente, mesmo que as
colunas escalares sejam suficientes para v1.

### 6.3 `playback_events`

Introduzida na Fase 4:

- `id`: UUID enviado pelo Observer para deduplicação.
- `session_id`.
- `sequence_number`.
- `event_type`.
- `wall_time`.
- `monotonic_ms`.
- `media_time_ms`.
- `buffer_ahead_ms`.
- `bitrate_kbps` e `throughput_kbps`, quando aplicáveis.
- `payload_json` com dados específicos do adapter.
- `received_at`.

Restrição única por `(session_id, id)`.

### 6.4 Findings

No primeiro corte, findings podem ser calculados durante a leitura da sessão.
Se o custo ou a necessidade de auditoria crescer, criar `diagnostic_findings`:

- `rule_id` e versão da regra.
- severidade.
- confiança.
- mensagem.
- IDs dos requests e eventos usados como evidência.
- valores observados.

### 6.5 Retenção inicial

- Requests e eventos brutos: 24 horas.
- Resumo da sessão: 7 dias.
- Até 1.000 requests e 5.000 eventos por sessão.
- Até 100 sessões recentes por workspace.

Os limites devem ser configuráveis antes de uma implantação multiusuário maior.

## 7. Definições de métricas

### 7.1 Startup time

Tempo entre `play_requested` e o primeiro frame apresentado.

- Preferência: `requestVideoFrameCallback`.
- Fallback: evento `playing`.
- Persistir o método usado para que a precisão seja explícita.

Não usar `loadedmetadata` como equivalente de primeiro frame.

### 7.2 Rebuffer

Intervalo em que a reprodução, depois de já iniciada, para involuntariamente por
falta de dados.

Excluir:

- startup inicial;
- pause intencional;
- seek em andamento;
- mídia encerrada;
- espera causada por ação explícita da aplicação.

Eventos `waiting` e `stalled` isolados são sinais, não confirmação suficiente.
Usar estado do media element, avanço do playhead e buffer disponível.

### 7.3 Buffer à frente

Fim do `TimeRange` que contém `currentTime`, menos `currentTime`. Se nenhum range
contiver o playhead, o buffer à frente é zero.

### 7.4 Taxa efetiva observada pelo proxy

```text
effective_delivery_kbps = response_bytes * 8 / total_duration_ms
```

Esse valor representa a taxa efetiva do request através do proxy. Não deve ser
descrito como throughput puro da origem nem como o instante exato de chegada do
último byte ao JavaScript do player.

### 7.5 Deadline miss

```text
deadline_miss_ms = max(0, request_total_ms - cmcd_dl_ms)
```

É um finding de risco até que um evento do Observer confirme impacto no
playback.

### 7.6 Bitrate contra throughput

```text
bitrate_to_throughput_ratio = cmcd_br_kbps / cmcd_mtp_kbps
```

- Maior que `1`: bitrate solicitado acima da estimativa do player.
- Entre `0,85` e `1`: warning configurável, não erro definitivo.
- Sem `mtp`: métrica indisponível, nunca zero.

## 8. Regras diagnósticas iniciais

| Regra | Finding | Confiança sem Observer | Confiança com Observer |
| --- | --- | --- | --- |
| `br > mtp` | Bitrate acima do throughput estimado | Média | Alta se seguido de downswitch/rebuffer |
| `request_total > dl` | Deadline perdido | Média | Alta se seguido de starvation/rebuffer |
| `request_total > bl` | Risco de esgotar o buffer | Baixa/média | Alta se buffer chegar a zero |
| `bs=true` | Player reportou starvation | Média | Alta com evento de rebuffer |
| `su=true` | Request urgente | Baixa para startup | Alta com estado startup/seek/recovery |
| `mtp` diverge da taxa efetiva | Percepção do player difere do proxy | Média | Média/alta com histórico da sessão |
| erro injetado | Falha causada pelo StreamMock | Alta | Alta |
| TTFB alto sem intervenção | Possível lentidão da origem | Média | Alta se causar deadline miss |
| entrega rápida e append tardio | Possível parsing/MSE/decoder | Indisponível | Alta |

Cada finding deve conter regra, severidade, confiança, evidências, valores e um
texto que evite afirmar causalidade além do observado.

## 9. APIs propostas

### 9.1 Leitura autenticada

```text
GET /api/playback/sessions?stream={stream_id}
GET /api/playback/sessions/{session_id}
GET /api/playback/sessions/{session_id}/timeline
GET /api/playback/sessions/{session_id}/export
```

As respostas só podem expor sessões do workspace do usuário autenticado.

### 9.2 Criação explícita de uma execução

Introduzida até a Fase 4:

```text
POST /api/playback/sessions
```

Retorna:

- ID interno da sessão;
- `cmcd_session_id` a ser configurado no player;
- playback URL;
- URL e token curto de ingestão do Observer;
- expiração do token.

Sessões CMCD-only continuam podendo ser criadas de forma lazy.

### 9.3 Ingestão do Observer

```text
POST /i/{write_only_token}/events
```

- Token opaco, curto, com TTL e permissão somente de escrita.
- Não registrar o token em access logs.
- Rate limiting por token e IP.
- Payload e lote limitados.
- Deduplicação por event ID.
- CORS restritivo quando houver origem configurada; configurável para dev local.

## 10. Fase 0 — Fundação, contratos e conformidade

### Objetivo

Remover ambiguidades antes de alterar o caminho crítico do proxy.

### Entregáveis

- Fixar `hls.js` exatamente na versão 1.7.1 durante este programa.
- Registrar as decisões deste documento em código e testes.
- Criar `internal/cmcd` com interfaces e tipos normalizados, ainda sem conectar
  ao proxy.
- Fazer um spike da biblioteca Go escolhida e documentar limitações.
- Adicionar `@svta/cml-cmcd` apenas como dependência de desenvolvimento do
  gerador de fixtures, se necessário.
- Criar corpus de fixtures:
  - query v1 válida completa;
  - booleanos implícitos;
  - strings quoted e escaped;
  - chaves customizadas;
  - duplicatas;
  - valores fora de limite;
  - payload truncado ou inválido.
- Definir enums, unidades e ausência de valores.
- Definir contratos de sessão, timeline e findings.
- Planejar migrações SQLite reversíveis por adição de colunas/tabelas.

### Critérios de aceite

- O decoder troca de implementação sem alterar handlers ou modelos externos.
- Fixtures possuem expected output normalizado e expected validation errors.
- Nenhuma dependência Node é necessária em runtime no backend.
- Limites de payload, campos e strings estão testados.
- `go test ./...`, `go build ./...`, `go vet ./...` e `make build` passam.

## 11. Fase 1 — CMCD v1 Query MVP

### Objetivo

Capturar o estado CMCD de cada request sem alterar a reprodução ou a origem.

### Entregáveis backend

- Extrair `CMCD` de:
  - `/ws/{slug}/p.m3u8` e `/ws/{slug}/p`;
  - `/s/{id}/master.m3u8`;
  - `/s/{id}/r/{encoded}`;
  - recursos locais de clones, quando o player anexar CMCD.
- Normalizar e anexar CMCD ao objeto interno do request.
- Persistir `request_cmcd` na mesma transação de `proxy_requests`.
- Criar/lincar a sessão pelo `sid`.
- Preservar payload bruto e erro de parsing conforme política.
- Garantir que CMCD não chegue à origem.
- Garantir que CMCD não altere IDs determinísticos nem cache/clone identity.

### Entregáveis frontend

- Configurar o preview HLS.js com:
  - `sessionId` explícito;
  - `contentId` estável para a stream;
  - `useHeaders: false`;
  - CMCD v1 explícito ou default validado.
- Mostrar na linha/detalhe do request:
  - `sid`, `ot`, `br`, `bl`, `mtp`, `dl`, `su` e `bs`;
  - erro de parsing/conformidade;
  - marcação visual para request urgente ou starvation.

### Testes obrigatórios

- Master, playlist e segmento com o mesmo `sid`.
- CMCD válido, parcial, customizado e inválido.
- Request inválido continua tocando.
- Origem de teste confirma ausência de CMCD.
- IDs permanecem iguais com valores CMCD diferentes.
- Migração de banco existente preserva histórico.

### Critérios de aceite

- Todos os requests de um preview CMCD aparecem correlacionados.
- A origem nunca recebe CMCD com a política default.
- DevTools mostra CMCD na URL do StreamMock.
- O dashboard distingue “CMCD ausente”, “válido” e “inválido”.
- Build e suíte completa passam.

## 12. Fase 2 — Sessões, correlações e primeiro Inspector

### Objetivo

Deixar de mostrar apenas requests soltos e apresentar uma execução de playback
como uma unidade investigável.

### Entregáveis backend

- Implementar `playback_sessions` e associação lazy por `sid`.
- Expor APIs de lista, detalhe, timeline inicial e export JSON.
- Calcular summary da sessão:
  - duração observada;
  - requests, bytes e erros;
  - bitrate mínimo, máximo e médio observado;
  - starvation e requests urgentes;
  - deadline misses;
  - intervenções do StreamMock.
- Implementar correlações CMCD iniciais:
  - `br / mtp`;
  - request total contra `dl`;
  - request total contra `bl`;
  - throughput CMCD contra taxa efetiva do proxy.

### Entregáveis frontend

- Lista/seletor de sessões recentes.
- Header com `sid`, `cid`, preset, início e última atividade.
- Cards de summary.
- Gráficos iniciais no eixo de requests:
  - buffer;
  - bitrate;
  - throughput CMCD e taxa efetiva;
  - deadline misses.
- Marcadores para `su`, `bs`, erros e intervenções.
- Request inspector preservado como drill-down.
- Export JSON da sessão.

### Critérios de aceite

- Duas sessões sobre a mesma stream ficam isoladas por `sid`.
- Requests sem `sid` continuam acessíveis como não correlacionados.
- Gráficos e cards usam as mesmas unidades e dados do request inspector.
- Uma sessão pode ser exportada e reanalisada sem acessar a origem.
- Consultas permanecem rápidas dentro dos limites de retenção.

## 13. Fase 3 — Timings causais e motor de diagnósticos

### Objetivo

Separar lentidão da origem, tempo de relay e interferência do StreamMock, e
transformar os sinais em explicações reproduzíveis.

### Entregáveis de instrumentação

- Instrumentar requests outbound com `httptrace`.
- Capturar quando aplicável:
  - DNS;
  - conexão TCP;
  - TLS;
  - conexão nova ou reutilizada;
  - tempo até headers/primeiro byte da origem;
  - tempo de relay do body;
  - duração total;
  - latência artificial;
  - bytes e status da origem e do StreamMock.
- Para conexão reutilizada, registrar fases não executadas como ausentes.
- Para clones locais, registrar leitura/serve local sem inventar timings de
  origem.

### Entregáveis de diagnóstico

- Criar `internal/diagnostics` com regras versionadas.
- Implementar as regras da seção 8 disponíveis sem Observer.
- Retornar findings na API da sessão.
- Cada finding inclui severidade, confiança e evidências.
- Distinguir explicitamente:
  - erro da origem;
  - erro de transporte;
  - resposta/falha injetada pelo StreamMock;
  - risco inferido a partir do CMCD.

### Entregáveis frontend

- Timeline de requests.
- Waterfall das fases disponíveis.
- Painel “Why was playback bad?”.
- Navegação finding → request → dados brutos.
- Mensagens que indiquem limites de observação do proxy.

### Testes obrigatórios

- Origem com TTFB alto.
- Origem que envia body lentamente.
- CDN degradation com erro injetado.
- Subway 3G com latência e possível 504.
- Deadline perdido e não perdido.
- Reuso de conexão sem fases falsas zeradas.
- Clone local sem campos de origem.

### Critérios de aceite

- Uma falha injetada nunca é atribuída à origem.
- Um TTFB alto conhecido produz finding com evidência numérica.
- Findings iguais são determinísticos para o mesmo conjunto de dados.
- O dashboard nunca descreve inferência de risco como stall confirmado.

## 14. Fase 4 — Observer JavaScript core + HLS.js

### Objetivo

Capturar os eventos que CMCD Request Mode não consegue representar com precisão
e fechar a cadeia causal entre request e experiência real.

### API conceitual

```ts
const observer = observePlayback({
  media: video,
  adapter: hlsJsAdapter(hls),
  sessionId,
  ingestUrl,
});

observer.destroy();
```

### Eventos core do media element

- `session_started` e `session_ended`.
- `play_requested`.
- `first_frame`.
- `playing`.
- `buffering_started` e `buffering_ended`.
- `seek_started` e `seek_ended`.
- `paused` e `resumed`.
- `ended`.
- `media_error`.
- `visibility_changed`.
- snapshots limitados de buffer, frames e playback rate.

### Eventos do adapter HLS.js

- Manifest loading, loaded e parsed.
- Fragment loading, loaded, parsed e buffered.
- Buffer appended e erros de append.
- Level switching e switched.
- Emergency downswitch.
- FPS drop.
- Stall detected/resolved.
- Erros HLS.js com tipo, detalhe, fatalidade e fragmento relacionado.

Não duplicar eventos sem ganho diagnóstico. O adapter deve converter dados
HLS.js para uma taxonomia estável do StreamMock e manter detalhes específicos
em `payload_json`.

### Transporte

- Batch por tempo e quantidade, inicialmente 1–2 segundos ou 20 eventos.
- Event ID UUID e sequence number monotônico.
- `fetch` com `keepalive` durante a sessão.
- `sendBeacon` ou fallback equivalente no encerramento.
- Lotes pequenos o suficiente para limites de keepalive/beacon.
- Retry limitado; telemetria nunca bloqueia playback.
- Token curto, write-only, com TTL e rate limiting.

### Integração inicial

- Usar primeiro no `ProxyPreviewPage` do próprio StreamMock.
- Criar sessão explícita antes de abrir o player.
- Usar o mesmo `sessionId` no CMCD e no Observer.
- Só depois publicar documentação para integração em players externos.

### Métricas habilitadas

- Startup time real/fallback identificado.
- Contagem e duração total de rebuffers.
- Tempo até manifest e primeiro fragmento.
- Tempo download → parse → append.
- Trocas de qualidade e emergency downswitch.
- Frames descartados.
- Erros de rede, parsing, MSE e decoder.

### Diagnósticos adicionais

- Deadline miss seguido de rebuffer.
- Falha injetada seguida de retry, downswitch ou erro fatal.
- Entrega rápida seguida de parsing/append lento.
- Buffer alto com stall, sugerindo gap, decoder ou MSE em vez de rede.
- Startup lento decomposto em manifest, primeiro segmento, append e primeiro
  frame.

### Testes obrigatórios

- Máquina de estados de startup, pause, seek e rebuffer.
- `waiting` falso-positivo durante pause/seek.
- First frame com e sem `requestVideoFrameCallback`.
- Deduplicação de lotes reenviados.
- Eventos fora de ordem dentro da tolerância definida.
- Encerramento com lote pendente.
- HLS.js fatal e não fatal.
- Simulação StreamMock correlacionada ao evento posterior.

### Critérios de aceite

- O preview interno produz sessão com requests e eventos na mesma timeline.
- Startup e rebuffer não dependem somente de `su` e `bs`.
- Um cenário de latência artificial gera uma explicação causal de alta
  confiança quando seguido de rebuffer.
- Desabilitar ou falhar o Observer não interrompe o player.
- O pacote não depende de React e limpa todos os listeners em `destroy()`.

## 15. Definição de pronto para o programa inicial

As fases 0 a 4 estarão concluídas quando um desenvolvedor puder:

1. abrir um preview ou integrar um HLS.js externo com um `sid` conhecido;
2. reproduzir usando um preset de caos;
3. encontrar uma sessão única no Playback Inspector;
4. visualizar CMCD, timings, intervenções e eventos do player sincronizados;
5. ver startup, rebuffers, erros e mudanças de qualidade;
6. receber findings que diferenciem origem, proxy, simulação e player;
7. navegar de cada explicação até os requests e eventos usados como evidência;
8. exportar os dados da sessão para compartilhamento ou análise offline.

Todos os cortes devem manter:

- `go test ./...`;
- `go build ./...`;
- `go vet ./...`;
- `make build`.

## 16. Referências

- CTA WAVE — CMCD corrente: <https://www.cta.tech/standards/wave-common-media-client-data/>
- CTA-5004 original: <https://cdn.cta.tech/cta/media/media/resources/standards/pdfs/cta-5004-final.pdf>
- HLS.js CMCD: <https://github.com/video-dev/hls.js/blob/master/docs/API.md#cmcd>
- HLS.js runtime events: <https://github.com/video-dev/hls.js/blob/master/docs/API.md#runtime-events>
- SVTA Common Media Library: <https://streaming-video-technology-alliance.github.io/common-media-library/>
- Shaka CMCD configuration: <https://shaka-player-demo.appspot.com/docs/api/shaka.extern.html>
- Shaka Player events/stats: <https://shaka-project.github.io/shaka-player/docs/api/shaka.Player.html>
- Go CMCD package candidate: <https://pkg.go.dev/github.com/untangledco/streaming/cmcd>

