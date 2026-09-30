// Maps the request URL a Vercel Function receives back to the API path handleApiRequest expects.
// vercel.json rewrites every /api/* (and the bare /layers, /runs, … routes) to /api/osa?__osa_path=<path>,
// because a file-system catch-all (api/[...path].ts) only matched one path segment on Vercel.
export const VERCEL_PATH_PARAM = "__osa_path";

export function vercelApiPath(requestUrl: string | undefined): string {
  const url = new URL(requestUrl ?? "/", "http://localhost");
  const rewritten = url.searchParams.get(VERCEL_PATH_PARAM);
  let pathname: string;
  if (rewritten !== null) {
    url.searchParams.delete(VERCEL_PATH_PARAM);
    const segments = rewritten.split("/").filter(Boolean).map(encodeURIComponent);
    pathname = "/" + segments.join("/");
  } else {
    pathname = url.pathname.startsWith("/api/") ? url.pathname.slice(4) : url.pathname === "/api" ? "/" : url.pathname;
  }
  const query = url.searchParams.toString();
  return query ? `${pathname}?${query}` : pathname;
}
