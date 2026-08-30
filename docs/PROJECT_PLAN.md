# Plano do projeto — StreamMock

Este documento descreve as fases do produto e a diferença importante entre o
comportamento atual de proxy e o clone HLS que o produto deve oferecer.

## Fase 1 — Proxy HLS e simulação de falhas (concluída)

- Criar streams a partir de uma URL HLS.
- Reescrever playlists e URLs de recursos para `/s/{id}/...`.
- Buscar playlists e segmentos da origem sob demanda.
- Limitar a playlist retornada a uma janela de até 60 segundos e encerrá-la
  com `#EXT-X-ENDLIST`.
- Aplicar presets de caos para testes de player e persistir os metadados da
  stream para usuários autenticados.

Limitação conhecida: esta fase não armazena playlists, segmentos ou chaves.
Consequentemente, a reprodução depende de a origem continuar disponível. A
janela de 60 segundos é uma transformação da playlist atual, e não uma cópia
imutável do conteúdo.

## Fase 2 — Clone HLS persistente (em andamento)

Objetivo: ao criar uma stream, capturar por padrão até 60 segundos de conteúdo
HLS, com duração solicitada de até 5 minutos, e servi-lo localmente. Depois de
concluída a captura, a URL clone continua reproduzível mesmo que a URL original
deixe de existir.

Escopo entregue no primeiro corte:

- Aceitar master playlist ou media playlist HLS VOD clear/MPEG-TS.
- Baixar a variante de vídeo de maior `BANDWIDTH` e a rendition de áudio padrão
  vinculada, quando houver.
- Selecionar segmentos completos cuja duração acumulada seja de no máximo o
  valor pedido: 60 segundos por padrão, 300 segundos no máximo.
- Baixar playlists e segmentos em staging antes da publicação local.
- Gerar playlists locais com referências locais e `#EXT-X-ENDLIST`.
- Registrar no banco modo, estado (`queued`, `capturing`, `ready` ou `failed`),
  duração, bytes, erro, inventário e diretório de armazenamento.
- Exibir o andamento, a falha ou a disponibilidade do clone na interface.
- Manter os presets de caos funcionando sobre os recursos locais clonados.

Critérios de aceite:

- Um clone marcado como `ready` toca sem qualquer requisição à origem.
- Derrubar ou tornar indisponível a URL de origem não impede a reprodução do
  clone pronto.
- Um clone não ultrapassa a duração solicitada nem o teto absoluto de 300
  segundos; segmentos indivisíveis que não couberem no limite são omitidos.
- Falhas de captura ficam visíveis e não produzem um clone parcialmente
  utilizável como se estivesse pronto.

Limitações deliberadas deste corte:

- Apenas uma variante de vídeo é preservada; a ladder completa fica para a
  próxima fase de ABR.
- AES-128/DRM, byte ranges, fMP4/`EXT-X-MAP`, LL-HLS e playlists live falham
  explicitamente e nunca geram clone parcial.
- O diretório é configurável por `STREAMMOCK_STORAGE` (default
  `streammock-data`) e o limite agregado é 1 GiB por clone.

## Fase 3 — Operação do acervo de clones

O programa detalhado de observabilidade de playback, com CMCD, diagnóstico
causal e Observer HLS.js, está em
[`PLAYBACK_INSPECTOR_PLAN.md`](PLAYBACK_INSPECTOR_PLAN.md). O escopo inicial
aprovado cobre as fases 0 a 4 desse documento.

- Listar tamanho, duração, data e estado de cada clone.
- Permitir remover clones e recuperar espaço com segurança.
- Aplicar quotas por usuário e políticas de expiração.
- Disponibilizar observabilidade de captura, reprodução e erros de origem.

## Fase 4 — Formatos e cenários avançados

- Suporte real a DASH, com parsing XML, reescrita de BaseURL e
  SegmentTemplate/SegmentTimeline, proxy .mpd e clone VOD local.
- Preview DASH com Shaka Player e adapter playback-observer/shaka.
- Captura de múltiplas variantes, faixas de áudio e legendas.
- Controles de captura, como duração, qualidade e ponto inicial para conteúdo
  live.
