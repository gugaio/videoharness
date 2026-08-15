# Project Vision - Video Harness Space

## Visao

Video Harness Space e um workspace de investigacao e experimentacao reproduzivel
para engenheiros de video streaming. Ele combina ferramentas deterministicas,
agentes especializados e uma experiencia premium para reduzir o tempo entre um
sintoma, uma medicao controlada e uma explicacao util.

## Problema

Investigar streaming exige correlacionar manifestos, rede, segmentos, codecs,
timestamps, players e compatibilidade. As ferramentas existem, mas o trabalho e
fragmentado, repetitivo e dependente de especialistas experientes.

## Hipoteses em validacao

Se um engenheiro puder enviar uma URL, relatar o sintoma e receber uma investigacao
auditavel com boa explicacao, ele percebera valor suficiente para reutilizar e
recomendar o produto.

Se o mesmo engenheiro puder gravar uma janela VOD, entregar o stream por uma URL
controlada a um device e observar como o ABR reage a condicoes reproduziveis de
rede, ele reduzira o tempo gasto montando laboratorios manuais e correlacionando
requests.

## North star

```text
Time to useful explanation
Time to reproducible playback evidence
```

O produto deve reduzir o tempo ate uma explicacao tecnicamente defensavel, nao
apenas aumentar a quantidade de dados exibidos.

## Diferenciais

- Evidencia antes de opiniao.
- Investigacao orientada pelo problema relatado.
- Progresso vivo e compreensivel.
- Correlacao entre camadas tecnicas.
- Relatorio claro, bonito e acionavel.
- Recording reutilizavel separado do experimento de delivery.
- Condicoes de rede explicitas e request evidence auditavel.

## Estrategia de implementacao

1. Criar um repositorio autonomo e focado.
2. Usar a stack ja dominada no Kael.
3. Copiar de forma controlada as partes uteis de Kael e VHS.
4. Manter tudo no mesmo projeto durante a validacao.
5. Extrair novamente bibliotecas apenas depois de uso real provar a fronteira.

## Fluxos atuais

```text
Investigate: URL -> explorer deterministico -> CTA explicito -> agentes -> hipoteses -> teste -> conclusao
Record:      URL HLS/DASH VOD -> media controlada + URL estavel para o teste
```

Qualidade ABR e uma dimensao permanente de Investigate, para HLS e DASH. Quando o
usuario relata um sintoma ABR, o sistema aprofunda e prioriza essa direcao; quando
nao relata, ainda avalia ladder, cobertura e riscos observaveis sem inventar
comportamento do player.

Record comecou por HLS VOD clear e agora estende a mesma fronteira
Recording/PlaybackRun para DASH VOD static clear.

## Limites

O MVP nao e uma plataforma de observabilidade completa. Watch, Replay, recording
live continuo, DRM e simulacao de device permanecem fora do corte atual. Record
controla a entrega da midia; o algoritmo ABR continua pertencendo ao player real.

## Criterios de produto

- Um novo usuario entende a acao principal sem onboarding.
- A tela responde imediatamente apos o clique.
- Eventos representam trabalho real.
- Achados citam evidencias.
- Confianca inclui limitacoes e contradicoes.
- Falhas sao explicadas e recuperaveis.
- O fluxo principal funciona em desktop e mobile.
- A URL de Record funciona fora da UI, em um player/device real.
- Troca ABR observada significa mudanca de variant/representation nos requests;
  decode e render so sao afirmados quando existir telemetria especifica.
