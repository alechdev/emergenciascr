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
  getAttentionSeconds
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

  const headline = formatIncidentHeadline(incident.title, incident);
  const attentionSeconds = getAttentionSeconds(incident.incidentTimestamp, timeline);
  const deck = buildIncidentDeck({
    isOpen: incident.isOpen,
    stations,
    responseTimes,
    attentionSeconds
  });

  return (
    <header>
      <IncidentOpenStatus />
      <h1 className="font-serif text-4xl leading-[1.05] tracking-tight text-balance sm:text-6xl">
        {headline}
      </h1>
      {deck && <p className="mt-5 max-w-2xl text-lg leading-relaxed text-pretty">{deck}</p>}
      <IncidentLeadFigure />
    </header>
  );
}

/**
 * Only an open incident needs a status line; a finished one reads as a settled story.
 * The page does not refresh itself, so the tag never claims to be live.
 */
function IncidentOpenStatus() {
  const { incident } = Route.useLoaderData();

  if (!incident.isOpen) return null;

  return (
    <div className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
      {/* A fixed red rather than --destructive: the dark theme's lighter red is too
          low-contrast under white text. */}
      <span className="inline-flex items-center bg-red-600 px-1.5 py-0.5 text-xs leading-none font-bold tracking-wider text-white uppercase">
        En curso
      </span>
      {incident.modifiedAt && (
        <span className="text-muted-foreground">
          Actualizado <RelativeTime date={incident.modifiedAt} />
        </span>
      )}
    </div>
  );
}

function IncidentLeadFigure() {
  const { incident } = Route.useLoaderData();

  if (!incident.mapImageUrl) {
    // Closed incidents never gain coordinates, so only an open one can promise a map.
    return incident.isOpen ? (
      <p className="mt-10 text-sm text-muted-foreground">
        El mapa aparecerá cuando las coordenadas estén disponibles.
      </p>
    ) : null;
  }

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
  return (
    <figure className="mt-10">
      <div className="relative aspect-video w-full overflow-hidden bg-muted sm:aspect-[2/1]">
        <img
          src={incident.mapImageUrl}
          alt="Imagen satelital de las coordenadas del incidente"
          referrerPolicy="origin"
          className="h-full w-full object-cover"
          sizes="(max-width: 896px) 100vw, 896px"
          fetchPriority="high"
        />
      </div>
      {incident.address && (
        <figcaption className="mt-3 text-center text-sm text-balance text-muted-foreground">
          {formatPlaceName(incident.address)}
        </figcaption>
      )}
    </figure>
  );
}

function formatLocality(...names: (string | null)[]): string | null {
  const places = names.filter((name): name is string => Boolean(name)).map(formatPlaceName);
  // A district often shares its canton's name ("Puriscal, Puriscal").
  const unique = places.filter((place, index) => places.indexOf(place) === index);
  return unique.length > 0 ? unique.join(", ") : null;
}

export function IncidentRecord() {
  const { incident } = Route.useLoaderData();

  return (
    <p className="text-sm text-muted-foreground">
      Consecutivo # <span className="text-foreground tabular-nums">{incident.EEConsecutive}</span>
    </p>
  );
}

function joinTypeNames(...names: (string | null | undefined)[]): string {
  return names.filter(Boolean).join(", ");
}

export function IncidentStory() {
  const { incident } = Route.useLoaderData();

  const incidentTimestamp = new Date(incident.incidentTimestamp);
  const alertType =
    joinTypeNames(incident.dispatchTypeName, incident.specificDispatchTypeName) || "incidente";
  const locality = formatLocality(incident.districtName, incident.cantonName);
  // The map caption carries the address; without a map the story has to.
  const addressInStory = !incident.mapImageUrl && Boolean(incident.address);

  return (
    <section className="incident-prose sm:text-lg">
      <p>
        {/* The header carries no date, so the story is where the reader finds it. */}
        El{" "}
        <time dateTime={incidentTimestamp.toISOString()}>
          {formatCostaRicaDate(incidentTimestamp, bylineDateFormat)}, al ser{" "}
          {formatArticleForTime(incidentTimestamp)} {formatCostaRicaDate(incidentTimestamp, "time")}
        </time>
        , Bomberos recibe una alerta de "<span className="lowercase">{alertType}</span>"
        {locality ? ` en ${locality}.` : "."}
        {addressInStory && " En la dirección:"}
      </p>
      {addressInStory && (
        <blockquote className="text-base text-foreground">
          {formatPlaceName(incident.address)}
        </blockquote>
      )}
      <DispatchParagraphs />
      <ClassificationParagraph />
      <StatisticsParagraph />
    </section>
  );
}

function DispatchParagraphs() {
  const { incident, stations } = Route.useLoaderData();

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
    <>
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
    </>
  );
}

function ClassificationParagraph() {
  const { incident } = Route.useLoaderData();

  const dispatchTypeDisplay = joinTypeNames(
    incident.dispatchTypeName,
    incident.specificDispatchTypeName
  );
  const actualTypeDisplay = joinTypeNames(incident.actualTypeName, incident.specificActualTypeName);

  if ((incident.isOpen && dispatchTypeDisplay === actualTypeDisplay) || !actualTypeDisplay) {
    return null;
  }

  return dispatchTypeDisplay !== actualTypeDisplay ? (
    <p>
      Los bomberos en la escena actualizan la clasificación del incidente a: "
      <span className="lowercase">{actualTypeDisplay}</span>".
    </p>
  ) : (
    <p>
      Los bomberos en la escena confirman la categoría del incidente como "
      <span className="lowercase">{actualTypeDisplay}</span>".
    </p>
  );
}

function StatisticsParagraph() {
  const { incident } = Route.useLoaderData();

  if (incident.statistics.currentYearCount === 0) return null;

  const currentYear = getCostaRicaYear();
  const isCurrentYear = incident.statistics.currentYear === currentYear;
  const count = incident.statistics.currentYearCount;
  const cantonCount = incident.statistics.currentYearCantonCount;
  const prevCount = incident.statistics.previousYearCount;
  const cantonName = incident.cantonName ? formatPlaceName(incident.cantonName) : null;

  const typeDisplay = joinTypeNames(
    incident.actualTypeName ?? incident.dispatchTypeName,
    incident.specificActualTypeName ?? incident.specificDispatchTypeName
  );

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
      <span className="lowercase">{typeDisplay}</span>"
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
          En {incident.statistics.previousYear} hubo {prevCount.toLocaleString("es-CR")} incidente
          {prevCount !== 1 ? "s" : ""} de este tipo.
        </>
      )}
    </p>
  );
}

export function IncidentHeaderSkeleton() {
  return (
    <header>
      <div className="space-y-3">
        <Skeleton className="h-9 w-full sm:h-14" />
        <Skeleton className="h-9 w-2/3 sm:h-14" />
      </div>
      <div className="mt-5 max-w-2xl space-y-2">
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-5 w-4/5" />
      </div>
      <Skeleton className="mt-10 aspect-video w-full sm:aspect-[2/1]" />
    </header>
  );
}

export function IncidentStorySkeleton() {
  return (
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
  );
}
