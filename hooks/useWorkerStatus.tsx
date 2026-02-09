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
  const MAX_RETRIES = 3;

  /* ---------------------------------------------------- */
  /* Fetch current status                                 */
  /* ---------------------------------------------------- */
  const refresh = useCallback(async () => {
    // Don't refresh if session is known to be expired
    if (authFailedRef.current) {
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      const res = await fetch("/api/taskrouter/worker-status");
      const data = await res.json();

      if (res.status === 401) {
        authFailedRef.current = true;
        setIsSessionExpired(true);
        setError("Session expired - please refresh the page");
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
  }, []);

  /* ---------------------------------------------------- */
  /* Update status                                        */
  /* ---------------------------------------------------- */
  const setStatus = useCallback(async (newStatus: WorkerActivity) => {
    // Don't allow status updates if session is expired
    if (authFailedRef.current) {
      throw new Error("Session expired - please refresh the page");
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
        authFailedRef.current = true;
        setIsSessionExpired(true);
        setError("Session expired - please refresh the page");
        throw new Error("Session expired - please refresh the page");
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
  }, []);

  /* ---------------------------------------------------- */
  /* SSE connection for real-time status updates          */
  /* ---------------------------------------------------- */
  useEffect(() => {
    const connectSSE = () => {
      // Don't reconnect if we know auth has failed
      if (authFailedRef.current) {
        console.log("🚫 SSE reconnect skipped - session expired");
        return;
      }

      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }

      const eventSource = new EventSource("/api/taskrouter/worker-status-stream");
      eventSourceRef.current = eventSource;

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          // Handle auth error from server - stop retrying
          if (data.error === "unauthorized" || data.code === 401) {
            console.error("❌ Session expired - stopping SSE reconnection");
            authFailedRef.current = true;
            setIsSessionExpired(true);
            setError("Session expired - please refresh the page");
            setIsLoading(false);
            eventSource.close();
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

        // Don't retry if auth has failed
        if (authFailedRef.current) {
          return;
        }

        // Increment retry count
        retryCountRef.current += 1;

        // Stop retrying after MAX_RETRIES to prevent infinite loop
        if (retryCountRef.current >= MAX_RETRIES) {
          console.error("❌ Max SSE retries reached - stopping reconnection");
          setError("Connection lost - please refresh the page");
          setIsLoading(false);
          return;
        }

        // Reconnect after 5 seconds with exponential backoff
        const backoffTime = Math.min(5000 * Math.pow(2, retryCountRef.current - 1), 30000);
        console.log(`🔄 SSE reconnecting in ${backoffTime}ms (attempt ${retryCountRef.current}/${MAX_RETRIES})`);
        setTimeout(connectSSE, backoffTime);
      };
    };

    connectSSE();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  /* ---------------------------------------------------- */
  /* Auto-offline on tab close / refresh                  */
  /* ---------------------------------------------------- */
  useEffect(() => {
    const goOffline = () => {
      // Don't send beacon if session is expired
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
  /* Initial load handled by SSE connection              */
  /* ---------------------------------------------------- */

  const value: WorkerStatusContextType = {
    status,
    isLoading,
    error,
    isSessionExpired,
    setStatus,
    refresh,
  };

  return (
    <WorkerStatusContext.Provider value={value}>
      {children}
    </WorkerStatusContext.Provider>
  );
}