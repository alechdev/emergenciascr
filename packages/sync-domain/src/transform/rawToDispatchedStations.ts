import type { dispatchedStationsInsertSchema } from "@bomberoscr/db/schema";
import type { DispatchedStation } from "@bomberoscr/sigae/client";
import type z from "zod";

export function rawToDispatchedStations({
  incidentId,
  dispatchedStations
}: {
  incidentId: number;
  dispatchedStations: DispatchedStation[];
}): z.infer<typeof dispatchedStationsInsertSchema>[] {
  return dispatchedStations.map((station) => ({
    id: station.IdBoletaEstacionAtiende,
    attentionOnFoot: station.AtencionAPie,
    incidentId: incidentId,
    serviceTypeId: station.IdTipoServicio,
    stationId: station.IdEstacion
  }));
}
