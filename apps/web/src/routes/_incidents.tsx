import { Outlet, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_incidents")({
  component: MapLayout
});

function MapLayout() {
  return (
    <div className="max-md:pt-0 md:pt-(--app-header-height)">
      <Outlet />
    </div>
  );
}
