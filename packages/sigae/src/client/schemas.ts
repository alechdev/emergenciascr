/**
 * Loose runtime schemas for the fields the sync reads. Unknown keys pass through, so
 * SIGAE adding fields is fine; a field we rely on changing type or format is reported as
 * `unexpected_shape` instead of turning into corrupt data.
 *
 * List schemas validate `items`, after the client has normalized `Items`/`items`.
 */
import { z } from "zod";

import { isSigaeDateString } from "./dates";

const sigaeDate = z.string().refine(isSigaeDateString, { message: "Expected a SIGAE date" });

const envelope = {
  Codigo: z.string(),
  Descripcion: z.string()
};

const list = <T extends z.ZodType>(item: T) => z.looseObject({ ...envelope, items: z.array(item) });

export const incidentDetailsSchema = z.looseObject({
  ...envelope,
  codigo_tipo_incidente: z.string().nullable(),
  codigo_tipo_incidente_despacho: z.string().nullable(),
  codigo_tipo_incidente_despacho_esp: z.string().nullable(),
  codigo_tipo_incidente_esp: z.string().nullable(),
  latitud: z.number().nullable(),
  longitud: z.number().nullable()
});

export const incidentReportSchema = z.looseObject({
  ...envelope,
  Id_Boleta_Incidente: z.number(),
  Consecutivo: z.string(),
  Fecha: sigaeDate,
  Hora_Aviso: sigaeDate,
  Hora_Controlado: sigaeDate,
  Hora_Fuego_Bajo_Control: sigaeDate,
  Hora_Perdidas_Detenidas: sigaeDate,
  Hora_Todo_Claro: sigaeDate,
  Estado_Abierto: z.enum(["true", "false"]),
  DesUbicacion: z.string(),
  Direccion: z.string(),
  Id_Provincia: z.number(),
  Id_Canton: z.number(),
  Id_Distrito: z.number()
});

export const dispatchedStationsSchema = list(
  z.looseObject({
    AtencionAPie: z.boolean(),
    DestipoServicio: z.string(),
    IdBoletaEstacionAtiende: z.number(),
    IdEstacion: z.number(),
    IdTipoServicio: z.number()
  })
);

export const dispatchedUnitsSchema = list(
  z.looseObject({
    CodigoEstacion: z.number(),
    CodigoUnidad: z.number(),
    HoraBase: sigaeDate,
    HoraDespacho: sigaeDate,
    HoraLLegada: sigaeDate,
    HoraRetiro: sigaeDate,
    IdBoletaUnidadDespachada: z.number(),
    NumeroInterno: z.string().nullable(),
    Unidad: z.string()
  })
);

const incidentListItem = z.looseObject({
  idBoletaIncidente: z.number(),
  consecutivoEE: z.string(),
  fecha: sigaeDate,
  horaIncidente: sigaeDate
});

export const incidentListSchema = list(incidentListItem);

export const latestIncidentsSchema = list(incidentListItem);

type IncidentTypeShape = {
  codigo_tipo_incidente: string;
  id_tipo_incidente: number;
  tipo_incidente: string;
  items?: IncidentTypeShape[] | null;
};

const incidentType: z.ZodType<IncidentTypeShape> = z.looseObject({
  codigo_tipo_incidente: z.string(),
  id_tipo_incidente: z.number(),
  tipo_incidente: z.string(),
  get items() {
    return z.array(incidentType).nullish();
  }
});

export const incidentTypesSchema = list(incidentType);

export const provincesSchema = list(
  z.looseObject({ CodigoProvincia: z.string(), IdProvincia: z.number(), Provincia: z.string() })
);

export const cantonsSchema = list(
  z.looseObject({
    Canton: z.string(),
    CodigoCanton: z.string(),
    IdCanton: z.number(),
    IdProvincia: z.number()
  })
);

export const districtsSchema = list(
  z.looseObject({
    Codigo_Distrito: z.string(),
    Distrito: z.string(),
    Id_Canton: z.number(),
    Id_Distrito: z.number()
  })
);

const station = z.looseObject({
  ClaveEstacion: z.string(),
  IdEstacion: z.number(),
  Nombre: z.string()
});

export const stationsSchema = list(station);

export const operativeStationsSchema = list(z.looseObject({ IdEstacion: z.number() }));

export const stationDetailsSchema = z.looseObject({
  ...envelope,
  CanalRadio: z.string().nullable(),
  Direccion: z.string().nullable(),
  Email: z.string().nullable(),
  Fax: z.string().nullable(),
  Latitud: z.number(),
  Longitud: z.number(),
  Telefono: z.string().nullable()
});

export const vehiclesSchema = list(
  z.looseObject({ IdVehiculo: z.number(), NumeroInterno: z.string() })
);

export const vehicleDetailsSchema = z.looseObject({
  ...envelope,
  Numero_interno: z.string(),
  Placa: z.string().nullable(),
  Des_clase_vehiculo: z.string().nullable(),
  Des_tipo_vehiculo: z.string().nullable(),
  Des_estado_operativo: z.string().nullable(),
  Id_estacion: z.number()
});

export const vehicleAvailabilityStatesSchema = list(
  z.looseObject({ Descripcion: z.string(), IdGrupoClasificacion: z.number() })
);
