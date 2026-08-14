# Start Here - Video Harness

Indice de onboarding para humanos e agentes.

## Leia primeiro

1. `AGENTS.md` - regras obrigatorias do repositorio.
2. `docs/planning/PROJECT-STATUS.md` - estado real e proximo passo.
3. `docs/architecture/phases/phase-record-dash-vod.md` - fase ativa.
4. `docs/planning/RECORD-ABR-IMPLEMENTATION-PLAN.md` - plano executavel de Record.

## Produto

- `docs/product/PRD.md` - requisitos do MVP.
- `docs/planning/PROJECT-VISION.md` - visao e limites do produto.
- `docs/planning/RECORD-ABR-IMPLEMENTATION-PLAN.md` - dominio, slices e DoD de
  Record HLS VOD e sequencia para DASH VOD.
- `docs/ui/UI-GUIDE.md` - experiencia desejada.

## Engenharia

- `docs/architecture/README.md` - arquitetura alvo e regras de dependencia.
- `docs/architecture/DECISIONS.md` - decisoes duradouras.
- `docs/architecture/phases/` - evolucao incremental.
- `docs/development/DEVELOPMENT-GUIDE.md` - convencoes de desenvolvimento.
- `docs/api.md` - contratos HTTP e SSE.

## Estado atual

- Fase 1 concluida: intake, worker recuperavel, timeline SSE e report funcionam de
  ponta a ponta sobre PostgreSQL.
- O worker usa claim transacional, lease, heartbeat e retry limitado.
- Homepage cria o caso e a tela restaura eventos e apresenta a conclusao.
- Fase ativa: **Record R2 - DASH VOD**.
- Um slice vertical de Experiments fecha o loop Investigation -> CloneSpec ->
  Recording -> teste real -> evaluation, sem substituir o Record existente.
- A linha Investigate continua funcional e auditavel; sua proxima reorganizacao
  visual fica pausada enquanto o primeiro slice Record e construido.
- Record materializa uma janela VOD das variants suportadas, publica uma URL
  fixa por recording e registra requests do device sob profiles de rede.
- DASH VOD Record usa o mesmo data plane/journal de HLS e ja correlaciona
  mudancas reais de Representation em `AbrSwitchEvidence` observado.
- Experiments usam uma unica `/streams/experiments/:experimentId/*` por device;
  a UI seleciona CONTROL/tratamento no servidor antes de cada replay e atribui o
  resultado ao TestRequest selecionado.
- A primeira fatia real coleta manifests HLS/DASH por uma fronteira protegida
  contra SSRF, persiste artifact + evidence bundle e gera report deterministico.
- Artifacts agora possuem identidade logica por investigation, sao registrados em
  lote e podem ser substituidos com seguranca em retries; novos reports usam o
  `EvidenceBundle` v2 orientado a multiplos manifests e media samples.
- Masters HLS agora expoem variants/renditions, selecionam uma variant por maior
  bandwidth e preservam seu media manifest e uma rendition de audio vinculada.
- A primeira amostra de media HLS ja baixa segmentos por playlist selecionada,
  preserva init segments quando necessarios e executa FFprobe local. O modo
  `full` (padrao) coleta uma janela contigua de ate 60s por variant, centrada no
  horario de incidente relatado quando existir; `sample` baixa apenas
  inicio/meio/fim.
- DASH trata switching como entidade de primeira classe. Com apenas a URL,
  Investigate gera candidatos explicitamente nao observados e analisa MPD,
  INIT/fMP4, HEVC IRAP/SAP e timeline; logs opcionais colados na descricao
  permanecem contexto relatado.
- Toda investigation HLS ou DASH produz um `AbrAssessment` com ladder, cobertura,
  verdict, findings e proximas medicoes. O especialista ABR roda sempre; o
  problema relatado orienta prioridade sem limitar o baseline.
- O primeiro corte Record valida HLS VOD MPEG-TS clear; live, DRM, LL-HLS e DASH
  Record ficam fora de R1.

## Referencias locais

Durante a extracao inicial, estas bases podem ser consultadas:

- Kael: `/home/gugaime/IA/kael`
- VHS: `/home/gugaime/IA/vhs`
- Referencia visual original: `/home/gugaime/Pictures/vhs.png`

Copie apenas o que contribui diretamente para o fluxo do MVP. Nao crie
dependencias relativas para esses diretorios.
