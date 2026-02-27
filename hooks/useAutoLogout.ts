"use client";

import { useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";

/**
 * Auto-logout hook that logs users out at 8pm local time.
 *
 * - Login before 8pm → logged out at 8pm same day
 * - Login after 8pm → logged out at 8pm NEXT day
 *
 * @param currentUserEmail  The authenticated user's email address.
 *   Workers listed in NEXT_PUBLIC_AUTO_LOGOUT_EXCLUDED_EMAILS are exempted
 *   from the auto-8pm logout entirely.  All other workers retain the
 *   existing auto-logout behavior without modification.
 */

const LOGOUT_HOUR = 20; // 8pm in 24-hour format

/**
 * Comma-separated list of worker email addresses that should NOT be
 * automatically logged out at 8pm.
 *
 * Set in .env.local / .env.dev / .env.prod:
 *   NEXT_PUBLIC_AUTO_LOGOUT_EXCLUDED_EMAILS=mcdonald@billboardsource.com
 *
 * Multiple addresses: comma-separate with no spaces.
 *   NEXT_PUBLIC_AUTO_LOGOUT_EXCLUDED_EMAILS=mcdonald@billboardsource.com,other@billboardsource.com
 *
 * NEXT_PUBLIC_ prefix is required so the value is bundled into the
 * client-side JavaScript without an extra API round-trip.  These are
 * internal co-worker email addresses — not secrets.
 */
const EXCLUDED_EMAILS: Set<string> = new Set(
  (process.env.NEXT_PUBLIC_AUTO_LOGOUT_EXCLUDED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
);

export function useAutoLogout(currentUserEmail?: string) {
  // Derive exclusion status from the env-var set and the caller's email.
  // This is a plain boolean, NOT a hook — computed before any hook calls so
  // it's stable across renders and safe to reference in dependency arrays.
  const isExcluded = Boolean(
    currentUserEmail &&
      EXCLUDED_EMAILS.has(currentUserEmail.toLowerCase())
  );

  // ── All hooks are called unconditionally (React Rules of Hooks) ───────────
  // The exclusion guard is placed INSIDE each hook's callback / effect body,
  // never as a conditional that skips the hook call itself.
  const router              = useRouter();
  const hasLoggedOutRef     = useRef(false);
  const checkIntervalRef    = useRef<NodeJS.Timeout | null>(null);
  const loginTimestampRef   = useRef<Date | null>(null);
  const nextLogoutTimeRef   = useRef<Date | null>(null);

  // ── Schedule the next 8pm logout time ────────────────────────────────────
  useEffect(() => {
    // ── McDONALD / EXCLUDED WORKERS ─────────────────────────────────────────
    // Workers in NEXT_PUBLIC_AUTO_LOGOUT_EXCLUDED_EMAILS skip the timer
    // entirely.  No logout time is calculated; no interval is started below.
    if (isExcluded) {
      console.log(
        `⏭️ Auto-logout suppressed for excluded worker: ${currentUserEmail}`
      );
      return;
    }

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
  }, [isExcluded, currentUserEmail]);

  const performLogout = useCallback(async () => {
    // ── McDONALD / EXCLUDED WORKERS ─────────────────────────────────────────
    // Guard inside the callback so the hook is still called unconditionally.
    if (hasLoggedOutRef.current || isExcluded) return;
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
  }, [router, isExcluded]);

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
    // ── McDONALD / EXCLUDED WORKERS ─────────────────────────────────────────
    // Skip interval and visibility-change wiring for excluded workers.
    // The effect still runs (hook is called unconditionally) but returns early.
    if (isExcluded) return;

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
  }, [checkTime, isExcluded]);
}
