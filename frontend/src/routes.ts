export const ROUTES = ["chat", "status", "skills-manage"] as const;
export type Route = (typeof ROUTES)[number] | `skill/${string}`;