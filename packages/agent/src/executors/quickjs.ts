import type { QuickJSAsyncVariant } from "@jitl/quickjs-ffi-types";
import variantModule from "@jitl/quickjs-wasmfile-release-asyncify";
import { HEADERS_MARKER, loadAsyncQuickJs } from "@sebastianwessel/quickjs";

// nodenext + verbatimModuleSyntax sees the package's `export { variant as default }`
// as a namespace rather than a default export. Cast to the real shape.
const variant = variantModule as unknown as QuickJSAsyncVariant;
import {
  type ExecuteResult,
  type Executor,
  normalizeProviders,
  type Providers,
} from "../executor.ts";

const HOST_PREFIX = "host://tool/";

// QuickJS sandbox can't receive real `Response` objects — internal slots can't
// cross the WASM boundary. The package expects a plain mapped object.
function mappedResponse(body: string, status = 200) {
  return {
    status,
    ok: status >= 200 && status < 300,
    statusText: "",
    text: async () => body,
    json: async () => JSON.parse(body),
    headers: {
      [HEADERS_MARKER]: true,
      _headers: { "content-type": "application/json" },
    },
    type: "default" as const,
    url: "",
    bodyUsed: false,
    redirected: false,
    body: undefined,
  };
}

let runSandboxedSingleton: Awaited<ReturnType<typeof loadAsyncQuickJs>>["runSandboxed"] | undefined;

async function getRunSandboxed() {
  if (!runSandboxedSingleton) {
    const loaded = await loadAsyncQuickJs(variant);
    runSandboxedSingleton = loaded.runSandboxed;
  }
  return runSandboxedSingleton;
}

export class QuickJSExecutor implements Executor {
  readonly name = "quickjs";

  async execute(code: string, providers: Providers): Promise<ExecuteResult> {
    const resolved = normalizeProviders(providers);
    // Flatten to "ns/toolName" -> fn for the bridge URL lookup.
    const flat: Record<string, (args: unknown) => Promise<unknown>> = {};
    for (const p of resolved) {
      for (const [toolName, fn] of Object.entries(p.fns)) {
        flat[`${p.name}/${toolName}`] = fn as (a: unknown) => Promise<unknown>;
      }
    }

    const fetchAdapter = (async (input: string | URL | Request, init?: RequestInit) => {
      try {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (!url.startsWith(HOST_PREFIX)) {
          return mappedResponse("blocked", 403);
        }
        const key = url.slice(HOST_PREFIX.length);
        const fn = flat[key];
        if (!fn) return mappedResponse(`unknown tool: ${key}`, 404);

        const bodyText = typeof init?.body === "string" ? init.body : "";
        const args = bodyText ? JSON.parse(bodyText) : undefined;

        const result = await fn(args);
        return mappedResponse(JSON.stringify({ ok: true, result }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return mappedResponse(JSON.stringify({ ok: false, error: msg }), 500);
      }
    }) as unknown as typeof fetch;

    const codemodeShim = resolved
      .map(
        (p) =>
          `globalThis.${p.name} = {${Object.keys(p.fns)
            .map(
              (toolName) => `${JSON.stringify(toolName)}: async (args) => {
            const r = await fetch(${JSON.stringify(`${HOST_PREFIX}${p.name}/${toolName}`)}, {
              method: "POST",
              body: JSON.stringify(args ?? null),
            });
            const env = await r.json();
            if (!env.ok) throw new Error(env.error);
            return env.result;
          }`,
            )
            .join(",")}};`,
      )
      .join("\n");

    const wrapped = `${codemodeShim}\nexport default await (${code})();`;

    const logs: string[] = [];
    const capture = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    const sandboxConsole = { log: capture, error: capture, warn: capture, info: capture };

    try {
      const runSandboxed = await getRunSandboxed();
      const evalResult = await runSandboxed(async ({ evalCode }) => evalCode(wrapped), {
        allowFetch: true,
        fetchAdapter,
        console: sandboxConsole,
      });

      if (evalResult.ok) {
        return { result: evalResult.data, logs };
      }
      return {
        result: undefined,
        error: `${evalResult.error.name}: ${evalResult.error.message}`,
        logs,
      };
    } catch (err) {
      return {
        result: undefined,
        error: err instanceof Error ? err.message : String(err),
        logs,
      };
    }
  }
}
