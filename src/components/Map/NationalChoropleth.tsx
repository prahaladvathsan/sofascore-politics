import { useEffect, useMemo, useRef, useState } from "react";
import { geoMercator, geoPath } from "d3-geo";
import { scaleSequential } from "d3-scale";
import { interpolateViridis } from "d3-scale-chromatic";
import { feature } from "topojson-client";
import {
  ArrowRight,
  LoaderCircle,
  MapPinned,
  TriangleAlert,
} from "lucide-react";

import type { NationalStateSummary } from "./types";

type TopologyObject = {
  type: string;
  objects: Record<
    string,
    { geometries: Array<{ properties: Record<string, unknown> }> }
  >;
  arcs: unknown[];
  transform?: unknown;
};

type GeoFeature = {
  type: string;
  properties: Record<string, unknown>;
  geometry: unknown;
};

type GeoFeatureCollection = {
  type: string;
  features: GeoFeature[];
};

type Shape = {
  code: string;
  name: string;
  d: string;
  href?: string;
  statusLabel: string;
  scheduleStatus: "officially_announced" | "pending";
  monthsToElection: number | null;
  hasAssembly: boolean;
};

interface Props {
  geometryPath: string;
  states: NationalStateSummary[];
}

function getTopologyObject(topology: TopologyObject) {
  return topology.objects[Object.keys(topology.objects)[0]];
}

function getSequentialColor(maxMonths: number) {
  return scaleSequential(interpolateViridis).domain([
    Math.max(maxMonths, 1),
    0,
  ]);
}

function getNeutralFill(hasAssembly: boolean) {
  return hasAssembly ? "var(--map-pending)" : "var(--map-disabled)";
}

