import { useCallback, useEffect, useState } from "react";
import { get, onMutation } from "./api";

export function useQuery<T = any>(path: string | null, opts: { refreshOnMutation?: boolean; intervalMs?: number } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    if (!path) return;
    try {
      setData(await get<T>(path));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);
  useEffect(() => (opts.refreshOnMutation === false ? undefined : onMutation(() => void load())), [load, opts.refreshOnMutation]);
  useEffect(() => {
    if (!opts.intervalMs) return;
    const h = setInterval(() => void load(), opts.intervalMs);
    return () => clearInterval(h);
  }, [load, opts.intervalMs]);
  return { data, error, loading, reload: load, setData };
}

export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, run, setError };
}
