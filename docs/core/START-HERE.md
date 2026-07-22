# Start Here - Video Harness

Indice de onboarding para humanos e agentes.

## Leia primeiro

1. `AGENTS.md` - regras obrigatorias do repositorio.
2. `docs/planning/PROJECT-STATUS.md` - estado real e proximo passo.
3. `docs/architecture/phases/phase-2.md` - proxima fase de implementacao.

## Produto

- `docs/product/PRD.md` - requisitos do MVP.
- `docs/planning/PROJECT-VISION.md` - visao e limites do produto.
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
- Fase ativa: **Fase 2 - Evidencia Deterministica**.
- A primeira fatia real coleta manifests HLS/DASH por uma fronteira protegida
  contra SSRF, persiste artifact + evidence bundle e gera report deterministico.
- Proximo passo: aprofundar o parsing do manifest e selecionar variants sem baixar
  segmentos ainda.

## Referencias locais

Durante a extracao inicial, estas bases podem ser consultadas:

- Kael: `/home/gugaime/IA/kael`
- VHS: `/home/gugaime/IA/vhs`
- Referencia visual original: `/home/gugaime/Pictures/vhs.png`

Copie apenas o que contribui diretamente para o fluxo do MVP. Nao crie
dependencias relativas para esses diretorios.
