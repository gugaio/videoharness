# Fase Record R2 - DASH VOD

Status: **ativa**.

## Objetivo

Adicionar recording e experimento ABR para DASH VOD reutilizando o data plane,
PlaybackRun, shaping, request journal e UX comprovados com HLS VOD.

## Dependencias

- Record R1 concluido.
- Contratos Recording/RecordedResource independentes de HLS.
- Shaper e journal operando por resource metadata, nao por extensao de arquivo.
- Parser MPD atual consolidado para a fronteira Record.

## Escopo inicial

- MPD `static` clear.
- `SegmentTemplate` com `SegmentTimeline` ou duration.
- Representations de video e audio.
- Init + media fMP4.
- Janela temporal comum entre representations.
- MPD local reescrito para recursos registrados.
- Transicao ABR inferida por requests de representation de video.

## Estado implementado

- Intake permite escolher `hls` ou `dash`; HLS permanece o default compativel.
- O worker despacha pelo protocolo e o collector DASH aceita MPD `static`, clear,
  `SegmentTemplate` com timeline ou duration, sem `SegmentBase`/ranges.
- A maior adaptation set de video com 2--8 representations e uma adaptation set
  de audio sao materializadas com init e segmentos fMP4 em storage privado.
- O MPD local e reescrito para paths registrados e o playback run devolve
  `index.mpd` na URL fixa do recording; shaping e journal continuam os mesmos
  do data plane existente.
- Antes de baixar media, o collector estima o tamanho da janela pela bitrate
  declarada. Ladder acima do teto agregado falha sem retry nem downloads parciais.
- A URL de playback e fixa por recording em `/streams/recordings/:recordingId/*`;
  cada request resolve o run aberto atual para shaping e journal, e sem run ativo
  o clone e servido com o perfil baseline. O journal permanece assincrono e fora
  do caminho critico.
- Um run aberto pode ser restaurado na UI por query de control plane; `finish`
  finaliza o run no banco, encerrando shaping e journal.
- O materializador inspeciona cada INIT e fragment com parser ISO BMFF proprio,
  incluindo hvcC/VPS/SPS/PPS, moof/tfhd/tfdt/trun e boundary NAL/IRAP; os bytes
  integrais continuam no storage e somente resumos de boundary viram metadata.
- O journal alimenta `AbrSwitchCorrelator`, que cria um `AbrSwitchEvidence`
  `OBSERVED` por mudanca real de Representation e expoe o resultado em
  `GET .../abr-switches` sem exigir telemetria de player/device.
- O fluxo Investigate, que recebe somente URL, cria candidatos
  `URL_STATIC_ANALYSIS/CANDIDATE` para as direcoes amostradas. Contexto de
  player/device eventualmente colado na descricao permanece `reported`, nunca
  observado.
- Timeline, semantic INIT diff, matrix e regras ABR com IDs estaveis sao
  compartilhados entre o fluxo estatico e o correlator do playback run.
- Investigate executa FFmpeg A/B/C no candidato prioritario e D somente quando o
  switching contract permite contexto compartilhado; um segundo INIT nunca e
  concatenado cegamente no meio do teste.
- Investigate agora produz `AbrAssessment` em HLS e DASH. O baseline de ladder e
  o especialista ABR rodam sempre; o relato do usuario apenas prioriza a
  transicao e a janela mais relevantes.
- Troca de resolucao/level/INIT/SPS esperada pelo modo de reinitialization e
  neutra. Ela so promove risco quando ha violacao de contrato, falha de decode,
  capability mismatch ou falha observada do player na mesma fronteira.

## Fora do primeiro corte DASH

- MPD dinamico;
- `SegmentBase`/`sidx`;
- DRM/licenca/decryption;
- byte ranges;
- low latency DASH;
- comprovacao de decode/render em hardware real.
- classificacao `PLATFORM_SUSPECTED` sem reproducao e evidencia especifica do
  modelo/firmware.

## Definition of Done

- Fixture DASH VOD com tres representations e audio e gravada e reproduzida pela
  URL do Video Harness.
- Device nao acessa a origem depois do recording pronto.
- O mesmo profile de R1 induz condicoes de downshift/recovery.
- Requests sao mapeados para representation, bitrate, resolucao e timeline.
- Resultado preserva a mesma semantica `observed | sustained | not_observed |
  inconclusive` de HLS.
