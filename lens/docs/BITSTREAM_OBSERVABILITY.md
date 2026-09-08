# Bitstream e sincronismo A/V observado

Este bloco ajuda engenharia, desenvolvimento e QA a comparar o que o manifesto
declara com o que o decoder conseguiu identificar nos segmentos que realmente
entraram na janela da inspeção. Ele **não** é um validador de compatibilidade de
dispositivo e não mede a experiência de sincronismo do player.

## O que é coletado

Para cada segmento de mídia que o `ffprobe` consegue ler, Stream Lens registra:

- vídeo: codec, profile, level, resolução, formato de pixel e frame rate;
- áudio: codec, profile, sample rate, número/layout de canais;
- menor PTS de apresentação de vídeo e áudio, em ticks e em segundos;
- `av_start_delta_seconds = PTS inicial do áudio − PTS inicial do vídeo`, apenas
  quando os dois estão no **mesmo arquivo capturado**;
- campos de configuração que mudaram entre dois segmentos consecutivos com
  observação derivada.

Em fMP4, o arquivo de init correspondente é combinado ao fragmento somente para
o probe, pois ele contém a configuração de codec que pode não estar no fragmento.
MPEG-TS é sondado diretamente. A fonte continua sendo `derived (ffprobe stream
configuration)`; boxes, PTS/DTS e PES/samples estruturais continuam disponíveis
separadamente como evidência determinística.

## Como usar na investigação

| Evidência | Pode ajudar a investigar | Não permite concluir |
| --- | --- | --- |
| Profile, level, pixel format ou resolução mudam | falha depois de troca de encoder, regressão em um device class, uma rendição que se comporta diferente da declaração `CODECS` | que um aparelho específico não suporta o stream |
| Sample rate, canais ou layout mudam | ausência de áudio, downmix inesperado, quebra na transição entre anúncios ou fontes | que o player aplicou ou deixou de aplicar um downmix |
| Delta A/V no mesmo container | offset de timestamps que merece correlacionar com PTS/DTS, muxing e telemetria do player | atraso percebido, lipsync ruim ou drift entre segmentos |
| Sem configuração efetiva | fragmento protegido, inválido, codec não disponível ao probe ou leitura parcial | configuração estável, saudável ou ausente no stream |

O cálculo prioriza `best_effort_timestamp`/PTS de apresentação do decoder, para
respeitar reorder de B-frames. O PTS bruto e sua conversão para segundos aparecem
na UI, de modo que a conta seja auditável. Se não houver PTS utilizável nas duas
tracks, o fallback homogêneo de `ffprobe.start_time` é indicado como tal; PTS e
`start_time` nunca são misturados. Um delta positivo significa que o áudio começa
depois do vídeo no arquivo sondado; esses tempos **não podem ser comparados
diretamente entre segmentos ou rendições**.

## Roteiro de QA

1. Use dois segmentos sintéticos com mesmo vídeo/áudio e confirme que não há
   `configuration_changes`; o delta A/V ainda pode aparecer, pois mede outra
   dimensão.
2. Altere somente o `profile` de vídeo no segundo segmento e confirme que a
   mudança lista somente `profile` com os índices de origem/destino corretos.
3. Inclua áudio e vídeo com PTS iniciais diferentes; confira os dois valores
   brutos, a conversão em segundos, o sinal de `audio - video` e o tooltip da UI.
4. Remova o áudio ou force o probe a não responder. O delta deve ser `null` e a
   UI deve dizer “não observado”, sem mostrar alerta de incompatibilidade.
5. Em fMP4, confirme que a configuração é obtida somente quando init e fragmento
   da mesma representação foram capturados; não reutilize init de outra rendição.

## Limites deliberados

- Não há parsing próprio de SPS/PPS/VPS/AudioSpecificConfig, nem hash de
  `extradata`; isso evita promover dados incompletos a verdade de codec.
- Não há comparação A/V entre grupos separados (por exemplo, vídeo e áudio em
  playlists HLS distintas), porque seus relógios e pontos de corte exigem uma
  regra explícita que ainda não existe.
- Uma lacuna de probe entre segmentos não vira uma “mudança” e não é mascarada
  como estabilidade.
- O bloco não cria findings, limiares ou alertas automáticos. Esses exigem
  evidência adicional e correlação com o player em entrega futura.
