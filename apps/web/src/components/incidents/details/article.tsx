import { WarningIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";

import { Skeleton } from "@/components/ui/skeleton";
import { isUndefinedDate } from "@/lib/utils";
import { Route } from "@/routes/_dashboard/incidentes/$slug";

const tenMinutesInMs = 600_000;

function formatArticleForTime(date: Date): "la" | "las" {
  const hour = date.getHours() % 12;
  return hour === 1 ? "la" : "las";
}

function formatListSpanish(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0] ?? "";
  return items.join(", ");
}

function calculateDuration(arrivalTime: Date, departureTime: Date): string {
  const diffMs = departureTime.getTime() - arrivalTime.getTime();
  const totalMinutes = Math.round(diffMs / (1000 * 60));

  if (totalMinutes === 0) {
    return "1 minuto";
  }

  return `${totalMinutes} minuto${totalMinutes !== 1 ? "s" : ""}`;
}

function calculateResponseTime(dispatchTime: Date, arrivalTime: Date): string {
  const diffMs = arrivalTime.getTime() - dispatchTime.getTime();
  const minutes = Math.floor(diffMs / (1000 * 60));
  const seconds = Math.floor((diffMs % (1000 * 60)) / 1000);

  if (minutes > 0) {
    return `${minutes} minuto${minutes !== 1 ? "s" : ""}${seconds > 0 ? ` y ${seconds} segundo${seconds !== 1 ? "s" : ""}` : ""}`;
  }
  return `${seconds} segundo${seconds !== 1 ? "s" : ""}`;
}

