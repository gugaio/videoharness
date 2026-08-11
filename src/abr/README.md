# ABR quality

Modulo interno e independente de protocolo/plataforma para avaliar a qualidade
adaptativa de todo stream investigado. Fatos continuam deterministas; o
especialista de IA explica, prioriza lacunas e propoe a proxima medicao.

## Origem

Codigo novo deste repositorio, criado em 2026-08-08. Nenhum codigo foi importado
de Kael ou VHS e nao existe dependencia de runtime para repositorios vizinhos.

## Modelo

```text
HLS master ou DASH MPD
  -> ladder canonica
  -> regras deterministicas de topologia e consistencia
  -> especializacoes de transicao disponiveis
  -> AbrAssessment com verdict + coverage + findings + measurements
  -> ABR Quality Investigator (sempre)
```

`AbrAssessment` e a raiz publica do diagnostico: existe para HLS e DASH, mesmo
quando o usuario nao relata ABR. O relato apenas prioriza direcao, qualidades e
janela; nunca e transformado em telemetria.

`AbrSwitchEvidence` continua sendo a evidencia canonica de uma transicao e hoje
possui a especializacao mais profunda em DASH/fMP4. `URL_STATIC_ANALYSIS/CANDIDATE`
representa uma fronteira tecnicamente possivel. Somente o journal de um playback
run pode produzir `PLAYBACK_NETWORK_OBSERVED/OBSERVED`, que comprova selecao por
request, nao decode ou render. `AbrAssessment.transitions` guarda resumos
protocol-neutral; o detalhe DASH permanece sob `EvidenceBundle.dash.switches`.

Mudanca de resolucao, HEVC level, INIT ou SPS classificada como
`EXPECTED_RESOLUTION_SWITCH`/`EXPECTED_DECODER_RECONFIGURATION` e um fato neutro
do ABR. So vira risco quando outra evidencia demonstra contrato incompatível,
falha de decode, capability mismatch ou falha observada correlacionada.

## Estrutura

- `domain/assessment.ts`: raiz protocol-neutral, ladder, cobertura e verdict.
- `application/assess-stream-abr.ts`: regras gerais e selecao de prioridade sem
  resolucao, fabricante ou player fixos.
- `domain/evidence.ts`: evidencia detalhada de transicao e proveniencia.
- `application/analyze-dash-switch-candidates.ts`: especializacao DASH URL-only.
- `application/abr-switch-correlator.ts`: correlacao request-level observada.
- `application/timeline-normalizer.ts`: tfdt/DTS/PTS/PTO/Period em tempo comum.
- `application/init-semantic-diff.ts`: diff de INIT e VPS/SPS/PPS.
- `application/rules.ts`: regras detalhadas de authoring/transicao.
- `application/switch-matrix.ts`: matriz de seguranca entre representations.
- `application/run-decode-tests.ts`: testes A/B/C/D para a transicao prioritaria.
- `ports/abr-decode-tester.ts`: fronteira do decoder automatizado.
- `adapters/`: FFmpeg decode tests e integracao opcional DASH-IF.

Contexto do usuario pertence a `src/investigation/application`; `stream-tools`
nao conhece usuario, jobs, agentes, prompts ou produto.
