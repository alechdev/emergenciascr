import { SITE_URL } from "@/lib/site";

import type {
  IncidentPageData,
  IncidentPageResponseTime,
  IncidentPageStation
} from "./get-incident-page";

const dateTimeFormat = new Intl.DateTimeFormat("es-CR", {
  day: "2-digit",
  month: "long",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true
});

const timeFormat = new Intl.DateTimeFormat("es-CR", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: true
});

const dateTimeShortFormat = new Intl.DateTimeFormat("es-CR", {
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: true
});

function joinTypes(...names: Array<string | null | undefined>): string {
  return names.filter((name): name is string => Boolean(name)).join(", ");
}

function isUsableDate(value: string | null | undefined): value is string {
  if (!value) return false;
  const year = new Date(value).getFullYear();
  return Number.isFinite(year) && year > 1970;
}

function formatDateTime(value: string): string {
  return dateTimeFormat.format(new Date(value));
}

function formatClock(value: string | null | undefined): string {
  if (!isUsableDate(value)) return "—";
  return timeFormat.format(new Date(value));
}

function formatSeconds(seconds: number): string {
  if (seconds <= 0) return "—";

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  const parts: string[] = [];

  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

  return parts.join(" ");
}

function mdCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function stationUrl(name: string): string {
  return `${SITE_URL}/estaciones/${encodeURIComponent(name)}`;
}

function sortedStations(stations: IncidentPageStation[]): IncidentPageStation[] {
  return [...stations].sort((a, b) => {
    if (a.isResponsible && !b.isResponsible) return -1;
    if (!a.isResponsible && b.isResponsible) return 1;
    return a.stationKey.localeCompare(b.stationKey, undefined, { numeric: true });
  });
}

function stationsSection(stations: IncidentPageStation[]): string {
  if (stations.length === 0) {
    return "## Estaciones despachadas\n\nNinguna estación registrada.";
  }

  const lines = sortedStations(stations).map((station) => {
    const key = station.stationKey.trim();
    const role = station.isResponsible ? "responsable" : "apoyo";
    const label = key ? `${station.name} (${key})` : station.name;
    const vehicles =
      station.vehicles.length > 0
        ? station.vehicles.map((vehicle) => vehicle.internalNumber).join(", ")
        : "ninguna";

    return `- **[${label}](${stationUrl(station.name)})** — ${role}\n  - Unidades: ${vehicles}`;
  });

  return `## Estaciones despachadas\n\n${lines.join("\n")}`;
}

function responseTimesSection(responseTimes: IncidentPageResponseTime[]): string {
  const rows = responseTimes.filter((vehicle) => vehicle.totalTimeSeconds > 0);
  if (rows.length === 0) {
    return "## Tiempos de respuesta\n\nNo hay datos de tiempo disponibles.";
  }

  const header =
    "| Unidad | Estación | Despacho | Llegada | Retiro | Respuesta | En escena | Total |\n| --- | --- | --- | --- | --- | --- | --- | --- |";
  const body = rows
    .slice()
    .sort((a, b) => a.totalTimeSeconds - b.totalTimeSeconds)
    .map((vehicle) => {
      const cells = [
        vehicle.vehicle,
        vehicle.station,
        formatClock(vehicle.dispatchedTime),
        formatClock(vehicle.arrivalTime),
        vehicle.isEnRoute ? "En camino" : formatClock(vehicle.departureTime),
        formatSeconds(vehicle.responseTimeSeconds),
        formatSeconds(vehicle.onSceneTimeSeconds),
        formatSeconds(vehicle.totalTimeSeconds)
      ];
      return `| ${cells.map(mdCell).join(" | ")} |`;
    });

  return `## Tiempos de respuesta\n\n${header}\n${body.join("\n")}`;
}

function timelineSection(page: IncidentPageData): string {
  if (page.timeline.length === 0) {
    return "## Cronología\n\nSin eventos registrados.";
  }

  const incidentDay = new Date(page.incident.incidentTimestamp);
  const lines = page.timeline.map((event) => {
    const date = new Date(event.date);
    const sameDay =
      date.getFullYear() === incidentDay.getFullYear() &&
      date.getMonth() === incidentDay.getMonth() &&
      date.getDate() === incidentDay.getDate();
    const when = sameDay ? timeFormat.format(date) : dateTimeShortFormat.format(date);
    const description = event.description ? `: ${event.description}` : "";
    return `- **${when}** — ${event.title}${description}`;
  });

  return `## Cronología\n\n${lines.join("\n")}`;
}

