export function toStateCode(input: string): string {
  return input.toUpperCase();
}

export function toStateSlug(input: string): string {
  return toStateCode(input).toLowerCase();
}

export function toConstituencyId(input: string): string {
  return input.toUpperCase();
}

export function toConstituencySlug(input: string): string {
  return toConstituencyId(input).toLowerCase();
}

export function toStatePath(input: string): string {
  return `/state/${toStateSlug(input)}`;
}

export function toConstituencyPath(input: string): string {
  return `/constituency/${toConstituencySlug(input)}`;
}

export function withBase(baseUrl: string, path: string): string {
  return `${baseUrl}${path.replace(/^\//, "")}`;
}
