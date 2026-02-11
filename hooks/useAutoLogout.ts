"use client";

import { useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";

/**
 * Auto-logout hook that logs users out at 8pm local time
 * 
 * Usage: Add to your main layout or dashboard layout:
 * 
 * function DashboardLayout({ children }) {
 *   useAutoLogout();
 *   return <>{children}</>;
 * }
 */

const LOGOUT_HOUR = 20; // 8pm in 24-hour format

export function useAutoLogout() {
  const router = useRouter();
  const hasLoggedOutRef = useRef(false);
  const checkIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const performLogout = useCallback(async () => {
    // Prevent multiple logout attempts
    if (hasLoggedOutRef.current) return;
    hasLoggedOutRef.current = true;

    console.log("🕗 8pm auto-logout triggered");

    try {
      // Call your logout API endpoint
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

    // If it's 8pm (20:00) or later, trigger logout
    if (currentHour >= LOGOUT_HOUR && !hasLoggedOutRef.current) {
      performLogout();
    }
  }, [performLogout]);

  useEffect(() => {
    // Check immediately on mount
    checkTime();

    // Then check every minute
    checkIntervalRef.current = setInterval(checkTime, 60 * 1000);

    // Also check when tab becomes visible (in case user was away)
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        checkTime();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current);
      }
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [checkTime]);

  // Reset the logout flag at midnight so users can log in the next day
  useEffect(() => {
    const checkMidnightReset = () => {
      const now = new Date();
      const currentHour = now.getHours();

      // Reset flag between midnight and 5am (allowing for next day logins)
      if (currentHour >= 0 && currentHour < 5) {
        hasLoggedOutRef.current = false;
      }
    };

    const midnightInterval = setInterval(checkMidnightReset, 60 * 60 * 1000); // Check every hour

    return () => clearInterval(midnightInterval);
  }, []);
}
