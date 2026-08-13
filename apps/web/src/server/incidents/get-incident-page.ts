import { buildIncidentSlug } from "@api/lib/slug";
import { buildMapImageUrl, buildStationImageUrl } from "@api/lib/url-builder";
import {
  getFirstValidCoordinatePair,
  resolveIncidentCoordinates,
  toCoordinateNumber
} from "@api/lib/utils/incidents/coordinates";
import { getIncidentTitle, toIsoStringOrNull } from "@api/lib/utils/incidents/formatters";
import { buildIncidentResponseTimes } from "@api/lib/utils/incidents/response-times";
import { buildDispatchedStationsSummary } from "@api/lib/utils/incidents/stations";
import { getIncidentStatistics } from "@api/lib/utils/incidents/statistics";
import { buildTimelineEvents } from "@api/lib/utils/incidents/timeline";
import { getIncidentById } from "@bomberoscr/db/queries/incidents";
import { createServerFn } from "@tanstack/react-start";

type IncidentPageTypeNames = {
  dispatchTypeName: string | null;
  specificDispatchTypeName: string | null;
  actualTypeName: string | null;
  specificActualTypeName: string | null;
};

type IncidentPageStatistics = {
  currentYear: number;
  currentYearCount: number;
  currentYearCantonCount: number;
  previousYear: number;
  previousYearCount: number;
};

type IncidentPageVehicle = {
  internalNumber: string;
  dispatchedTime: string | null;
  arrivalTime: string | null;
  departureTime: string | null;
};

type IncidentPageStation = {
  name: string;
  stationKey: string;
  imageUrl: string;
  isResponsible: boolean;
  vehicles: IncidentPageVehicle[];
};

type IncidentPageTimelineEvent = {
  id: string;
  date: string;
  title: string;
  description?: string;
};

type IncidentPageResponseTime = {
  id: number;
  vehicle: string;
  station: string;
  dispatchedTime: string | null;
  arrivalTime: string | null;
  departureTime: string | null;
  responseTimeSeconds: number;
  onSceneTimeSeconds: number;
  returnTimeSeconds: number;
  totalTimeSeconds: number;
  isEnRoute: boolean;
};

type IncidentPageIncident = {
  id: number;
  slug: string;
  title: string;
  isOpen: boolean;
  EEConsecutive: string;
  address: string;
  incidentTimestamp: string;
  modifiedAt: string | null;
  latitude: number;
  longitude: number;
  cantonName: string | null;
  mapImageUrl: string | null;
  statistics: IncidentPageStatistics;
} & IncidentPageTypeNames;

type IncidentPageData = {
  incident: IncidentPageIncident;
  stations: IncidentPageStation[];
  timeline: IncidentPageTimelineEvent[];
  responseTimes: IncidentPageResponseTime[];
};

function parseIncidentIdFromSlug(slug: string): number | null {
  const id = Number.parseInt(slug.split("-")[0] ?? "", 10);
  return Number.isNaN(id) ? null : id;
}

