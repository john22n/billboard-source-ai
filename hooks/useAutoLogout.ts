"use client";
import { useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";

/**
 * Auto-logout hook that logs users out at 8pm local time.
 *
 * - Login before 8pm → logged out at 8pm same day
 * - Login after 8pm → logged out at 8pm NEXT day
 * - Workers with simultaneous_ring=true → exempt from auto-logout entirely
 */
const LOGOUT_HOUR = 20; // 8pm in 24-hour format

export function useAutoLogout() {
  const router = useRouter();
  const hasLoggedOutRef = useRef(false);
  const checkIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const nextLogoutTimeRef = useRef<Date | null>(null);
  const isExemptRef = useRef<boolean | null>(null); // null = not yet checked

  // Check if this worker is exempt from auto-logout
  useEffect(() => {
    async function checkExemption() {
      try {
        const res = await fetch("/api/taskrouter/worker-status");
        if (res.ok) {
          const data = await res.json();
          const attrs =
            typeof data.attributes === "string"
              ? JSON.parse(data.attributes)
              : data.attributes ?? {};

          if (attrs.simultaneous_ring) {
            console.log(
              `⏭️ Auto-logout disabled for ${attrs.email} (simultaneous ring enabled)`
            );
            isExemptRef.current = true;
            return;
          }
        }
      } catch (err) {
        console.warn("⚠️ Could not check worker exemption, defaulting to auto-logout enabled:", err);
      }

      // Not exempt — calculate the next 8pm logout time
      isExemptRef.current = false;
      const now = new Date();
      const next8pm = new Date(now);
      next8pm.setHours(LOGOUT_HOUR, 0, 0, 0);

      // If it's already past 8pm today, next logout is tomorrow at 8pm
      if (now.getHours() >= LOGOUT_HOUR) {
        next8pm.setDate(next8pm.getDate() + 1);
      }

      nextLogoutTimeRef.current = next8pm;
      console.log(`🕐 Session started: ${now.toLocaleString()}`);
      console.log(`🕗 Next auto-logout scheduled: ${next8pm.toLocaleString()}`);
    }

    checkExemption();
  }, []);

  const performLogout = useCallback(async () => {
    // Prevent multiple logout attempts
    if (hasLoggedOutRef.current) return;
    hasLoggedOutRef.current = true;

    console.log("🕗 8pm auto-logout triggered");

    try {
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
      await fetch("/api/auth/logout", { method: "POST" });
    } catch (error) {
      console.error("Logout API call failed:", error);
    }

    router.push("/login?reason=auto-logout");
  }, [router]);

  const checkTime = useCallback(() => {
    // Don't do anything until exemption check resolves
    if (isExemptRef.current === null) return;

    // Skip entirely if exempt
    if (isExemptRef.current) return;

    const now = new Date();
    if (
      nextLogoutTimeRef.current &&
      now >= nextLogoutTimeRef.current &&
      !hasLoggedOutRef.current
    ) {
      performLogout();
    }
  }, [performLogout]);

  useEffect(() => {
    const startChecking = setTimeout(() => {
      checkTime();
      checkIntervalRef.current = setInterval(checkTime, 60 * 1000);
    }, 1000);

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