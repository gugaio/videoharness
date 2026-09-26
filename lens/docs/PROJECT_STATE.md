# PROJECT_STATE.md

Fotografia concisa do estado atual. Atualizada ao final de cada fase. Histórico
arquitetural fica nos ADRs; histórico de mudanças no Git.

**Data**: 2026-09-26 · **Fase concluída**: 6 + extensões aprovadas · **Produto
funcional**: ✅ v1.0 (headless, ADR-0005) — captura limitada + inspeção estrutural fMP4/MPEG-TS,
Timeline Health, matriz ABR, bitrate por segmento, visualização de frames/samples e HDR
(entrega HTTP/live, matriz ABR por sequência, configuração efetiva de bitstream/A/V
e DRM declarado no DASH; snapshot 1.14, analyzer 1.6.0). Extensão aprovada:
cobertura de segmentos e capturas suplementares por referência/janela, sem alterar
o snapshot baseline (ADR-0009).

## Mudança estrutural mais recente (parsers — ADR-0007)

Inspector de manifestos e analyzer de containers ficam em `application/`.
Os quatro parsers puros ficam em `parsers/`; ffprobe permanece adapter de
subprocess e serialização de manifestos/containers fica junto ao filesystem.
Contratos internos de injeção, HTTP/CLI e snapshots preservados. A mudança
supera a localização prevista no ADR-0002 e não avança a fase do produto.

`CapturePlan` também fica em `application/capture_plan.py` (ADR-0008): é estado
de decisão sem I/O. `SegmentCaptureService` fica em
`application/capture_service.py` e coordena a captura via ports; os adapters só
buscam (`SegmentFetcher`) e gravam (`FilesystemSegmentStore`) os bytes. A
leitura de playlist de mídia da captura vai para `parsers/hls_playlist.py`
(`m3u8` encapsulado).

Validação histórica da mudança de parsers: 171 testes da Lens passaram, Ruff e
mypy passaram (71 arquivos). Nesta extensão, `python3 -m compileall` passou;
`make test`/lint não puderam ser executados porque o checkout não tem
`lens/.venv` e o ambiente global não tem pytest/Ruff. A validação atual da
extensão está registrada ao final deste documento.

## Layout na raiz (ADR-0006)

Projeto Python na raiz: `src/`, `tests/`, pyproject, requirements e Dockerfile.
O diretório intermediário `backend/` e placeholders vazios foram removidos.
Makefile usa `dev`, `test` e `lint`; Compose standalone usa o serviço `api`.
CI e build do VH acompanham os novos caminhos. API, CLI e snapshot preservados.

Validação do layout: 167 testes passam; Ruff e mypy passam (68 arquivos).
A CLI inspeciona `fixture://hls-ts/master.m3u8` usando a descoberta padrão de
fixtures. Compose standalone e do VH passam em `docker compose config --quiet`.
Build da imagem não validado localmente: daemon Docker indisponível.

## Remoção do frontend (ADR-0005)

O frontend React foi removido; a Lens é um serviço headless (API FastAPI + CLI).
A visualização cabe aos clientes do snapshot canônico — no produto atual, o
orquestrador do Video Harness. Menções à UI nas seções abaixo são registro
histórico das entregas que as originaram. Validação desta mudança: suíte
backend completa, ruff + mypy e CLI exercitando o fluxo de inspeção.

## Correção mais recente (DTS de frames fMP4)

O adapter lê frames e pacotes na mesma execução e só copia DTS do pacote quando
stream e posição identificam uma relação um-para-um, com PTS original e tamanho
conferidos. Sem evidência suficiente, retorna null. A heurística por tamanho e
offset de composição foi removida. A proveniência é `derived (ffprobe packet)`;
os campos `packet_position` e `packet_pts` permitem auditar a associação.
Ver ADR-0004. No VH, a UI mantém PTS/DTS fora da barra proporcional de bytes e
não apresenta DTS legado como verificado.

## Aprimoramento mais recente (strings de codec de áudio)

