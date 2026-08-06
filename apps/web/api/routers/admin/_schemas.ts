import { z } from "@hono/zod-openapi";

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function isValidIsoDate(value: string) {
  const [yearString, monthString, dayString] = value.split("-");
  const year = Number(yearString);
  const month = Number(monthString);
  const day = Number(dayString);

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

const isoDateStringSchema = z
  .string()
  .regex(isoDatePattern, { message: "Date must be in YYYY-MM-DD format" })
  .refine(isValidIsoDate, { message: "Invalid calendar date" });

export const SearchIncidentsByDateRangeQuerySchema = z
  .object({
    from: isoDateStringSchema.openapi({ example: "2024-01-01" }),
    to: isoDateStringSchema.openapi({ example: "2024-01-31" })
  })
  .refine((value) => value.from <= value.to, {
    message: "`from` must be on or before `to`",
    path: ["to"]
  });

export const SearchIncidentsByDateRangeResponseSchema = z.object({
  incidents: z.array(
    z.object({
      id: z.number(),
      consecutivo: z.string(),
      fecha: z.string(),
      hora: z.string(),
      direccion: z.string(),
      tipoIncidente: z.string(),
      estacionResponsable: z.string(),
      synced: z.boolean()
    })
  )
});

export const SyncIncidentsBodySchema = z.object({
  incidentIds: z.array(z.number())
});

export const SyncIncidentsResponseSchema = z.object({
  success: z.boolean(),
  totalIncidents: z.number(),
  syncedIncidents: z.number(),
  failedIncidents: z.number(),
  failedResults: z.array(
    z.object({
      incidentId: z.number(),
      success: z.boolean(),
      error: z.string().optional()
    })
  )
});

export const IncidentIdParamsSchema = z.object({
  id: z.coerce.number().openapi({
    param: { name: "id", in: "path", required: true },
    example: 1556825
  })
});

export const SyncSingleIncidentResponseSchema = z.object({
  incidentId: z.number(),
  success: z.boolean(),
  error: z.string().optional()
});