const getIncidentPage = createServerFn({ method: "GET" })
  .inputValidator((data: { slug: string }) => data)
  .handler(async ({ data }): Promise<IncidentPageData | null> => {
    const incidentId = parseIncidentIdFromSlug(data.slug);
    if (incidentId === null) {
      return null;
    }

    const incident = await getIncidentById({ id: incidentId });
    if (!incident) {
      return null;
    }

    const title = getIncidentTitle(
      incident.importantDetails,
      incident.specificIncidentType?.name,
      incident.incidentType?.name,
      {
        districtName: incident.district?.name ?? null,
        cantonName: incident.canton?.name ?? null,
        provinceName: incident.province?.name ?? null
      }
    );

    const fallbackCoordinates = getFirstValidCoordinatePair([
      {
        latitude: toCoordinateNumber(incident.station?.latitude),
        longitude: toCoordinateNumber(incident.station?.longitude)
      }
    ]);

    const coordinates = resolveIncidentCoordinates({
      incidentId: incident.id,
      latitude: incident.latitude,
      longitude: incident.longitude,
      fallbackLatitude: fallbackCoordinates?.latitude,
      fallbackLongitude: fallbackCoordinates?.longitude
    });

    const statistics = await getIncidentStatistics({
      incidentTimestamp: incident.incidentTimestamp,
      incidentCode: incident.incidentCode,
      specificIncidentCode: incident.specificIncidentCode,
      cantonId: incident.cantonId,
      cantonName: incident.canton?.name ?? null
    });

    const stations: IncidentPageStation[] = buildDispatchedStationsSummary(incident).map(
      (station) => ({
        name: station.name,
        stationKey: station.key ?? "",
        imageUrl: buildStationImageUrl(station.name),
        isResponsible: station.isResponsible,
        vehicles: station.vehicles.map((vehicle) => ({
          internalNumber: vehicle.internalNumber,
          dispatchedTime: vehicle.dispatchTime,
          arrivalTime: vehicle.arrivalTime,
          departureTime: vehicle.departureTime
        }))
      })
    );

    const timeline: IncidentPageTimelineEvent[] = buildTimelineEvents(
      incident,
      incident.dispatchedVehicles.map((vehicle) => ({
        dispatchedTime: vehicle.dispatchedTime,
        arrivalTime: vehicle.arrivalTime,
        departureTime: vehicle.departureTime,
        station: { name: vehicle.station?.name ?? "Estación desconocida" },
        vehicle: vehicle.vehicle
      }))
    ).map((event) => ({
      id: event.id,
      date: event.date.toISOString(),
      title: event.title,
      ...(event.description ? { description: event.description } : {})
    }));

    const responseTimes: IncidentPageResponseTime[] = buildIncidentResponseTimes(incident).map(
      (vehicle) => ({
        id: vehicle.id,
        vehicle: vehicle.vehicle,
        station: vehicle.station,
        dispatchedTime: vehicle.dispatchedTime,
        arrivalTime: vehicle.arrivalTime,
        departureTime: vehicle.departureTime,
        responseTimeSeconds: vehicle.responseTimeSeconds,
        onSceneTimeSeconds: vehicle.onSceneTimeSeconds,
        returnTimeSeconds: vehicle.returnTimeSeconds,
        totalTimeSeconds: vehicle.totalTimeSeconds,
        isEnRoute: vehicle.isEnRoute
      })
    );

    return {
      incident: {
        id: incident.id,
        slug: buildIncidentSlug(incident.id, title, incident.incidentTimestamp),
        title,
        isOpen: incident.isOpen,
        EEConsecutive: incident.EEConsecutive,
        address: incident.address,
        incidentTimestamp: incident.incidentTimestamp.toISOString(),
        modifiedAt: toIsoStringOrNull(incident.modifiedAt),
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        cantonName: incident.canton?.name ?? null,
        mapImageUrl: coordinates.hasStoredCoordinates ? buildMapImageUrl(incident.id) : null,
        dispatchTypeName: incident.dispatchIncidentType?.name ?? null,
        specificDispatchTypeName: incident.specificDispatchIncidentType?.name ?? null,
        actualTypeName: incident.incidentType?.name ?? null,
        specificActualTypeName: incident.specificIncidentType?.name ?? null,
        statistics: {
          currentYear: statistics.currentYear,
          currentYearCount: statistics.currentYearCount,
          currentYearCantonCount: statistics.currentYearCantonCount,
          previousYear: statistics.previousYear,
          previousYearCount: statistics.previousYearCount
        }
      },
      stations,
      timeline,
      responseTimes
    };
  });

export { getIncidentPage };
export type {
  IncidentPageData,
  IncidentPageIncident,
  IncidentPageResponseTime,
  IncidentPageStation,
  IncidentPageTimelineEvent
};
