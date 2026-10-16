import {
  cantonsSchema,
  dispatchedStationsSchema,
  dispatchedUnitsSchema,
  districtsSchema,
  incidentDetailsSchema,
  incidentListSchema,
  incidentReportSchema,
  incidentTypesSchema,
  latestIncidentsSchema,
  operativeStationsSchema,
  provincesSchema,
  stationDetailsSchema,
  stationsSchema,
  vehicleAvailabilityStatesSchema,
  vehicleDetailsSchema,
  vehiclesSchema
} from "./schemas";

import type {
  CantonsResponse,
  DispatchedStationsResponse,
  DispatchedUnitsResponse,
  DistrictsResponse,
  IncidentDetails,
  IncidentListResponse,
  IncidentReport,
  IncidentTypesResponse,
  LatestIncidentsResponse,
  OperativeStationsResponse,
  ProvincesResponse,
  StationDetails,
  StationsResponse,
  VehicleAvailabilityStatesResponse,
  VehicleDetails,
  VehiclesResponse,
  WithItems
} from "./wire";
import type { z } from "zod";

/** Every SIGAE endpoint the client calls, with the type of a successful response. */
export interface SigaeEndpointTypes {
  ObtenerDetalleEmergencias: IncidentDetails;
  ObtenerBoletaIncidente: IncidentReport;
  ObtenerEstacionesAtiendeIncidente: WithItems<DispatchedStationsResponse>;
  ObtenerUnidadesDespachadasIncidente: WithItems<DispatchedUnitsResponse>;
  ObtenerListaUltimasEmergenciasApp: LatestIncidentsResponse;
  ObtenerListaEmergenciasApp: IncidentListResponse;
  ObtenerTiposIncidente: IncidentTypesResponse;
  ObtenerProvinciaLista: WithItems<ProvincesResponse>;
  ObtenerCantonesLista: WithItems<CantonsResponse>;
  ObtenerDistritosLista: WithItems<DistrictsResponse>;
  ObtenerEstaciones: WithItems<StationsResponse>;
  ObtenerEstacionesOperativas: WithItems<OperativeStationsResponse>;
  ObtenerEstacionDetalle: StationDetails;
  ObtenerVehiculosComboF5: WithItems<VehiclesResponse>;
  ObtenerDatosVehiculo: VehicleDetails;
  ObtenerEstadoDisponibilidadUnidades: WithItems<VehicleAvailabilityStatesResponse>;
}

export type SigaeEndpoint = keyof SigaeEndpointTypes;

interface EndpointDefinition {
  schema: z.ZodObject;
  /** List endpoints expose their list as `items`, whatever SIGAE calls it. */
  isList: boolean;
}

export const ENDPOINTS: Record<SigaeEndpoint, EndpointDefinition> = {
  ObtenerDetalleEmergencias: { schema: incidentDetailsSchema, isList: false },
  ObtenerBoletaIncidente: { schema: incidentReportSchema, isList: false },
  ObtenerEstacionesAtiendeIncidente: { schema: dispatchedStationsSchema, isList: true },
  ObtenerUnidadesDespachadasIncidente: { schema: dispatchedUnitsSchema, isList: true },
  ObtenerListaUltimasEmergenciasApp: { schema: latestIncidentsSchema, isList: true },
  ObtenerListaEmergenciasApp: { schema: incidentListSchema, isList: true },
  ObtenerTiposIncidente: { schema: incidentTypesSchema, isList: true },
  ObtenerProvinciaLista: { schema: provincesSchema, isList: true },
  ObtenerCantonesLista: { schema: cantonsSchema, isList: true },
  ObtenerDistritosLista: { schema: districtsSchema, isList: true },
  ObtenerEstaciones: { schema: stationsSchema, isList: true },
  ObtenerEstacionesOperativas: { schema: operativeStationsSchema, isList: true },
  ObtenerEstacionDetalle: { schema: stationDetailsSchema, isList: false },
  ObtenerVehiculosComboF5: { schema: vehiclesSchema, isList: true },
  ObtenerDatosVehiculo: { schema: vehicleDetailsSchema, isList: false },
  ObtenerEstadoDisponibilidadUnidades: { schema: vehicleAvailabilityStatesSchema, isList: true }
};
