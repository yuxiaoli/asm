import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { trackPageView } from "../lib/analytics.js";

/**
 * Send virtual page views on HashRouter navigations (issue #645).
 *
 * Disabled by default: App does not install this hook or any tracking scripts.
 * Configure an owned provider before enabling tracking.
 */
export function usePageTracking() {
  const location = useLocation();

  useEffect(() => {
    trackPageView(location);
  }, [location]);
}
