# Entrega HTTP e evidência live

Este módulo mostra o que o **cliente de captura** observou ao obter manifestos e
segmentos. Ele ajuda a separar uma hipótese de entrega (CDN, cache, redirect ou
vazão daquela requisição) de uma hipótese de mídia (bitrate, timeline, GOP) e de
uma experiência real de player. Não emite diagnóstico automático.

## O que é medido

Em cada resposta HTTP de segmento bem-sucedida, o snapshot pode conter:

- **TTFB**: tempo entre iniciar a requisição e receber o primeiro byte do corpo.
  Inclui a cadeia de redirects observada antes da resposta final.
- **Download**: tempo entre iniciar a requisição e terminar a leitura do corpo.
- **Throughput efetivo**: `bytes recebidos * 8 / tempo total de download`.
- **HTTP e redirects**: status final e quantidade de redirects seguidos.
- **Sinais de cache seguros**: diretivas conhecidas de `Cache-Control`,
  `max-age`, `Age` e somente a presença de `ETag`.

Esses valores têm proveniência `observed (HTTP client)`. Fixtures locais não são
HTTP: os respectivos campos ficam ausentes, em vez de receber zero ou uma
latência inventada. Uma resposta HTTP de segmento que falha ainda preserva o
status e os sinais de cache quando o cliente conseguiu receber a resposta.

Não persistimos o valor de `ETag`, headers arbitrários, cookies, authorization,
nem URLs intermediárias de redirect. URLs serializadas continuam redigidas.

## Evidência live

Para cada media playlist HLS live que foi efetivamente lida, o snapshot registra
`MEDIA-SEQUENCE`, sequência final, `TARGETDURATION` e a soma das durações
declaradas na playlist. Isso descreve a janela declarada pelo manifesto — não o
buffer do player.

Quando `PROGRAM-DATE-TIME` permite associar um horário ao último segmento — mesmo
que o marcador apareça apenas antes de um segmento anterior — a distância da borda
live é calculada como horário da captura menos o fim declarado do último segmento
(`PROGRAM-DATE-TIME + EXTINF`). O valor depende dos relógios de origem e do
cliente; pode inclusive ser negativo se eles estiverem desalinhados. Sem
`PROGRAM-DATE-TIME`, a distância fica explicitamente não observada. DASH dinâmico
ainda não oferece um cálculo equivalente nesta entrega.

O Stream Lens lê cada playlist uma vez por inspeção. Por isso, **avanço/frescura
entre atualizações não é medido**: duas ou mais leituras da mesma playlist seriam
necessárias. A UI declara esse limite literalmente, em vez de inferir frescura a
partir de uma amostra.

## Roteiro de investigação para QA e operação

| Evidência | Pergunta que ajuda a responder | Cuidado ao interpretar |
|---|---|---|
| TTFB alto e download curto | A origem/CDN demorou para começar a responder? | Não confirma startup lento no player. |
| Throughput abaixo do bitrate calculado por segmento | Esta amostra de entrega sustenta a taxa daquele segmento? | Compare várias amostras; uma requisição não representa a rede do usuário. |
| Redirects ou status 4xx/5xx | A URL final/roteamento respondeu como esperado? | O snapshot não expõe os destinos intermediários. |
| `no-store`, `private`, idade ou `max-age` | Há sinal para investigar política de cache? | Diretivas não provam hit/miss nem configuração correta da CDN. |
| Janela live e sequência | Qual parte declarada da playlist foi observada? | Não é buffer nem posição de reprodução. |
| Distância da borda com PDT | A borda temporal declarada parece distante do horário da captura? | Validar NTP/clock e repetir a captura antes de concluir atraso live. |

Para reproduzir um caso, registre o snapshot JSON, a hora da captura, a URL já
redigida, o tipo de cliente/região e ao menos uma segunda inspeção. Correlacione
com Timeline Health e bitrate por segmento antes de atribuir rebuffering à CDN.

## Limites verificáveis

- Medidas são da máquina que executa Stream Lens; não há RUM, CMCD ou trace do player.
- TTFB não separa DNS, TCP, TLS e tempo de origem; isso exigiria instrumentação adicional.
- A captura é sequencial, limitada e pequena; não mede concorrência típica de um player.
- Não há polling de playlist, cálculo de avanço ou latência DASH nesta versão.
- `null`/"não observado" não quer dizer cache miss, latência zero ou stream saudável.
