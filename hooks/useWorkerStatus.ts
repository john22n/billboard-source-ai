"use client";

import { useState, useEffect, useCallback } from "react";

export type WorkerActivity = "available" | "unavailable" | "offline";

interface UseWorkerStatusReturn {
  status: WorkerActivity;
  isLoading: boolean;
  error: string | null;
  setStatus: (status: WorkerActivity) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useWorkerStatus(): UseWorkerStatusReturn {
  const [status, setStatusState] = useState<WorkerActivity>("offline");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch("/api/taskrouter/worker-status");
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to fetch status");
      }

      setStatusState(data.status || "offline");
    } catch (err) {
      console.error("Failed to fetch worker status:", err);
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const setStatus = useCallback(async (newStatus: WorkerActivity) => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch("/api/taskrouter/worker-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to update status");
      }

      setStatusState(newStatus);
    } catch (err) {
      console.error("Failed to update worker status:", err);
      setError(err instanceof Error ? err.message : "Unknown error");
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    status,
    isLoading,
    error,
    setStatus,
    refresh,
  };
}
