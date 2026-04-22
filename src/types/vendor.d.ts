declare module "d3-geo" {
  export function geoMercator(): {
    fitSize(size: [number, number], object: unknown): unknown;
  };

  export function geoPath(
    projection: unknown,
  ): (feature: unknown) => string | null;
}

declare module "d3-scale" {
  export function scaleSequential(interpolator: (value: number) => string): {
    domain(values: [number, number]): (value: number) => string;
  };
}

declare module "d3-scale-chromatic" {
  export const interpolateViridis: (value: number) => string;
}

declare module "d3-selection" {
  export function select(target: unknown): {
    call(method: unknown, ...args: unknown[]): unknown;
  };
}

declare module "d3-zoom" {
  export interface ZoomBehavior<
    TElement extends Element = Element,
    TDatum = unknown,
  > {
    scaleExtent(values: [number, number]): ZoomBehavior<TElement, TDatum>;
    on(
      eventType: string,
      listener: (event: { transform: { toString(): string } }) => void,
    ): ZoomBehavior<TElement, TDatum>;
    scaleBy(selection: unknown, multiplier: number): void;
    transform(selection: unknown, transform: unknown): void;
    __types__?: [TElement, TDatum];
  }

  export function zoom<TElement extends Element, TDatum>(): ZoomBehavior<
    TElement,
    TDatum
  >;

  export const zoomIdentity: unknown;
}

declare module "topojson-client" {
  export function feature(topology: unknown, object: unknown): unknown;
}
