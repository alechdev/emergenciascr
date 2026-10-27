import {
  type CostaRicaDateFormatOptions,
  formatCostaRicaDate,
  getCostaRicaDateParts,
  getCostaRicaYear
} from "@bomberoscr/lib/costa-rica-time";
import { isKnownDate } from "@bomberoscr/lib/missing-date";
import { Link } from "@tanstack/react-router";

import { RelativeTime } from "@/components/ui/relative-time";
import { Skeleton } from "@/components/ui/skeleton";
import {
  buildIncidentDeck,
  formatIncidentHeadline,
  formatPlaceName,
  getAttentionSeconds,
  toSentenceCase
} from "@/lib/incident-editorial";
import { Route } from "@/routes/_dashboard/incidentes/$slug";

const tenMinutesInMs = 600_000;

// Running text reads "8 de abril", not the site-wide zero-padded "08 de abril".
const bylineDateFormat: CostaRicaDateFormatOptions = {
  day: "numeric",
  month: "long",
  year: "numeric"
};

function formatArticleForTime(date: Date): "la" | "las" {
  const hour = getCostaRicaDateParts(date).hour % 12;
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

export function IncidentHeader() {
  const { incident, stations, responseTimes, timeline } = Route.useLoaderData();

  const incidentTimestamp = new Date(incident.incidentTimestamp);
  const headline = formatIncidentHeadline(incident.title, incident);
  const category = incident.actualTypeName ?? incident.dispatchTypeName;
  const deck = buildIncidentDeck({
    isOpen: incident.isOpen,
    stations,
    responseTimes,
    attentionSeconds: getAttentionSeconds(incident.incidentTimestamp, timeline)
  });

  return (
    <header>
      {category && <p className="text-sm text-muted-foreground">{toSentenceCase(category)}</p>}
      <h1 className="mt-3 font-serif text-3xl text-balance sm:text-4xl">{headline}</h1>
      {deck && (
        <p className="mt-5 text-lg leading-relaxed text-pretty text-muted-foreground">{deck}</p>
      )}
      <p className="mt-6 text-sm text-muted-foreground">
        Reportado el{" "}
        <time dateTime={incidentTimestamp.toISOString()}>
          {formatCostaRicaDate(incidentTimestamp, bylineDateFormat)} a{" "}
          {formatArticleForTime(incidentTimestamp)} {formatCostaRicaDate(incidentTimestamp, "time")}
        </time>
        {/* The time already ends in "a. m."/"p. m.", which closes the sentence. */}
        {incident.isOpen && incident.modifiedAt && (
          <>
            {" "}
            Actualizado <RelativeTime date={incident.modifiedAt} />.
          </>
        )}
      </p>
    </header>
  );
}

export function IncidentRecord() {
  const { incident } = Route.useLoaderData();

  return (
    <p className="text-sm text-muted-foreground">
      Consecutivo # <span className="text-foreground tabular-nums">{incident.EEConsecutive}</span>
    </p>
  );
}

export function IncidentStory() {
  const { incident, stations } = Route.useLoaderData();

  const incidentTimestamp = new Date(incident.incidentTimestamp);
  const formattedIncidentTime = formatCostaRicaDate(incidentTimestamp, "time");

  const responsibleStation = stations.find((station) => station.isResponsible);

  const supportingStations = stations.filter((station) => !station.isResponsible);

  const firstBatchVehicles = responsibleStation
    ? responsibleStation.vehicles
        .filter((v) => isKnownDate(v.dispatchedTime) && isKnownDate(v.arrivalTime))
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

  const allVehicles = stations.flatMap((s) => s.vehicles);

  const getSingleVehicleWithDeparture = (allVehicles: (typeof stations)[number]["vehicles"]) => {
    if (allVehicles.length !== 1) return null;
    const vehicle = allVehicles[0];
    // Check if departureTime and arrivalTime exist and are valid dates
    if (!isKnownDate(vehicle.departureTime) || !isKnownDate(vehicle.arrivalTime)) return null;

    return vehicle;
  };

  const singleVehicleWithDeparture = getSingleVehicleWithDeparture(allVehicles);

  return (
    <div className="flex flex-col gap-10">
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
        <div className="relative aspect-video w-full overflow-hidden bg-muted">
          <img
            src={incident.mapImageUrl}
            alt="Imagen satelital de las coordenadas del incidente"
            referrerPolicy="origin"
            className="h-full w-full object-cover"
            sizes="(max-width: 672px) 100vw, 672px"
            fetchPriority="high"
          />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          El mapa aparecerá cuando las coordenadas estén disponibles.
        </p>
      )}

      <section className="incident-prose">
        <p>
          Al ser {formatArticleForTime(incidentTimestamp)} {formattedIncidentTime}, Bomberos recibe
          una alerta de "
          <em className="lowercase">
            {[incident.dispatchTypeName, incident.specificDispatchTypeName]
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
              {formatPlaceName(responsibleStation.name)}
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
                {formatCostaRicaDate(firstBatchVehicles[0].arrivalTime ?? "", "time")}
              </>
            )}
            {/* A trailing time ends in "a. m."/"p. m.", which already closes the sentence. */}
            {firstBatchVehicles.length === 0 && "."}
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
            {formatCostaRicaDate(singleVehicleWithDeparture.departureTime ?? "", "time")}
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
                    {formatPlaceName(s.name)}
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
          const dispatchTypeDisplay = [incident.dispatchTypeName, incident.specificDispatchTypeName]
            .filter(Boolean)
            .join(", ");
          const actualTypeDisplay = [incident.actualTypeName, incident.specificActualTypeName]
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
            const currentYear = getCostaRicaYear();
            const isCurrentYear = incident.statistics.currentYear === currentYear;
            const count = incident.statistics.currentYearCount;
            const cantonCount = incident.statistics.currentYearCantonCount;
            const prevCount = incident.statistics.previousYearCount;
            const cantonName = incident.cantonName ? formatPlaceName(incident.cantonName) : null;

            const typeDisplay = [
              incident.actualTypeName ?? incident.dispatchTypeName,
              incident.specificActualTypeName ?? incident.specificDispatchTypeName
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
                {cantonCount > 0 && cantonName && (
                  <>
                    {", "}
                    {cantonCount === 1
                      ? `siendo este el primero en el cantón de ${cantonName}`
                      : `${cantonCount.toLocaleString("es-CR")} de ellos en ${cantonName}`}
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
    </div>
  );
}

export function IncidentHeaderSkeleton() {
  return (
    <header>
      <Skeleton className="h-4 w-48" />
      <div className="mt-3 space-y-2">
        <Skeleton className="h-9 w-full sm:h-10" />
        <Skeleton className="h-9 w-2/3 sm:h-10" />
      </div>
      <div className="mt-5 space-y-2">
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-5 w-4/5" />
      </div>
      <Skeleton className="mt-6 h-4 w-64" />
    </header>
  );
}

export function IncidentStorySkeleton() {
  return (
    <div className="flex flex-col gap-10">
      <Skeleton className="aspect-video w-full" />
      <section className="space-y-6">
        <div className="space-y-2.5">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-3/4" />
        </div>
        <Skeleton className="h-4 w-5/6" />
        <div className="space-y-2.5">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </section>
    </div>
  );
}
