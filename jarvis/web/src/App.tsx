import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { get, onAuthLost, onMutation, post } from "./api";
import { LoginScreen, Logo, SetupScreen } from "./auth";
import { RedDialog } from "./red";
import { Badge, Button, cx, Loading } from "./ui";
import { Overview } from "./pages/Overview";
import { Operator } from "./pages/Operator";
import { Revenue } from "./pages/Revenue";
import { Pipeline } from "./pages/Pipeline";
import { Opportunities } from "./pages/Opportunities";
import { Approvals } from "./pages/Approvals";
import { Research } from "./pages/Research";
import { Memory } from "./pages/Memory";
import { Projects } from "./pages/Projects";
import { Operations } from "./pages/Operations";
import { Security } from "./pages/Security";
import { Settings } from "./pages/Settings";

export interface Me {
  displayName: string; sessionId: number; redActive: boolean; redUntil: string | null; killSwitch: boolean;
  performanceReview: string[]; llm: { available: boolean; model: string; reason: string | null };
}
interface Shell { me: Me; openRed: () => void; refreshMe: () => void; go: (r: string) => void }
const ShellCtx = createContext<Shell | null>(null);
export const useShell = () => useContext(ShellCtx)!;

const NAV: { id: string; label: string; icon: string; el: () => ReactNode }[] = [
  { id: "overview", label: "Overview", icon: "◎", el: () => <Overview /> },
  { id: "operator", label: "Operator", icon: "❯", el: () => <Operator /> },
  { id: "revenue", label: "Revenue", icon: "€", el: () => <Revenue /> },
  { id: "pipeline", label: "Pipeline", icon: "⇢", el: () => <Pipeline /> },
  { id: "opportunities", label: "Opportunities", icon: "◇", el: () => <Opportunities /> },
  { id: "approvals", label: "Approvals", icon: "✓", el: () => <Approvals /> },
  { id: "research", label: "Research", icon: "⌕", el: () => <Research /> },
  { id: "memory", label: "Memory", icon: "◈", el: () => <Memory /> },
  { id: "projects", label: "Projects", icon: "▤", el: () => <Projects /> },
  { id: "operations", label: "Operations", icon: "⚙", el: () => <Operations /> },
  { id: "security", label: "Security", icon: "⛨", el: () => <Security /> },
  { id: "settings", label: "Settings", icon: "≡", el: () => <Settings /> },
];

const routeFromHash = () => (location.hash.replace(/^#\/?/, "") || "overview").split("?")[0];

export function App() {
  const [phase, setPhase] = useState<"loading" | "setup" | "login" | "app">("loading");
  const check = useCallback(async () => {
    try {
      const s = await get<{ setup: { setupComplete: boolean }; authenticated: boolean }>("/api/status");
      setPhase(!s.setup.setupComplete ? "setup" : s.authenticated ? "app" : "login");
    } catch {
      setPhase("login");
    }
  }, []);
  useEffect(() => { void check(); }, [check]);
  useEffect(() => onAuthLost(() => setPhase("login")), []);
  if (phase === "loading") return <Loading />;
  if (phase === "setup") return <SetupScreen onDone={() => setPhase("login")} />;
  if (phase === "login") return <LoginScreen onDone={() => setPhase("app")} />;
  return <AppShell />;
}

function useCountdown(until: string | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!until) return;
    const h = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(h);
  }, [until]);
  if (!until) return null;
  const s = Math.max(0, Math.floor((Date.parse(until) - now) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function AppShell() {
  const [route, setRoute] = useState(routeFromHash());
  const [me, setMe] = useState<Me | null>(null);
  const [redOpen, setRedOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const refreshMe = useCallback(() => { get<Me>("/api/me").then(setMe).catch(() => undefined); }, []);
  useEffect(() => { refreshMe(); }, [refreshMe]);
  useEffect(() => onMutation(refreshMe), [refreshMe]);
  useEffect(() => {
    const h = () => { setRoute(routeFromHash()); setNavOpen(false); };
    window.addEventListener("hashchange", h);
    return () => window.removeEventListener("hashchange", h);
  }, []);
  const countdown = useCountdown(me?.redActive ? me.redUntil : null);
  useEffect(() => { if (me?.redActive && countdown === "0:00") refreshMe(); }, [countdown, me?.redActive, refreshMe]);

  if (!me) return <Loading />;
  const go = (r: string) => { location.hash = `/${r}`; };
  const page = NAV.find((n) => n.id === route) ?? NAV[0];

  return (
    <ShellCtx.Provider value={{ me, openRed: () => setRedOpen(true), refreshMe, go }}>
      <div className={cx("min-h-screen", me.redActive && "bg-[radial-gradient(ellipse_at_top,#e5484d14,transparent_60%)]")}>
        <aside className={cx("fixed inset-y-0 left-0 z-40 w-56 border-r border-line bg-[#0c111b] transition-transform lg:translate-x-0", navOpen ? "translate-x-0" : "-translate-x-full")}>
          <div className="flex h-14 items-center gap-2.5 border-b border-line px-4">
            <Logo size={28} />
            <span className="text-sm font-semibold tracking-[0.25em]">JARVIS</span>
          </div>
          <nav className="space-y-0.5 p-2" aria-label="Primary">
            {NAV.map((n) => (
              <a key={n.id} href={`#/${n.id}`} className={cx("flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm", route === n.id ? "bg-accent-soft text-ink" : "text-ink-2 hover:bg-panel hover:text-ink")}>
                <span aria-hidden className={cx("w-4 text-center", route === n.id ? "text-accent" : "text-muted")}>{n.icon}</span>
                {n.label}
              </a>
            ))}
          </nav>
        </aside>
        {navOpen && <div className="fixed inset-0 z-30 bg-black/60 lg:hidden" onClick={() => setNavOpen(false)} />}

        <div className="lg:pl-56">
          <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-bg/85 px-4 backdrop-blur">
            <button className="rounded-md p-1.5 text-ink-2 lg:hidden" aria-label="Open navigation" onClick={() => setNavOpen(true)}>☰</button>
            <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
              {me.redActive ? (
                <Badge tone="critical" className="red-glow tracking-[0.15em]">● RED PROTOCOL · {countdown}</Badge>
              ) : (
                <Badge tone="blue" className="tracking-[0.12em]">NORMAL MODE</Badge>
              )}
              {me.killSwitch && <Badge tone="critical">▲ KILL SWITCH ENGAGED</Badge>}
              {me.performanceReview.length > 0 && <a href="#/revenue"><Badge tone="serious">■ PERFORMANCE REVIEW · {me.performanceReview.join(", ")}</Badge></a>}
              {!me.llm.available && <Badge tone="neutral" className="hidden sm:inline-flex">LLM not configured</Badge>}
            </div>
            {me.redActive ? (
              <Button size="sm" variant="outline" onClick={() => post("/api/red/deactivate")}>Exit RED</Button>
            ) : (
              <Button size="sm" variant="danger" onClick={() => setRedOpen(true)} className="tracking-widest">RED</Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => post("/api/auth/logout").then(() => location.reload())}>Sign out</Button>
          </header>
          <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">{page.el()}</main>
        </div>
      </div>
      <RedDialog open={redOpen} onClose={() => { setRedOpen(false); refreshMe(); }} />
    </ShellCtx.Provider>
  );
}

/** Wraps a privileged action: prompts for RED when it is not active. */
export function useRedGate() {
  const { me, openRed } = useShell();
  return (fn: () => void) => (me.redActive ? fn() : openRed());
}