export function IncidentArticle() {
  const { incident } = Route.useLoaderData();

  const incidentTimestamp = new Date(incident.incidentTimestamp);
  const formattedIncidentDate = incidentTimestamp.toLocaleString("es-CR", {
    day: "2-digit",
    month: "long",
    year: "numeric"
  });
  const formattedIncidentTime = incidentTimestamp.toLocaleTimeString("es-CR", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });

  const responsibleStation = incident.dispatchedStations.find((station) => station.isResponsible);

  const supportingStations = incident.dispatchedStations.filter(
    (station) => !station.isResponsible
  );

  const firstBatchVehicles = responsibleStation
    ? responsibleStation.vehicles
        .filter((v) => v.dispatchedTime && v.arrivalTime)
        .filter(
          (v) =>
            !isUndefinedDate(new Date(v.dispatchedTime ?? "")) &&
            !isUndefinedDate(new Date(v.arrivalTime ?? ""))
        )
        .filter((v) => {
          const timeDiff =
            new Date(v.dispatchedTime ?? "").getTime() -
            new Date(incident.incidentTimestamp).getTime();
          return timeDiff >= 0 && timeDiff <= tenMinutesInMs;
        })
        .sort(
          (a, b) =>
            new Date(a.dispatchedTime ?? "").getTime() - new Date(b.dispatchedTime ?? "").getTime()
        )
    : [];

  const allVehicles = incident.dispatchedStations.flatMap((s) => s.vehicles);

  const getSingleVehicleWithDeparture = (
    allVehicles: (typeof incident.dispatchedStations)[number]["vehicles"]
  ) => {
    if (allVehicles.length !== 1) return null;
    const vehicle = allVehicles[0];
    // Check if departureTime and arrivalTime exist and are valid dates
    if (!vehicle.departureTime || isUndefinedDate(new Date(vehicle.departureTime))) return null;
    if (!vehicle.arrivalTime || isUndefinedDate(new Date(vehicle.arrivalTime))) return null;

    return vehicle;
  };

  const singleVehicleWithDeparture = getSingleVehicleWithDeparture(allVehicles);

  return (
    <article className="flex flex-col gap-4 md:gap-6">
      <h1>{incident.title}</h1>
      <figure className="not-typography">
        {incident.mapImageUrl ? (
          // TODO: Re-enable interactive map when ready
          // <IncidentMap
          //   latitude={Number(incident.latitude)}
          //   longitude={Number(incident.longitude)}
          //   stations={incident.dispatchedStations.map((station) => ({
          //     latitude: Number(station.station.latitude),
          //     longitude: Number(station.station.longitude),
          //     name: station.station.name
          //   }))}
          // />
          <div className="relative aspect-video w-full overflow-hidden rounded-xl">
            <img
              src={incident.mapImageUrl}
              alt="magen satelital de las coordenadas del incidente"
              referrerPolicy="origin"
              className="h-full w-full object-cover"
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 100vw, 672px"
              fetchPriority="high"
            />
          </div>
        ) : (
          <div className="relative flex min-h-[400px] flex-col gap-4 overflow-hidden rounded-xl border-2 bg-muted">
            <div className="absolute inset-0 z-20 flex items-center justify-center backdrop-blur-sm">
              <div className="mx-4 w-fit rounded-md bg-background/60 px-4 py-3 backdrop-blur-3xl">
                <p className="text-sm select-none">
                  <WarningIcon
                    className="me-3 -mt-0.5 inline-flex text-amber-500"
                    size={16}
                    aria-hidden="true"
                  />
                  Coordenadas aún no disponibles.
                </p>
              </div>
            </div>
          </div>
        )}
      </figure>
      <time dateTime={incidentTimestamp.toISOString()}>
        {formattedIncidentDate}, {formattedIncidentTime}
      </time>
      <section className="space-y-4">
        <p>
          Al ser {formatArticleForTime(incidentTimestamp)} {formattedIncidentTime}, Bomberos recibe
          una alerta de "
          <em className="lowercase">
            {[incident.dispatchType?.name, incident.specificDispatchType?.name]
              .filter(Boolean)
              .join(", ") || "incidente"}
          </em>
          ". En la dirección:
        </p>
        <blockquote>{incident.address}</blockquote>
        {responsibleStation && (
          <p>
            Se asigna la estación{" "}
            <Link
              to={`/estaciones/$name`}
              params={{ name: responsibleStation.name }}>
              {responsibleStation.name}
            </Link>{" "}
            como responsable
            {responsibleStation.vehicles.length > 0 && (
              <>
                {" "}
                y se{" "}
                {responsibleStation.vehicles.length > 1
                  ? "despachan las unidades"
                  : "despacha la unidad"}{" "}
                {formatListSpanish(responsibleStation.vehicles.map((v) => v.internalNumber))}
              </>
            )}
            {firstBatchVehicles.length > 0 && (
              <>
                {" "}
                que con un tiempo de respuesta de{" "}
                {calculateResponseTime(
                  new Date(firstBatchVehicles[0].dispatchedTime ?? ""),
                  new Date(firstBatchVehicles[0].arrivalTime ?? "")
                )}{" "}
                {firstBatchVehicles.length > 1 ? "llegan" : "llega"} a la escena al ser{" "}
                {formatArticleForTime(new Date(firstBatchVehicles[0].arrivalTime ?? ""))}{" "}
                {new Date(firstBatchVehicles[0].arrivalTime ?? "").toLocaleTimeString("es-CR", {
                  hour: "numeric",
                  minute: "2-digit",
                  hour12: true
                })}
              </>
            )}
            .
          </p>
        )}
        {singleVehicleWithDeparture && (
          <p>
            La unidad {singleVehicleWithDeparture.internalNumber} permanece en la escena por{" "}
            {calculateDuration(
              new Date(singleVehicleWithDeparture.arrivalTime ?? ""),
              new Date(singleVehicleWithDeparture.departureTime ?? "")
            )}{" "}
            y se retira al ser{" "}
            {formatArticleForTime(new Date(singleVehicleWithDeparture.departureTime ?? ""))}{" "}
            {new Date(singleVehicleWithDeparture.departureTime ?? "").toLocaleTimeString("es-CR", {
              hour: "numeric",
              minute: "2-digit",
              hour12: true
            })}
            .
          </p>
        )}

        {supportingStations.length > 0 && (
          <p>
            Adicionalmente, se{" "}
            {supportingStations.length > 1 ? "despachan las estaciones" : "despacha la estación"}{" "}
            {supportingStations.map((s, index) => {
              const isLast = index === supportingStations.length - 1;
              const isSecondLast = index === supportingStations.length - 2;

              return (
                <span key={s.name}>
                  <Link
                    to={`/estaciones/$name`}
                    params={{ name: s.name }}>
                    {s.name}
                  </Link>
                  {!isLast && (isSecondLast ? " y " : ", ")}
                </span>
              );
            })}{" "}
            que apoyan con {supportingStations.flatMap((s) => s.vehicles).length} unidades
            adicionales.
          </p>
        )}

        {(() => {
          const dispatchTypeDisplay = [
            incident.dispatchType?.name,
            incident.specificDispatchType?.name
          ]
            .filter(Boolean)
            .join(", ");
          const actualTypeDisplay = [incident.actualType?.name, incident.specificActualType?.name]
            .filter(Boolean)
            .join(", ");

          if (
            (!incident.isOpen || dispatchTypeDisplay !== actualTypeDisplay) &&
            actualTypeDisplay
          ) {
            return dispatchTypeDisplay !== actualTypeDisplay ? (
              <p>
                Los bomberos en la escena actualizan la clasificación del incidente a: "
                <em className="lowercase">{actualTypeDisplay}</em>".
              </p>
            ) : (
              <p>
                Los bomberos en la escena confirman la categoría del incidente como "
                <em className="lowercase">{actualTypeDisplay}</em>".
              </p>
            );
          }
          return null;
        })()}

        {incident.statistics.currentYearCount > 0 &&
          (() => {
            const currentYear = new Date().getFullYear();
            const isCurrentYear = incident.statistics.currentYear === currentYear;
            const count = incident.statistics.currentYearCount;
            const cantonCount = incident.statistics.currentYearCantonCount;
            const prevCount = incident.statistics.previousYearCount;

            const typeDisplay = [
              incident.actualType?.name ?? incident.dispatchType?.name,
              incident.specificActualType?.name ?? incident.specificDispatchType?.name
            ]
              .filter(Boolean)
              .join(", ");

            // Verb conjugation based on tense and number
            const verb = isCurrentYear
              ? count === 1
                ? "se ha reportado"
                : "se han reportado"
              : count === 1
                ? "se reportó"
                : "se reportaron";

            return (
              <p>
                En {isCurrentYear ? "lo que va del" : "el"} {incident.statistics.currentYear} {verb}{" "}
                {count.toLocaleString("es-CR")} incidente{count !== 1 ? "s" : ""} de tipo "
                <em className="lowercase">{typeDisplay}</em>"
                {cantonCount > 0 && incident.cantonName && (
                  <>
                    {", "}
                    {cantonCount === 1
                      ? `siendo este el primero en el cantón de ${incident.cantonName}`
                      : `${cantonCount.toLocaleString("es-CR")} de ellos en ${incident.cantonName}`}
                  </>
                )}
                .
                {prevCount > 0 && (
                  <>
                    {" "}
                    En {incident.statistics.previousYear} hubo {prevCount.toLocaleString("es-CR")}{" "}
                    incidente{prevCount !== 1 ? "s" : ""} de este tipo.
                  </>
                )}
              </p>
            );
          })()}
      </section>
    </article>
  );
}

export function IncidentArticleSkeleton() {
  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <div className="space-y-2">
        <Skeleton className="h-9 w-full md:h-10" />
        <Skeleton className="h-9 w-full md:h-10" />
        <Skeleton className="h-9 w-3/4 md:h-10" />
      </div>

      <Skeleton className="aspect-video w-full rounded-xl" />

      <Skeleton className="h-5 w-56" />

      <section className="space-y-4">
        <div className="space-y-2">
          <Skeleton className="h-4 w-full max-w-prose" />
          <Skeleton className="h-4 w-3/4 max-w-prose" />
        </div>
        <Skeleton className="ml-4 h-5 w-5/6 max-w-prose border-l-4 pl-4" />
        <div className="space-y-2">
          <Skeleton className="h-4 w-full max-w-prose" />
          <Skeleton className="h-4 w-4/5 max-w-prose" />
          <Skeleton className="h-4 w-2/3 max-w-prose" />
        </div>
      </section>
    </div>
  );
}
