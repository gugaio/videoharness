# Matriz de alinhamento ABR

## Por que existe

Uma troca de qualidade pressupõe que duas rendições descrevam o mesmo ponto do
conteúdo. Segmentos com início ou duração divergentes podem causar falha de append,
salto visual, tela preta durante a troca ou seek impreciso. Esta matriz expõe a
evidência disponível antes de atribuir a causa ao encoder, packager ou player.

## O que é comparado

- Apenas rendições do mesmo tipo de mídia. Quando disponível, o pareamento usa
  a identidade canônica do segmento: `EXT-X-MEDIA-SEQUENCE` no HLS e o número
  de segmento no DASH. O índice local da janela é usado somente quando a fonte
  não declara essa identidade.
- Início e duração declarados: provenientes da timeline normalizada do manifesto.
  Em HLS, uma janela live pode começar em sequências diferentes em cada rendição;
  o início local da janela não é tratado como desvio temporal. Dois segmentos da
  mesma `MEDIA-SEQUENCE` representam a mesma fronteira declarada.
- Primeiro PTS de keyframe: derivado de `ffprobe -show_frames`, somente quando os
  dois fragments da mesma sequência o reportam.
- A primeira rendição do grupo na ordem do manifesto é a referência da matriz.

Os valores apresentados são o maior delta absoluto dentro da janela capturada.
`0.000s` significa igualdade dentro da precisão registrada; `não comparável` ou
`não observado` significa que não havia os dois lados da evidência.

Quando a tela informa `janela diferente`, não é um alarme de encoder: ela só
mostra quantos segmentos observados de cada lado não tinham a mesma sequência na
outra playlist. Isso é comum em live quando as playlists são buscadas em instantes
ligeiramente diferentes. O sistema compara apenas a interseção das sequências.

## Como investigar

| Sinal | Pode ajudar a investigar | Próxima verificação |
| --- | --- | --- |
| Janela diferente | Playlists live capturadas em sequências distintas; não prova falha | Ver as sequências sem par e a interseção comparada |
| Duração/início declarados diferentes no mesmo par | Manifestos desalinhados, numbering ou empacotamento | Timeline e `EXTINF`/`SegmentTimeline` |
| Keyframe PTS diferente no mesmo par | GOPs desalinhados, boundary não independente ou timestamps distintos | Frames/GOP de cada segmento e PTS/DTS |
| Keyframe não observado | Limite da janela, probe indisponível ou fragmento sem ponto de acesso | Ampliar captura; não concluir falha |

## QA

QA deve testar pares alinhados, janelas live deslocadas por uma sequência, delta
declarado, delta de keyframe e ausência de keyframe. A matriz não pode comparar
áudio com vídeo, parear janelas live só pela mesma posição local ou converter dados
ausentes em uma recomendação de switching.
