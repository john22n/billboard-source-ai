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
  reconnect: () => void; // New: manual reconnect without page refresh
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
  const MAX_RETRIES = 5; // Increased slightly to handle brief network blips

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
        setError("Session expired - please log in again");
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
        authFailedRef.current = true;
        setIsSessionExpired(true);
        setError("Session expired - please log in again");
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
  }, []);

  /* ---------------------------------------------------- */
  /* SSE connection function (extracted for reuse)        */
  /* ---------------------------------------------------- */
  const connectSSE = useCallback(() => {
    // Don't reconnect if we know auth has failed
    if (authFailedRef.current) {
      console.log("🚫 SSE reconnect skipped - session expired");
      return;
    }

    // Clear any pending reconnect timeout
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    // Close existing connection
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

        // Handle auth error from server - stop retrying
        if (data.error === "unauthorized" || data.code === 401) {
          console.error("❌ Session expired - stopping SSE reconnection");
          authFailedRef.current = true;
          setIsSessionExpired(true);
          setError("Session expired - please log in again");
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
      eventSourceRef.current = null;

      // Don't retry if auth has failed
      if (authFailedRef.current) {
        return;
      }

      // Increment retry count
      retryCountRef.current += 1;

      // Stop retrying after MAX_RETRIES to prevent infinite loop
      if (retryCountRef.current >= MAX_RETRIES) {
        console.error("❌ Max SSE retries reached - stopping reconnection");
        setError("Connection interrupted. Click 'Reconnect' to try again.");
        setIsLoading(false);
        return;
      }

      // Reconnect with exponential backoff
      const backoffTime = Math.min(5000 * Math.pow(2, retryCountRef.current - 1), 30000);
      console.log(`🔄 SSE reconnecting in ${backoffTime}ms (attempt ${retryCountRef.current}/${MAX_RETRIES})`);
      reconnectTimeoutRef.current = setTimeout(connectSSE, backoffTime);
    };
  }, []);

  /* ---------------------------------------------------- */
  /* Manual reconnect (resets everything and tries again) */
  /* ---------------------------------------------------- */
  const reconnect = useCallback(() => {
    console.log("🔄 Manual reconnect triggered");
    
    // Reset all failure flags
    retryCountRef.current = 0;
    authFailedRef.current = false;
    setIsSessionExpired(false);
    setError(null);
    setIsLoading(true);

    // Clear any pending reconnect timeout
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    // Close existing connection if any
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    // Start fresh connection
    connectSSE();
  }, [connectSSE]);

  /* ---------------------------------------------------- */
  /* Initial SSE connection                               */
  /* ---------------------------------------------------- */
  useEffect(() => {
    connectSSE();

    return () => {
      // Cleanup on unmount
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
  /* Context value                                        */
  /* ---------------------------------------------------- */
  const value: WorkerStatusContextType = {
    status,
    isLoading,
    error,
    isSessionExpired,
    setStatus,
    refresh,
    reconnect, // New: exposed for UI to use
  };

  return (
    <WorkerStatusContext.Provider value={value}>
      {children}
    </WorkerStatusContext.Provider>
  );
}