export type ApiMode = "responses" | "chat";

const cache = new Map<string, ApiMode>();

export async function detectApiMode(opts: {
  baseUrl: string;
  apiKey: string | undefined;
}): Promise<ApiMode> {
  const cached = cache.get(opts.baseUrl);
  if (cached) return cached;

  const url = `${opts.baseUrl.replace(/\/$/, "")}/responses`;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.apiKey ?? ""}`,
      },
      body: "{}",
    });
    // 404 = path not implemented (chat only). Anything else = endpoint exists.
    const mode: ApiMode = r.status === 404 ? "chat" : "responses";
    cache.set(opts.baseUrl, mode);
    return mode;
  } catch {
    cache.set(opts.baseUrl, "chat");
    return "chat";
  }
}
