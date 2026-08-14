import { SITE_URL } from "@/lib/site";

import type { StationPageData, StationPageIncident, StationPageVehicle } from "./get-station-page";

const dateTimeFormat = new Intl.DateTimeFormat("es-CR", {
  day: "2-digit",
  month: "long",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true
});

function formatDateTime(value: string): string {
  return dateTimeFormat.format(new Date(value));
}

function mdCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function stationUrl(name: string): string {
  return `${SITE_URL}/estaciones/${encodeURIComponent(name)}`;
}

function incidentUrl(slug: string): string {
  return `${SITE_URL}/incidentes/${slug}`;
}

function formatResponseTime(seconds: number | null): string {
  if (seconds == null || seconds <= 0) return "—";

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  if (minutes === 0) return `${remainingSeconds}s`;
  return `${minutes}m ${remainingSeconds}s`;
}

function incidentsSection(
  title: string,
  emptyText: string,
  incidents: StationPageIncident[]
): string {
  if (incidents.length === 0) {
    return `## ${title}\n\n${emptyText}`;
  }

  const lines = incidents.map((incident) => {
    const counts = `${incident.dispatchedStationsCount} estación(es), ${incident.dispatchedVehiclesCount} unidad(es)`;
    const address = incident.address ? `\n  - Dirección: ${incident.address}` : "";
    return `- **[${incident.title}](${incidentUrl(incident.slug)})** — ${formatDateTime(incident.incidentTimestamp)}\n  - Despacho: ${counts}${address}`;
  });

  return `## ${title}\n\n${lines.join("\n")}`;
}

function collaborationsSection(page: StationPageData): string {
  if (page.collaborations.length === 0) {
    return "## Colaboraciones con otras estaciones\n\nSin colaboraciones registradas.";
  }

  const lines = page.collaborations.map((collaboration) => {
    const key = collaboration.stationKey.trim();
    const label = key ? `${collaboration.name} (${key})` : collaboration.name;
    const count = collaboration.collaborationCount.toLocaleString("es-CR");
    const noun = collaboration.collaborationCount === 1 ? "incidente" : "incidentes";
    return `- **[${label}](${stationUrl(collaboration.name)})** — ${count} ${noun} en conjunto`;
  });

  return `## Colaboraciones con otras estaciones\n\n${lines.join("\n")}`;
}

function vehiclesSection(vehicles: StationPageVehicle[]): string {
  if (vehicles.length === 0) {
    return "## Unidades\n\nNinguna unidad registrada.";
  }

  const header =
    "| Unidad | Placa | Clase | Estado | Despachos (30 días) | Tiempo de respuesta |\n| --- | --- | --- | --- | --- | --- |";
  const body = vehicles.map((vehicle) => {
    const cells = [
      vehicle.internalNumber || "Sin número",
      vehicle.plate || "Sin placa",
      vehicle.class || "—",
      vehicle.descriptionOperationalStatus || "Desconocido",
      vehicle.stats.incidentCount.toLocaleString("es-CR"),
      formatResponseTime(vehicle.stats.avgResponseTimeSeconds)
    ];
    return `| ${cells.map(mdCell).join(" | ")} |`;
  });

  return `## Unidades\n\n${header}\n${body.join("\n")}`;
}

export function stationPageToMarkdown(page: StationPageData): string {
  const { station } = page;
  const url = stationUrl(station.name);
  const status =
    station.isOperative == null ? null : station.isOperative ? "operativa" : "no operativa";
  const lat = Number(station.latitude);
  const lng = Number(station.longitude);
  const hasCoordinates = Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0;
  const yearCount = page.yearIncidentCount.toLocaleString("es-CR");

  const facts = [
    `- Clave: ${station.stationKey}`,
    status ? `- Estado: ${status}` : null,
    station.address ? `- Dirección: ${station.address}` : null,
    station.phoneNumber ? `- Teléfono: ${station.phoneNumber}` : null,
    station.fax ? `- Fax: ${station.fax}` : null,
    station.email ? `- Correo: ${station.email}` : null,
    station.radioChannel ? `- Canal de radio: ${station.radioChannel}` : null,
    hasCoordinates ? `- Coordenadas: ${station.latitude}, ${station.longitude}` : null
  ].filter((line): line is string => Boolean(line));

  const links = [
    `- Página: ${url}`,
    `- JSON: ${SITE_URL}/api/stations/${encodeURIComponent(station.name)}`,
    `- Imagen: ${station.imageUrl}`,
    `- Incidentes de esta estación: ${SITE_URL}/incidentes?stations=${station.id}`
  ];

  const sections = [
    `# Estación ${station.name}`,
    facts.join("\n"),
    `## Actividad del último año\n\n${yearCount} incidente${page.yearIncidentCount === 1 ? "" : "s"}.`,
    incidentsSection(
      "Incidentes destacados",
      "Ningún incidente destacado.",
      page.highlightedIncidents
    ),
    incidentsSection(
      "Últimos incidentes",
      "No hay incidentes recientes para esta estación.",
      page.recentIncidents
    ),
    collaborationsSection(page),
    vehiclesSection(page.vehicles),
    `## Enlaces\n\n${links.join("\n")}`,
    "_Emergencias CR es un sitio independiente. No es el sitio oficial del Benemérito Cuerpo de Bomberos de Costa Rica._"
  ];

  return `${sections.join("\n\n")}\n`;
}
