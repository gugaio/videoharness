# AGENTS.md — Instruções para agentes

Este arquivo contém instruções estáveis para qualquer agente (Codex, Claude, etc.) que trabalhe neste repositório.

## Início de sessão (obrigatório)

1. Leia `AGENTS.md` (este arquivo).
2. Leia `docs/PROJECT_STATE.md`.
3. Confira `docs/ROADMAP.md` para fases e gates.
4. Leia os ADRs em `docs/adr/` relevantes para a tarefa.
5. Inspecione o estado real do código e do Git (`git status`, `git log`).
6. Execute o menor teste que confirme a baseline antes de alterar código (ex.: `make test` ou subconjunto).

## Regras de trabalho

- **Trabalhe por fases.** Não avance para a fase seguinte sem aprovação explícita do usuário. Veja `docs/ROADMAP.md`.
- **Não antecipe funcionalidades** de fases posteriores, mesmo que pareçam fáceis.
- **Nunca afirme que um teste foi executado sem tê-lo executado de fato.** Reporte resultados reais.
- **Não faça commit, push, deploy ou alterações externas** sem solicitação explícita do usuário.
- **Não apague nem sobrescreva alterações do usuário.** Preserve trabalho existente não relacionado.
- Atualize a documentação (`docs/`, skills) **junto com o código**, no mesmo conjunto de mudanças.
- Atualize `docs/PROJECT_STATE.md` ao final de cada fase (fotografia concisa, não diário).
- Nenhum documento ou skill pode alegar capacidade que o código não implementa e testa.
- Segurança (SSRF, limites, redaction) é comportamento funcional, não etapa final.

## Arquitetura (resumo)

Arquitetura hexagonal leve. Detalhes em `docs/ARCHITECTURE.md` e ADRs.
Projeto Python na raiz (`src/`, `tests/`, `pyproject.toml`); executar
`make bootstrap`, `make test` e `make lint` neste diretório (ADR-0006).

- Dependências apontam para dentro.
- O domínio não importa FastAPI, filesystem, HTTP client ou subprocess.
- A aplicação coordena inspeções e seleciona parsers; `parsers/` contém
  transformações sem I/O, dependentes apenas do domínio e bibliotecas de parsing.
- `CapturePlan` e `SegmentCaptureService` são da aplicação (decisão e
  coordenação da captura, sem I/O); os adapters só buscam e persistem bytes via
  ports `ManifestFetcher`/`SegmentFetcher`/`SegmentStore` (ADR-0008).
- Fronteiras externas usam ports (`typing.Protocol`) implementados por adapters.
  Os Protocols de inspector/analyzer são contratos internos (ADR-0007).
- Composição explícita em um composition root; sem framework de DI no MVP.
- CLI e HTTP chamam os mesmos casos de uso.

## Contexto de produto

Stream Lens inspeciona streams (HLS/DASH; MPEG-TS/fMP4) e produz snapshots canônicos versionados. É independente do Stream Mock (integração apenas por URL/contratos HTTP). Diagnóstico automático e Video Harness são não objetivos do MVP. Veja `docs/PRODUCT.md`.
