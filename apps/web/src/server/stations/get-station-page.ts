import { buildIncidentSlug } from "@api/lib/slug";
import { buildStationImageUrl } from "@api/lib/url-builder";
import { getIncidentTitle } from "@api/lib/utils/incidents/formatters";
import { getIncidents } from "@bomberoscr/db/queries/incidents";
import {
  getStationByName,
  getStationCollaborations,
  getStationIncidentsPerDay,
  getStationVehiclesWithStats
} from "@bomberoscr/db/queries/stations";
import { createServerFn } from "@tanstack/react-start";

type StationPageIncident = {
  slug: string;
  title: string;
  address: string;
  incidentTimestamp: string;
  dispatchedStationsCount: number;
  dispatchedVehiclesCount: number;
};

type StationPageCollaboration = {
  name: string;
  stationKey: string;
  collaborationCount: number;
};

type StationPageVehicle = {
  internalNumber: string;
  plate: string;
  class: string;
  descriptionOperationalStatus: string;
  stats: {
    incidentCount: number;
    avgResponseTimeSeconds: number | null;
  };
};

type StationPageStation = {
  id: number;
  name: string;
  stationKey: string;
  radioChannel: string | null;
  latitude: string;
  longitude: string;
  address: string | null;
  phoneNumber: string | null;
  fax: string | null;
  email: string | null;
  isOperative: boolean | null;
  imageUrl: string;
};

type StationPageData = {
  station: StationPageStation;
  yearIncidentCount: number;
  highlightedIncidents: StationPageIncident[];
  recentIncidents: StationPageIncident[];
  collaborations: StationPageCollaboration[];
  vehicles: StationPageVehicle[];
};

function mapIncident(incident: {
  id: number;
  importantDetails: string | null;
  specificIncidentType: string | null;
  incidentType: string | null;
  districtName: string | null;
  cantonName: string | null;
  provinceName: string | null;
  address: string;
  incidentTimestamp: Date;
  dispatchedStationsCount: number | null;
  dispatchedVehiclesCount: number | null;
}): StationPageIncident {
  const title = getIncidentTitle(
    incident.importantDetails,
    incident.specificIncidentType,
    incident.incidentType,
    {
      districtName: incident.districtName,
      cantonName: incident.cantonName,
      provinceName: incident.provinceName
    }
  );

  return {
    slug: buildIncidentSlug(incident.id, title, incident.incidentTimestamp),
    title,
    address: incident.address,
    incidentTimestamp: incident.incidentTimestamp.toISOString(),
    dispatchedStationsCount: incident.dispatchedStationsCount ?? 0,
    dispatchedVehiclesCount: incident.dispatchedVehiclesCount ?? 0
  };
}

const getStationPage = createServerFn({ method: "GET" })
  .inputValidator((data: { name: string }) => data)
  .handler(async ({ data }): Promise<StationPageData | null> => {
    const station = await getStationByName({ name: data.name });
    if (!station) {
      return null;
    }

    const [heatmapDays, highlighted, recent, collaborations, vehicles] = await Promise.all([
      getStationIncidentsPerDay({ stationId: station.id, days: 365 }),
      getIncidents({
        pageSize: 6,
        sort: ["totalDispatched", "desc"],
        stations: [station.id]
      }),
      getIncidents({
        pageSize: 5,
        sort: ["id", "desc"],
        stations: [station.id]
      }),
      getStationCollaborations({ stationId: station.id }),
      getStationVehiclesWithStats({ stationId: station.id })
    ]);

    return {
      station: {
        id: station.id,
        name: station.name,
        stationKey: station.stationKey,
        radioChannel: station.radioChannel,
        latitude: station.latitude,
        longitude: station.longitude,
        address: station.address,
        phoneNumber: station.phoneNumber,
        fax: station.fax,
        email: station.email,
        isOperative: station.isOperative,
        imageUrl: buildStationImageUrl(station.name)
      },
      yearIncidentCount: heatmapDays.reduce((sum, day) => sum + day.count, 0),
      highlightedIncidents: highlighted.data.map(mapIncident),
      recentIncidents: recent.data.map(mapIncident),
      collaborations: collaborations.map((collaboration) => ({
        name: collaboration.name,
        stationKey: collaboration.stationKey,
        collaborationCount: collaboration.collaborationCount
      })),
      vehicles: vehicles.map((vehicle) => ({
        internalNumber: vehicle.internalNumber,
        plate: vehicle.plate,
        class: vehicle.class,
        descriptionOperationalStatus: vehicle.descriptionOperationalStatus,
        stats: {
          incidentCount: vehicle.stats.incidentCount,
          avgResponseTimeSeconds: vehicle.stats.avgResponseTimeSeconds
        }
      }))
    };
  });

export { getStationPage };
export type {
  StationPageCollaboration,
  StationPageData,
  StationPageIncident,
  StationPageStation,
  StationPageVehicle
};
