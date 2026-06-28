export const ROUTES = ["chat", "status", "skills-manage", "settings"] as const;
export type Route = (typeof ROUTES)[number] | `skill/${string}`;