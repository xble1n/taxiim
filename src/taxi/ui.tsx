import type { ButtonHTMLAttributes, ReactNode } from "react";
import { STATUS_LABEL, type OrderStatus, type Presence } from "@/lib/taxi/logic";

const fieldBase =
  "h-11 min-w-0 rounded-md border border-line bg-bg px-3 text-base text-fg outline-none placeholder:text-muted focus:border-accent md:text-sm";
export const fieldClass = `${fieldBase} w-full`;
/** Field for toolbars and filter rows: add a fixed width from sm up, e.g. `${filterFieldClass} sm:w-48`. */
export const filterFieldClass = `${fieldBase} w-full`;

export function Logo({ className = "h-8 w-auto" }: { className?: string }) {
  return <img src="/brand/taxi-im.png" alt="TAXI IM" draggable={false} className={className} />;
}

export function Btn({
  variant = "primary",
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" | "quiet" }) {
  const styles = {
    primary: "bg-accent text-on-accent hover:bg-accent-2",
    ghost: "border border-line bg-surface-2 text-fg hover:border-accent",
    danger: "border border-danger/40 bg-danger/10 text-danger hover:bg-danger/20",
    quiet: "text-muted hover:text-fg",
  }[variant];
  return (
    <button
      type={type}
      className={`inline-flex h-11 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition-[transform,background-color,border-color,color] duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 ${styles} ${className}`}
      {...props}
    />
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="text-muted">{label}</span>
      {children}
    </label>
  );
}

export function Banner({ tone = "danger", children }: { tone?: "danger" | "ok" | "info"; children: ReactNode }) {
  const styles = {
    danger: "border-danger/40 bg-danger/10 text-danger",
    ok: "border-ok/40 bg-ok/10 text-ok",
    info: "border-line bg-surface-2 text-muted",
  }[tone];
  return <div className={`rounded-md border px-3 py-2 text-sm ${styles}`}>{children}</div>;
}

export function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-dashed border-line px-4 py-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 text-sm text-muted">{body}</p>
    </div>
  );
}

export function Panel({
  title,
  action,
  children,
  className = "",
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`flex min-h-0 flex-col overflow-hidden rounded-lg border border-line bg-surface ${className}`}>
      {title ? (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="text-sm font-medium tracking-tight">{title}</h2>
          {action}
        </header>
      ) : null}
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, className = "" }: { label: string; value: string | number; hint?: string; className?: string }) {
  return (
    <div className={`bg-surface px-4 py-4 ${className}`}>
      <p className="text-xs font-medium tracking-wide text-muted uppercase">{label}</p>
      <p className="mt-2 font-mono text-2xl font-medium tracking-tight tabular-nums sm:text-3xl">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

const presenceStyle: Record<Presence, string> = {
  ONLINE: "bg-free/20 text-free",
  ON_RIDE: "bg-busy/20 text-busy",
  OFFLINE: "bg-surface-2 text-muted",
};

const presenceLabel: Record<Presence, string> = {
  ONLINE: "Online",
  ON_RIDE: "On ride",
  OFFLINE: "Offline",
};

/** `noGps`: online, but the phone has stopped sending its location (same wording as the map). */
export function PresencePill({ presence, noGps = false }: { presence: Presence; noGps?: boolean }) {
  const lost = noGps && presence !== "OFFLINE";
  return (
    <span
      className={`inline-flex rounded-sm px-2 py-0.5 text-xs font-medium ${lost ? "bg-warn/15 text-warn" : presenceStyle[presence]}`}
      title={lost ? "Online, but this phone has not sent its location recently" : undefined}
    >
      {lost ? "No GPS" : presenceLabel[presence]}
    </span>
  );
}

const orderStyle: Record<OrderStatus, string> = {
  PENDING: "bg-surface-2 text-muted",
  DISPATCHED: "bg-warn/15 text-warn",
  ACCEPTED: "bg-accent/15 text-accent",
  ON_THE_WAY: "bg-accent/15 text-accent",
  DECLINED: "bg-danger/15 text-danger",
  ARRIVED: "bg-accent/15 text-accent",
  IN_PROGRESS: "bg-ok/15 text-ok",
  COMPLETED: "bg-surface-2 text-fg",
  CANCELLED: "bg-danger/10 text-danger",
};

export function OrderPill({ status }: { status: OrderStatus }) {
  return (
    <span className={`inline-flex rounded-sm px-2 py-0.5 text-xs font-medium ${orderStyle[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function BootScreen() {
  return (
    <div className="grid min-h-dvh place-items-center bg-bg text-fg">
      <Logo className="h-10 w-auto" />
    </div>
  );
}

export function PageHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <h1 className="text-xl font-medium tracking-tight">{title}</h1>
      {children}
    </div>
  );
}
