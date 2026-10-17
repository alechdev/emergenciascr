import type { SigaeIncidentEndpoint } from "../types";

export type Scalar = string | number | boolean | null;

/**
 * `true` keeps a scalar value; `{ when }` keeps a scalar only while another field of the same
 * object, as received, equals the given value; `{ each }` keeps an array, filtering every item.
 */
export type FieldRule = true | { when: { field: string; equals: Scalar } } | { each: Allowlist };
export type Allowlist = Readonly<Record<string, FieldRule>>;

function fields(...names: string[]): Record<string, true> {
  return Object.fromEntries(names.map((name) => [name, true]));
}

function keptWhen(field: string, equals: Scalar): FieldRule {
  return { when: { field, equals } };
}

/** SIGAE sends lists as `Items` or `items`; snapshots keep the key as received. */
function list(each: Allowlist): Record<string, FieldRule> {
  return { Items: { each }, items: { each } };
}

/**
 * What a snapshot may keep, per endpoint (spec section 5.2). Everything else is dropped,
 * including fields SIGAE adds later: the report carries caller names, phone numbers, ID
 * numbers, operator names and free text.
 */
export const SNAPSHOT_ALLOWLISTS: Readonly<Record<SigaeIncidentEndpoint, Allowlist>> = {
  ObtenerBoletaIncidente: fields(
    "Codigo",
    "Descripcion",
    "Id_Boleta_Incidente",
    "Consecutivo",
    "Fecha",
    "Hora_Aviso",
    "Hora_Controlado",
    "Hora_Disponible",
    "Hora_Fuego_Bajo_Control",
    "Hora_Hospital",
    "Hora_Paciente",
    "Hora_Perdidas_Detenidas",
    "Hora_Todo_Claro",
    "Hora_Traslado",
    "Estado_Abierto",
    "DesUbicacion",
    "Direccion",
    "Id_Provincia",
    "Id_Canton",
    "Id_Distrito",
    "Provincia",
    "Canton",
    "Distrito",
    "CodigoTipoIncidenteDespacho",
    "CodigoTipoIncidenteReal",
    "NomtipoIncidenteDespacho",
    "NomTipoIncidenteReal",
    "Id_Etapa_Incidente",
    "DesEtapaIncidente",
    "Civiles_Heridos",
    "Civiles_Fallecidos",
    "Bomberos_Heridos",
    "Bomberos_Fallecidos"
  ),
  ObtenerDetalleEmergencias: {
    ...fields(
      "Codigo",
      "Descripcion",
      "codigo_tipo_incidente",
      "codigo_tipo_incidente_despacho",
      "codigo_tipo_incidente_despacho_esp",
      "codigo_tipo_incidente_esp",
      "consecutivo_EE",
      "direccion",
      "fecha",
      "hora_incidente",
      "latitud",
      "longitud",
      "tipo_incidente",
      "tipo_incidente_despacho",
      "tipo_incidente_despacho_esp",
      "tipo_incidente_esp"
    ),
    estaciones: {
      each: {
        ...fields("clave_estacion", "nombre"),
        vehiculos: { each: fields("estado", "numero_interno") }
      }
    }
  },
  ObtenerEstacionesAtiendeIncidente: {
    ...fields("Codigo", "Descripcion"),
    ...list({
      ...fields("Codigo", "Descripcion", "AtencionAPie", "ClaveEstacion", "DestipoServicio"),
      // Without attention on foot SIGAE sends its current clock time here, which would make
      // every poll store a new snapshot.
      HoraAtencionAPie: keptWhen("AtencionAPie", true),
      ...fields("IdBoletaEstacionAtiende", "IdEstacion", "IdTipoServicio", "NombreEstacion")
    })
  },
  ObtenerUnidadesDespachadasIncidente: {
    ...fields("Codigo", "Descripcion"),
    ...list(
      fields(
        "Codigo",
        "Descripcion",
        "CodigoEstacion",
        "CodigoUnidad",
        "DespachoAlarma",
        "HoraBase",
        "HoraDespacho",
        "HoraDevolverBase",
        "HoraLLegada",
        "HoraRetiro",
        "HoraTraslado",
        "IdBoletaServicio",
        "IdBoletaUnidadDespachada",
        "IdVehiculo",
        "NumeroInterno",
        "Traslado",
        "Unidad",
        "UnidadCompleta"
      )
    )
  }
};
