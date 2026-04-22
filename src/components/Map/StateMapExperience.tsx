import { useEffect, useMemo, useRef, useState } from "react";
import { geoMercator, geoPath } from "d3-geo";
import { select } from "d3-selection";
import { zoom, zoomIdentity } from "d3-zoom";
import { feature } from "topojson-client";
import {
  ChevronRight,
  ExternalLink,
  LoaderCircle,
  RotateCcw,
  TriangleAlert,
  UserRound,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import type { StateMapExperienceProps } from "./types";

type TopologyObject = {
  type: string;
  objects: Record<
    string,
    { geometries: Array<{ properties: Record<string, unknown> }> }
  >;
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
  slug: string;
  id: string;
  d: string;
  number: number;
  name: string;
  district?: string;
  href: string;
};

function getTopologyObject(topology: TopologyObject) {
  return topology.objects[Object.keys(topology.objects)[0]];
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      setReduced(query.matches);
    };
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return reduced;
}

function animatePanels(elements: Array<HTMLElement | null>, disabled: boolean) {
  if (disabled) {
    return;
  }

  for (const element of elements) {
    if (!element) {
      continue;
    }

    element.animate(
      [
        { opacity: 0, transform: "translateY(20px) scale(0.985)" },
        { opacity: 1, transform: "translateY(0) scale(1)" },
      ],
      {
        duration: 320,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        fill: "both",
      },
    );
  }
}

