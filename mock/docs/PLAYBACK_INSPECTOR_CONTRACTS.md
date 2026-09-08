# Contratos do Playback Inspector — Fase 0

Este documento fixa os contratos usados pelas fases 1 a 4. Os tipos Go vivem
em `internal/cmcd`, `internal/telemetry` e `internal/diagnostics`.

## CMCD

- Transporte do MVP: parâmetro de query string exatamente chamado `CMCD`.
- Versão do MVP: v1; headers ficam para a Fase 6.
- Um decoder retorna `NormalizedCMCD` e pode retornar `ValidationError` com
  múltiplos códigos estáveis. Payload inválido nunca implica erro HTTP.
- `RawValue` preserva a forma URL-decodificada apenas quando tem até 8 KiB.
- `CanonicalValue` ordena chaves para facilitar fixtures e comparação.
- `nor` é percent-decoded depois do decode da query e volta à codificação RFC
  3986 na forma canônica.
- Métricas possuem nome com unidade: `*_ms` ou `*_kbps`.
- Métricas ausentes são `nil`; `0` só existe quando foi explicitamente enviado
  e permitido para aquela chave.
- Na instrumentação de rede, `ttfb_ms` mede até o primeiro byte,
  `origin_body_ms` mede o tempo bloqueado lendo o corpo da origem e `relay_ms`
  mede o intervalo entre o primeiro byte e o fim da entrega ao cliente. O
  último pode incluir backpressure do cliente; por isso `slow_origin_body` usa
  `origin_body_ms`, não `relay_ms`.
- `ObjectValues[T]` permite representar valores scalar v1 e valores por tipo
  de objeto no CMCD v2 sem quebrar o contrato.
- Para diagnóstico, `bl=0` e `dl=0` significam “sem buffer/deadline útil
  disponível ainda” (comum no primeiro objeto do HLS.js), e não buffer ou
  deadline de duração zero.
- A comparação `br/mtp` usa uma tolerância de 10%. Uma diferença sem
  rebuffer/downswitch é sinal contextual, não diagnóstico de playback ruim.

Limites iniciais:

| Limite | Valor |
| --- | ---: |
| Payload CMCD URL-decodificado | 8 KiB |
| Payload codificado antes do decode | 24 KiB |
| Chaves totais | 64 |
| Chaves customizadas | 16 |
| Nome de chave | 64 bytes |
| String quoted/customizada | 1 KiB |
| `sid` e `cid` | 64 caracteres |

Custom keys devem possuir um hífen para evitar colisão com chaves CMCD
reservadas. Chaves ou parâmetros `CMCD` duplicados são inválidos, sem política
de sobrescrever o último valor.

Em CMCD v1, `bl`, `dl`, `mtp` e `rtp` devem chegar em múltiplos de 100. `nrr`
aceita as três formas definidas pelo padrão: `início-`, `início-fim` e
`-sufixo`.

## Sessão e timeline

Persistência usa `INTEGER` Unix epoch em milissegundos. JSON também usa
`*_at_ms`, para não perder precisão durante uma timeline sincronizada.

- Sessão é única por `(workspace_slug, stream_id, cmcd_sid)`.
- `cid` identifica conteúdo, mas não substitui `sid` para correlação.
- `initial_preset` é o snapshot do primeiro request; a intervenção em cada
  request continua sendo a fonte de verdade se o preset mudar durante a sessão.
- Uma entrada de timeline é `request` ou `event`, nunca ambos.
- Entradas são ordenadas por `at_ms`, depois `kind`, depois o ID do payload.

## Findings

Um finding possui `rule_id`, `rule_version`, severidade (`info`, `warning` ou
`error`), confiança (`low`, `medium` ou `high`), mensagem, evidências e
medições. Medições são numéricas e sempre carregam unidade (`ms`, `kbps`,
`bytes`, `ratio` ou `count`).

O texto deve distinguir fato observado de risco inferido. Por exemplo,
`deadline_miss` sem Observer indica risco; não afirma rebuffer confirmado.
