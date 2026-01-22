"use client";

import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from "react";

export type WorkerActivity = "available" | "unavailable" | "offline";

interface WorkerStatusContextType {
  status: WorkerActivity;
  isLoading: boolean;
  error: string | null;
  setStatus: (status: WorkerActivity) => Promise<void>;
  refresh: () => Promise<void>;
}

const WorkerStatusContext = createContext<WorkerStatusContextType | null>(null);

const HEARTBEAT_INTERVAL = 30_000; // 30 seconds

/**
 * Hook to access worker status - must be used within WorkerStatusProvider
 */
export function useWorkerStatus(): WorkerStatusContextType {
  const context = useContext(WorkerStatusContext);
  if (!context) {
    throw new Error("useWorkerStatus must be used within WorkerStatusProvider");
  }
  return context;
}

interface WorkerStatusProviderProps {
  children: ReactNode;
}

/**
 * Provider that manages worker status state and shares it across all consumers
 */
export function WorkerStatusProvider({ children }: WorkerStatusProviderProps) {
  const [status, setStatusState] = useState<WorkerActivity>("offline");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const heartbeatRef = useRef<NodeJS.Timeout | null>(null);
  const statusRef = useRef<WorkerActivity>("offline");

  /* ---------------------------------------------------- */
  /* Fetch current status                                 */
  /* ---------------------------------------------------- */
  const refresh = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const res = await fetch("/api/taskrouter/worker-status");
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to fetch status");
      }

      const newStatus = data.status || "offline";
      setStatusState(newStatus);
      statusRef.current = newStatus;
      console.log("✅ Worker status refreshed:", newStatus);
    } catch (err) {
      console.error("❌ Failed to fetch worker status:", err);
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }, []);

  /* ---------------------------------------------------- */
  /* Update status                                        */
  /* ---------------------------------------------------- */
  const setStatus = useCallback(async (newStatus: WorkerActivity) => {
    try {
      setIsLoading(true);
      setError(null);
      
      console.log("🔄 Updating worker status to:", newStatus);
      
      const res = await fetch("/api/taskrouter/worker-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to update status");
      }

      setStatusState(newStatus);
      statusRef.current = newStatus;
      console.log("✅ Worker status updated to:", newStatus);
    } catch (err) {
      console.error("❌ Failed to update worker status:", err);
      setError(err instanceof Error ? err.message : "Unknown error");
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  /* ---------------------------------------------------- */
  /* Heartbeat (keeps worker alive)                       */
  /* ---------------------------------------------------- */
  useEffect(() => {
    heartbeatRef.current = setInterval(() => {
      if (statusRef.current !== "offline") {
        fetch("/api/taskrouter/heartbeat", { method: "POST" }).catch(() => {});
      }
    }, HEARTBEAT_INTERVAL);

    return () => {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
      }
    };
  }, []);

  /* ---------------------------------------------------- */
  /* Auto-offline on tab close / refresh                  */
  /* ---------------------------------------------------- */
  useEffect(() => {
    const goOffline = () => {
      if (statusRef.current !== "offline") {
        navigator.sendBeacon(
          "/api/taskrouter/worker-status",
          JSON.stringify({ status: "offline" })
        );
      }
    };

    window.addEventListener("beforeunload", goOffline);
    window.addEventListener("pagehide", goOffline);

    return () => {
      window.removeEventListener("beforeunload", goOffline);
      window.removeEventListener("pagehide", goOffline);
    };
  }, []);

  /* ---------------------------------------------------- */
  /* Initial load                                        */
  /* ---------------------------------------------------- */
  useEffect(() => {
    refresh();
  }, [refresh]);

  const value: WorkerStatusContextType = {
    status,
    isLoading,
    error,
    setStatus,
    refresh,
  };

  return (
    <WorkerStatusContext.Provider value={value}>
      {children}
    </WorkerStatusContext.Provider>
  );
}