/**
 * SIGAE wire format: what each endpoint sends, key for key. Date fields are
 * {@link SigaeDateString}s; parse them with `parseSigaeDate`.
 *
 * Only the fields the sync reads are validated at runtime (see `schemas.ts`); the rest
 * are typed from observed responses.
 */
import type { SigaeDateString } from "./dates";

export type { SigaeDateString } from "./dates";

export interface SigaeEnvelope {
  Codigo: string;
  Descripcion: string;
}

/** `ObtenerDetalleEmergencias` */
export interface IncidentDetails extends SigaeEnvelope {
  DetallesImportantes: string;
  codigo_tipo_incidente: string | null;
  codigo_tipo_incidente_despacho: string | null;
  codigo_tipo_incidente_despacho_esp: string | null;
  codigo_tipo_incidente_esp: string | null;
  consecutivo_EE: string;
  direccion: string;
  estaciones: IncidentDetailsStation[];
  fecha: SigaeDateString;
  hora_incidente: SigaeDateString;
  latitud: number | null;
  longitud: number | null;
  tipo_incidente: string;
  tipo_incidente_despacho: string;
  tipo_incidente_despacho_esp: string;
  tipo_incidente_esp: string;
}

export interface IncidentDetailsStation {
  clave_estacion: string;
  nombre: string;
  vehiculos: IncidentDetailsVehicle[];
}

export interface IncidentDetailsVehicle {
  estado: string;
  numero_interno: string;
}

/** `ObtenerBoletaIncidente`. Contains personal data; never log or store it unredacted. */
export interface IncidentReport extends SigaeEnvelope {
  Aerolinea: number;
  Almas_Abordo: number;
  Anno: number;
  Area_Afectada: number;
  Area_Quemada_Protegida: string;
  Bomberos_Fallecidos: number;
  Bomberos_Heridos: number;
  Cantidad_Dimensiones: number;
  Cantidad_Estructuras_Involucradas: number;
  Canton: string;
  Capacidad: number;
  Cedula_Avisa: string;
  Civiles_Fallecidos: number;
  Civiles_Heridos: number;
  Clave: string;
  CodigoTipoIncidenteDespacho: string;
  CodigoTipoIncidenteReal: string;
  Combustible: string;
  Condiciones_Especiales: string;
  Consecutivo: string;
  DesConstruccion: string;
  DesDimensionesIncidente: string;
  DesEstrategia: string | null;
  DesEtapaIncidente: string | null;
  DesMetodoAviso: string | null;
  DesUbicacion: string;
  Descripcion_Aviso: string | null;
  Direccion: string;
  Distrito: string;
  /** `"true"` or `"false"`. */
  Estado_Abierto: string;
  /** The incident date at midnight. The time is in {@link IncidentReport.Hora_Aviso}. */
  Fecha: SigaeDateString;
  Hora_Aviso: SigaeDateString;
  Hora_Controlado: SigaeDateString;
  Hora_Disponible: SigaeDateString;
  Hora_Fuego_Bajo_Control: SigaeDateString;
  Hora_Hospital: SigaeDateString;
  Hora_Paciente: SigaeDateString;
  Hora_Perdidas_Detenidas: SigaeDateString;
  Hora_Todo_Claro: SigaeDateString;
  Hora_Traslado: SigaeDateString;
  Id_Boleta_Incidente: number;
  Id_Bombero_Mando: number;
  Id_Canton: number;
  Id_Construccion: number;
  Id_Dimensiones_Incidente: number;
  Id_Distrito: number;
  Id_Estrategia: number;
  Id_Etapa_Incidente: number;
  Id_Metodo_Aviso: number;
  Id_Provincia: number;
  Id_Tipo_Incidente: number;
  Id_Ubicacion: number;
  Info_Relevante: string;
  Marca: number;
  Matricula: string;
  NomBomberoMando: string;
  NomTipoIncidenteReal: string;
  Nombre_Avisa: string;
  Nombre_Incidente: string;
  Nombre_Mando: string;
  NomtipoIncidenteDespacho: string;
  Observaciones: string;
  Otra_Marca: string;
  Provincia: string;
  Telefono_Avisa: string;
  /** A duration encoded as a date (`0001-01-01T…`), not a placeholder. */
  Tiempo_Desplazamiento: SigaeDateString;
  Tiene_Poliza: boolean;
  Tipo_Aeronave: number;
  Tipo_Alerta: number;
  Tipo_Problema: string;
  Unidad_Capacidad: number;
  Usuario: string;
  X: number;
  Y: number;
}

/** `ObtenerEstacionesAtiendeIncidente` */
export interface DispatchedStationsResponse extends SigaeEnvelope {
  Items: DispatchedStation[];
}

export interface DispatchedStation {
  Codigo: string | null;
  Descripcion: string | null;
  AtencionAPie: boolean;
  ClaveEstacion: string;
  /** `RESPONSABLE` or `APOYO`. */
  DestipoServicio: string;
  HoraAtencionAPie: SigaeDateString;
  IdBoletaEstacionAtiende: number;
  IdEstacion: number;
  IdTipoServicio: number;
  NombreEstacion: string;
}

/** `ObtenerUnidadesDespachadasIncidente` */
export interface DispatchedUnitsResponse extends SigaeEnvelope {
  Items: DispatchedUnit[];
}

