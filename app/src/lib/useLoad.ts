import { useCallback, useEffect, useState } from "react";

export type Load<T> =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; data: T };

/** Runs `load` on mount and whenever `key` changes; `retry` runs it again. */
export function useLoad<T>(load: (signal: AbortSignal) => Promise<T>, key: string): [Load<T>, () => void] {
  const [result, setResult] = useState<Load<T>>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setResult({ state: "loading" });
    load(controller.signal)
      .then((data) => setResult({ state: "ready", data }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setResult({ state: "error", message: error instanceof Error ? error.message : String(error) });
      });
    return () => controller.abort();
    // `load` is recreated each render; `key` and `attempt` say when to refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return [result, retry];
}
