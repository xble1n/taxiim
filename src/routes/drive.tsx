import { createFileRoute } from "@tanstack/react-router";
import { DRIVE_SECTIONS, DriverApp, type DriveSection } from "@/components/taxi/driver-app";

export const Route = createFileRoute("/drive")({
  validateSearch: (raw: Record<string, unknown>): { s: DriveSection; as?: string } => {
    const s =
      typeof raw.s === "string" && (DRIVE_SECTIONS as readonly string[]).includes(raw.s)
        ? (raw.s as DriveSection)
        : "home";
    const as = typeof raw.as === "string" ? raw.as : undefined;
    return { s, as };
  },
  component: DrivePage,
});

function DrivePage() {
  const search = Route.useSearch();
  return <DriverApp section={search.s} asId={search.as} />;
}
