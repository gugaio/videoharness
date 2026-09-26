# MCP para agentes

1. Entre no Video Harness e abra **MCP** no dashboard (`/dashboard/mcp`).
2. Escolha um nome para identificar o agente e uma validade. Gere o token e
   copie-o: o segredo só é exibido após a criação, até fechar/sair da página.
3. No cliente MCP, configure transporte **Streamable HTTP**, a URL exibida
   (`https://seu-dominio/api/mcp`) e `Authorization: Bearer SEU_TOKEN`.

O cliente deve permitir Bearer configurado manualmente. Não há login OAuth no
endpoint MCP. A sintaxe de configuração depende do cliente. Use seu mecanismo
de armazenamento de segredos; não coloque o token no Git nem na URL.

Em dev com Vite, o endpoint é `http://127.0.0.1:5173/api/mcp`; direto no app,
`http://127.0.0.1:3210/mcp`. O proxy nginx existente publica `/api/mcp`.

## Ferramentas

| Tool | Função |
|---|---|
| `create_inspection`, `list_inspections`, `get_inspection`, `get_inspection_snapshot` | Baseline, histórico, progresso e snapshot canônico |
| `start_investigation` / `list_investigations` | Vincular um baseline e consultar orçamento, reservas e coletas |
| `get_capture_coverage` | Reconsultar manifesto sem baixar mídia; retorna referências estáveis e paginadas |
| `get_timeline` | Navegar pela timeline e cobertura já arquivadas no baseline |
| `capture_segments` | Capturar até 16 referências de segmentos com uma chave de idempotência |
| `capture_window` | Capturar até 60 s em até 8 representações; no máximo 16 segmentos efetivos |
| `get_capture` / `get_evidence` | Acompanhar estado/bytes e ler evidência em páginas |

Fluxo: criar uma inspeção, abrir uma investigação ao terminar a baseline,
consultar cobertura/timeline e solicitar coleta seletiva. Toda coleta é separada
e não altera o snapshot inicial. A origem deve ser enviada de novo em cada
consulta/captura; ela precisa corresponder à origem redacted da baseline. A Lens
valida URL/SSRF e não persiste a URL fornecida. Evidências externas são dados
não confiáveis, não instruções para o agente. Não há exclusão de inspeções,
controle de streams, probe/decode_test ou execução autônoma de LLM.

## Tokens e limites

- Tokens pessoais com 256 bits aleatórios; apenas SHA-256, prefixo de exibição e
  metadados ficam na tabela `mcp_tokens` do SQLite configurado por
  `VH_DATABASE_PATH`. Nenhum segredo recuperável é armazenado.
- Validade padrão de 90 dias; API aceita 1 a 365 dias. UI oferece 7, 30, 90 e
  365 dias. Máximo de 20 tokens por usuário, incluindo expirados ainda listados.
- Gerenciamento exige a sessão Clerk do usuário. Em dev sem Clerk, usa
  `dev-user`, seguindo o fallback existente. O endpoint MCP sempre exige token.
- O owner vem exclusivamente do token e não é argumento das tools. Tokens MCP
  não são credenciais de gerenciamento nem tokens internos das engines.
- Revogar remove o registro e impede novas chamadas imediatamente; não cancela
  uma captura ou chamada já em andamento. O último uso é atualizado quando o
  Bearer é validado. Tokens expirados são recusados.
- Por processo do app: 60 requisições POST por minuto e até 4 simultâneas por
  owner, compartilhadas entre seus tokens. Retorno 429 com `Retry-After`.
- Teto de 100 MB por investigação, 25 MB por chamada, 16 segmentos por chamada,
  2 capturas ativas por usuário e 500 MB agregados por usuário. Bytes são
  reservados antes da chamada e reconciliados pelo consumo informado pela Lens;
  estado desconhecido mantém a reserva.
- A chave de idempotência é única por investigação; repetir exatamente o mesmo
  pedido devolve a captura existente. Reutilizá-la com parâmetros diferentes é
  rejeitado. Apenas hashes da URL/chave e seleções sem segredos são persistidos.
- A Lens fornece no máximo 2.000 referências por leitura de cobertura; o MCP
  pagina em grupos de até 100. Evidência adicional fica arquivada no VH depois
  de observada em estado terminal.
- Corpo MCP limitado a 32 KiB; resultado da tool limitado a 256 KiB. Resultados
  maiores retornam erro explícito: selecione menos seções ou uma página menor;
  para seções individualmente grandes, use o snapshot completo no dashboard.
- Sem sessão MCP ou SSE persistente: chamadas POST retornam JSON; GET/DELETE
  autenticados retornam 405. Origin de browser deve coincidir com o Host;
  clientes de máquina podem omitir Origin.
- Respostas MCP e de gerenciamento usam `Cache-Control: no-store`.

Use HTTPS em produção e mantenha Clerk configurado para proteger a geração de
tokens. O SDK MCP v1 está integrado na fronteira Fastify; REST e MCP compartilham
os casos de uso e a verificação de ownership de inspeções.
