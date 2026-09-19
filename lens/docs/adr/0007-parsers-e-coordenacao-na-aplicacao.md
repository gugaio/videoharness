# ADR-0007 — Coordenação na aplicação e parsers como módulos puros

Status: aceito · Data: 2026-09-19

## Contexto

O ADR-0002 colocou parsing e seleção de formatos em outbound por serem
substituíveis e processarem conteúdo obtido por I/O. Porém, essas operações
recebem texto/bytes já carregados e produzem modelos sem efeitos externos.
O usuário solicitou corrigir essa separação após a simplificação do layout.

## Decisão

- `DeclarativeManifestInspector` fica em `application/manifest_inspector.py`.
- `SniffingContainerAnalyzer` fica em `application/container_analyzer.py`.
- Os parsers HLS, DASH, fMP4 e MPEG-TS ficam em `parsers/`, com dependências
  no domínio e em bibliotecas de parsing; não importam aplicação ou adapters
  nem executam rede, leitura/escrita de arquivos ou subprocess.
- Os Protocols `ManifestInspector` e `ContainerAnalyzer` permanecem como
  contratos internos para injeção; não exigem implementações em outbound.
- ffprobe continua como adapter em `adapters/outbound/ffprobe.py`.
- A serialização de manifestos/containers usada pelo repositório fica em
  `adapters/outbound/filesystem/`, junto à persistência que a consome.
- Bootstrap e consumidores usam os novos imports, sem aliases de compatibilidade.

## Consequências

Supera somente a localização dos parsers definida no ADR-0002. Preserva as
bibliotecas e estratégias de parsing, contratos HTTP/CLI, schema/analyzer,
mensagens de erro e limites. Não muda fases nem acrescenta funcionalidades.
Importadores Python dos caminhos antigos precisam migrar. O serviço de captura
de segmentos continua com sua organização atual; esta decisão não declara
eliminado todo acoplamento preexistente entre aplicação e adapters.
