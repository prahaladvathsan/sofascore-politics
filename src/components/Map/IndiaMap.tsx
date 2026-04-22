import { useEffect, useState } from "react";
import { geoMercator, geoPath } from "d3";
import { feature } from "topojson-client";

type Shape = {
  name: string;
  path: string;
  href?: string;
  isHighlighted: boolean;
};

type TopologyObject = {
  type: string;
  objects: Record<string, unknown>;
};

type GeoFeature = {
  properties?: Record<string, string>;
};

type GeoFeatureCollection = {
  features: GeoFeature[];
};

export default function IndiaMap() {
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );

  useEffect(() => {
    let isMounted = true;

    async function loadMap() {
      try {
        const response = await fetch(
          `${import.meta.env.BASE_URL}data/geo/india.topojson`,
        );
        if (!response.ok) {
          throw new Error(`Failed to load map (${response.status})`);
        }

        const topology = (await response.json()) as TopologyObject;
        const statesObject =
          topology.objects.states ?? Object.values(topology.objects)[0];

        if (!statesObject) {
          throw new Error("No state geometry found in TopoJSON file");
        }

        const collection = feature(
          topology,
          statesObject,
        ) as GeoFeatureCollection;
        const projection = geoMercator().fitSize([760, 860], collection);
        const pathBuilder = geoPath(projection);
        const nextShapes = collection.features.map((shape) => {
          const properties = (shape.properties ?? {}) as Record<string, string>;
          const name = properties.st_nm ?? properties.name ?? "Unknown";
          const isHighlighted = name.toLowerCase() === "tamil nadu";

          return {
            name,
            path: pathBuilder(shape) ?? "",
            href: isHighlighted
              ? `${import.meta.env.BASE_URL}state/TN`
              : undefined,
            isHighlighted,
          };
        });

        if (isMounted) {
          setShapes(nextShapes);
          setStatus("ready");
        }
      } catch (error) {
        console.error(error);
        if (isMounted) {
          setStatus("error");
        }
      }
    }

    void loadMap();

    return () => {
      isMounted = false;
    };
  }, []);

  if (status === "loading") {
    return (
      <div className="flex h-[22rem] items-center justify-center rounded-3xl border border-brand-ink/10 bg-white/75 text-sm text-brand-slate">
        Loading India map...
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex h-[22rem] flex-col items-center justify-center rounded-3xl border border-brand-rose/20 bg-white/75 px-6 text-center text-sm text-brand-slate">
        <p>The India map could not be loaded.</p>
        <p className="mt-2">
          The rest of the seed data pages are still available in this build.
        </p>
      </div>
    );
  }

  return (
    <figure className="rounded-[2rem] border border-brand-ink/10 bg-white/80 p-4 shadow-card">
      <svg
        viewBox="0 0 760 860"
        className="h-auto w-full"
        role="img"
        aria-label="India map with Tamil Nadu highlighted"
      >
        {shapes.map((shape) => {
          const pathElement = (
            <path
              d={shape.path}
              fill={shape.isHighlighted ? "#be123c" : "#dbe6e2"}
              stroke={shape.isHighlighted ? "#881337" : "#8ca3a0"}
              strokeWidth={shape.isHighlighted ? 1.8 : 1}
              className={
                shape.isHighlighted
                  ? "cursor-pointer transition-opacity hover:opacity-85"
                  : ""
              }
            >
              <title>{shape.name}</title>
            </path>
          );

          return shape.href ? (
            <a
              key={shape.name}
              href={shape.href}
              aria-label={`Open ${shape.name} state page`}
            >
              {pathElement}
            </a>
          ) : (
            <g key={shape.name}>{pathElement}</g>
          );
        })}
      </svg>
      <figcaption className="mt-3 text-sm text-brand-slate">
        Tamil Nadu is the seeded state in phase 1. The homepage map is a
        lightweight React island backed by static TopoJSON served from{" "}
        <code>/data/geo/india.topojson</code>.
      </figcaption>
    </figure>
  );
}