function contextSection(page: IncidentPageData): string | null {
  const { incident } = page;
  if (incident.statistics.currentYearCount <= 0) return null;

  const currentYear = new Date().getFullYear();
  const isCurrentYear = incident.statistics.currentYear === currentYear;
  const count = incident.statistics.currentYearCount;
  const typeDisplay =
    joinTypes(
      incident.actualTypeName ?? incident.dispatchTypeName,
      incident.specificActualTypeName ?? incident.specificDispatchTypeName
    ) || "incidente";
  const verb = isCurrentYear
    ? count === 1
      ? "se ha reportado"
      : "se han reportado"
    : count === 1
      ? "se reportó"
      : "se reportaron";

  let text = `En ${isCurrentYear ? "lo que va del" : "el"} ${incident.statistics.currentYear} ${verb} ${count.toLocaleString("es-CR")} incidente${count !== 1 ? "s" : ""} de tipo "${typeDisplay.toLowerCase()}"`;

  if (incident.statistics.currentYearCantonCount > 0 && incident.cantonName) {
    const cantonCount = incident.statistics.currentYearCantonCount;
    text +=
      cantonCount === 1
        ? `, siendo este el primero en el cantón de ${incident.cantonName}`
        : `, ${cantonCount.toLocaleString("es-CR")} de ellos en ${incident.cantonName}`;
  }

  text += ".";

  if (incident.statistics.previousYearCount > 0) {
    const prevCount = incident.statistics.previousYearCount;
    text += ` En ${incident.statistics.previousYear} hubo ${prevCount.toLocaleString("es-CR")} incidente${prevCount !== 1 ? "s" : ""} de este tipo.`;
  }

  return `## Contexto\n\n${text}`;
}

export function incidentPageToMarkdown(page: IncidentPageData): string {
  const { incident } = page;
  const url = `${SITE_URL}/incidentes/${incident.slug}`;
  const status = incident.isOpen ? "abierto" : "cerrado";
  const dispatchType = joinTypes(incident.dispatchTypeName, incident.specificDispatchTypeName);
  const actualType = joinTypes(incident.actualTypeName, incident.specificActualTypeName);
  const hasCoordinates = incident.latitude !== 0 && incident.longitude !== 0;

  const facts = [
    `- Estado: ${status}`,
    `- Expediente: EE-${incident.EEConsecutive}`,
    `- Reportado: ${formatDateTime(incident.incidentTimestamp)}`,
    incident.modifiedAt && isUsableDate(incident.modifiedAt)
      ? `- Última actualización: ${formatDateTime(incident.modifiedAt)}`
      : null,
    incident.address ? `- Dirección: ${incident.address}` : null,
    hasCoordinates ? `- Coordenadas: ${incident.latitude}, ${incident.longitude}` : null,
    dispatchType ? `- Tipo al despacho: ${dispatchType}` : null,
    actualType ? `- Tipo en escena: ${actualType}` : null
  ].filter((line): line is string => Boolean(line));

  const links = [
    `- Página: ${url}`,
    `- JSON: ${SITE_URL}/api/incidents/${incident.id}`,
    incident.mapImageUrl ? `- Mapa: ${incident.mapImageUrl}` : null,
    ...sortedStations(page.stations).map(
      (station) => `- Estación ${station.name}: ${stationUrl(station.name)}`
    )
  ].filter((line): line is string => Boolean(line));

  const sections = [
    `# ${incident.title}`,
    incident.isOpen ? "Incidente en progreso." : null,
    facts.join("\n"),
    stationsSection(page.stations),
    responseTimesSection(page.responseTimes),
    timelineSection(page),
    contextSection(page),
    `## Enlaces\n\n${links.join("\n")}`,
    "_Emergencias CR es un sitio independiente. No es el sitio oficial del Benemérito Cuerpo de Bomberos de Costa Rica._"
  ].filter((section): section is string => Boolean(section));

  return `${sections.join("\n\n")}\n`;
}
