import { useEffect, useState, type FormEvent } from "react";
import { createMcpToken, listMcpTokens, revokeMcpToken, type McpToken } from "../api";

function message(error: unknown): string {
  return error instanceof Error ? error.message : "Não foi possível concluir a operação.";
}

export default function McpPage() {
  const [tokens, setTokens] = useState<McpToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [days, setDays] = useState(90);
  const [created, setCreated] = useState<{ id: string; secret: string } | null>(null);
  const [notice, setNotice] = useState("");
  const endpoint = `${window.location.origin}/api/mcp`;

  useEffect(() => {
    let live = true;
    listMcpTokens().then(({ tokens }) => { if (live) setTokens(tokens); })
      .catch((error: unknown) => { if (live) setError(message(error)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, []);

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await createMcpToken(name, days);
      setCreated({ id: result.token.id, secret: result.secret });
      setTokens((items) => [result.token, ...items]);
      setName("");
    } catch (error) { setError(message(error)); }
    finally { setBusy(false); }
  }

  async function revoke(token: McpToken) {
    if (!window.confirm(`Revogar “${token.name}”? O agente perderá acesso nas próximas chamadas.`)) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await revokeMcpToken(token.id);
      setTokens((items) => items.filter((item) => item.id !== token.id));
      if (created?.id === token.id) setCreated(null);
      setNotice("Token revogado.");
    } catch (error) { setError(message(error)); }
    finally { setBusy(false); }
  }

  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); setNotice("Copiado."); }
    catch { setNotice("Não foi possível copiar automaticamente. Selecione e copie o texto."); }
  }

  return (
    <div className="mcp-page">
      <section className="panel">
        <h2>Conecte seu agente</h2>
        <p>Use o MCP para criar inspeções, abrir investigações a partir de um baseline e solicitar capturas seletivas com orçamento.</p>
        <p>Configure seu cliente com transporte <strong>Streamable HTTP</strong> e autenticação por token Bearer.</p>
        <label htmlFor="mcp-endpoint">URL do servidor</label>
        <div className="mcp-copy-row">
          <input id="mcp-endpoint" readOnly value={endpoint} />
          <button type="button" onClick={() => void copy(endpoint)}>Copiar URL</button>
        </div>
        <p>Header de autenticação: <code>Authorization: Bearer SEU_TOKEN</code></p>
        <p className="panel-hint">O cliente precisa aceitar um token configurado manualmente. O token dá acesso às suas inspeções e às evidências adicionais que você solicitar.</p>
      </section>

      {error && <p role="alert" className="state-error">{error}</p>}
      <p role="status" aria-live="polite">{notice}</p>

      {created && <section className="panel mcp-secret">
        <h3>Copie seu token agora</h3>
        <p>Ele será exibido apenas nesta sessão da página. Guarde-o na configuração segura do seu agente.</p>
        <div className="mcp-copy-row">
          <input aria-label="Token gerado" readOnly value={created.secret} autoComplete="off" spellCheck={false} />
          <button type="button" onClick={() => void copy(created.secret)}>Copiar token</button>
        </div>
        <button type="button" onClick={() => { setCreated(null); setNotice(""); }}>Já guardei o token</button>
      </section>}

      <section className="panel">
        <h3>Gerar token</h3>
        <form className="mcp-form" onSubmit={(event) => void create(event)}>
          <label htmlFor="mcp-name">Nome do agente ou dispositivo</label>
          <input id="mcp-name" required maxLength={80} value={name} placeholder="Meu agente local" onChange={(event) => setName(event.target.value)} />
          <label htmlFor="mcp-expiry">Validade</label>
          <select id="mcp-expiry" value={days} onChange={(event) => setDays(Number(event.target.value))}>
            <option value={7}>7 dias</option><option value={30}>30 dias</option>
            <option value={90}>90 dias</option><option value={365}>1 ano</option>
          </select>
          <button type="submit" disabled={busy || loading || !name.trim() || created !== null}>{busy ? "Aguarde…" : "Gerar token"}</button>
          {created && <p className="panel-hint">Guarde e feche o token exibido antes de gerar outro.</p>}
        </form>
      </section>

      <section className="panel">
        <h3>Seus tokens</h3>
        {loading ? <p>Carregando…</p> : tokens.length === 0 ? <p>Nenhum token gerado.</p> :
          <ul className="mcp-token-list">{tokens.map((token) => <li key={token.id}>
            <div>
              <strong>{token.name}</strong> <code>{token.prefix}…</code>
              <p>{Date.parse(token.expires_at) <= Date.now() ? "Expirou" : "Expira"} em {new Date(token.expires_at).toLocaleDateString("pt-BR")} · Último uso: {token.last_used_at ? new Date(token.last_used_at).toLocaleString("pt-BR") : "nunca"}</p>
            </div>
            <button type="button" disabled={busy} onClick={() => void revoke(token)}>Revogar</button>
          </li>)}</ul>}
      </section>
    </div>
  );
}