export interface DispatchedUnit {
  Codigo: string | null;
  Descripcion: string | null;
  CodigoEstacion: number;
  CodigoUnidad: number;
  DespachoAlarma: boolean;
  HoraBase: SigaeDateString;
  HoraDespacho: SigaeDateString;
  HoraDevolverBase: SigaeDateString;
  HoraLLegada: SigaeDateString;
  HoraRetiro: SigaeDateString;
  HoraTraslado: SigaeDateString;
  IdBoletaServicio: number;
  IdBoletaUnidadDespachada: number;
  IdVehiculo: number;
  NumeroInterno: string | null;
  Traslado: boolean;
  /** `ATENCION A PIE` for units attending on foot. */
  Unidad: string;
  UnidadCompleta: string;
}

/** `ObtenerListaEmergenciasApp` */
export interface IncidentListResponse extends SigaeEnvelope {
  items: IncidentListItem[];
}

/** `ObtenerListaUltimasEmergenciasApp` */
export interface LatestIncidentsResponse extends SigaeEnvelope {
  items: IncidentListItem[];
  itemsFecha: LatestIncidentsDateCount[];
}

export interface IncidentListItem {
  codigoTipoIncidente: string;
  codigoTipoIncidenteDespacho: string;
  consecutivoEE: string;
  direccion: string;
  estacionResponsable: string;
  fecha: SigaeDateString;
  horaIncidente: SigaeDateString;
  idBoletaIncidente: number;
  tipoIncidente: string;
  tipoIncidenteDespacho: string;
}

export interface LatestIncidentsDateCount {
  CantidadEmergencias: number;
  Fecha: SigaeDateString;
}

/** `ObtenerTiposIncidente` */
export interface IncidentTypesResponse extends SigaeEnvelope {
  items: IncidentType[];
}

export interface IncidentType {
  codigo_tipo_incidente: string;
  id_tipo_incidente: number;
  items: IncidentType[] | null;
  tipo_incidente: string;
}

/** `ObtenerProvinciaLista` */
export interface ProvincesResponse extends SigaeEnvelope {
  Items: Province[];
}

export interface Province {
  CodigoProvincia: string;
  IdProvincia: number;
  Provincia: string;
}

/** `ObtenerCantonesLista` */
export interface CantonsResponse extends SigaeEnvelope {
  Items: Canton[];
}

export interface Canton {
  Canton: string;
  CodigoCanton: string;
  IdCanton: number;
  IdProvincia: number;
}

/** `ObtenerDistritosLista` */
export interface DistrictsResponse extends SigaeEnvelope {
  Items: District[];
}

export interface District {
  Codigo_Distrito: string;
  Distrito: string;
  Id_Canton: number;
  Id_Distrito: number;
}

/** `ObtenerEstaciones` */
export interface StationsResponse extends SigaeEnvelope {
  Items: Station[];
}

/** `ObtenerEstacionesOperativas` */
export interface OperativeStationsResponse extends SigaeEnvelope {
  Items: Station[];
}

export interface Station {
  ClaveEstacion: string;
  IdEstacion: number;
  Nombre: string;
}

/** `ObtenerEstacionDetalle` */
export interface StationDetails extends SigaeEnvelope {
  CanalRadio: string;
  ClaveEstacion: string;
  Direccion: string;
  Email: string;
  Fax: string;
  IdEstacion: number;
  Latitud: number;
  Longitud: number;
  Nombre: string;
  Telefono: string;
}

/** `ObtenerVehiculosComboF5` */
export interface VehiclesResponse extends SigaeEnvelope {
  Items: Vehicle[];
}

export interface Vehicle {
  IdVehiculo: number;
  NumeroInterno: string;
}

/** `ObtenerDatosVehiculo`. Contains staff assignments; avoid logging it. */
export interface VehicleDetails extends SigaeEnvelope {
  Asignado_a: string;
  Canton: string;
  Capacidad: number;
  Clave_estacion_evolution: string;
  Des_clase_vehiculo: string;
  Des_estado_disponibilidad: string;
  Des_estado_operativo: string;
  Des_tipo_vehiculo: string;
  Distrito: string;
  Id_Estacion_Reporte: number;
  Id_canton: number;
  Id_clase_vehiculo: number;
  Id_distrito: number;
  Id_estacion: number;
  Id_estacion_transferido: number;
  Id_estado_disponibilidad: number;
  Id_estado_operativo: number;
  Id_personal: number;
  Id_personal_transferido: number;
  Id_provincia: number;
  Id_tipo_vehiculo: number;
  Id_veh_evo: string;
  Id_vehiculo: number;
  Ind_i_a: number;
  Numero_interno: string;
  Observaciones: string;
  Placa: string;
  Provincia: string;
  Transferido_a: string;
}

/** `ObtenerEstadoDisponibilidadUnidades` */
export interface VehicleAvailabilityStatesResponse extends SigaeEnvelope {
  Items: VehicleAvailabilityState[];
}

export interface VehicleAvailabilityState {
  Descripcion: string;
  IdGrupoClasificacion: number;
}

/**
 * A list response as the client returns it: the list is always under `items`, whether
 * SIGAE called it `Items` or `items`. `raw` keeps the original key.
 */
export type WithItems<T> = T extends { Items: infer I } ? Omit<T, "Items"> & { items: I } : T;
