import { Skeleton } from "@/components/ui/skeleton";
import {
  Timeline,
  TimelineContent,
  TimelineDate,
  TimelineHeader,
  TimelineIndicator,
  TimelineItem,
  TimelineSeparator,
  TimelineTitle
} from "@/components/ui/timeline";
import { Route } from "@/routes/_dashboard/incidentes/$slug";

type TimelineEvent = {
  id: string;
  date: Date;
  title: string;
  description?: string;
};

function formatEventDate(date: Date, incidentDate: Date): string {
  const sameDay =
    date.getFullYear() === incidentDate.getFullYear() &&
    date.getMonth() === incidentDate.getMonth() &&
    date.getDate() === incidentDate.getDate();

  if (sameDay) {
    return date.toLocaleTimeString("es-CR", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true
    });
  }

  return date.toLocaleString("es-CR", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true
  });
}

export function IncidentTimeline() {
  const { incident, timeline } = Route.useLoaderData();
  const incidentDate = new Date(incident.incidentTimestamp);

  const events: TimelineEvent[] = timeline.map((event) => ({
    ...event,
    date: new Date(event.date)
  }));

  const lastStep = events.length > 0 ? events.length : 1;

  return (
    <Timeline defaultValue={lastStep}>
      {events.map((event, index) => (
        <TimelineItem
          key={event.id}
          step={index + 1}>
          <TimelineHeader>
            <TimelineSeparator />
            <TimelineDate>{formatEventDate(event.date, incidentDate)}</TimelineDate>
            <TimelineTitle>{event.title}</TimelineTitle>
            <TimelineIndicator />
          </TimelineHeader>
          {event.description ? <TimelineContent>{event.description}</TimelineContent> : null}
        </TimelineItem>
      ))}
    </Timeline>
  );
}

export function IncidentTimelineSkeleton() {
  return (
    <Timeline defaultValue={5}>
      <TimelineItem step={1}>
        <TimelineHeader>
          <TimelineSeparator />
          <Skeleton className="mb-1 h-4 w-16" />
          <TimelineTitle>Reporte inicial</TimelineTitle>
          <TimelineIndicator />
        </TimelineHeader>
      </TimelineItem>

      {Array.from({ length: 4 }).map((_, i) => (
        <TimelineItem
          key={i}
          step={i + 2}>
          <TimelineHeader>
            <TimelineSeparator />
            <Skeleton className="mb-1 h-4 w-16" />
            <TimelineTitle>
              <Skeleton className="h-4 w-40" />
            </TimelineTitle>
            <TimelineIndicator />
          </TimelineHeader>
          <TimelineContent>
            <Skeleton className="h-3 w-24" />
          </TimelineContent>
        </TimelineItem>
      ))}
    </Timeline>
  );
}

export default IncidentTimeline;
