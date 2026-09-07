# Matriz de alinhamento ABR

## Por que existe

Uma troca de qualidade pressupõe que duas rendições descrevam o mesmo ponto do
conteúdo. Segmentos com início ou duração divergentes podem causar falha de append,
salto visual, tela preta durante a troca ou seek impreciso. Esta matriz expõe a
evidência disponível antes de atribuir a causa ao encoder, packager ou player.

## O que é comparado

- Apenas rendições do mesmo tipo de mídia e segmentos com o mesmo índice.
- Início e duração declarados: provenientes da timeline normalizada do manifesto.
- Primeiro PTS de keyframe: derivado de `ffprobe -show_frames`, somente quando os
  dois fragments o reportam.
- A primeira rendição do grupo na ordem do manifesto é a referência da matriz.

Os valores apresentados são o maior delta absoluto dentro da janela capturada.
`0.000s` significa igualdade dentro da precisão registrada; `não comparável` ou
`não observado` significa que não havia os dois lados da evidência.

## Como investigar

| Sinal | Pode ajudar a investigar | Próxima verificação |
| --- | --- | --- |
| Duração/início declarados diferentes | Manifestos desalinhados, numbering ou empacotamento | Timeline e `EXTINF`/`SegmentTimeline` |
| Keyframe PTS diferente | GOPs desalinhados, boundary não independente | Frames/GOP de cada segmento |
| Keyframe não observado | Limite da janela, probe indisponível ou fragmento sem ponto de acesso | Ampliar captura; não concluir falha |

## QA

QA deve testar pares alinhados, delta declarado, delta de keyframe e ausência de
keyframe. A matriz não pode comparar áudio com vídeo, índices distintos ou converter
dados ausentes em uma recomendação de switching.
