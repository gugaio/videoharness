# PROJECT_STATE.md

Fotografia concisa do estado atual. Atualizada ao final de cada fase. Histórico
arquitetural fica nos ADRs; histórico de mudanças no Git.

**Data**: 2026-09-06 · **Fase concluída**: 6 + extensão aprovada · **Produto
funcional**: ✅ v0.6 — captura limitada + inspeção estrutural fMP4/MPEG-TS,
visualização de frames/samples e metadados HDR (snapshot 1.4, analyzer 0.6.0)

## Entrega mais recente (extensão da Fase 6)

Materializar unidades temporizadas diretamente dos containers capturados e mostrá-las
em uma faixa horizontal no detalhe do segmento, usando tamanho e tipo visual sem
chamar unidades PES de frames quando o container não prova essa equivalência.

## Status atual

`analysis.samples` preserva até 1.000 samples fMP4 de `trun` ou unidades PES TS,
com tamanho, PTS/DTS, duração, timescale e sync quando disponível. A UI mostra cada
track/PID em uma linha horizontal, com largura/altura proporcionais ao tamanho e cor
para quadro-chave, inter-frame ou tipo não sinalizado.
O painel HDR da Fase 6 permanece contextual e `ffprobe` continua separado como dado
derivado.

## Entregas concluídas (extensão de samples)

- **fMP4**: registros de `trun`, defaults `tfhd`/`trex`, decode time `tfdt`,
  composition offset, sync flags e timescale do init da mesma representação.
- **MPEG-TS**: unidades PES observadas com tamanho de payload, PTS/DTS em 90 kHz e
  duração entre timestamps consecutivos da mesma PID.
- **Contrato/UI**: `ContainerSample`, schema 1.4/analyzer 0.6.0 e faixa horizontal
  responsiva com escala visual de tamanho, tempos visíveis e distinção sample/PES.
- **Limites**: no máximo 1.000 itens serializados por container; a flag
  `samples_truncated` e as contagens totais tornam o corte explícito.
- **Testes**: 123 testes backend e 31 frontend passam; lint, typecheck e build do
  frontend também passam.

## Objetivo da Fase 5

Inspecionar estruturalmente os segmentos capturados, preservando a distinção entre
fatos determinísticos dos bytes e metadados derivados por `ffprobe`, e permitir que
a UI navegue da timeline ao container sem esconder diferenças entre TS e fMP4.

## Status após a Fase 5

Após `capturing_segments`, inspeções entram em `inspecting_containers`. Cada segmento
capturado com sucesso gera um item `containers` no snapshot **schema 1.2**: fMP4 traz
árvore de boxes com offsets absolutos, tamanho e campos selecionados; MPEG-TS traz
sync, programas, PIDs, continuity counters, PCR e PES/PTS/DTS. Erro de um container
ou de `ffprobe` não derruba a inspeção. A captura continua limitada a **500MB** totais
e **20MB** por segmento por padrão (ambos configuráveis por env). DASH resolve
`SegmentTemplate` por `$Number$` e `$Time$`; `SegmentTimeline` aplica `S@t`, tempo
implícito e `S@r`, e `Representation/BaseURL` direto é capturável como segmento único.

## Entregas concluídas (Fase 6)

- **HDR determinístico**: parser de `stsd`/VisualSampleEntry e boxes `colr/nclx`,
  `mdcv` e `clli`; CICP, mastering display, MaxCLL e MaxFALL no snapshot.
- **HDR dinâmico observado**: detecção da assinatura HDR10+ em SEI prefix/suffix
  HEVC, em Annex B ou NAL length-prefixed; sem decodificar parâmetros por quadro.
- **Contrato/UI**: `HdrInfo`, serialização schema 1.3/analyzer 0.5.0, painel HDR
  contextual e propriedades de cor/side data derivadas do `ffprobe`.
- **Testes**: ausência de metadados, HDR10 estático, HLG, HDR10+, round-trip, UI e
  MPD com BOM/prefixo de namespace; 121 testes backend e 30 frontend passam.

## Entregas concluídas (Fase 5)

