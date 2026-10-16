import db, { eq } from "@bomberoscr/db/index";
import { type incidentsInsertSchema, incidents as incidentsTable } from "@bomberoscr/db/schema";

import type { IncidentDetails, IncidentReport } from "@bomberoscr/sigae/client";
import type z from "zod";

export async function rawToIncident({
  incidentId,
  responsibleStationId,
  incidentReport,
  incidentDetails
}: {
  incidentId: number;
  responsibleStationId: number;
  incidentReport: IncidentReport;
  incidentDetails: IncidentDetails;
}): Promise<z.infer<typeof incidentsInsertSchema>> {
  const date = incidentReport.Fecha.split("T")[0];
  const time = incidentReport.Hora_Aviso.split("T")[1];
  const timestamp = new Date(`${date}T${time}`);
  return {
    id: incidentId,
    EEConsecutive: incidentReport.Consecutivo,
    address: incidentReport.DesUbicacion,
    districtId: incidentReport.Id_Distrito === 0 ? null : incidentReport.Id_Distrito,
    cantonId: incidentReport.Id_Canton === 0 ? null : incidentReport.Id_Canton,
    provinceId: incidentReport.Id_Provincia === 0 ? null : incidentReport.Id_Provincia,
    importantDetails: incidentReport.Direccion,
    dispatchIncidentCode: await getIncidentType(incidentDetails.codigo_tipo_incidente_despacho),
    specificDispatchIncidentCode: await getIncidentType(
      incidentDetails.codigo_tipo_incidente_despacho_esp
    ),
    incidentCode: await getIncidentType(incidentDetails.codigo_tipo_incidente),
    specificIncidentCode: await getIncidentType(incidentDetails.codigo_tipo_incidente_esp),
    incidentTimestamp: timestamp,
    responsibleStation: responsibleStationId,
    latitude: incidentDetails.latitud?.toString() || "0",
    longitude: incidentDetails.longitud?.toString() || "0",
    isOpen: incidentReport.Estado_Abierto === "true",
    modifiedAt: new Date()
  };
}

function sanitizeIncidentCode(code: string) {
  if (code.charAt(code.length - 1) !== ".") return code;

  return code.slice(0, code.length - 1);
}

async function getIncidentType(incidentCode: string | null) {
  if (!incidentCode) return null;
  const sanitized = sanitizeIncidentCode(incidentCode);
  const type = await db.query.incidentTypes.findFirst({
    where: eq(incidentsTable.incidentCode, sanitized),
    columns: { incidentCode: true }
  });
  return type?.incidentCode || null;
}
