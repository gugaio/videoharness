# UX.md

## Princípios

- **Top-down com progressive disclosure**: primeiro a visão macro; detalhes só após seleção. A tela nunca é uma página de textos, cards genéricos ou explicações geradas por IA.
- **Fatos antes de hipóteses**: mostrar o que existe no stream. Sem diagnóstico automático no MVP.
- **Uma única experiência para HLS e DASH**: mesma navegação, mesmo layout; diferenças de protocolo ficam em áreas próprias (painel contextual, `protocol_specific`).
- **Toda a UI é rastreável ao snapshot**: nada é exibido sem origem no JSON canônico.

## Hierarquia de navegação

```
Presentation → Manifest → Track group → Representation → Segment → Part → Container → Sample → Bitstream metadata
```

## Tela de inspeção (implementação atual)

1. Cabeçalho compacto: status, protocolo, fonte redacted, modo, volume capturado e
   quantidade de containers. Metadados de validade/versão não competem com a análise.
2. Superfície principal única, agrupada por tipo de mídia. Cada representação ocupa
   uma linha horizontal com identidade/resolução, bitrate relativo e a janela de
   segmentos no mesmo campo visual. Strings AVC (`avc1`/`avc3`) e HEVC
   (`hvc1`/`hev1`) continuam visíveis e ganham leitura adjacente de família,
   Profile e Level; em HEVC, o tier também é colorido na string. Hover ou foco no
   Profile explica as ferramentas de compressão e o uso típico; no Level, mostra
   um exemplo de resolução/frame rate e os limites de decoder envolvidos. Ambos
   deixam explícita a divisão de responsabilidades e que Level não mede qualidade.
3. Init, captura, falha e descontinuidade têm sinais visuais próprios. Segmentos com
   container são acionáveis por mouse ou teclado sem abrir antes uma tabela auxiliar.
4. A seleção expande abaixo da própria representação: breadcrumb curto
   representação → segmento → container, fatos do segmento e então a estrutura do
   container.
5. Antes da estrutura, o segmento mostra uma faixa horizontal de frames/samples
   fMP4 ou unidades PES TS. Largura e altura comunicam o tamanho relativo; a cor
   distingue quadro-chave (I/IDR/CRA), inter-frame (P/B) ou tipo não sinalizado.
   Cada bloco mostra PTS/DTS na escala disponível.
   fMP4 então mostra resumo e árvore de boxes; MPEG-TS mostra resumo e tabela de PIDs.
   `ffprobe` permanece separado e identificado como derivado.
6. Capabilities, dados específicos do protocolo e JSON bruto ficam recolhidos em
   “Dados técnicos e JSON”.

O detalhe aberto é exclusivo: selecionar um segmento em outra representação troca o
contexto em vez de acumular painéis. A estrutura e os samples só são renderizados
depois da seleção;
o snapshot continua sendo obtido pelo endpoint canônico único do MVP.

A decodificação de codec nesta fase é uma ajuda de leitura determinística sobre a
string declarada no manifesto. Ela cobre `avc1.PPCCLL`, `avc3.PPCCLL` e as formas
HEVC `hvc1`/`hev1` com profile, compatibilidade, tier e level; formatos não
reconhecidos permanecem crus, sem Profile/Level inferidos.

## Estados de tela

Carregamento, falha, **resultado parcial** (identificado como parcial, com erros por estágio), expiração (TTL), formato não suportado. Estados visíveis e distintos — parcial nunca se disfarça de completo.

## Requisitos não funcionais

- Desktop-first, responsivo até telas menores.
- Acessível por teclado; componentes acessíveis.
- Disclosure de listas grandes — resumo primeiro e renderização estrutural só após a
  seleção. Endpoint individual/lazy por container permanece evolução futura.

## Identidade visual

Identidade própria; evitar aparência genérica de cards prontos. SVG/Canvas/bibliotecas só quando melhorarem materialmente a visualização (ladder, timeline, árvore de boxes).