As representações de áudio agora interpretam `mp4a.40.2` como AAC-LC, explicando
`mp4a`, o Object Type Indication `40` e o Audio Object Type `2`. `ac-3` e `ec-3`
também recebem nomes e tooltips próprios para Dolby Digital e Dolby Digital Plus,
sem inferir canais, Atmos, bitrate ou compatibilidade de device.

## Entrega mais recente (DRM 1 — manifesto DASH)

Cada `ContentProtection` do MPD agora preserva escopo, sistema, esquema, KIDs e um
resumo seguro do PSSH. A UI explica cada conceito e separa claramente sinalização
de manifesto de aquisição de licença e compatibilidade de device. O conteúdo PSSH
não é armazenado; somente validade, tamanho e hash são persistidos. HLS ficou fora
desta fase conforme o uso atual do produto.

## Entrega mais recente (O5 — Bitstream e sincronismo A/V)

Para cada segmento de mídia que o `ffprobe` lê, expõe a configuração efetiva de
vídeo e áudio (codec, profile, level, pixel format, geometria, frame rate, sample
rate e canais), as mudanças entre segmentos observados e o delta A/V por PTS de
apresentação dentro do mesmo container, com os PTS bruto/normalizado usados no
cálculo. Tudo é evidência derivada: não há conclusão sobre
compatibilidade de device, drift ou lipsync percebido pelo player.

## Entrega mais recente (extensão da Fase 6)

Enriquecer a faixa horizontal com `ffprobe -show_frames`, usando o init junto ao
fragmento fMP4 para obter a classificação I/P/B real do bitstream e resumir o GOP
observado, sem perder a visualização estrutural anterior quando a leitura derivada
não estiver disponível.

## Entrega mais recente (O1 — Timeline Health)

Medidas determinísticas por track/PID: PTS/DTS observáveis, duração dos bytes,
duração declarada e fronteira com o segmento anterior. Gaps, overlaps e ausência de
evidência são distintos na UI; não há diagnóstico automático.

## Entrega mais recente (O2 — Matriz ABR)

Compara rendições do mesmo grupo pela identidade canônica de segmento: `MEDIA-SEQUENCE`
no HLS e número disponível no DASH. A posição local da janela é fallback apenas
quando a sequência não existe. Janelas live diferentes ficam explícitas por contagem
de segmentos sem par; só a interseção alimenta duração e PTS de keyframe. A matriz
não declara compatibilidade de switching.

## Entrega mais recente (O3 — Bitrate por segmento)

Calcula bitrate da janela a partir de bytes baixados e duração por segmento; quando
as tracks do container não oferecem uma duração consistente, mostra o fallback da
duração declarada no manifesto. A UI resume média ponderada, mínimo, pico e a
relação com o bitrate declarado. Tamanho de frame/sample/PES fica explícito como
indicador de distribuição de payload, não como medição de complexidade ou qualidade.

## Entrega mais recente (O4 — Entrega HTTP e live)

Para cada resposta HTTP de segmento observada, preserva TTFB, tempo total,
throughput efetivo, status final, redirects e sinais de cache sem armazenar valores
sensíveis de headers. A leitura de playlist HLS live guarda sequence e janela; só
calcula a distância da borda quando `PROGRAM-DATE-TIME` permite, e declara que o
avanço não é mensurável com uma única leitura. Não é telemetria ou diagnóstico de
player.

**Validação atual**: suíte backend (pytest) e lint (ruff + mypy); sem suíte
frontend desde o ADR-0005 (contagens de frontend nas seções históricas
referem-se à UI removida).

## Captura incremental (ADR-0009)

`POST /coverage` resolve novamente o manifesto e devolve referências opacas sem
baixar mídia. Coletas adicionais aceitam referências ou janelas, aplicam limite
de até 16 segmentos e até 100 MB no endpoint da Lens, e guardam bytes/evidência
em `captures/<capture_id>/` sob a inspeção base. O snapshot canônico é imutável;
os artefatos herdam seu TTL. A URL é exigida de novo e validada contra a origem
redigida do baseline; ela não é persistida. O serviço Lens não autentica essas
rotas: deve permanecer somente na rede interna, com autorização/ownership no VH.

