import { createFileRoute } from "@tanstack/react-router";
import { ADMIN_SECTIONS, AdminApp, type AdminSection } from "@/components/taxi/admin-app";

export const Route = createFileRoute("/console")({
  validateSearch: (raw: Record<string, unknown>): { s: AdminSection; driver?: string } => {
    const s =
      typeof raw.s === "string" && (ADMIN_SECTIONS as readonly string[]).includes(raw.s)
        ? (raw.s as AdminSection)
        : "dashboard";
    const driver = typeof raw.driver === "string" ? raw.driver : undefined;
    return { s, driver };
  },
  component: ConsolePage,
});

function ConsolePage() {
  const { s, driver } = Route.useSearch();
  return <AdminApp section={s} driverId={driver} />;
}
