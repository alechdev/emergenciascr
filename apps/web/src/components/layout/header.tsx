import { useLocation } from "@tanstack/react-router";

import { HeaderNav } from "@/components/layout/header-nav";
import { Logo } from "@/components/layout/logo";
import { MobileHeaderNav } from "@/components/layout/mobile-header-nav";
import { useIsMobile } from "@/hooks/use-mobile";

export function Header() {
  const isMobile = useIsMobile();
  const { pathname } = useLocation();
  const normalizedPathname = pathname.replace(/\/+$/, "") || "/";
  const isIncidentesPage = normalizedPathname === "/incidentes";

  // Hide header on /incidentes page when on mobile
  if (isMobile && isIncidentesPage) {
    return null;
  }

  return (
    <header className="app-header rail-divider-bottom fixed inset-x-0 top-0 flex shrink-0 items-center bg-background px-6">
      <div className="mx-auto flex h-full w-full max-w-6xl items-center justify-between gap-3 px-2 sm:px-0">
        <Logo />
        <HeaderNav className="max-sm:hidden" />
        <MobileHeaderNav className="sm:hidden" />
      </div>
    </header>
  );
}
