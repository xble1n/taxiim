import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  BarChart3,
  Bell,
  CircleDollarSign,
  ClipboardList,
  LayoutDashboard,
  Map as MapIcon,
  Menu,
  MessageSquare,
  MoreHorizontal,
  ScrollText,
  Search,
  Send,
  Settings,
  UserCog,
  Users,
  X,
  Car,
  Fuel,
  Wrench,
} from "lucide-react";
import { signOut } from "@/lib/auth/client";
import { UserButton } from "@/lib/auth/gates";
import {
  acknowledgeAlert,
  addAccount,
  callDriver,
  deletePrice,
  editAccount,
  getAccounts,
  getActivity,
  getAlerts,
  getChat,
  getDashboard,
  getFleet,
  getOrders,
  getPrices,
  getPulse,
  getReport,
  getSession,
  getSettings,
  logOutEvent,
  orderAction,
  putSettings,
  setDriverOffline,
  upsertPrice,
} from "@/lib/taxi/api";
import { ORDER_STATUSES, STATUS_LABEL, type OrderDto, type Role, type StaffDto } from "@/lib/taxi/logic";
import { clockTime, errText, eur, isFail, kmText, speedText, todayISO, todayLabel, when } from "@/lib/taxi/format";
import { buildEarningsPdf } from "@/lib/taxi/report-pdf";
import { ChatBox } from "./chat-box";
import { DispatchForm } from "./dispatch-form";
import { FleetMap } from "./map";
import { FleetCostPage, FuelPage, MaintenancePage, VehiclesPage } from "./fleet-pages";
import { Banner, BootScreen, Btn, Empty, Field, Logo, OrderPill, PageHead, Panel, PresencePill, Stat, fieldClass } from "./ui";

export const ADMIN_SECTIONS = [
  "dashboard",
  "map",
  "drivers",
  "dispatch",
  "orders",
  "chat",
  "prices",
  "accounts",
  "activity",
  "reports",
  "fleet",
  "vehicles",
  "fuel",
  "maintenance",
  "settings",
] as const;
export type AdminSection = (typeof ADMIN_SECTIONS)[number];

const NAV: Array<{ id: AdminSection; label: string; icon: typeof LayoutDashboard }> = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "map", label: "Live Map", icon: MapIcon },
  { id: "drivers", label: "Drivers", icon: Users },
  { id: "dispatch", label: "Dispatch", icon: Send },
  { id: "orders", label: "Orders", icon: ClipboardList },
  { id: "chat", label: "Chat", icon: MessageSquare },
  { id: "prices", label: "Prices", icon: CircleDollarSign },
  { id: "accounts", label: "Accounts", icon: UserCog },
  { id: "activity", label: "Activity", icon: ScrollText },
  { id: "reports", label: "Reports", icon: BarChart3 },
  { id: "fleet", label: "Fleet", icon: Car },
  { id: "vehicles", label: "Vehicles", icon: Car },
  { id: "fuel", label: "Fuel", icon: Fuel },
  { id: "maintenance", label: "Maintenance", icon: Wrench },
  { id: "settings", label: "Settings", icon: Settings },
];

const MOBILE_TABS: AdminSection[] = ["dashboard", "map", "orders", "drivers"];
const MORE_IDS: AdminSection[] = ["dispatch", "chat", "prices", "vehicles", "fuel", "maintenance", "reports", "fleet", "accounts", "activity", "settings"];

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