export default function StateMapExperience({
  basePath,
  geometryPath,
  stateCode,
  stateName,
  statusLabel,
  mode,
  selectedSlug,
  panels,
}: StateMapExperienceProps) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [shapes, setShapes] = useState<Shape[]>([]);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const viewportRef = useRef<SVGGElement | null>(null);
  const mapCardRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const anchorRefs = useRef<Array<HTMLAnchorElement | null>>([]);
  const zoomBehaviorRef = useRef<ReturnType<
    typeof zoom<SVGSVGElement, unknown>
  > | null>(null);
  const activeIndexRef = useRef(0);
  const reducedMotion = useReducedMotion();

  const panelsBySlug = useMemo(
    () => new Map(panels.map((panel) => [panel.slug, panel])),
    [panels],
  );
  const activePanel =
    (selectedSlug ? panelsBySlug.get(selectedSlug) : undefined) ?? undefined;

  useEffect(() => {
    let isMounted = true;

    async function loadGeometry() {
      try {
        const response = await fetch(geometryPath);
        if (!response.ok) {
          throw new Error(
            `Failed to load constituency geometry (${response.status})`,
          );
        }

        const topology = (await response.json()) as TopologyObject;
        const collection = feature(
          topology as never,
          getTopologyObject(topology) as never,
        ) as GeoFeatureCollection;
        const projection = geoMercator().fitSize(
          [900, 860],
          collection as never,
        );
        const builder = geoPath(projection);

        const nextShapes = collection.features.map((featureRecord) => ({
          slug: String(featureRecord.properties.slug),
          id: String(featureRecord.properties.id),
          d: builder(featureRecord as never) ?? "",
          number: Number(featureRecord.properties.number),
          name: String(featureRecord.properties.name),
          district:
            typeof featureRecord.properties.district === "string"
              ? String(featureRecord.properties.district)
              : undefined,
          href: `${basePath}constituency/${String(featureRecord.properties.slug)}`,
        }));

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
  }, [basePath, geometryPath]);

  useEffect(() => {
    if (status !== "ready" || !svgRef.current || !viewportRef.current) {
      return;
    }

    const nextZoom = zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 10])
      .on("zoom", (event: { transform: { toString(): string } }) => {
        if (viewportRef.current) {
          viewportRef.current.setAttribute(
            "transform",
            event.transform.toString(),
          );
        }
      });

    zoomBehaviorRef.current = nextZoom;
    select(svgRef.current).call(nextZoom as never);
  }, [status]);

  useEffect(() => {
    animatePanels([mapCardRef.current, panelRef.current], reducedMotion);
  }, [reducedMotion, selectedSlug, status]);

  function zoomBy(multiplier: number) {
    if (!svgRef.current || !zoomBehaviorRef.current) {
      return;
    }

    select(svgRef.current).call(
      zoomBehaviorRef.current.scaleBy as never,
      multiplier,
    );
  }

  function resetZoom() {
    if (!svgRef.current || !zoomBehaviorRef.current) {
      return;
    }

    select(svgRef.current).call(
      zoomBehaviorRef.current.transform as never,
      zoomIdentity,
    );
  }

  function moveFocus(direction: -1 | 1) {
    const count = shapes.length;
    if (count === 0) {
      return;
    }

    activeIndexRef.current =
      (activeIndexRef.current + direction + count) % count;
    anchorRefs.current[activeIndexRef.current]?.focus();
  }

  function renderFallback(isError: boolean) {
    if (!isError) {
      return (
        <div className="state-map-shell state-map-shell--fallback">
          <div className="map-fallback" aria-live="polite">
            <div className="map-fallback__header">
              <LoaderCircle size={18} className="animate-spin" />
              <p>Loading {stateName} constituency geometry...</p>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="state-map-shell state-map-shell--fallback">
        <div className="map-fallback">
          <div className="map-fallback__header">
            <TriangleAlert size={18} />
            <p>
              The {stateName} geometry could not be loaded. The constituency
              list is still available below.
            </p>
          </div>
          <ul className="map-fallback__list">
            {panels.map((panel) => (
              <li key={panel.slug} className="map-fallback__item">
                <div>
                  <p className="map-fallback__title">
                    Seat {panel.number}: {panel.name}
                  </p>
                  <p className="map-fallback__copy">
                    {panel.hasSeedData
                      ? panel.mla
                        ? `${panel.mla.name} currently holds the seat.`
                        : "Seed data available."
                      : "Candidate data coming soon."}
                  </p>
                </div>
                <a
                  className="map-fallback__link"
                  href={`${basePath}constituency/${panel.slug}`}
                >
                  Open seat
                  <ChevronRight size={16} />
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  if (status === "loading") {
    return renderFallback(false);
  }

  if (status === "error") {
    return renderFallback(true);
  }

  return (
    <section
      className={`state-map-shell ${mode === "focus" ? "state-map-shell--focus" : ""}`}
    >
      <div
        className="map-frame"
        ref={mapCardRef}
        style={{ viewTransitionName: `${stateCode.toLowerCase()}-map` }}
        data-flip-id="map"
      >
        <div className="map-frame__meta">
          <div>
            <p className="eyebrow">{stateName}</p>
            <h2 className="map-frame__title">Constituency boundaries</h2>
            <p className="map-frame__copy">{statusLabel}</p>
          </div>
          <div className="map-controls" aria-label="Map zoom controls">
            <button
              type="button"
              className="map-control"
              onClick={() => zoomBy(1.2)}
            >
              <ZoomIn size={16} />
            </button>
            <button
              type="button"
              className="map-control"
              onClick={() => zoomBy(0.85)}
            >
              <ZoomOut size={16} />
            </button>
            <button type="button" className="map-control" onClick={resetZoom}>
              <RotateCcw size={16} />
            </button>
          </div>
        </div>

        <div className="map-frame__canvas">
          <svg
            ref={svgRef}
            viewBox="0 0 900 860"
            role="img"
            aria-label={`${stateName} assembly constituencies map`}
            className="h-auto w-full touch-none"
          >
            <g ref={viewportRef}>
              {shapes.map((shape, index) => {
                const isSelected = shape.slug === selectedSlug;
                return (
                  <a
                    key={shape.slug}
                    href={shape.href}
                    ref={(element) => {
                      anchorRefs.current[index] = element;
                    }}
                    tabIndex={index === 0 ? 0 : -1}
                    aria-current={isSelected ? "page" : undefined}
                    aria-label={`${shape.name}, seat ${shape.number}`}
                    onFocus={() => {
                      activeIndexRef.current = index;
                    }}
                    onKeyDown={(event) => {
                      if (
                        event.key === "ArrowRight" ||
                        event.key === "ArrowDown"
                      ) {
                        event.preventDefault();
                        moveFocus(1);
                      }
                      if (
                        event.key === "ArrowLeft" ||
                        event.key === "ArrowUp"
                      ) {
                        event.preventDefault();
                        moveFocus(-1);
                      }
                    }}
                    className="map-shape-link"
                  >
                    <path
                      d={shape.d}
                      fill={
                        isSelected ? "var(--map-selected)" : "var(--map-fill)"
                      }
                      stroke={
                        isSelected
                          ? "var(--map-selected-stroke)"
                          : "var(--map-stroke)"
                      }
                      strokeWidth={isSelected ? 1.8 : 1}
                      className="map-shape-link__path"
                    />
                    <title>{`${shape.name}, seat ${shape.number}`}</title>
                  </a>
                );
              })}
            </g>
          </svg>
        </div>
      </div>

      {mode === "focus" && activePanel ? (
        <aside
          className="editorial-panel editorial-panel--compact"
          ref={panelRef}
          data-flip-id="panel"
          style={{ viewTransitionName: `${activePanel.slug}-panel` }}
        >
          <p className="eyebrow">Constituency panel</p>
          <h2 className="panel-title">
            Seat {activePanel.number}: {activePanel.name}
          </h2>
          <p className="panel-copy">
            {activePanel.district
              ? `${activePanel.district}, ${stateName}.`
              : `${stateName} assembly constituency.`}
          </p>

          <dl className="detail-grid">
            <div className="detail-card">
              <dt>Route</dt>
              <dd>{activePanel.id.toLowerCase()}</dd>
            </div>
            <div className="detail-card">
              <dt>Seed data</dt>
              <dd>{activePanel.hasSeedData ? "Available" : "Coming soon"}</dd>
            </div>
            {activePanel.reservation ? (
              <div className="detail-card">
                <dt>Reservation</dt>
                <dd>{activePanel.reservation}</dd>
              </div>
            ) : null}
            {activePanel.latestElectionYear ? (
              <div className="detail-card">
                <dt>Latest election</dt>
                <dd>{activePanel.latestElectionYear}</dd>
              </div>
            ) : null}
          </dl>

          {activePanel.mla ? (
            <section className="panel-stack">
              <div className="panel-card">
                <p className="eyebrow">Current MLA</p>
                <div className="panel-card__header">
                  <div>
                    <h3>{activePanel.mla.name}</h3>
                    <p>
                      {activePanel.mla.partyName} (
                      {activePanel.mla.partyShortName})
                    </p>
                  </div>
                  <span
                    className="party-badge"
                    style={{ backgroundColor: activePanel.mla.partyColor }}
                  >
                    {activePanel.mla.partyShortName}
                  </span>
                </div>
                <p className="panel-card__copy">{activePanel.mla.office}</p>
                <p className="panel-card__copy">
                  Term start: {activePanel.mla.termStart}
                </p>
                <div className="panel-link-row">
                  {activePanel.mla.profileUrls.map((url) => (
                    <a
                      key={url}
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="panel-link"
                    >
                      Source page
                      <ExternalLink size={14} />
                    </a>
                  ))}
                </div>
              </div>

              <div className="panel-card">
                <p className="eyebrow">Seed candidate list</p>
                <ul className="candidate-list">
                  {activePanel.candidates.map((candidate) => (
                    <li key={candidate.id} className="candidate-list__item">
                      <div>
                        <p className="candidate-list__title">
                          {candidate.name}
                        </p>
                        <p className="candidate-list__copy">
                          {candidate.partyName} ({candidate.partyShortName}) |{" "}
                          {candidate.office}
                        </p>
                      </div>
                      {candidate.incumbent ? (
                        <span className="candidate-list__pill">Incumbent</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          ) : (
            <div className="empty-state">
              <UserRound size={18} />
              <div>
                <p className="empty-state__title">Candidate data coming soon</p>
                <p className="empty-state__copy">
                  The geometry-backed seat route is live, but this constituency
                  does not yet have seeded MLA or candidate JSON.
                </p>
              </div>
            </div>
          )}

          <div className="panel-card">
            <p className="eyebrow">Sources</p>
            <ul className="source-list">
              {activePanel.sources.map((source) => (
                <li key={source.url}>
                  <a href={source.url} target="_blank" rel="noreferrer">
                    {source.name}
                    <ExternalLink size={14} />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      ) : null}
    </section>
  );
}
