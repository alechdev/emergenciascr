import { createFileRoute, Outlet } from "@tanstack/react-router";

import { Footer } from "@/components/layout/footer";

export const Route = createFileRoute("/_dashboard")({
  component: DashboardLayout
});

function DashboardLayout() {
  return (
    <>
      <main className="pt-(--app-header-height)">
        <div className="mx-auto min-h-[calc(100dvh-var(--app-header-height))] max-w-6xl px-8 pt-8 xl:px-0">
          <Outlet />
        </div>
      </main>
      <Footer />
    </>
  );
}
