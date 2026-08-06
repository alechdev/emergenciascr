import { ChartBarHorizontalIcon, TableIcon, WarningIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, XAxis, YAxis } from "recharts";

import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip
} from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs";
import { getIncidentResponseTimesOptions } from "@/lib/api/@tanstack/react-query.gen";
import { cn } from "@/lib/utils";
import { Route } from "@/routes/_dashboard/incidentes/$slug";

import type { GetIncidentResponseTimesResponse } from "@/lib/api/types.gen";

const chartConfig = {
  responseTime: {
    label: "Tiempo de respuesta",
    color: "var(--chart-1)",
    className: "bg-chart-1"
  },
  onSceneTime: {
    label: "Tiempo en escena",
    color: "var(--chart-2)",
    className: "bg-chart-2"
  },
  returnTime: {
    label: "Tiempo de regreso",
    color: "var(--chart-3)",
    className: "bg-chart-3"
  }
} satisfies ChartConfig & {
  [key: string]: { className: string };
};

function formatSecondsToHMS(seconds: number): string {
  if (seconds <= 0) return "0s";

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

  return parts.join(" ");
}

function formatTime(dateString: string | null): string {
  if (!dateString) return "N/A";
  const date = new Date(dateString);
  if (date.getFullYear() === 1970) return "N/A";
  return date.toLocaleTimeString("es-CR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true
  });
}

export function VehicleResponseTimes() {
  const { incident } = Route.useLoaderData();

  const {
    data: responseTimes,
    isLoading,
    isError
  } = useQuery(
    getIncidentResponseTimesOptions({
      path: { id: incident.id }
    })
  );

  if (isLoading || isError || !responseTimes) {
    return (
      <div className="relative">
        <VehicleResponseTimesSkeleton />
        {isError ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/70 p-4 text-center text-sm text-muted-foreground backdrop-blur-sm">
            <WarningIcon className="size-6" />
            Ocurrió un error cargando los tiempos de respuesta
          </div>
        ) : null}
      </div>
    );
  }

  const vehicles = responseTimes.vehicles ?? [];
  const timeData = vehicles
    .filter((v) => v.totalTimeSeconds > 0)
    .sort((a, b) => a.totalTimeSeconds - b.totalTimeSeconds);

  if (timeData.length === 0) {
    return (
      <section className="mt-6">
        <h2 id="tiempos">Desglose de tiempos de vehículos despachados</h2>
        <p className="mt-2 text-muted-foreground">No hay datos de tiempo disponibles</p>
      </section>
    );
  }

  return (
    <section className="mt-6">
      <h2 id="tiempos">Desglose de tiempos de vehículos despachados</h2>
      <Tabs
        defaultValue="chart"
        className="w-full">
        <TabsList
          variant="underline"
          className="mt-2 h-auto">
          <TabsTab
            value="chart"
            className="border-none"
            aria-label="Ver gráfico">
            <ChartBarHorizontalIcon
              className="size-4"
              aria-hidden="true"
            />
            Gráfico
          </TabsTab>
          <TabsTab
            value="table"
            className="border-none"
            aria-label="Ver tabla">
            <TableIcon
              className="size-4"
              aria-hidden="true"
            />
            Tabla
          </TabsTab>
        </TabsList>

        <TabsPanel value="chart">
          <VehicleResponseTimeChart vehicles={timeData} />
        </TabsPanel>

        <TabsPanel value="table">
          <VehicleResponseTimeTable vehicles={vehicles} />
        </TabsPanel>
      </Tabs>
    </section>
  );
}

type VehicleTimeData = GetIncidentResponseTimesResponse["vehicles"][number];

