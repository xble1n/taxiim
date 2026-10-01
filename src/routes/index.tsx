import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { getSession } from "@/lib/taxi/api";
import { errText, isFail } from "@/lib/taxi/format";
import { Banner, BootScreen, Logo } from "@/components/taxi/ui";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const { user, isPending } = useCurrentUserState();
  const session = useQuery({
    queryKey: ["session"],
    queryFn: () => getSession(),
    enabled: Boolean(user) && !isPending,
  });

  if (isPending || (user && session.isPending)) return <BootScreen />;
  if (!user) return <Navigate to="/login" />;
  if (session.isError) {
    if (/unauthorized/i.test(errText(session.error))) return <Navigate to="/login" />;
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
        <Banner>{isFail(data) ? data.message : "The control system did not answer."}</Banner>
      </div>
    );
  }
  if (data.access !== "ok") {
    return (
      <main className="grid min-h-dvh place-items-center px-6">
        <div className="max-w-md space-y-4">
          <Logo className="h-8 w-auto" />
          <p className="text-sm text-pretty text-muted">{data.message}</p>
        </div>
      </main>
    );
  }
  if (data.staff.role === "DRIVER") return <Navigate to="/drive" search={{ s: "home" }} />;
  return <Navigate to="/console" search={{ s: "dashboard" }} />;
}
