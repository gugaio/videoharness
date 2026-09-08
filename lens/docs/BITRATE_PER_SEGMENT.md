# Bitrate por segmento e distribuição de payload

## Por que existe

Um bitrate declarado no manifesto é uma expectativa do empacotamento, não uma
medição do que foi baixado. Um segmento excepcionalmente grande pode exigir mais
banda e buffer que os seus vizinhos, mesmo quando a média da rendição parece
adequada. Esta visão reduz o caminho entre um sintoma de rebuffer e a evidência
disponível nos bytes capturados.

## O que é calculado

- **Bitrate do segmento**: `tamanho do arquivo × 8 / duração usada`.
- **Média da rendição**: soma dos bytes ÷ soma das durações dos segmentos válidos;
  é ponderada por duração, não uma média simples das taxas.
- **Pico e faixa**: maior, menor e maior taxa observadas na janela.
- **Relação com o declarado**: taxa do segmento dividida por `BANDWIDTH` (HLS) ou
  `bandwidth` (DASH), somente quando o manifesto disponibiliza esse campo.
- **Distribuição de payload**: quantidade, média e maior tamanho dos frames do
  `ffprobe`, ou de samples/PES estruturais quando frames não estão disponíveis.

## Escolha de duração

O Stream Lens prefere a duração determinística calculada pelos timestamps do
container. Em um segmento com mais de uma track, só a utiliza se todas as durações
observadas diferirem no máximo 50 ms. Caso contrário, usa a duração declarada pelo
manifesto e expõe isso na linha do segmento. Se nenhuma duração é utilizável, o
segmento simplesmente não entra no cálculo.

Isso evita escolher arbitrariamente uma track em conteúdo muxado e chamar o
resultado de taxa real. O cálculo ainda mede os bytes do arquivo completo, não só
o payload de vídeo.

## Como investigar

| Sinal | Pode ajudar a investigar | Próxima verificação |
| --- | --- | --- |
| Pico muito acima do restante | Cena de alto payload, configuração de encoder ou segmentação desigual | Frames/samples do segmento e limites de buffer do player |
| Pico acima do declarado | Ladder/manifesto possivelmente mal descrito ou janela com burst | Outros segmentos e política de `BANDWIDTH` do packager |
| Grande faixa entre segmentos | Variação de conteúdo, GOP ou escolha de duração | Proveniência da duração e GOP/frame sizes |
| Sem taxa em um segmento | Falha de download ou ausência de duração utilizável | Timeline e dados do container; não tratar como zero |

Nenhum desses sinais, isoladamente, prova a causa de rebuffer, a qualidade visual
ou a complexidade do codec. Métricas de throughput HTTP, buffer e telemetria do
player continuam necessárias para fechar esse diagnóstico.

## QA

QA deve cobrir: duração de container única; múltiplas tracks concordantes; tracks
divergentes com fallback declarado; ausência de duração; pico/média ponderada;
ausência de `BANDWIDTH`; frames derivados preferidos para tamanho de unidade e
fallback para samples/PES. A interface deve sempre explicar que payload não é
complexidade de codec e que o bitrate declarado é uma fonte diferente da taxa
calculada.
