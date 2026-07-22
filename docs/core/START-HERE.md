# Start Here - Video Harness

Indice de onboarding para humanos e agentes.

## Leia primeiro

1. `AGENTS.md` - regras obrigatorias do repositorio.
2. `docs/planning/PROJECT-STATUS.md` - estado real e proximo passo.
3. `docs/architecture/phases/phase-1.md` - fase atualmente ativa.

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

- Fase ativa: **Fase 1 - Thin Slice Persistente**.
- Fase 0 concluida com API, worker, UI, PostgreSQL, migration e CI executaveis.
- Criacao, consulta e timeline SSE de investigacoes estao implementadas.
- Homepage cria o caso e navega para a primeira tela real da investigacao.
- Proximo passo: worker reclamar jobs e publicar lifecycle placeholder real.

## Referencias locais

Durante a extracao inicial, estas bases podem ser consultadas:

- Kael: `/home/gugaime/IA/kael`
- VHS: `/home/gugaime/IA/vhs`
- Referencia visual original: `/home/gugaime/Pictures/vhs.png`

Copie apenas o que contribui diretamente para o fluxo do MVP. Nao crie
dependencias relativas para esses diretorios.
