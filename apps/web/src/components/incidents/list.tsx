import { WarningIcon } from "@phosphor-icons/react";

import { IncidentCard, IncidentCardSkeleton } from "@/components/incidents/card";
import { useIncidentsQuery } from "@/components/incidents/query-options";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Route } from "@/routes/_incidents/incidentes";

import type { ListIncidentsResponse } from "@/lib/api/types.gen";

type IncidentsListVariant = "default" | "sidebar";

type IncidentsListProps = {
  variant?: IncidentsListVariant;
  onIncidentHoverChange?: (incidentId: number | null) => void;
};

const SORT_OPTIONS = [
  { value: "newest", label: "Más recientes" },
  { value: "oldest", label: "Más antiguos" },
  { value: "most-dispatched", label: "Más despachados" },
  { value: "least-dispatched", label: "Menos despachados" }
] as const;

type IncidentSortValue = (typeof SORT_OPTIONS)[number]["value"];

function formatIncidentsCount(count: number): string {
  const label = count === 1 ? "incidente" : "incidentes";
  return `${count.toLocaleString("es-CR")} ${label}`;
}

function IncidentsListHeader({
  variant,
  subtitle,
  sortValue,
  onSortChange,
  disableSort = false
}: {
  variant: IncidentsListVariant;
  subtitle: string;
  sortValue?: IncidentSortValue;
  onSortChange?: (sort: IncidentSortValue) => void;
  disableSort?: boolean;
}) {
  const isSidebar = variant === "sidebar";

  return (
    <div
      className={cn(
        isSidebar
          ? "sticky top-0 z-10 -mx-3 mb-2 border-b border-border/70 bg-background/95 px-3 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80"
          : "mb-5 py-3"
      )}>
      <div className={cn(isSidebar && "flex items-start justify-between gap-3")}>
        <div>
          <h2 className={cn(isSidebar ? "text-lg font-semibold" : "text-2xl font-semibold")}>
            Resultados de la búsqueda
          </h2>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
        {isSidebar && (
          <Select
            value={sortValue ?? "newest"}
            items={SORT_OPTIONS}
            onValueChange={(value) => onSortChange?.(value as IncidentSortValue)}>
            <SelectTrigger
              size="sm"
              className="w-[11.5rem] bg-background"
              disabled={disableSort}>
              <SelectValue placeholder="Ordenar" />
            </SelectTrigger>
            <SelectPopup>
              {SORT_OPTIONS.map((option) => (
                <SelectItem
                  key={option.value}
                  value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        )}
      </div>
    </div>
  );
}

function getSectionClassName(variant: IncidentsListVariant) {
  if (variant === "sidebar") {
    return "min-h-full";
  }

  return "mx-auto w-full max-w-6xl px-6 pb-28 xl:px-0";
}

function getGridClassName(variant: IncidentsListVariant) {
  if (variant === "sidebar") {
    return "grid grid-cols-1 gap-3 2xl:grid-cols-2";
  }

  return "grid grid-cols-1 gap-4 md:grid-cols-2";
}

export function IncidentsList({ variant = "default", onIncidentHoverChange }: IncidentsListProps) {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data, isPending, isError } = useIncidentsQuery(search);
  const incidents = data?.data ?? [];
  const currentSort = search.sort ?? "newest";

  const handleSortChange = (sort: IncidentSortValue) => {
    void navigate({
      search: (prev) => ({ ...prev, sort }),
      replace: true,
      resetScroll: false
    });
  };

  if (isPending) {
    return (
      <IncidentsListSkeleton
        variant={variant}
        sortValue={currentSort}
      />
    );
  }

  if (isError) {
    return <IncidentsListError variant={variant} />;
  }

  if (incidents.length === 0) {
    return <IncidentsListEmpty variant={variant} />;
  }

  return (
    <section className={getSectionClassName(variant)}>
      <IncidentsListHeader
        variant={variant}
        subtitle={formatIncidentsCount(incidents.length)}
        sortValue={currentSort}
        onSortChange={handleSortChange}
      />

      <IncidentsGrid
        incidents={incidents}
        variant={variant}
        onIncidentHoverChange={onIncidentHoverChange}
      />
    </section>
  );
}

function IncidentsGrid({
  incidents,
  variant,
  onIncidentHoverChange
}: {
  incidents: ListIncidentsResponse["data"];
  variant: IncidentsListVariant;
  onIncidentHoverChange?: (incidentId: number | null) => void;
}) {
  return (
    <div className={getGridClassName(variant)}>
      {incidents.map((incident) => (
        <IncidentCard
          key={incident.id}
          incident={incident}
          onIncidentHoverChange={onIncidentHoverChange}
        />
      ))}
    </div>
  );
}

function IncidentsListSkeleton({
  variant,
  sortValue
}: {
  variant: IncidentsListVariant;
  sortValue: IncidentSortValue;
}) {
  const cards = variant === "sidebar" ? 12 : 8;

  return (
    <section className={getSectionClassName(variant)}>
      <IncidentsListHeader
        variant={variant}
        subtitle="Cargando"
        sortValue={sortValue}
        disableSort
      />
      <div className={getGridClassName(variant)}>
        {Array.from({ length: cards }).map((_, index) => (
          <IncidentCardSkeleton key={index} />
        ))}
      </div>
    </section>
  );
}

function IncidentsListEmpty({ variant }: { variant: IncidentsListVariant }) {
  return (
    <section className={getSectionClassName(variant)}>
      <div className="flex min-h-56 flex-col items-center justify-center rounded-xl border border-dashed bg-muted/30 text-center">
        <p className="text-base font-medium">No se encontraron incidentes</p>
        <p className="text-sm text-muted-foreground">Intenta ajustar los filtros de búsqueda.</p>
      </div>
    </section>
  );
}

function IncidentsListError({ variant }: { variant: IncidentsListVariant }) {
  return (
    <section className={getSectionClassName(variant)}>
      <div className="flex min-h-56 flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-muted/30 text-center text-muted-foreground">
        <WarningIcon className="size-6" />
        <p className="text-sm">Ocurrió un error cargando los incidentes.</p>
      </div>
    </section>
  );
}
