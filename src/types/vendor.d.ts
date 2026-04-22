declare module "d3" {
  export function geoMercator(): {
    fitSize(size: [number, number], object: unknown): unknown;
  };

  export function geoPath(
    projection: unknown,
  ): (feature: unknown) => string | null;
}

declare module "topojson-client" {
  export function feature(topology: unknown, object: unknown): unknown;
}