- **Domínio/contrato**: `BoxNode`, `Fmp4Info`, `TsInfo`, `TsPidStats`,
  `ContainerAnalysis` e `SegmentContainer`; schema 1.2 / analyzer 0.4.1.
- **Parsers determinísticos**: ISOBMFF/fMP4 para boxes relevantes, incluindo
  `ftyp/styp`, `moov/trak/mdhd`, `mvex/trex`, `moof/traf/tfhd/tfdt/trun`, `mdat` e
  `sidx`; MPEG-TS para pacotes 188, PAT/PMT, PIDs, CC, adaptation/PCR e PES.
- **Adapter opcional**: `FFprobeMediaProbe`, com argv fixo, sem shell e timeout; seu
  resultado entra como `probe` com proveniência `derived (ffprobe)`.
- **Integração**: port `ContainerAnalyzer`, analyzer por sniffing e nova etapa do
  caso de uso; serialização e round-trip completos, incluindo `probe`.
- **Frontend**: mapa top-down em linhas por representação, unindo ladder de bitrate e
  janela de segmentos; seleção do segmento expande o container no próprio contexto,
  com árvore de boxes ou tabela de PIDs e painel separado de ffprobe; metadados e JSON
  ficam recolhidos; strings `avc1`/`avc3` e `hvc1`/`hev1` exibem família, Profile e
  Level decodificados ao lado dos bytes correspondentes (HEVC também destaca tier),
  com explicações contextuais por hover/foco; download do snapshot canônico permanece
  no cabeçalho.
- **Fixtures/testes**: TS sintético com PAT/PMT/H.264/PES/PTS/PCR e fMP4 com init e
  fragmentos; testes dos parsers, truncamento, flags `tfhd`, serialização, integração
  das três combinações e ffprobe quando disponível.
- **Docs**: contrato 1.2, API, segurança, testes, README e roadmap atualizados.

## Decisões tomadas na fase

- Parser de container é estrutural e incremental; não há demux completo ou parser de
  codec próprio. A decisão permanece coerente com ADR-0002.
- Offsets de boxes são absolutos ao arquivo capturado, logo diretamente rastreáveis.
- A UI faz disclosure progressivo: representações, bitrate e segmentos formam a
  primeira visão; árvores/tabelas aparecem inline somente após a seleção de um
  segmento. Não há endpoint individual por container ainda; todos os dados estão no
  snapshot, suficiente para o volume limitado do MVP.
- `ffprobe` é complemento derivado e opcional, nunca fonte de verdade para a análise
  determinística e nunca motivo para falhar uma inspeção.

## Limitações conhecidas

- PSI TS multi-pacote e detalhes de todos os descritores não são demuxados; o suporte
  foca PAT/PMT simples e estatísticas necessárias à UI.
- A árvore fMP4 interpreta apenas a parte de HDR de VisualSampleEntry (`colr`, `mdcv`,
  `clli`); materializa a tabela estrutural dos samples, mas não decodifica seus
  payloads nem configurações gerais de codec, e limita a
  serialização a 64 filhos por nó; boxes malformados são preservados como
  truncados/erro quando possível.
- `ffprobe` pode recusar fragmentos sem init/sample entry; nesse caso `probe` é `null`.
- A lista detalhada é limitada a 1.000 itens por container. Em MPEG-TS, uma unidade
  PES pode carregar múltiplos access units e não é apresentada como frame; detectar
  frames TS exigiria parsing adicional de bitstream.
- A ajuda visual de Profile/Level cobre AVC compacto e HEVC `hvc1`/`hev1`; outros
  codec strings continuam visíveis sem interpretação adicional.
- Não há diagnóstico automático, inspeção de samples/bitstream completa, parsing de
  RPU Dolby Vision ou endpoint lazy por container. HDR10+ é apenas uma presença
  observada no segmento, não seus parâmetros por quadro.
- A expansão defensiva de `SegmentTimeline` para o snapshot é limitada a 10.000
  segmentos por representação; `r=-1` sem limite temporal conhecido materializa
  somente a primeira referência e gera aviso no manifesto.

## Próximo passo exato

**Fase 7** (mediante aprovação): skills e API para agentes, baseadas no schema 1.4 e
nos endpoints reais; catálogo versionado, exemplos verificáveis e evals.