export function AdminApp({ section, driverId }: { section: AdminSection; driverId?: string }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const session = useQuery({ queryKey: ["session"], queryFn: () => getSession() });
  const pulse = useQuery({ queryKey: ["pulse"], queryFn: () => getPulse(), refetchInterval: 4000 });
  const [bell, setBell] = useState(false);
  const [more, setMore] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const now = useClock();
  const alerts = useQuery({ queryKey: ["alerts"], queryFn: () => getAlerts({ data: {} }), refetchInterval: 4000 });
  const meId =
    session.data && !isFail(session.data) && session.data.success && session.data.access === "ok"
      ? session.data.staff.id
      : undefined;
  const chat = useQuery({ queryKey: ["chat"], queryFn: () => getChat(), refetchInterval: 8000, enabled: Boolean(meId) });
  const fleetSearch = useQuery({ queryKey: ["fleet"], queryFn: () => getFleet(), enabled: searchOpen || more });
  const [chatTick, setChatTick] = useState(0);
  const [chatUnread, setChatUnread] = useState(0);
  useEffect(() => {
    const sync = () => setChatTick((n) => n + 1);
    window.addEventListener("taxiim-chat-seen", sync);
    return () => window.removeEventListener("taxiim-chat-seen", sync);
  }, []);
  useEffect(() => {
    if (!meId) return;
    const messages = chat.data && !isFail(chat.data) && chat.data.success ? chat.data.messages : [];
    let seen = "";
    try {
      seen = localStorage.getItem(`taxiim-chat:${meId}`) ?? "";
    } catch {
      seen = "";
    }
    setChatUnread(messages.filter((m) => m.senderId !== meId && m.createdAt > seen).length);
  }, [chat.data, chatTick, meId]);

  useEffect(() => {
    if (session.isError && /unauthorized/i.test(errText(session.error))) {
      void navigate({ to: "/login" });
    }
  }, [session.isError, session.error, navigate]);

  useEffect(() => {
    if (!session.data || isFail(session.data) || !session.data.success) return;
    if (session.data.access === "ok" && session.data.staff.role === "DRIVER") {
      void navigate({ to: "/drive", search: { s: "home" } });
    }
  }, [session.data, navigate]);

  useEffect(() => {
    setMore(false);
    setBell(false);
  }, [section]);

  if (session.isPending) return <BootScreen />;
  if (session.isError) {
    if (/unauthorized/i.test(errText(session.error))) return <BootScreen />;
    return (
      <div className="grid min-h-dvh place-items-center px-6">
        <Banner>{errText(session.error)}</Banner>
      </div>
    );
  }
  const data = session.data;
  if (!data || isFail(data) || !data.success) {
    return (
      <div className="grid min-h-dvh place-items-center px-6">
        <Banner>{isFail(data) ? data.message : "Could not open the session."}</Banner>
      </div>
    );
  }
  if (data.access !== "ok") {
    return (
      <div className="grid min-h-dvh place-items-center px-6">
        <div className="max-w-md space-y-4">
          <Logo className="h-8 w-auto" />
          <div>
            <h1 className="text-lg font-medium tracking-tight">No staff access</h1>
            <p className="mt-1 text-sm text-muted">{data.message}</p>
          </div>
        </div>
      </div>
    );
  }

  const pulseOk = pulse.data && !isFail(pulse.data) && pulse.data.success ? pulse.data : null;
  const alertRows = alerts.data && !isFail(alerts.data) && alerts.data.success ? alerts.data.alerts : [];
  const unread = alertRows.filter((a) => !a.acknowledged).length;
  const fill = section === "map" || section === "chat" || section === "dispatch";
  const needle = query.trim().toLowerCase();
  const searchDrivers =
    needle && fleetSearch.data && !isFail(fleetSearch.data) && fleetSearch.data.success
      ? fleetSearch.data.drivers
          .filter((driver) => `${driver.name} ${driver.plate} ${driver.driverCode ?? ""} ${driver.vehicle}`.toLowerCase().includes(needle))
          .slice(0, 6)
      : [];
  const searchSections = needle ? NAV.filter((item) => item.label.toLowerCase().includes(needle)).slice(0, 6) : [];
  const moreActive = MORE_IDS.includes(section);

  return (
    <div className="h-app flex max-w-full overflow-hidden bg-bg pt-[env(safe-area-inset-top)] text-fg">
      <aside className="desk-shell hidden w-60 shrink-0 flex-col border-r border-line bg-surface md:flex">
        <div className="border-b border-line px-5 py-5">
          <Logo className="h-8 w-auto" />
          <p className="mt-3 text-xs text-muted">Control center</p>
        </div>
        <nav className="flex-1 overflow-auto py-2">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = item.id === section;
            return (
              <Link
                key={item.id}
                to="/console"
                search={{ s: item.id }}
                onClick={() => {
                  setMore(false);
                  setSearchOpen(false);
                }}
                className={`mx-2 flex h-11 items-center gap-3 rounded-md border-l-2 px-3 text-sm ${active ? "border-accent bg-surface-2 text-fg" : "border-transparent text-muted hover:bg-surface-2 hover:text-fg"}`}
              >
                <Icon className="size-4" />
                {item.label}
                {item.id === "chat" && chatUnread > 0 ? <span className="ml-auto font-mono text-xs text-accent">{chatUnread}</span> : null}
              </Link>
            );
          })}
        </nav>
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center gap-2 overflow-hidden border-b border-line px-3 md:gap-3 md:px-4">
          <Logo className="logo-sm phone-only h-6 w-auto shrink-0 md:hidden" />
          <div className="desk-only min-w-0 flex-1">
            <p className="truncate text-sm">Welcome back, {data.staff.name}</p>
            <p className="truncate text-xs text-muted">{todayLabel(now)}</p>
          </div>
          <div className="phone-only flex min-w-0 flex-1 flex-col md:hidden">
            <p className="truncate text-sm">{data.staff.name}</p>
            <p className="truncate text-xs text-muted">Administrator</p>
          </div>
          <button
            type="button"
            className="desk-only grid size-11 shrink-0 place-items-center rounded-md border border-line"
            onClick={() => {
              setSearchOpen((v) => !v);
              setBell(false);
              setMore(false);
            }}
            aria-label="Search"
          >
            <Search className="size-4" />
          </button>
          <button type="button" className="relative grid size-11 shrink-0 place-items-center rounded-md border border-line" onClick={() => { setBell((v) => !v); setSearchOpen(false); setMore(false); }} aria-label="Notifications">
            <Bell className="size-4" />
            {unread > 0 ? <span className="absolute top-1 right-1 grid min-w-4 place-items-center bg-danger px-1 font-mono text-xs text-on-accent">{unread}</span> : null}
          </button>
          <div className="desk-only flex items-center gap-3">
            <span className="text-xs text-muted">Administrator</span>
            <UserButton />
          </div>
          <button
            type="button"
            className="desk-only inline-flex h-11 shrink-0 items-center rounded-md border border-line px-3 text-sm"
            onClick={() => {
              void logOutEvent().finally(() => signOut("/login").catch(() => toast.error("Could not log out. Try again.")));
            }}
          >
            Log out
          </button>
          <button
            type="button"
            className="phone-only grid size-11 shrink-0 place-items-center rounded-md border border-line md:hidden"
            aria-label={more ? "Close menu" : "Open menu"}
            aria-expanded={more}
            onClick={() => {
              setMore((v) => !v);
              setBell(false);
              setSearchOpen(false);
            }}
          >
            {more ? <X className="size-4" /> : <Menu className="size-4" />}
          </button>
        </header>
        {searchOpen ? (
          <div className="border-b border-line bg-surface px-3 py-3">
            <input
              className={fieldClass}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search drivers, plates, or sections"
              aria-label="Search the desk"
              autoFocus
            />
            {needle ? (
              <ul className="mt-2 max-h-64 overflow-auto">
                {searchSections.map((item) => (
                  <li key={item.id}>
                    <Link
                      to="/console"
                      search={{ s: item.id }}
                      className="flex h-11 items-center text-sm"
                      onClick={() => setSearchOpen(false)}
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
                {searchDrivers.map((driver) => (
                  <li key={driver.id}>
                    <Link
                      to="/console"
                      search={{ s: "map", driver: driver.id }}
                      className="flex h-11 items-center justify-between gap-2 text-sm"
                      onClick={() => setSearchOpen(false)}
                    >
                      <span>{driver.name}</span>
                      <span className="text-xs text-muted">{driver.plate || driver.driverCode}</span>
                    </Link>
                  </li>
                ))}
                {searchSections.length === 0 && searchDrivers.length === 0 ? <li className="py-2 text-sm text-muted">No matches.</li> : null}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-muted">Drivers, plates, and desk sections.</p>
            )}
          </div>
        ) : null}
        {bell ? (
          <div className="border-b border-line bg-surface px-4 py-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-medium">Alerts</p>
              <button type="button" onClick={() => setBell(false)} aria-label="Close alerts"><X className="size-4" /></button>
            </div>
            <ul className="max-h-56 space-y-2 overflow-auto">
              {alertRows.length === 0 ? <li className="text-sm text-muted">No alerts.</li> : null}
              {alertRows.slice(0, 8).map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-3 text-sm">
                  <span>
                    <span className={a.acknowledged ? "text-muted" : "text-fg"}>{a.title}</span>
                    <span className="text-muted"> · {when(a.createdAt)}</span>
                    <span className="block text-xs text-muted">{a.body}</span>
                  </span>
                  {a.acknowledged ? <span className="text-xs text-muted">Ack</span> : (
                    <button
                      type="button"
                      className="shrink-0 text-xs text-accent"
                      onClick={() => {
                        void acknowledgeAlert({ data: { alertId: a.id } }).then(() => {
                          void qc.invalidateQueries({ queryKey: ["alerts"] });
                          void qc.invalidateQueries({ queryKey: ["dashboard"] });
                        });
                      }}
                    >
                      Acknowledge
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <main className={fill ? "flex min-h-0 flex-1 flex-col overflow-hidden" : "min-h-0 flex-1 overflow-auto p-3 md:p-4"}>
          {section === "dashboard" ? <Dashboard meId={data.staff.id} /> : null}
          {section === "map" ? <div className="min-h-0 flex-1"><LiveMap focusId={driverId} /></div> : null}
          {section === "drivers" ? <Drivers focusId={driverId} /> : null}
          {section === "dispatch" ? <Dispatch presetDriverId={driverId} /> : null}
          {section === "orders" ? <Orders /> : null}
          {section === "chat" ? (
            <div className="h-full min-h-0 p-3 md:p-4">
              <Panel title="Group chat" className="h-full">
                <ChatBox meId={data.staff.id} />
              </Panel>
            </div>
          ) : null}
          {section === "prices" ? <Prices /> : null}
          {section === "accounts" ? <Accounts selfId={data.staff.id} /> : null}
          {section === "activity" ? <Activity /> : null}
          {section === "reports" ? <Reports /> : null}
          {section === "fleet" ? <FleetCostPage /> : null}
          {section === "vehicles" ? <VehiclesPage /> : null}
          {section === "fuel" ? <FuelPage /> : null}
          {section === "maintenance" ? <MaintenancePage /> : null}
          {section === "settings" ? <SettingsPage operatorName={data.staff.name} /> : null}
        </main>
        <footer className="desk-shell hidden min-h-10 shrink-0 items-center gap-3 overflow-x-auto border-t border-line px-3 font-mono text-xs text-muted tabular-nums md:flex">
          <span className="shrink-0">{clockTime(now)}</span>
          <span className="shrink-0">{pulseOk?.weather ?? "Weather unavailable"}</span>
          <span className="shrink-0">{pulseOk?.online ?? "—"} online</span>
          <span className="shrink-0">{pulseOk?.onRide ?? "—"} on ride</span>
          <span className="shrink-0">{pulseOk?.activeOrders ?? "—"} active</span>
          <span className="shrink-0">{pulseOk ? `${kmText(pulseOk.kmToday)} km today` : "— km"}</span>
          <span className={`sticky right-0 shrink-0 bg-bg px-2 ${pulse.isError ? "text-danger" : "text-ok"}`}>{pulse.isError ? "DEGRADED" : "OPERATIONAL"}</span>
        </footer>
        {more ? (
          <div className="phone-sheet fixed inset-0 z-[700] items-end md:hidden">
            <button type="button" className="absolute inset-0 bg-black/60" aria-label="Close menu" onClick={() => setMore(false)} />
            <div className="relative flex max-h-[min(78dvh,36rem)] w-full flex-col overflow-hidden rounded-t-lg border border-line bg-surface pb-[env(safe-area-inset-bottom)]">
              <div className="flex h-12 shrink-0 items-center justify-between border-b border-line px-4">
                <p className="text-sm font-medium">Menu</p>
                <button type="button" className="grid size-11 place-items-center" onClick={() => setMore(false)} aria-label="Close menu">
                  <X className="size-4" />
                </button>
              </div>
              <div className="shrink-0 border-b border-line px-3 py-3">
                <input
                  className={fieldClass}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search drivers, plates, or sections"
                  aria-label="Search the desk"
                />
                {needle ? (
                  <ul className="mt-2 max-h-40 overflow-auto">
                    {searchSections.map((item) => (
                      <li key={item.id}>
                        <Link to="/console" search={{ s: item.id }} className="flex h-11 items-center text-sm" onClick={() => setMore(false)}>
                          {item.label}
                        </Link>
                      </li>
                    ))}
                    {searchDrivers.map((driver) => (
                      <li key={driver.id}>
                        <Link to="/console" search={{ s: "map", driver: driver.id }} className="flex h-11 items-center justify-between gap-2 text-sm" onClick={() => setMore(false)}>
                          <span className="truncate">{driver.name}</span>
                          <span className="text-xs text-muted">{driver.plate || driver.driverCode}</span>
                        </Link>
                      </li>
                    ))}
                    {searchSections.length === 0 && searchDrivers.length === 0 ? <li className="py-2 text-sm text-muted">No matches.</li> : null}
                  </ul>
                ) : null}
              </div>
              <nav className="min-h-0 flex-1 overflow-auto py-1">
                {NAV.map((item) => {
                  const Icon = item.icon;
                  const active = section === item.id;
                  return (
                    <Link
                      key={item.id}
                      to="/console"
                      search={{ s: item.id }}
                      onClick={() => setMore(false)}
                      className={`mx-2 flex h-12 items-center gap-3 rounded-md px-3 text-sm ${active ? "bg-accent text-on-accent" : "text-fg"}`}
                    >
                      <Icon className="size-4 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      {item.id === "chat" && chatUnread > 0 ? <span className="font-mono text-xs">{chatUnread}</span> : null}
                    </Link>
                  );
                })}
              </nav>
              <button
                type="button"
                className="flex h-12 shrink-0 items-center border-t border-line px-5 text-sm text-muted"
                onClick={() => {
                  void logOutEvent().finally(() => signOut("/login").catch(() => toast.error("Could not log out. Try again.")));
                }}
              >
                Log out
              </button>
            </div>
          </div>
        ) : null}
        <nav className="phone-nav grid shrink-0 grid-cols-5 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
          {MOBILE_TABS.map((id) => {
            const item = NAV.find((entry) => entry.id === id);
            if (!item) return null;
            const Icon = item.icon;
            const active = section === id;
            return (
              <Link
                key={id}
                to="/console"
                search={{ s: id }}
                onClick={() => setMore(false)}
                className={`flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] ${active ? "text-accent" : "text-muted"}`}
              >
                <Icon className="size-5" />
                {item.label === "Live Map" ? "Map" : item.label}
              </Link>
            );
          })}
          <button
            type="button"
            className={`flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] ${more || moreActive ? "text-accent" : "text-muted"}`}
            onClick={() => setMore((v) => !v)}
          >
            <MoreHorizontal className="size-5" />
            More
          </button>
        </nav>
      </div>
    </div>
  );
}

function Dashboard({ meId }: { meId: string }) {
  const dash = useQuery({ queryKey: ["dashboard"], queryFn: () => getDashboard(), refetchInterval: 4000 });
  const prices = useQuery({ queryKey: ["prices"], queryFn: () => getPrices() });
  const [selected, setSelected] = useState<string | null>(null);
  if (dash.isPending) return <p className="text-sm text-muted">Loading the desk…</p>;
  if (dash.isError || !dash.data || isFail(dash.data) || !dash.data.success) {
    return <Banner>{isFail(dash.data) ? dash.data.message : errText(dash.error)}</Banner>;
  }
  const d = dash.data;
  const priceRows = prices.data && !isFail(prices.data) && prices.data.success ? prices.data.prices : [];
  const online = d.drivers.filter((driver) => driver.presence !== "OFFLINE");
  function ring(id: string) {
    void callDriver({ data: { driverId: id } }).then((res) => {
      if (isFail(res)) toast.error(res.message);
      else toast.success("Ring sent to that driver only.");
    });
  }
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-3 md:hidden">
        <Stat label="Active taxis" value={d.onRide} />
        <Stat label="Online drivers" value={d.online} />
        <Stat label="On-road orders" value={d.activeOrders} />
        <Stat label="Pending" value={d.pendingOrders} />
        <Stat label="Alerts" value={d.alerts} className="col-span-2 sm:col-span-1" />
      </div>
      <div className="hidden grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line md:grid xl:grid-cols-5">
        <Stat label="Total drivers" value={d.drivers.length} />
        <Stat label="Online" value={d.online} />
        <Stat label="Offline" value={d.offline} />
        <Stat label="On ride" value={d.onRide} />
        <Stat label="Active orders" value={d.activeOrders} />
      </div>
      <div className="hidden grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line md:grid xl:grid-cols-5">
        <Stat label="Vehicles" value={d.vehicles} />
        <Stat label="Available" value={d.available} />
        <Stat label="In shop" value={d.inShop} />
        <Stat label="Out of service" value={d.outOfService} />
        <Stat label="Service due" value={d.serviceDue} className="max-xl:col-span-2" />
      </div>
      <div className="hidden grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line md:grid xl:grid-cols-5">
        <Stat label="Pending" value={d.pendingOrders} />
        <Stat label="Completed today" value={d.completedToday} />
        <Stat label="Cancelled today" value={d.cancelledToday} />
        <Stat label="Fuel today" value={eur(d.fuelCostToday)} hint={`${d.fuelLitersToday} L`} />
        <Stat label="Fuel this month" value={eur(d.fuelCostMonth)} hint={`${eur(d.maintCostMonth)} repairs · ${d.repairsMonth}`} className="max-xl:col-span-2" />
      </div>
      <div className="grid gap-3 lg:grid-cols-5">
        <Panel title="Live fleet map" className="h-[min(52dvh,28rem)] md:h-96 lg:col-span-3">
          <FleetMap drivers={d.drivers} selectedId={selected} onSelect={setSelected} base={d.base} defaultMode="satellite" />
        </Panel>
        <Panel title="Drivers" className="md:h-96 md:overflow-auto lg:col-span-2">
          {d.drivers.length === 0 ? <Empty title="No drivers" body="Create a driver account to put a taxi on the map." /> : null}
          <ul className="md:hidden">
            {d.drivers.map((driver) => (
              <li key={driver.id} className="border-b border-line p-3">
                <button type="button" className="w-full text-left" onClick={() => setSelected(driver.id)}>
                  <span className="flex items-start justify-between gap-2">
                    <span>
                      <span className="block text-sm font-medium">{driver.name}</span>
                      <span className="text-xs text-muted">{driver.vehicle || "No vehicle"} · {driver.plate || "No plate"}</span>
                    </span>
                    <PresencePill presence={driver.presence} />
                  </span>
                  <span className="mt-2 grid grid-cols-3 gap-2 font-mono text-xs tabular-nums text-muted">
                    <span>{speedText(driver.speedKmh)} km/h</span>
                    <span>{kmText(driver.todayKm)} km</span>
                    <span>{driver.presence === "OFFLINE" ? "No live fix" : driver.gpsStale ? "GPS stale" : "Live"}</span>
                  </span>
                </button>
                <span className="mt-3 flex gap-2">
                  <Link to="/console" search={{ s: "map", driver: driver.id }} className="inline-flex h-11 flex-1 items-center justify-center rounded-md border border-line text-sm">Map</Link>
                  <button type="button" className="h-11 flex-1 rounded-md bg-accent text-sm font-medium text-on-accent" onClick={() => ring(driver.id)}>Ring</button>
                </span>
              </li>
            ))}
          </ul>
          <ul className="hidden md:block">
            {online.length === 0 ? <li className="px-3 py-6 text-sm text-muted">No drivers online.</li> : null}
            {online.map((driver) => (
              <li key={driver.id}>
                <button type="button" className="flex w-full items-center justify-between gap-2 border-b border-line px-3 py-2 text-left hover:bg-surface-2" onClick={() => setSelected(driver.id)}>
                  <span>
                    <span className="block text-sm">{driver.name}</span>
                    <span className="text-xs text-muted">{driver.driverCode} · {driver.vehicle} · {driver.plate}</span>
                  </span>
                  <span className="text-right font-mono text-xs tabular-nums">
                    <PresencePill presence={driver.presence} />
                    <span className="mt-1 block text-muted">{speedText(driver.speedKmh)} km/h · {kmText(driver.todayKm)} km</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
      <div className="grid gap-3 xl:grid-cols-4">
        <Panel title="Recent activity" className="max-h-96 overflow-auto">
          {d.activity.length === 0 ? <Empty title="No activity yet" body="Dispatches, logins and price changes land here." /> : null}
          <ul>
            {d.activity.map((a) => (
              <li key={a.id} className="border-b border-line px-3 py-2">
                <p className="text-sm">{a.description}</p>
                <p className="text-xs text-muted">{when(a.createdAt)}</p>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Quick dispatch" className="h-96">
          <div className="taxi-scroll h-full p-3">
            <DispatchForm drivers={d.drivers} prices={priceRows} />
          </div>
        </Panel>
        <Panel title="Alerts" className="max-h-96 overflow-auto">
          {d.recentAlerts.length === 0 ? <Empty title="No alerts" body="Rings, speed and GPS warnings show up here." /> : null}
          <ul>
            {d.recentAlerts.map((a) => (
              <li key={a.id} className="border-b border-line px-3 py-2">
                <p className="text-sm">{a.title}</p>
                <p className="text-xs text-muted">{a.body}</p>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Group chat" className="max-h-96">
          <ChatBox meId={meId} compact />
        </Panel>
      </div>
    </div>
  );
}

function LiveMap({ focusId }: { focusId?: string }) {
  const fleet = useQuery({ queryKey: ["fleet"], queryFn: () => getFleet(), refetchInterval: 2000 });
  const orders = useQuery({ queryKey: ["orders", "live"], queryFn: () => getOrders({ data: {} }), refetchInterval: 2000 });
  const [selected, setSelected] = useState<string | null>(focusId ?? null);
  const [tracking, setTracking] = useState(false);
  useEffect(() => {
    if (focusId) setSelected(focusId);
  }, [focusId]);
  if (fleet.isPending) return <p className="p-4 text-sm text-muted">Loading map…</p>;
  if (!fleet.data || isFail(fleet.data) || !fleet.data.success) return <div className="p-4"><Banner>{isFail(fleet.data) ? fleet.data.message : "Map data failed."}</Banner></div>;
  const driver = fleet.data.drivers.find((d) => d.id === selected) ?? null;
  const open = orders.data && !isFail(orders.data) && orders.data.success ? orders.data.orders : [];
  const ride = driver ? open.find((order) => order.driverId === driver.id && ["DISPATCHED", "ACCEPTED", "ON_THE_WAY", "ARRIVED", "IN_PROGRESS"].includes(order.status)) : undefined;
  return (
    <div className="relative h-full">
      <FleetMap drivers={fleet.data.drivers} selectedId={selected} onSelect={(id) => { setSelected(id); setTracking(true); }} base={fleet.data.base} defaultMode="satellite" tracking={tracking} />
      {driver ? <DriverCard driver={driver} ride={ride} tracking={tracking} onTrack={() => setTracking((value) => !value)} onClose={() => { setSelected(null); setTracking(false); }} /> : null}
    </div>
  );
}

function DriverCard({ driver, ride, tracking, onTrack, onClose }: { driver: StaffDto; ride?: OrderDto; tracking: boolean; onTrack: () => void; onClose: () => void }) {
  return (
    <aside className="absolute top-14 left-3 w-[min(18rem,calc(100%-1.5rem))] rounded-lg border border-line bg-surface p-4 sm:top-3" style={{ zIndex: 500 }}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium">{driver.name}</p>
          <p className="text-xs text-muted">{driver.driverCode} · {driver.vehicle} · {driver.plate}</p>
        </div>
        <button type="button" className="grid size-11 shrink-0 place-items-center" onClick={onClose} aria-label="Close driver"><X className="size-4" /></button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <PresencePill presence={driver.presence} />
        {driver.presence === "OFFLINE" ? <span className="text-xs text-muted">Last known</span> : null}
        {driver.gpsStale ? <span className="text-xs text-warn">GPS stale</span> : null}
        {driver.presence !== "OFFLINE" && !driver.gpsStale && driver.lastGpsAt ? <span className="text-xs text-ok">Live</span> : null}
        {driver.presence !== "OFFLINE" && !driver.lastGpsAt ? <span className="text-xs text-warn">No GPS yet</span> : null}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 font-mono text-xs tabular-nums">
        <div><dt className="text-muted">Speed</dt><dd>{speedText(driver.speedKmh)} km/h</dd></div>
        <div><dt className="text-muted">Heading</dt><dd>{driver.heading == null ? "—" : `${Math.round(driver.heading)}°`}</dd></div>
        <div><dt className="text-muted">Today</dt><dd>{kmText(driver.todayKm)} km</dd></div>
        <div><dt className="text-muted">Yesterday</dt><dd>{kmText(driver.yesterdayKm)} km</dd></div>
        <div><dt className="text-muted">7 days</dt><dd>{kmText(driver.weekKm)} km</dd></div>
        <div><dt className="text-muted">Month</dt><dd>{kmText(driver.monthKm)} km</dd></div>
        <div><dt className="text-muted">Accuracy</dt><dd>{driver.accuracyM == null ? "—" : `${Math.round(driver.accuracyM)} m`}</dd></div>
        <div><dt className="text-muted">Last GPS</dt><dd>{driver.lastGpsAt ? when(driver.lastGpsAt) : "Never"}</dd></div>
        <div className="col-span-2"><dt className="text-muted">Position</dt><dd>{driver.latitude == null || driver.longitude == null ? "No fix yet" : `${driver.latitude.toFixed(5)}, ${driver.longitude.toFixed(5)}`}</dd></div>
        <div className="col-span-2"><dt className="text-muted">Current order</dt><dd>{ride ? `${ride.code} · ${ride.source === "DIRECT" ? "Direct" : "Desk"} · ${STATUS_LABEL[ride.status]}` : "None"}</dd></div>
      </dl>
      <div className="mt-3 flex gap-2">
        <button type="button" className="h-11 flex-1 rounded-md bg-accent text-sm font-medium text-on-accent" onClick={onTrack}>{tracking ? "Stop tracking" : "Track driver"}</button>
        <Link to="/console" search={{ s: "dispatch", driver: driver.id }} className="inline-flex h-11 flex-1 items-center justify-center rounded-md border border-line text-sm">Dispatch</Link>
      </div>
    </aside>
  );
}

function Drivers({ focusId }: { focusId?: string }) {
  const qc = useQueryClient();
  const fleet = useQuery({ queryKey: ["fleet"], queryFn: () => getFleet(), refetchInterval: 4000 });
  const orders = useQuery({ queryKey: ["orders", "desk"], queryFn: () => getOrders({ data: {} }), refetchInterval: 8000 });
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(focusId ?? null);
  const [password, setPassword] = useState("");
  useEffect(() => {
    if (focusId) setSelected(focusId);
  }, [focusId]);
  if (fleet.isPending) return <p className="text-sm text-muted">Loading drivers…</p>;
  if (!fleet.data || isFail(fleet.data) || !fleet.data.success) return <Banner>{isFail(fleet.data) ? fleet.data.message : "Could not load drivers."}</Banner>;
  const rows = fleet.data.drivers.filter((d) => {
    const hay = `${d.name} ${d.plate} ${d.driverCode ?? ""} ${d.vehicle}`.toLowerCase();
    return hay.includes(q.trim().toLowerCase());
  });
  const orderRows = orders.data && !isFail(orders.data) && orders.data.success ? orders.data.orders : [];
  const current = selected ? rows.find((d) => d.id === selected) ?? fleet.data.drivers.find((d) => d.id === selected) : null;
  const mine = current ? orderRows.filter((o) => o.driverId === current.id).slice(0, 6) : [];
  async function ring(id: string) {
    const res = await callDriver({ data: { driverId: id } });
    if (isFail(res) || !res.success) toast.error(isFail(res) ? res.message : "Ring failed.");
    else toast.success(res.message);
    void qc.invalidateQueries({ queryKey: ["alerts"] });
    void qc.invalidateQueries({ queryKey: ["activity"] });
  }
  async function offline(id: string) {
    const res = await setDriverOffline({ data: { driverId: id } });
    if (isFail(res) || !res.success) toast.error(isFail(res) ? res.message : "Could not update presence.");
    else toast.success("Driver set offline.");
    void qc.invalidateQueries({ queryKey: ["fleet"] });
    void qc.invalidateQueries({ queryKey: ["pulse"] });
  }
  async function setAccount(id: string, status: "ACTIVE" | "DISABLED") {
    const res = await editAccount({ data: { id, status } });
    if (isFail(res) || !res.success) toast.error(isFail(res) ? res.message : "Could not update the account.");
    else toast.success(status === "ACTIVE" ? "Driver activated." : "Driver deactivated.");
    void qc.invalidateQueries({ queryKey: ["fleet"] });
    void qc.invalidateQueries({ queryKey: ["accounts"] });
  }
  async function resetPassword(id: string) {
    const res = await editAccount({ data: { id, password } });
    if (isFail(res) || !res.success) toast.error(isFail(res) ? res.message : "Password was not changed.");
    else {
      toast.success("Password updated.");
      setPassword("");
    }
  }
  return (
    <div className="space-y-3">
      <PageHead title="Drivers">
        <input className={`${fieldClass} w-56`} placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
      </PageHead>
      <div className="overflow-auto rounded-lg border border-line">
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead className="bg-surface text-xs text-muted">
            <tr>
              <th className="px-3 py-2 font-medium">Driver</th>
              <th className="px-3 py-2 font-medium">Vehicle</th>
              <th className="px-3 py-2 font-medium">Plate</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Speed</th>
              <th className="px-3 py-2 font-medium">Today km</th>
              <th className="px-3 py-2 font-medium">Order</th>
              <th className="px-3 py-2 font-medium">GPS</th>
              <th className="px-3 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => {
              const ride = orderRows.find((o) => o.driverId === d.id && ["DISPATCHED", "ACCEPTED", "ON_THE_WAY", "ARRIVED", "IN_PROGRESS"].includes(o.status));
              return (
                <tr key={d.id} className="border-t border-line">
                  <td className="px-3 py-2">
                    <div className="font-medium">{d.name}</div>
                    <div className="text-xs text-muted">{d.driverCode}</div>
                  </td>
                  <td className="px-3 py-2">{d.vehicle || "—"}</td>
                  <td className="px-3 py-2 font-mono text-xs">{d.plate || "—"}</td>
                  <td className="px-3 py-2">
                    <PresencePill presence={d.presence} />
                    <div className="mt-1 text-xs text-muted">{d.status === "DISABLED" ? "Account off" : "Account on"}</div>
                  </td>
                  <td className="px-3 py-2 font-mono tabular-nums">{speedText(d.speedKmh)}</td>
                  <td className="px-3 py-2 font-mono tabular-nums">{kmText(d.todayKm)}</td>
                  <td className="px-3 py-2 font-mono text-xs">{ride?.code ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">
                    {d.presence === "OFFLINE" ? "OFFLINE" : d.gpsStale ? "GPS STALE" : "LIVE"}
                    <div className="text-muted">{when(d.lastGpsAt)}</div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-2">
                      <Btn variant="ghost" className="h-9" onClick={() => setSelected(d.id)}>View</Btn>
                      <Btn className="h-9" onClick={() => void ring(d.id)}>Ring</Btn>
                      <Link to="/console" search={{ s: "dispatch", driver: d.id }} className="inline-flex h-9 items-center rounded-md border border-line px-3 text-xs">Dispatch</Link>
                      <Link to="/console" search={{ s: "map", driver: d.id }} className="inline-flex h-9 items-center rounded-md border border-line px-3 text-xs">Location</Link>
                      <Btn variant="ghost" className="h-9" onClick={() => void offline(d.id)}>Offline</Btn>
                      <Btn variant="ghost" className="h-9" onClick={() => void setAccount(d.id, d.status === "DISABLED" ? "ACTIVE" : "DISABLED")}>
                        {d.status === "DISABLED" ? "Activate" : "Deactivate"}
                      </Btn>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 ? <Empty title="No drivers" body="Create driver accounts from Accounts." /> : null}
      </div>
      {current ? (
        <div className="grid gap-3 rounded-lg border border-line bg-surface p-4 lg:grid-cols-[1.2fr_1fr]">
          <div>
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-sm font-medium">{current.name}</h2>
                <p className="text-xs text-muted">{current.driverCode} · {current.email}{current.phone ? ` · ${current.phone}` : ""}</p>
              </div>
              <button type="button" onClick={() => setSelected(null)} aria-label="Close driver"><X className="size-4" /></button>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <div><dt className="text-xs text-muted">Vehicle</dt><dd>{current.vehicle || "—"} · {current.plate || "—"}</dd></div>
              <div><dt className="text-xs text-muted">Fuel / odometer</dt><dd>{current.vehicleFuel ?? "—"} · {current.vehicleOdometer == null ? "—" : `${kmText(current.vehicleOdometer)} km`}</dd></div>
              <div><dt className="text-xs text-muted">Vehicle status</dt><dd>{current.vehicleStatus?.replaceAll("_", " ") ?? "—"}</dd></div>
              <div><dt className="text-xs text-muted">Last seen</dt><dd>{when(current.lastGpsAt)}</dd></div>
            </dl>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link to="/drive" search={{ s: "home", as: current.id }} className="inline-flex h-11 items-center rounded-md border border-line px-3 text-sm">Phone view</Link>
              <Link to="/console" search={{ s: "chat" }} className="inline-flex h-11 items-center rounded-md border border-line px-3 text-sm">Message</Link>
              <Link to="/console" search={{ s: "fuel" }} className="inline-flex h-11 items-center rounded-md border border-line px-3 text-sm">Fuel</Link>
              <Link to="/console" search={{ s: "maintenance" }} className="inline-flex h-11 items-center rounded-md border border-line px-3 text-sm">Maintenance</Link>
            </div>
            <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); void resetPassword(current.id); }}>
              <input className={fieldClass} type="password" placeholder="New password" value={password} onChange={(e) => setPassword(e.target.value)} />
              <Btn type="submit" disabled={password.length < 8}>Reset password</Btn>
            </form>
          </div>
          <div>
            <h3 className="text-xs text-muted">Recent orders</h3>
            <ul className="mt-2">
              {mine.length === 0 ? <li className="text-sm text-muted">No orders for this driver.</li> : null}
              {mine.map((o) => (
                <li key={o.id} className="border-b border-line py-2 text-sm">
                  <span className="font-mono text-xs">{o.code}</span> · {o.pickupLabel} → {o.destLabel}
                  <span className="block text-xs text-muted">{o.status} · {when(o.createdAt)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Dispatch({ presetDriverId }: { presetDriverId?: string }) {
  const fleet = useQuery({ queryKey: ["fleet"], queryFn: () => getFleet() });
  const prices = useQuery({ queryKey: ["prices"], queryFn: () => getPrices() });
  const orders = useQuery({ queryKey: ["orders", "desk"], queryFn: () => getOrders({ data: {} }) });
  const [pickup, setPickup] = useState<{ label: string; lat: number; lng: number } | null>(null);
  const [dest, setDest] = useState<{ label: string; lat: number; lng: number } | null>(null);
  const [route, setRoute] = useState<import("@/lib/taxi/logic").LatLng[] | null>(null);
  const [alts, setAlts] = useState<import("@/lib/taxi/logic").LatLng[][] | null>(null);
  const [aim, setAim] = useState<"pickup" | "dest">("pickup");
  const seeded = useRef(false);
  const base = fleet.data && !isFail(fleet.data) && fleet.data.success ? fleet.data.base : null;
  useEffect(() => {
    if (seeded.current || !base) return;
    seeded.current = true;
    setPickup({ label: base.label || "Base", lat: base.lat, lng: base.lng });
  }, [base]);
  if (fleet.isPending || prices.isPending) return <p className="text-sm text-muted">Loading dispatch…</p>;
  const drivers = fleet.data && !isFail(fleet.data) && fleet.data.success ? fleet.data.drivers : [];
  const priceRows = prices.data && !isFail(prices.data) && prices.data.success ? prices.data.prices : [];
  const openOrders = orders.data && !isFail(orders.data) && orders.data.success ? orders.data.orders : [];
  const busyIds = openOrders
    .filter((order) => order.driverId && ["DISPATCHED", "ACCEPTED", "ON_THE_WAY", "ARRIVED", "IN_PROGRESS"].includes(order.status))
    .map((order) => order.driverId as string);
  return (
    <div className="grid h-full min-h-0 flex-1 gap-3 p-3 lg:grid-cols-[22rem_1fr] md:p-4">
      <Panel title="Dispatch" className="min-h-0">
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex shrink-0 gap-2 border-b border-line p-3">
            <Btn variant={aim === "pickup" ? "primary" : "ghost"} onClick={() => setAim("pickup")}>Map: pickup</Btn>
            <Btn variant={aim === "dest" ? "primary" : "ghost"} onClick={() => setAim("dest")}>Map: destination</Btn>
          </div>
          <div className="taxi-scroll min-h-0 flex-1 p-3">
            <DispatchForm
              drivers={drivers}
              prices={priceRows}
              presetDriverId={presetDriverId}
              busyIds={busyIds}
              pickup={pickup}
              destination={dest}
              onPicked={(which, point) => (which === "pickup" ? setPickup(point) : setDest(point))}
              onRoute={(line, alternatives) => {
                setRoute(line);
                setAlts(alternatives);
              }}
            />
          </div>
        </div>
      </Panel>
      <Panel title="Route preview" className="min-h-0">
        <FleetMap
          drivers={drivers}
          route={route}
          alternatives={alts}
          pickup={pickup}
          destination={dest}
          base={fleet.data && !isFail(fleet.data) && fleet.data.success ? fleet.data.base : null}
          defaultMode="satellite"
          onMapClick={(point) => {
            const labeled = { ...point, label: aim === "pickup" ? "Map pickup" : "Map destination" };
            if (aim === "pickup") setPickup(labeled);
            else setDest(labeled);
          }}
        />
      </Panel>
    </div>
  );
}

function Orders() {
  const qc = useQueryClient();
  const fleet = useQuery({ queryKey: ["fleet"], queryFn: () => getFleet() });
  const [status, setStatus] = useState("");
  const [driverId, setDriverId] = useState("");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [assign, setAssign] = useState<Record<string, string>>({});
  const orders = useQuery({
    queryKey: ["orders", status, q, driverId],
    queryFn: () => getOrders({ data: { status: status || undefined, q, driverId: driverId || undefined } }),
    refetchInterval: 4000,
  });
  const drivers = fleet.data && !isFail(fleet.data) && fleet.data.success ? fleet.data.drivers : [];
  async function act(orderId: string, action: "cancel" | "complete" | "reassign", driverId?: string) {
    const res = await orderAction({ data: { orderId, action, driverId } });
    if (isFail(res) || !res.success) toast.error(isFail(res) ? res.message : "Order was not updated.");
    else toast.success(`${res.order?.code ?? "Order"} updated.`);
    void qc.invalidateQueries({ queryKey: ["orders"] });
    void qc.invalidateQueries({ queryKey: ["dashboard"] });
    void qc.invalidateQueries({ queryKey: ["pulse"] });
    void qc.invalidateQueries({ queryKey: ["activity"] });
    void qc.invalidateQueries({ queryKey: ["fleet"] });
  }
  const rows = orders.data && !isFail(orders.data) && orders.data.success ? orders.data.orders : [];
  return (
    <div>
      <PageHead title="Orders">
        <div className="flex flex-wrap gap-2">
          <Link to="/console" search={{ s: "dispatch" }} className="inline-flex h-11 items-center justify-center rounded-md bg-accent px-3 text-sm font-medium text-on-accent">+ Add order</Link>
          <input className={`${fieldClass} w-48`} placeholder="Search code or place" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className={`${fieldClass} w-44`} value={driverId} onChange={(e) => setDriverId(e.target.value)}>
            <option value="">All drivers</option>
            {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select className={`${fieldClass} w-40`} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {ORDER_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </div>
      </PageHead>
      {orders.isError ? <Banner>{errText(orders.error)}</Banner> : null}
      {isFail(orders.data) ? <Banner>{orders.data.message}</Banner> : null}
      <div className="overflow-auto rounded-lg border border-line">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className="bg-surface text-xs text-muted">
            <tr>
              <th className="px-3 py-2 font-medium">Order</th>
              <th className="px-3 py-2 font-medium">Driver</th>
              <th className="px-3 py-2 font-medium">Route</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Price</th>
              <th className="px-3 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <Fragment key={o.id}>
              <tr className="border-t border-line align-top">
                <td className="px-3 py-2 font-mono text-xs">{o.code}<div className="text-muted">{o.source === "DIRECT" ? "Direct ride" : "Desk"} · {when(o.createdAt)}</div></td>
                <td className="px-3 py-2">{o.driverName ?? "—"}<div className="text-xs text-muted">{o.driverCode}</div></td>
                <td className="px-3 py-2">{o.pickupLabel} → {o.destLabel}<div className="text-xs text-muted">{o.distanceKm ?? "—"} km · {o.notes || "No notes"}</div></td>
                <td className="px-3 py-2"><OrderPill status={o.status} /></td>
                <td className="px-3 py-2 font-mono tabular-nums">{eur(o.priceEur)}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-col gap-2">
                    <Btn variant="ghost" className="h-9" onClick={() => setOpenId(openId === o.id ? null : o.id)}>{openId === o.id ? "Hide" : "Details"}</Btn>
                    {o.status !== "COMPLETED" && o.status !== "CANCELLED" ? (
                      <Btn variant="danger" className="h-9" onClick={() => void act(o.id, "cancel")}>Cancel</Btn>
                    ) : null}
                    {o.status === "IN_PROGRESS" ? <Btn variant="ghost" className="h-9" onClick={() => void act(o.id, "complete")}>Close completed</Btn> : null}
                    {["DISPATCHED", "DECLINED", "ACCEPTED", "ON_THE_WAY", "ARRIVED"].includes(o.status) ? (
                      <div className="flex gap-2">
                        <select className="h-9 border border-line bg-bg px-2 text-xs" value={assign[o.id] ?? ""} onChange={(e) => setAssign((s) => ({ ...s, [o.id]: e.target.value }))}>
                          <option value="">Reassign</option>
                          {drivers.filter((d) => d.status === "ACTIVE").map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                        </select>
                        <Btn className="h-9" disabled={!assign[o.id]} onClick={() => void act(o.id, "reassign", assign[o.id])}>Move</Btn>
                      </div>
                    ) : null}
                  </div>
                </td>
              </tr>
              {openId === o.id ? (
                <tr className="border-t border-line bg-bg">
                  <td colSpan={6} className="px-3 py-3 text-xs text-muted">
                    <p>Source {o.source === "DIRECT" ? "Driver direct ride" : "Desk dispatch"} · Pickup {o.pickupLabel} · Destination {o.destLabel}</p>
                    <p className="mt-1">Driver {o.driverName ?? "—"} {o.driverCode ?? ""} · Vehicle {drivers.find((d) => d.id === o.driverId)?.vehicle || "—"} · Plate {drivers.find((d) => d.id === o.driverId)?.plate || "—"}</p>
                    <p className="mt-1">Price {eur(o.priceEur)} · Distance {o.distanceKm ?? "—"} km · ETA {o.durationMin ? `${Math.round(o.durationMin)} min` : "—"} · Status {STATUS_LABEL[o.status]}</p>
                    <p className="mt-1">Created {when(o.createdAt)} · Accepted {when(o.acceptedAt)} · Arrived {when(o.arrivedAt)} · Started {when(o.startedAt)} · Completed {when(o.completedAt)} · Cancelled {when(o.cancelledAt)}</p>
                    <p className="mt-1">Live location {(() => {
                      const who = drivers.find((d) => d.id === o.driverId);
                      if (!who || who.latitude == null || who.longitude == null) return "No GPS fix for this driver";
                      const stamp = who.lastGpsAt ? when(who.lastGpsAt) : "no timestamp";
                      const live = who.presence !== "OFFLINE" && !who.gpsStale;
                      return `${live ? "Live" : "Last fix"} ${who.latitude.toFixed(5)}, ${who.longitude.toFixed(5)} · ${stamp}`;
                    })()}</p>
                  </td>
                </tr>
              ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
        {!orders.isPending && rows.length === 0 ? <Empty title="No orders" body="Dispatch a ride and it will show up here." /> : null}
      </div>
    </div>
  );
}

function Prices() {
  const qc = useQueryClient();
  const prices = useQuery({ queryKey: ["prices"], queryFn: () => getPrices() });
  const [q, setQ] = useState("");
  const blank = { id: "", name: "", basePrice: "", perKm: "", perMin: "", minFare: "", latitude: "", longitude: "", enabled: true };
  const [form, setForm] = useState(blank);
  const [error, setError] = useState<string | null>(null);
  const rows = prices.data && !isFail(prices.data) && prices.data.success ? prices.data.prices : [];
  const shown = rows.filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase())).sort((a, b) => a.name.localeCompare(b.name));
  async function save() {
    setError(null);
    const res = await upsertPrice({
      data: {
        id: form.id || undefined,
        name: form.name,
        basePrice: Number(form.basePrice),
        perKm: Number(form.perKm || 0),
        perMin: Number(form.perMin || 0),
        minFare: Number(form.minFare || 0),
        latitude: form.latitude.trim() === "" ? null : Number(form.latitude),
        longitude: form.longitude.trim() === "" ? null : Number(form.longitude),
        enabled: form.enabled,
      },
    });
    if (isFail(res) || !res.success) setError(isFail(res) ? res.message : "Could not save the price.");
    else {
      toast.success(form.id ? "Price updated." : "Price added.");
      setForm(blank);
      void qc.invalidateQueries({ queryKey: ["prices"] });
      void qc.invalidateQueries({ queryKey: ["activity"] });
    }
  }
  async function remove(id: string) {
    const res = await deletePrice({ data: { id } });
    if (isFail(res) || !res.success) toast.error(isFail(res) ? res.message : "Could not delete.");
    else {
      toast.success("Price deleted.");
      void qc.invalidateQueries({ queryKey: ["prices"] });
    }
  }
  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <form className="space-y-3 rounded-lg border border-line bg-surface p-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <h2 className="text-sm font-medium">{form.id ? "Edit destination" : "Add destination"}</h2>
        <p className="text-xs text-muted">The fixed price is stored exactly as you enter it. Leave per km and per minute at 0 unless you want the fare to change with the trip.</p>
        {error ? <Banner>{error}</Banner> : null}
        <Field label="Name"><input className={fieldClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Fixed price (EUR)"><input className={fieldClass} inputMode="decimal" value={form.basePrice} onChange={(e) => setForm({ ...form, basePrice: e.target.value })} /></Field>
        <Field label="Per km (optional)"><input className={fieldClass} inputMode="decimal" value={form.perKm} onChange={(e) => setForm({ ...form, perKm: e.target.value })} /></Field>
        <Field label="Per minute (optional)"><input className={fieldClass} inputMode="decimal" value={form.perMin} onChange={(e) => setForm({ ...form, perMin: e.target.value })} /></Field>
        <Field label="Minimum fare"><input className={fieldClass} inputMode="decimal" value={form.minFare} onChange={(e) => setForm({ ...form, minFare: e.target.value })} /></Field>
        <Field label="Latitude"><input className={fieldClass} value={form.latitude} onChange={(e) => setForm({ ...form, latitude: e.target.value })} /></Field>
        <Field label="Longitude"><input className={fieldClass} value={form.longitude} onChange={(e) => setForm({ ...form, longitude: e.target.value })} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /> Enabled</label>
        <div className="flex gap-2">
          <Btn type="submit">{form.id ? "Save" : "Add"}</Btn>
          {form.id ? <Btn variant="ghost" onClick={() => setForm(blank)}>Cancel</Btn> : null}
        </div>
      </form>
      <div>
        <PageHead title="Destination prices">
          <input className={`${fieldClass} w-52`} placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        </PageHead>
        <div className="overflow-auto rounded-lg border border-line">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-surface text-xs text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Destination</th>
                <th className="px-3 py-2 font-medium">Base</th>
                <th className="px-3 py-2 font-medium">Per km</th>
                <th className="px-3 py-2 font-medium">Per min</th>
                <th className="px-3 py-2 font-medium">Minimum</th>
                <th className="px-3 py-2 font-medium">State</th>
                <th className="px-3 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.id} className="border-t border-line">
                  <td className="px-3 py-2">{p.name}</td>
                  <td className="px-3 py-2 font-mono tabular-nums">{eur(p.basePrice)}</td>
                  <td className="px-3 py-2 font-mono tabular-nums">{eur(p.perKm)}</td>
                  <td className="px-3 py-2 font-mono tabular-nums">{eur(p.perMin)}</td>
                  <td className="px-3 py-2 font-mono tabular-nums">{eur(p.minFare)}</td>
                  <td className="px-3 py-2">{p.enabled ? "Enabled" : "Disabled"}</td>
                  <td className="px-3 py-2">
                    <div className="flex gap-2">
                      <Btn variant="ghost" className="h-9" onClick={() => setForm({ id: p.id, name: p.name, basePrice: String(p.basePrice), perKm: String(p.perKm), perMin: String(p.perMin), minFare: String(p.minFare), latitude: p.latitude == null ? "" : String(p.latitude), longitude: p.longitude == null ? "" : String(p.longitude), enabled: p.enabled })}>Edit</Btn>
                      <Btn variant="danger" className="h-9" onClick={() => void remove(p.id)}>Delete</Btn>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length === 0 ? <Empty title="No destinations" body="Add a destination to quote trips." /> : null}
        </div>
      </div>
    </div>
  );
}

function Accounts({ selfId }: { selfId: string }) {
  const qc = useQueryClient();
  const accounts = useQuery({ queryKey: ["accounts"], queryFn: () => getAccounts() });
  const [error, setError] = useState<string | null>(null);
  const [reset, setReset] = useState<{ id: string; password: string } | null>(null);
  const [form, setForm] = useState({ role: "DRIVER" as Role, name: "", email: "", phone: "", password: "", vehicle: "", plate: "", driverCode: "" });
  const data = accounts.data && !isFail(accounts.data) && accounts.data.success ? accounts.data : null;
  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await addAccount({ data: form });
    if (isFail(res) || !res.success) setError(isFail(res) ? res.message : "Could not create the account.");
    else {
      toast.success("Account created.");
      setForm({ role: "DRIVER", name: "", email: "", phone: "", password: "", vehicle: "", plate: "", driverCode: "" });
      void qc.invalidateQueries({ queryKey: ["accounts"] });
      void qc.invalidateQueries({ queryKey: ["fleet"] });
    }
  }
  async function patch(id: string, body: { status?: "ACTIVE" | "DISABLED"; deleted?: boolean }) {
    const res = await editAccount({ data: { id, ...body } });
    if (isFail(res) || !res.success) toast.error(isFail(res) ? res.message : "Update failed.");
    else toast.success("Account updated.");
    void qc.invalidateQueries({ queryKey: ["accounts"] });
    void qc.invalidateQueries({ queryKey: ["fleet"] });
  }
  return (
    <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
      <form className="space-y-3 rounded-lg border border-line bg-surface p-4" onSubmit={(e) => void create(e)}>
        <h2 className="text-sm font-medium">Create account</h2>
        <p className="text-xs text-muted">{data ? `${data.adminCount}/${data.maxAdmins} administrators · ${data.driverCount}/${data.maxDrivers} drivers` : ""}</p>
        {error ? <Banner>{error}</Banner> : null}
        <Field label="Role">
          <select className={fieldClass} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
            <option value="DRIVER">Driver</option>
            <option value="ADMIN">Administrator</option>
          </select>
        </Field>
        <Field label="Name"><input className={fieldClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Field>
        <Field label="Email"><input className={fieldClass} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></Field>
        <Field label="Phone"><input className={fieldClass} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
        <Field label="Password"><input className={fieldClass} type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required /></Field>
        {form.role === "DRIVER" ? (
          <>
            <Field label="Vehicle"><input className={fieldClass} value={form.vehicle} onChange={(e) => setForm({ ...form, vehicle: e.target.value })} /></Field>
            <Field label="Plate"><input className={fieldClass} value={form.plate} onChange={(e) => setForm({ ...form, plate: e.target.value })} /></Field>
            <Field label="Driver ID"><input className={fieldClass} placeholder="D-06" value={form.driverCode} onChange={(e) => setForm({ ...form, driverCode: e.target.value })} /></Field>
          </>
        ) : null}
        <Btn type="submit">Create</Btn>
        {data?.demo ? <p className="text-xs text-muted">Preview driver sign-in password is Fleet-demo-26. It is not used once this system is deployed.</p> : null}
      </form>
      <div className="overflow-auto rounded-lg border border-line">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-surface text-xs text-muted">
            <tr>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Role</th>
              <th className="px-3 py-2 font-medium">Contact</th>
              <th className="px-3 py-2 font-medium">Vehicle</th>
              <th className="px-3 py-2 font-medium">State</th>
              <th className="px-3 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {(data?.accounts ?? []).map((a) => (
              <tr key={a.id} className="border-t border-line align-top">
                <td className="px-3 py-2">{a.name}<div className="text-xs text-muted">{a.driverCode}</div></td>
                <td className="px-3 py-2">{a.role === "ADMIN" ? "Admin" : "Driver"}</td>
                <td className="px-3 py-2">{a.email}<div className="text-xs text-muted">{a.phone || "—"}</div></td>
                <td className="px-3 py-2">{a.vehicle || "—"}<div className="font-mono text-xs">{a.plate}</div></td>
                <td className="px-3 py-2">{a.deleted ? "Deleted" : a.status === "DISABLED" ? "Disabled" : "Active"}</td>
                <td className="px-3 py-2">
                  {a.id === selfId ? <span className="text-xs text-muted">You</span> : (
                    <div className="flex flex-wrap gap-2">
                      {!a.deleted && a.status === "ACTIVE" ? <Btn variant="ghost" className="h-9" onClick={() => void patch(a.id, { status: "DISABLED" })}>Disable</Btn> : null}
                      {!a.deleted && a.status === "DISABLED" ? <Btn variant="ghost" className="h-9" onClick={() => void patch(a.id, { status: "ACTIVE" })}>Enable</Btn> : null}
                      {!a.deleted ? <Btn variant="ghost" className="h-9" onClick={() => setReset(reset?.id === a.id ? null : { id: a.id, password: "" })}>Password</Btn> : null}
                      {!a.deleted ? <Btn variant="danger" className="h-9" onClick={() => void patch(a.id, { deleted: true })}>Delete</Btn> : <Btn className="h-9" onClick={() => void patch(a.id, { deleted: false })}>Restore</Btn>}
                      {reset?.id === a.id ? (
                        <form className="flex gap-2" onSubmit={(e) => {
                          e.preventDefault();
                          void editAccount({ data: { id: a.id, password: reset.password } }).then((res) => {
                            if (isFail(res) || !res.success) toast.error(isFail(res) ? res.message : "Password was not changed.");
                            else {
                              toast.success("Password updated.");
                              setReset(null);
                            }
                          });
                        }}>
                          <input className="h-11 w-40 min-w-0 border border-line bg-bg px-2 text-base md:text-sm" type="password" value={reset.password} onChange={(e) => setReset({ id: a.id, password: e.target.value })} />
                          <Btn type="submit" className="h-9" disabled={reset.password.length < 8}>Save</Btn>
                        </form>
                      ) : null}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Activity() {
  const activity = useQuery({ queryKey: ["activity"], queryFn: () => getActivity() });
  const [type, setType] = useState("");
  const rows = activity.data && !isFail(activity.data) && activity.data.success ? activity.data.activity : [];
  const types = useMemo(() => Array.from(new Set(rows.map((r) => r.eventType))), [rows]);
  const shown = type ? rows.filter((r) => r.eventType === type) : rows;
  return (
    <div>
      <PageHead title="Activity">
        <select className={`${fieldClass} w-56`} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All events</option>
          {types.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </PageHead>
      {isFail(activity.data) ? <Banner>{activity.data.message}</Banner> : null}
      <ul className="border border-line">
        {shown.map((a) => (
          <li key={a.id} className="grid gap-1 border-b border-line px-3 py-2 md:grid-cols-[180px_140px_140px_1fr]">
            <span className="font-mono text-xs text-muted">{when(a.createdAt)}</span>
            <span className="text-xs text-accent">{a.eventType}</span>
            <span className="text-xs">{a.actorName ?? "System"}</span>
            <span className="text-sm">{a.description}</span>
          </li>
        ))}
      </ul>
      {shown.length === 0 ? <Empty title="No events" body="Logins, dispatches and price changes are recorded here." /> : null}
    </div>
  );
}

function periodBounds(kind: "today" | "week" | "month" | "year") {
  const today = todayISO();
  const [y, m, d] = today.split("-").map(Number);
  if (kind === "today") return { from: today, to: today };
  if (kind === "year") return { from: `${y}-01-01`, to: `${y}-12-31` };
  if (kind === "month") {
    const last = new Date(Date.UTC(y ?? 2026, m ?? 1, 0)).getUTCDate();
    const month = String(m).padStart(2, "0");
    return { from: `${y}-${month}-01`, to: `${y}-${month}-${String(last).padStart(2, "0")}` };
  }
  const weekday = new Date(Date.UTC(y ?? 2026, (m ?? 1) - 1, d ?? 1)).getUTCDay();
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  const from = shiftISO(today, mondayOffset);
  return { from, to: shiftISO(from, 6) };
}

function dayKey(iso: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Belgrade", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function shiftISO(iso: string, days: number) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y ?? 2026, (m ?? 1) - 1, d ?? 1));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function Reports() {
  const today = todayISO();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [driverId, setDriverId] = useState("");
  const [status, setStatus] = useState("");
  const fleet = useQuery({ queryKey: ["fleet"], queryFn: () => getFleet() });
  const report = useQuery({
    queryKey: ["report", from, to, driverId, status],
    queryFn: () => getReport({ data: { from, to, driverId: driverId || undefined, status: status || undefined } }),
  });
  const drivers = fleet.data && !isFail(fleet.data) && fleet.data.success ? fleet.data.drivers : [];
  const data = report.data && !isFail(report.data) && report.data.success ? report.data : null;
  function exportPdf() {
    if (!data) return;
    const chosen = drivers.find((d) => d.id === driverId);
    const row = data.byDriver.find((d) => d.id === driverId);
    const completed = data.orders.filter((o) => o.status === "COMPLETED");
    const byDay = new Map<string, { trips: number; revenue: number }>();
    for (const order of completed) {
      const key = dayKey(order.completedAt ?? order.createdAt);
      const slot = byDay.get(key) ?? { trips: 0, revenue: 0 };
      slot.trips += 1;
      slot.revenue += order.priceEur ?? 0;
      byDay.set(key, slot);
    }
    const blob = buildEarningsPdf({
      period: `${data.from} to ${data.to}`,
      generated: todayLabel(new Date()),
      driver: chosen ? `${chosen.driverCode ?? ""} ${chosen.name}`.trim() : "All drivers",
      vehicle: chosen ? `${chosen.vehicle || "—"}${chosen.plate ? ` · ${chosen.plate}` : ""}` : undefined,
      trips: data.ordersTotal,
      completed: data.completed,
      cancelled: data.cancelled,
      revenue: eur(driverId ? row?.revenue ?? 0 : data.revenue),
      rows: [...byDay.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, slot]) => ({ date, trips: String(slot.trips), revenue: eur(slot.revenue) })),
      note: "Revenue is the sum of completed trip prices. Cancelled trips are not included.",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `taxi-im-earnings-${data.from}-${data.to}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  }
  function exportCsv() {
    if (!data) return;
    const header = ["code", "status", "driver", "pickup", "destination", "price_eur", "distance_km", "created_at"];
    const lines = data.orders.map((o) => [o.code, o.status, o.driverName ?? "", o.pickupLabel, o.destLabel, o.priceEur ?? "", o.distanceKm ?? "", o.createdAt]);
    const csv = [header, ...lines].map((r) => r.map((c) => `"${String(c).replaceAll('"', '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `taxi-im-${from}-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="space-y-4">
      <PageHead title="Reports">
        <div className="flex flex-wrap gap-2">
          <Btn variant="ghost" onClick={() => { const span = periodBounds("today"); setFrom(span.from); setTo(span.to); }}>Today</Btn>
          <Btn variant="ghost" onClick={() => { const span = periodBounds("week"); setFrom(span.from); setTo(span.to); }}>Week</Btn>
          <Btn variant="ghost" onClick={() => { const span = periodBounds("month"); setFrom(span.from); setTo(span.to); }}>Month</Btn>
          <Btn variant="ghost" onClick={() => { const span = periodBounds("year"); setFrom(span.from); setTo(span.to); }}>Year</Btn>
        </div>
      </PageHead>
      <div className="flex flex-wrap gap-2">
        <input className={fieldClass} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <input className={fieldClass} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <select className={`${fieldClass} w-48`} value={driverId} onChange={(e) => setDriverId(e.target.value)}>
          <option value="">All drivers</option>
          {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select className={`${fieldClass} w-44`} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {ORDER_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <Btn variant="ghost" disabled={!data} onClick={exportCsv}>Export CSV</Btn>
        <Btn disabled={!data} onClick={exportPdf}>Export PDF</Btn>
      </div>
      {isFail(report.data) ? <Banner>{report.data.message}</Banner> : null}
      {data ? (
        <>
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line xl:grid-cols-5">
            <Stat label="Orders" value={data.ordersTotal} />
            <Stat label="Completed" value={data.completed} />
            <Stat label="Cancelled" value={data.cancelled} />
            <Stat label="Revenue" value={eur(data.revenue)} hint="Completed trips only" />
            <Stat label="Fleet km" value={kmText(data.fleetKm)} hint={`Trip distance ${kmText(data.tripKm)} km`} />
          </div>
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line xl:grid-cols-4">
            <Stat label="Fuel liters" value={data.fuelLiters} />
            <Stat label="Fuel cost" value={eur(data.fuelCost)} />
            <Stat label="Maintenance" value={eur(data.maintCost)} hint={`Parts ${eur(data.partsCost)} · labor ${eur(data.laborCost)}`} />
            <Stat label="€ / km" value={data.costPerKm == null ? "—" : eur(data.costPerKm)} hint="Fuel + maintenance / GPS km" />
          </div>
          <p className="text-xs text-muted">Revenue uses the price stored on each completed order. Cancelled trips stay in the list and are not added to revenue. Period {data.from} to {data.to}.</p>
          <div className="overflow-auto rounded-lg border border-line">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-surface text-xs text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Driver</th>
                  <th className="px-3 py-2 font-medium">Vehicle</th>
                  <th className="px-3 py-2 font-medium">Trips</th>
                  <th className="px-3 py-2 font-medium">Completed</th>
                  <th className="px-3 py-2 font-medium">Cancelled</th>
                  <th className="px-3 py-2 font-medium">Revenue</th>
                  <th className="px-3 py-2 font-medium">Trip km</th>
                </tr>
              </thead>
              <tbody>
                {data.byDriver.map((d) => (
                  <tr key={d.id} className="border-t border-line">
                    <td className="px-3 py-2">{d.name}<div className="text-xs text-muted">{d.driverCode}</div></td>
                    <td className="px-3 py-2">{d.vehicle || "—"}<div className="text-xs text-muted">{d.plate}</div></td>
                    <td className="px-3 py-2 font-mono tabular-nums">{d.orders}</td>
                    <td className="px-3 py-2 font-mono tabular-nums">{d.completed}</td>
                    <td className="px-3 py-2 font-mono tabular-nums">{d.cancelled}</td>
                    <td className="px-3 py-2 font-mono tabular-nums">{eur(d.revenue)}</td>
                    <td className="px-3 py-2 font-mono tabular-nums">{kmText(d.tripKm)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="overflow-auto rounded-lg border border-line">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="bg-surface text-xs text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">When</th>
                  <th className="px-3 py-2 font-medium">Driver</th>
                  <th className="px-3 py-2 font-medium">Trip</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Km</th>
                  <th className="px-3 py-2 font-medium">Min</th>
                  <th className="px-3 py-2 font-medium">Price</th>
                </tr>
              </thead>
              <tbody>
                {data.orders.slice(0, 200).map((o) => (
                  <tr key={o.id} className="border-t border-line">
                    <td className="px-3 py-2 text-xs">{when(o.completedAt ?? o.createdAt)}</td>
                    <td className="px-3 py-2">{o.driverName ?? "—"}</td>
                    <td className="px-3 py-2">{o.pickupLabel} → {o.destLabel}<div className="text-xs text-muted">{o.code}</div></td>
                    <td className="px-3 py-2">{o.status === "CANCELLED" ? "Cancelled" : o.status === "COMPLETED" ? "Completed" : o.status}</td>
                    <td className="px-3 py-2 font-mono tabular-nums">{kmText(o.distanceKm)}</td>
                    <td className="px-3 py-2 font-mono tabular-nums">{o.durationMin ?? "—"}</td>
                    <td className="px-3 py-2 font-mono tabular-nums">{eur(o.priceEur)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : report.isPending ? <p className="text-sm text-muted">Building the report…</p> : null}
    </div>
  );
}

function SettingsPage({ operatorName }: { operatorName: string }) {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => getSettings() });
  const [error, setError] = useState<string | null>(null);
  const data = settings.data && !isFail(settings.data) && settings.data.success ? settings.data : null;
  const [form, setForm] = useState<{ companyName: string; operatorName: string; companyPhone: string; staleSeconds: string; speedAlertKmh: string; baseLabel: string; baseLat: string; baseLng: string; fuelHigh: string; serviceWarnDays: string; startFare: string; perKmRate: string } | null>(null);
  useEffect(() => {
    if (!data || form) return;
    setForm({
      operatorName,
      companyName: data.settings.companyName,
      companyPhone: data.settings.companyPhone,
      staleSeconds: String(data.settings.staleSeconds),
      speedAlertKmh: String(data.settings.speedAlertKmh),
      baseLabel: data.settings.baseLabel,
      baseLat: String(data.settings.baseLat),
      baseLng: String(data.settings.baseLng),
      fuelHigh: String(data.settings.fuelHigh),
      serviceWarnDays: String(data.settings.serviceWarnDays),
      startFare: String(data.settings.startFare),
      perKmRate: String(data.settings.perKmRate),
    });
  }, [data, form, operatorName]);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setError(null);
    const res = await putSettings({
      data: {
        operatorName: form.operatorName,
        companyName: form.companyName,
        companyPhone: form.companyPhone,
        staleSeconds: Number(form.staleSeconds),
        speedAlertKmh: Number(form.speedAlertKmh),
        baseLabel: form.baseLabel,
        baseLat: Number(form.baseLat),
        baseLng: Number(form.baseLng),
        fuelHigh: Number(form.fuelHigh),
        serviceWarnDays: Number(form.serviceWarnDays),
        startFare: Number(form.startFare),
        perKmRate: Number(form.perKmRate),
      },
    });
    if (isFail(res) || !res.success) setError(isFail(res) ? res.message : "Could not save settings.");
    else {
      toast.success("Settings saved.");
      void qc.invalidateQueries({ queryKey: ["settings"] });
      void qc.invalidateQueries({ queryKey: ["session"] });
      void qc.invalidateQueries({ queryKey: ["pulse"] });
    }
  }
  if (!data || !form) return <p className="text-sm text-muted">Loading settings…</p>;
  return (
    <form className="max-w-xl space-y-3" onSubmit={(e) => void save(e)}>
      <PageHead title="Settings" />
      {error ? <Banner>{error}</Banner> : null}
      <Banner tone="info">
        The map uses a current vector style. Satellite imagery is loaded through the desk. Map, Satellite, and Hybrid switch on every map.
        Routing is {data.routing.provider === "mapbox" ? "Mapbox with live traffic" : "OSRM on the road network, which is not live traffic"}.
        A Mapbox token, if you add one, is read only on the server from MAPBOX_ACCESS_TOKEN.
        Account limit is {data.limits.maxAdmins} administrator and {data.limits.maxDrivers} drivers. Fuel fills are entered by hand. GPS does not invent refuels.
      </Banner>
      <h2 className="pt-2 text-xs tracking-wide text-muted uppercase">Company</h2>
      <Field label="Your name"><input className={fieldClass} value={form.operatorName} onChange={(e) => setForm({ ...form, operatorName: e.target.value })} /></Field>
      <Field label="Company name"><input className={fieldClass} value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} /></Field>
      <Field label="Company phone"><input className={fieldClass} value={form.companyPhone} onChange={(e) => setForm({ ...form, companyPhone: e.target.value })} placeholder="Optional" /></Field>
      <h2 className="pt-2 text-xs tracking-wide text-muted uppercase">Base</h2>
      <Field label="Base name"><input className={fieldClass} value={form.baseLabel} onChange={(e) => setForm({ ...form, baseLabel: e.target.value })} /></Field>
      <Field label="Base latitude"><input className={fieldClass} value={form.baseLat} onChange={(e) => setForm({ ...form, baseLat: e.target.value })} /></Field>
      <Field label="Base longitude"><input className={fieldClass} value={form.baseLng} onChange={(e) => setForm({ ...form, baseLng: e.target.value })} /></Field>
      <h2 className="pt-2 text-xs tracking-wide text-muted uppercase">Meter</h2>
      <p className="text-xs text-muted">Used only when a trip has no fixed destination price. Mitrovica and Prishtina keep the price you set on the Prices page.</p>
      <Field label="Starting fare (EUR)"><input className={fieldClass} value={form.startFare} onChange={(e) => setForm({ ...form, startFare: e.target.value })} /></Field>
      <Field label="Per kilometre (EUR)"><input className={fieldClass} value={form.perKmRate} onChange={(e) => setForm({ ...form, perKmRate: e.target.value })} /></Field>
      <h2 className="pt-2 text-xs tracking-wide text-muted uppercase">Alerts</h2>
      <Field label="GPS stale after (seconds)"><input className={fieldClass} value={form.staleSeconds} onChange={(e) => setForm({ ...form, staleSeconds: e.target.value })} /></Field>
      <Field label="Speed alert (km/h)"><input className={fieldClass} value={form.speedAlertKmh} onChange={(e) => setForm({ ...form, speedAlertKmh: e.target.value })} /></Field>
      <Field label="Flag fuel above (L/100 km)"><input className={fieldClass} value={form.fuelHigh} onChange={(e) => setForm({ ...form, fuelHigh: e.target.value })} /></Field>
      <Field label="Document warning (days)"><input className={fieldClass} value={form.serviceWarnDays} onChange={(e) => setForm({ ...form, serviceWarnDays: e.target.value })} /></Field>
      <Btn type="submit">Save settings</Btn>
    </form>
  );
}