export default function NationalChoropleth({ geometryPath, states }: Props) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [shapes, setShapes] = useState<Shape[]>([]);
  const anchorRefs = useRef<Array<HTMLAnchorElement | null>>([]);
  const activeIndexRef = useRef(0);
  const frameRef = useRef<HTMLDivElement | null>(null);

  const scheduledStates = useMemo(
    () =>
      states
        .filter((state) => state.scheduleStatus === "officially_announced")
        .map((state) => state.monthsToElection ?? 0),
    [states],
  );

  const maxMonths =
    scheduledStates.length === 0 ? 1 : Math.max(...scheduledStates, 1);
  const viridis = useMemo(() => getSequentialColor(maxMonths), [maxMonths]);

  useEffect(() => {
    let isMounted = true;

    async function loadGeometry() {
      try {
        const response = await fetch(geometryPath);
        if (!response.ok) {
          throw new Error(
            `Failed to load national geometry (${response.status})`,
          );
        }

        const topology = (await response.json()) as TopologyObject;
        const collection = feature(
          topology as never,
          getTopologyObject(topology) as never,
        ) as GeoFeatureCollection;
        const projection = geoMercator().fitSize(
          [920, 780],
          collection as never,
        );
        const builder = geoPath(projection);
        const statesByCode = new Map(
          states.map((state) => [state.code, state]),
        );

        const nextShapes: Shape[] = [];
        for (const stateFeature of collection.features) {
          const code = String(stateFeature.properties.code ?? "");
          const state = statesByCode.get(code);
          if (!state) {
            continue;
          }

          nextShapes.push({
            code,
            name: state.name,
            d: builder(stateFeature as never) ?? "",
            href: state.href,
            statusLabel: state.statusLabel,
            scheduleStatus: state.scheduleStatus,
            monthsToElection: state.monthsToElection,
            hasAssembly: state.hasAssembly,
          });
        }

        if (!isMounted) {
          return;
        }

        setShapes(nextShapes);
        setStatus("ready");
      } catch (error) {
        console.error(error);
        if (isMounted) {
          setStatus("error");
        }
      }
    }

    void loadGeometry();

    return () => {
      isMounted = false;
    };
  }, [geometryPath, states]);

  useEffect(() => {
    const element = frameRef.current;
    if (!element) {
      return;
    }

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    element.animate(
      [
        { opacity: 0, transform: "translateY(20px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      {
        duration: 320,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        fill: "both",
      },
    );
  }, [status]);

  const interactiveShapes = shapes.filter((shape) => shape.href);

  function moveFocus(direction: -1 | 1) {
    const count = interactiveShapes.length;
    if (count === 0) {
      return;
    }

    activeIndexRef.current =
      (activeIndexRef.current + direction + count) % count;
    anchorRefs.current[activeIndexRef.current]?.focus();
  }

  function renderLoadingState() {
    return (
      <div className="map-fallback" aria-live="polite">
        <div className="map-fallback__header">
          <LoaderCircle size={18} className="animate-spin" />
          <p>Loading the national geometry...</p>
        </div>
      </div>
    );
  }

  function renderFallbackList() {
    return (
      <div className="map-fallback">
        <div className="map-fallback__header">
          <TriangleAlert size={18} />
          <p>Geometry fetch failed. Showing the state list instead.</p>
        </div>
        <ul className="map-fallback__list">
          {states
            .filter((state) => state.hasAssembly)
            .map((state) => (
              <li key={state.code} className="map-fallback__item">
                <div>
                  <p className="map-fallback__title">{state.name}</p>
                  <p className="map-fallback__copy">{state.statusLabel}</p>
                </div>
                {state.href ? (
                  <a className="map-fallback__link" href={state.href}>
                    Open state
                    <ArrowRight size={16} />
                  </a>
                ) : (
                  <span className="map-fallback__muted">Route unavailable</span>
                )}
              </li>
            ))}
        </ul>
      </div>
    );
  }

  if (status === "loading") {
    return renderLoadingState();
  }

  if (status === "error") {
    return renderFallbackList();
  }

  return (
    <div
      className="map-frame"
      ref={frameRef}
      style={{ viewTransitionName: "national-map" }}
    >
      <div className="map-frame__meta">
        <div>
          <p className="eyebrow">National heatmap</p>
          <h2 className="map-frame__title">Assembly calendar at a glance</h2>
        </div>
        <div className="map-frame__legend">
          <span className="map-frame__legend-chip map-frame__legend-chip--scheduled">
            <MapPinned size={14} />
            Official ECI schedule
          </span>
          <span className="map-frame__legend-chip">Pending ECI schedule</span>
        </div>
      </div>

      <div className="map-frame__canvas">
        <svg
          viewBox="0 0 920 780"
          role="img"
          aria-label="National choropleth of Indian states and union territories by months to next assembly election"
          className="h-auto w-full"
        >
          {shapes.map((shape) => {
            const fill =
              shape.scheduleStatus === "officially_announced"
                ? viridis(shape.monthsToElection ?? 0)
                : getNeutralFill(shape.hasAssembly);
            const stroke = shape.href
              ? "var(--map-stroke)"
              : "var(--map-stroke-muted)";

            if (!shape.href) {
              return (
                <g key={shape.code}>
                  <path
                    d={shape.d}
                    fill={fill}
                    stroke={stroke}
                    strokeWidth={1}
                  />
                  <title>{`${shape.name}: ${shape.statusLabel}`}</title>
                </g>
              );
            }

            const interactiveIndex = interactiveShapes.findIndex(
              (candidate) => candidate.code === shape.code,
            );

            return (
              <a
                key={shape.code}
                href={shape.href}
                ref={(element) => {
                  anchorRefs.current[interactiveIndex] = element;
                }}
                className="map-shape-link"
                tabIndex={interactiveIndex === 0 ? 0 : -1}
                aria-label={`${shape.name}: ${shape.statusLabel}`}
                onFocus={() => {
                  activeIndexRef.current = interactiveIndex;
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                    event.preventDefault();
                    moveFocus(1);
                  }
                  if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                    event.preventDefault();
                    moveFocus(-1);
                  }
                }}
              >
                <path
                  d={shape.d}
                  fill={fill}
                  stroke={stroke}
                  strokeWidth={1.2}
                  className="map-shape-link__path"
                />
                <title>{`${shape.name}: ${shape.statusLabel}`}</title>
              </a>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