**Validação desta extensão (2026-09-26)**: `python3 -m compileall -q
lens/src/stream_lens` passou. `make test` e lint indisponíveis: o host não tem
`python3-venv`/`ensurepip`, então `make bootstrap` não conseguiu criar o ambiente;
pytest, Ruff e httpx também não estão no Python global. No VH, `npm test` passou
com 51 testes, `npm run check`, `npm --prefix ui run check` e `npm --prefix ui
run build` passaram. O build emitiu apenas o aviso do chunk maior que 500 kB.

## Status atual

`analysis.samples` preserva até 1.000 samples fMP4 de `trun` ou unidades PES TS,
com tamanho, PTS/DTS, duração, timescale e sync quando disponível. A UI mostra cada
track/PID em uma linha horizontal como fallback. Quando `probe.frames` está
disponível, a UI prefere os frames I, P e B reportados pelo decoder, com cor própria,
tamanho de pacote, PTS e DTS. Um resumo mostra ponto de acesso inicial, distribuição
I/P/B e intervalos entre keyframes em frames/segundos, distinguindo intervalos
completos de limites inferiores. O painel HDR da Fase 6 permanece contextual e todo
resultado do `ffprobe` continua separado e marcado como derivado.

## Entregas concluídas (extensões de visualização)

- **fMP4**: registros de `trun`, defaults `tfhd`/`trex`, decode time `tfdt`,
  composition offset, sync flags e timescale do init da mesma representação.
- **MPEG-TS**: unidades PES observadas com tamanho de payload, PTS/DTS em 90 kHz e
  duração entre timestamps consecutivos da mesma PID.
- **Contrato/UI (histórico)**: `ContainerSample`, `probe.frames`, schema 1.5/analyzer 0.7.0 e
  faixa horizontal responsiva com escala visual de tamanho, tempos visíveis e
  distinção I/P/B ou sample/PES no fallback.
- **Frames derivados**: `show_frames` limitado a 1.000 frames; fMP4 usa
  `init + fragmento` via stdin, enquanto TS é sondado diretamente.
- **GOP observado**: ponto de acesso no início, contagem I/P/B, pares de keyframes e
  trecho final incompleto; open/closed GOP não é inferido.
- **Limites**: no máximo 1.000 itens serializados por container; as flags
  `samples_truncated`/`frames_truncated` tornam o corte explícito; a entrada fMP4
  combinada do probe é limitada a 40 MiB.
- **Testes (na entrega anterior)**: 127 testes backend e 32 frontend passavam; a
  contagem atualizada fica registrada após a validação da extensão O1.

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
- `ffprobe` pode estar ausente, recusar bitstream inválido/protegido ou não produzir
  frames; nesse caso a UI usa os samples/PES estruturais. Um fragmento fMP4 recebe o
  init capturado da mesma representação quando disponível.
- A lista detalhada é limitada a 1.000 itens por container. Em MPEG-TS, uma unidade
  PES pode carregar múltiplos access units e só é apresentada como frame quando a
  leitura derivada do `ffprobe` fornece essa evidência.
- A ajuda visual cobre AVC compacto, HEVC `hvc1`/`hev1`, `mp4a.40[.AOT]`, `ac-3` e
  `ec-3`; outros codec strings continuam visíveis sem interpretação adicional.
- Não há diagnóstico automático, inspeção de samples/bitstream completa, parsing de
  RPU Dolby Vision ou endpoint lazy por container. HDR10+ é apenas uma presença
  observada no segmento, não seus parâmetros por quadro.
- O resumo de GOP mede keyframes observados; não classifica GOP aberto/fechado e usa
  `+` quando o próximo keyframe está fora do segmento ou do limite coletado.
- A expansão defensiva de `SegmentTimeline` para o snapshot é limitada a 10.000
  segmentos por representação; `r=-1` sem limite temporal conhecido materializa
  somente a primeira referência e gera aviso no manifesto.

## Próximo passo exato

**DRM 2** (mediante aprovação): inspecionar `sinf`/`schm`/`schi`/`tenc`/`pssh` nos
init segments fMP4 e comparar esquema, KID, IV e pattern encryption com o MPD.
