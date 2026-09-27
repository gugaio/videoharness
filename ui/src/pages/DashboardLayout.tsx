import { NavLink, Outlet } from "react-router-dom";
import { SessionControls } from "../auth/AuthControls";

const NAV_ITEMS = [
  { to: "/dashboard/boards", label: "Boards", hint: "Monitorar a saúde do streaming por SLA" },
  { to: "/dashboard/inspect", label: "Inspect", hint: "Inspecionar um stream (Stream Lens)" },
  { to: "/dashboard/streams/proxy", label: "Proxy", hint: "Reproduzir uma origem sem criar um clone" },
  { to: "/dashboard/streams/clones", label: "Clone", hint: "Criar e gerenciar clones no Stream Mock" },
  { to: "/dashboard/mcp", label: "MCP", hint: "Conectar seu agente com um token pessoal" },
  {
    to: "/dashboard/investigations",
    label: "Investigations",
    hint: "Em breve — investigação por agentes",
  },
] as const;

export default function DashboardLayout() {
  return (
    <div className="app">
      <aside className="sidebar">
        <NavLink to="/" className="brand">
          Video Harness
        </NavLink>
        <nav>
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              title={item.hint}
              className={({ isActive }) =>
                isActive ? "nav-item nav-item-active" : "nav-item"
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="main-col">
        <header className="topbar">
          <span className="topbar-title">Dashboard</span>
          <SessionControls />
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