function VehicleResponseTimeChart({ vehicles }: { vehicles: VehicleTimeData[] }) {
  const chartData = vehicles.map((v) => ({
    id: v.id,
    vehicle: v.vehicle,
    station: v.station,
    responseTime: v.responseTimeSeconds,
    onSceneTime: v.onSceneTimeSeconds,
    returnTime: v.returnTimeSeconds,
    isEnRoute: v.isEnRoute,
    totalTime: v.totalTimeSeconds
  }));

  const chartHeight = 125 + chartData.length * 35;

  return (
    <ChartContainer
      config={chartConfig}
      className="w-full"
      style={{ height: chartHeight }}>
      <BarChart
        accessibilityLayer
        data={chartData}
        layout="vertical">
        <YAxis
          type="category"
          dataKey="vehicle"
          tickLine={false}
          tickMargin={10}
          axisLine={false}
          tickFormatter={(value) => (value.length > 6 ? `${value.slice(0, 6)}...` : value)}
          width={70}
          textAnchor="end"
        />
        <XAxis
          type="number"
          tickLine={false}
          tickMargin={10}
          axisLine={false}
          tickFormatter={(value) => formatSecondsToHMS(Number(value))}
        />
        <ChartTooltip
          cursor={false}
          content={<CustomTooltipContent />}
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar
          stackId="a"
          dataKey="responseTime"
          fill="var(--color-responseTime)"
          radius={4}
          barSize={8}
        />
        <Bar
          stackId="a"
          dataKey="onSceneTime"
          fill="var(--color-onSceneTime)"
          radius={4}
          barSize={8}
        />
        <Bar
          stackId="a"
          dataKey="returnTime"
          fill="var(--color-returnTime)"
          radius={4}
          barSize={8}
        />
      </BarChart>
    </ChartContainer>
  );
}

interface TooltipPayloadItem {
  value: number;
  dataKey: string;
  payload: Record<string, number | string | boolean>;
}

interface CustomTooltipContentProps {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string;
}

function CustomTooltipContent({ active, payload }: CustomTooltipContentProps) {
  if (!active || !payload || !payload.length) return null;
  const data = payload[0]?.payload;
  if (!data) return null;

  const vehicleLabel = `${data.vehicle} ${data.station}`;

  const segments = [
    { key: "responseTime", ...chartConfig.responseTime },
    { key: "onSceneTime", ...chartConfig.onSceneTime },
    { key: "returnTime", ...chartConfig.returnTime }
  ];

  return (
    <div className="min-w-[220px] rounded-lg border bg-background p-3 shadow-sm">
      <div className="space-y-1">
        <div className="font-medium">{vehicleLabel}</div>
        <div className="space-y-1">
          {segments.map((seg) => {
            const isReturnSegment = seg.key === "returnTime";
            const isEnRoute = Boolean(data.isEnRoute);
            const valueSeconds = Number(data[seg.key] ?? 0);
            return (
              <div
                className="flex items-center justify-between gap-4"
                key={seg.key}>
                <div className="flex items-center gap-2">
                  <div className={cn("h-3 w-1 rounded-[2px]", seg.className)} />
                  <span className="text-xs text-muted-foreground">{seg.label}:</span>
                </div>
                <span className="font-mono text-sm font-medium">
                  {isReturnSegment && isEnRoute ? "En camino" : formatSecondsToHMS(valueSeconds)}
                </span>
              </div>
            );
          })}
        </div>
        <div className="mt-2 flex items-center justify-between gap-4 border-t pt-2">
          <span className="text-xs font-semibold">Total:</span>
          <span className="font-mono text-xs font-semibold">
            {formatSecondsToHMS(Number(data.totalTime ?? 0))}
          </span>
        </div>
      </div>
    </div>
  );
}

function VehicleResponseTimeTable({ vehicles }: { vehicles: VehicleTimeData[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Vehículo</TableHead>
          <TableHead>Estación</TableHead>
          <TableHead>Despacho</TableHead>
          <TableHead>Llegada</TableHead>
          <TableHead>Retiro</TableHead>
          <TableHead>Tiempo de respuesta</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {vehicles.map((vehicle) => (
          <TableRow key={vehicle.id}>
            <TableCell>{vehicle.vehicle}</TableCell>
            <TableCell>{vehicle.station}</TableCell>
            <TableCell>{formatTime(vehicle.dispatchedTime)}</TableCell>
            <TableCell>{formatTime(vehicle.arrivalTime)}</TableCell>
            <TableCell>{formatTime(vehicle.departureTime)}</TableCell>
            <TableCell>
              {vehicle.responseTimeSeconds > 0
                ? formatSecondsToHMS(vehicle.responseTimeSeconds)
                : "N/A"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function VehicleResponseTimesSkeleton() {
  return (
    <section className="mt-6">
      <Skeleton className="mb-4 h-8 w-80" />
      <div className="flex gap-4 border-b pb-2">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-20" />
      </div>
      <div className="mt-4 space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-2 flex-1" />
          </div>
        ))}
      </div>
      <div className="mt-4 flex justify-center gap-6">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-4 w-28" />
      </div>
    </section>
  );
}

export default VehicleResponseTimes;
