"use client";

import { useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";

/**
 * Auto-logout hook that logs users out at 8pm local time
 * 
 * - Login before 8pm → logged out at 8pm same day
 * - Login after 8pm → logged out at 8pm NEXT day
 */

const LOGOUT_HOUR = 20; // 8pm in 24-hour format

export function useAutoLogout() {
  const router = useRouter();
  const hasLoggedOutRef = useRef(false);
  const checkIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const loginTimestampRef = useRef<Date | null>(null);
  const nextLogoutTimeRef = useRef<Date | null>(null);

  // Calculate the next 8pm logout time based on login time
  useEffect(() => {
    const now = new Date();
    loginTimestampRef.current = now;

    // Calculate next 8pm
    const next8pm = new Date(now);
    next8pm.setHours(LOGOUT_HOUR, 0, 0, 0);

    // If it's already past 8pm today, next logout is tomorrow at 8pm
    if (now.getHours() >= LOGOUT_HOUR) {
      next8pm.setDate(next8pm.getDate() + 1);
    }

    nextLogoutTimeRef.current = next8pm;
    console.log(`🕐 Session started: ${now.toLocaleString()}`);
    console.log(`🕗 Next auto-logout scheduled: ${next8pm.toLocaleString()}`);
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

    // Check if we've reached the scheduled logout time
    if (
      nextLogoutTimeRef.current &&
      now >= nextLogoutTimeRef.current &&
      !hasLoggedOutRef.current
    ) {
      performLogout();
    }
  }, [performLogout]);

  useEffect(() => {
    // Wait for nextLogoutTimeRef to be set, then start checking
    const startChecking = setTimeout(() => {
      checkTime();
      checkIntervalRef.current = setInterval(checkTime, 60 * 1000); // Check every minute
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