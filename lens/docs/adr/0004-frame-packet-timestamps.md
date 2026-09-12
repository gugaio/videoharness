# ADR-0004 — DTS de pacote com associação verificável

Status: aceito · Data: 2026-09-12

## Decisão

O adapter MediaProbe lê `-show_frames -show_packets` na mesma execução limitada
de ffprobe. Para atribuir DTS a um frame, exige uma relação um-para-um por
`stream_index` e posição no arquivo (`pkt_pos` / `pos`), além de igualdade do PTS
original e tamanho positivo do pacote. Posições ausentes/negativas, duplicadas,
PTS estimado sem PTS original ou tamanhos divergentes não permitem associação.

O DTS inteiro e em segundos são copiados do pacote associado. Não se usa
`frame.pkt_dts`, não se associa por tamanho isolado, não se soma offset estrutural
ao PTS derivado, e não se presume DTS diferente para um frame B.

## Contrato e limites

Analyzer 1.5.1 corrige a semântica dos campos nullable `dts`/`dts_time` no schema
1.13. Campos aditivos `packet_position`, `packet_pts` e `dts_provenance` registram
a evidência. A proveniência é `derived (ffprobe packet)`, pois os timestamps são
reportados pelo demuxer, não uma alegação de leitura estrutural sem transformação.
Sem DTS observado, retorna null. Não há fallback heurístico.

Posição é relativa à entrada do probe: arquivo TS/MP4 ou init + fragmento fMP4
concatenados. Conservam-se limite de 1.000 frames serializados, leitura limitada
a 1.001 pacotes selecionados, timeout e teto de 40 MiB para entrada concatenada.

Snapshots anteriores não são reescritos. Consumidores podem exigir a proveniência
nova e indicar DTS indisponível para resultados anteriores. Samples/PES estruturais
continuam independentes, na escala e origem próprias do container.
