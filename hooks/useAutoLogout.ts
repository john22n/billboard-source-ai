"use client";

import { useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";

/**
 * Auto-logout hook that logs users out at 8pm local time
 * ONLY if they were logged in before 8pm.
 * 
 * Users who log in after 8pm will NOT be auto-logged out.
 */

const LOGOUT_HOUR = 20; // 8pm in 24-hour format

export function useAutoLogout() {
  const router = useRouter();
  const hasLoggedOutRef = useRef(false);
  const checkIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const loginHourRef = useRef<number | null>(null);

  // Capture the hour when user logged in (when hook first mounts)
  useEffect(() => {
    const now = new Date();
    loginHourRef.current = now.getHours();
    console.log(`🕐 Session started at hour: ${loginHourRef.current}`);
  }, []);

  const performLogout = useCallback(async () => {
    // Prevent multiple logout attempts
    if (hasLoggedOutRef.current) return;
    hasLoggedOutRef.current = true;

    console.log("🕗 8pm auto-logout triggered");

    try {
      // First, set worker status to offline
      await fetch("/api/taskrouter/worker-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "offline" }),
      });
      console.log("✅ Worker set to offline");
    } catch (error) {
      console.error("Failed to set worker offline:", error);
    }

    try {
      // Then call logout API endpoint
      await fetch("/api/auth/logout", { method: "POST" });
    } catch (error) {
      console.error("Logout API call failed:", error);
    }

    // Redirect to login page
    router.push("/login?reason=auto-logout");
  }, [router]);

  const checkTime = useCallback(() => {
    const now = new Date();
    const currentHour = now.getHours();

    // Only logout if:
    // 1. It's 8pm or later
    // 2. User logged in BEFORE 8pm
    // 3. Haven't already logged out
    const loggedInBefore8pm = loginHourRef.current !== null && loginHourRef.current < LOGOUT_HOUR;
    
    if (currentHour >= LOGOUT_HOUR && loggedInBefore8pm && !hasLoggedOutRef.current) {
      performLogout();
    }
  }, [performLogout]);

  useEffect(() => {
    // Don't check immediately - wait for loginHourRef to be set
    // Then check every minute
    const startChecking = setTimeout(() => {
      checkTime();
      checkIntervalRef.current = setInterval(checkTime, 60 * 1000);
    }, 1000);

    // Also check when tab becomes visible (in case user was away)
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        checkTime();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearTimeout(startChecking);
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current);
      }
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [checkTime]);
}