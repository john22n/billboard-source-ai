"use client";

import { useState, useEffect, useCallback, useRef } from "react";

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
  const wasOnlineRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch("/api/taskrouter/worker-status");
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to fetch status");
      }

      const currentStatus = data.status || "offline";
      setStatusState(currentStatus);
      wasOnlineRef.current = currentStatus === "available";
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
      wasOnlineRef.current = newStatus === "available";
    } catch (err) {
      console.error("Failed to update worker status:", err);
      setError(err instanceof Error ? err.message : "Unknown error");
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Set worker offline when leaving the page
  const setOfflineSync = useCallback(() => {
    // Use sendBeacon for reliable delivery on page unload
    navigator.sendBeacon(
      "/api/taskrouter/worker-status",
      JSON.stringify({ status: "offline" })
    );
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // NOTE: beforeunload disabled - was causing workers to go offline on refresh
  // TODO: Use visibilitychange + sessionStorage to only offline on actual tab close
  // useEffect(() => {
  //   const handleBeforeUnload = () => {
  //     setOfflineSync();
  //   };
  //   window.addEventListener("beforeunload", handleBeforeUnload);
  //   return () => {
  //     window.removeEventListener("beforeunload", handleBeforeUnload);
  //   };
  // }, [setOfflineSync]);

  return {
    status,
    isLoading,
    error,
    setStatus,
    refresh,
  };
}
