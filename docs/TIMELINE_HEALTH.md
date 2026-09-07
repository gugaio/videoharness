# Timeline Health

## Por que existe

Playback adaptativo depende de fronteiras temporais contínuas. Um manifesto pode
declarar segmentos de um segundo enquanto os bytes trazem gap, overlap ou duração
distinta. A tela de Timeline Health torna essa diferença observável antes de atribuir
causa a encoder, packager, CDN ou player.

## O que é medido

Para cada track fMP4 ou PID MPEG-TS com amostras temporizadas, o snapshot expõe:

- PTS e DTS inicial/final observáveis;
- duração observada, quando o DTS final e a duração da última amostra existem;
- duração declarada no manifesto para o mesmo segmento;
- delta da fronteira anterior: `DTS_inicio_atual - DTS_fim_anterior`.

Delta positivo é um **gap**; negativo é **overlap**; zero é fronteira contínua. A
comparação só acontece na mesma representação, mesmo track/PID e mesma timescale.

## Limites importantes

- MPEG-TS pode não fornecer duração da última PES; nesse caso o fim do segmento não
  é conhecido e a fronteira seguinte fica `não comparável`.
- PTS pode ser reordenado por B-frames; a continuidade usa DTS.
- A fase atual não compara rendições, áudio contra vídeo, PCR nem sinalização de
  descontinuidade. Esses itens pertencem às próximas entregas da trilha.
- Um valor ausente não é sucesso, falha ou zero.

## Como usar na investigação

| Evidência | Hipóteses que ajuda a testar |
|---|---|
| gap entre segmentos | stall, frame perdido, transição de anúncio ou erro de empacotamento |
| overlap | repetição, append rejeitado ou salto de reprodução |
| duração real diferente da declarada | live edge incorreto, ABR desalinhado ou drift acumulado |
| fronteira não comparável | PES/fMP4 incompleto, captura curta ou timestamps insuficientes |

QA deve validar tanto os valores quanto a linguagem: a UI não pode chamar um valor
ausente de "contínuo" nem apresentar uma hipótese como causa confirmada.
