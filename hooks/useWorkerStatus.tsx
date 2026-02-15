"use client";

import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from "react";

export type WorkerActivity = "available" | "unavailable" | "offline";

interface WorkerStatusContextType {
  status: WorkerActivity;
  isLoading: boolean;
  error: string | null;
  isSessionExpired: boolean;
  setStatus: (status: WorkerActivity) => Promise<void>;
  refresh: () => Promise<void>;
  reconnect: () => void;
}

const WorkerStatusContext = createContext<WorkerStatusContextType | null>(null);

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
  const [isSessionExpired, setIsSessionExpired] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const statusRef = useRef<WorkerActivity>("offline");
  const authFailedRef = useRef(false);
  const retryCountRef = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const MAX_RETRIES = 5;

  /* ---------------------------------------------------- */
  /* Set worker offline (used when session expires)       */
  /* ---------------------------------------------------- */
  const setWorkerOffline = useCallback(() => {
    // Use sendBeacon to try to set offline even if session is expiring
    // This is fire-and-forget, may or may not succeed
    try {
      navigator.sendBeacon(
        "/api/taskrouter/worker-status",
        JSON.stringify({ status: "offline" })
      );
      console.log("📡 Attempted to set worker offline via sendBeacon");
    } catch (error) {
      console.error("Failed to send offline beacon:", error);
    }
    
    // Update local state regardless
    setStatusState("offline");
    statusRef.current = "offline";
  }, []);

  /* ---------------------------------------------------- */
  /* Handle session expiration                            */
  /* ---------------------------------------------------- */
  const handleSessionExpired = useCallback(() => {
    if (authFailedRef.current) return; // Already handled
    
    console.error("❌ Session expired - setting worker offline");
    authFailedRef.current = true;
    setIsSessionExpired(true);
    setError("Session expired - please log in again");
    setIsLoading(false);
    
    // Try to set worker offline before fully expiring
    setWorkerOffline();
  }, [setWorkerOffline]);

  /* ---------------------------------------------------- */
  /* Fetch current status                                 */
  /* ---------------------------------------------------- */
  const refresh = useCallback(async () => {
    if (authFailedRef.current) {
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      const res = await fetch("/api/taskrouter/worker-status");
      const data = await res.json();

      if (res.status === 401) {
        handleSessionExpired();
        return;
      }

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
  }, [handleSessionExpired]);

  /* ---------------------------------------------------- */
  /* Update status                                        */
  /* ---------------------------------------------------- */
  const setStatus = useCallback(async (newStatus: WorkerActivity) => {
    if (authFailedRef.current) {
      throw new Error("Session expired - please log in again");
    }

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

      if (res.status === 401) {
        handleSessionExpired();
        throw new Error("Session expired - please log in again");
      }

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
  }, [handleSessionExpired]);

  /* ---------------------------------------------------- */
  /* SSE connection function                              */
  /* ---------------------------------------------------- */
  const connectSSE = useCallback(() => {
    if (authFailedRef.current) {
      console.log("🚫 SSE reconnect skipped - session expired");
      return;
    }

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    console.log("📡 SSE connecting...");
    const eventSource = new EventSource("/api/taskrouter/worker-status-stream");
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        // Handle auth error from server - set offline and stop retrying
        if (data.error === "unauthorized" || data.code === 401) {
          eventSource.close();
          handleSessionExpired();
          return;
        }

        if (data.error) {
          console.error("❌ SSE error:", data.error);
          setError(data.error);
          return;
        }

        // Reset retry count on successful message
        retryCountRef.current = 0;

        const newStatus = data.status || "offline";
        if (newStatus !== statusRef.current) {
          setStatusState(newStatus);
          statusRef.current = newStatus;
          console.log("✅ Worker status updated via SSE:", newStatus);
        }

        setIsLoading(false);
        setError(null);
      } catch (err) {
        console.error("❌ Failed to parse SSE message:", err);
      }
    };

    eventSource.onerror = (err) => {
      console.error("❌ SSE connection error:", err);
      eventSource.close();
      eventSourceRef.current = null;

      if (authFailedRef.current) {
        return;
      }

      retryCountRef.current += 1;

      if (retryCountRef.current >= MAX_RETRIES) {
        console.error("❌ Max SSE retries reached - stopping reconnection");
        setError("Connection interrupted. Click 'Reconnect' to try again.");
        setIsLoading(false);
        return;
      }

      const backoffTime = Math.min(5000 * Math.pow(2, retryCountRef.current - 1), 30000);
      console.log(`🔄 SSE reconnecting in ${backoffTime}ms (attempt ${retryCountRef.current}/${MAX_RETRIES})`);
      reconnectTimeoutRef.current = setTimeout(connectSSE, backoffTime);
    };
  }, [handleSessionExpired]);

  /* ---------------------------------------------------- */
  /* Manual reconnect                                     */
  /* ---------------------------------------------------- */
  const reconnect = useCallback(() => {
    console.log("🔄 Manual reconnect triggered");
    
    retryCountRef.current = 0;
    authFailedRef.current = false;
    setIsSessionExpired(false);
    setError(null);
    setIsLoading(true);

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    connectSSE();
  }, [connectSSE]);

  /* ---------------------------------------------------- */
  /* Initial SSE connection                               */
  /* ---------------------------------------------------- */
  useEffect(() => {
    connectSSE();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, [connectSSE]);

  /* ---------------------------------------------------- */
  /* Auto-offline on tab close / refresh                  */
  /* ---------------------------------------------------- */
  useEffect(() => {
    const goOffline = () => {
      if (authFailedRef.current) {
        return;
      }

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
  /* Context value                                        */
  /* ---------------------------------------------------- */
  const value: WorkerStatusContextType = {
    status,
    isLoading,
    error,
    isSessionExpired,
    setStatus,
    refresh,
    reconnect,
  };

  return (
    <WorkerStatusContext.Provider value={value}>
      {children}
    </WorkerStatusContext.Provider>
  );
}