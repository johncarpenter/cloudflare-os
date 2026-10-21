// The slice of the Cloudflare Workers REST API the Terraform deployment's uploader needs: read a
// script's Durable Object migration tag, upload a script, delete one. Takes `fetch` so tests can
// stand in for the network.
//
// Error messages carry only what Cloudflare reported (status, error codes and messages). They never
// include the request, because a script upload's metadata holds secret_text bindings.

const API_BASE = "https://api.cloudflare.com/client/v4";

/** The Workers API operations used by the uploader. */
export interface WorkersApi {
  /** The script's current migration tag, or undefined when it does not exist or has none. */
  getMigrationTag(accountId: string, scriptName: string): Promise<string | undefined>;
  /** Uploads (creates or replaces) a script from a multipart form. */
  putScript(accountId: string, scriptName: string, form: FormData): Promise<void>;
  /** Deletes a script. A script that is already gone counts as deleted. */
  deleteScript(accountId: string, scriptName: string): Promise<void>;
}

/** A failure reported by the Cloudflare API. */
export class WorkersApiError extends Error {
  readonly status: number;

  constructor(operation: string, status: number, detail: string) {
    super(`${operation} failed (HTTP ${status})${detail ? `: ${detail}` : ""}`);
    this.name = "WorkersApiError";
    this.status = status;
  }
}

interface Envelope {
  success?: boolean;
  errors?: { code?: number; message?: string }[];
  result?: unknown;
}

async function readEnvelope(response: Response): Promise<Envelope> {
  try {
    return await response.json() as Envelope;
  } catch {
    return {};
  }
}

function describeErrors(envelope: Envelope): string {
  return (envelope.errors ?? [])
      .map((error) => `${error.code ?? "?"} ${error.message ?? ""}`.trim())
      .join("; ");
}

/** Creates the Workers API client for `token`. */
export function createWorkersApi(
    token: string, fetchImpl: typeof fetch = fetch, base = API_BASE): WorkersApi {
  const headers = { Authorization: `Bearer ${token}` };

  async function call(operation: string, url: string, init: RequestInit, okStatuses: number[] = [])
      : Promise<{ response: Response; envelope: Envelope }> {
    const response = await fetchImpl(url, { ...init, headers: { ...headers, ...init.headers } });
    const envelope = await readEnvelope(response);
    if (!response.ok && !okStatuses.includes(response.status)) {
      throw new WorkersApiError(operation, response.status, describeErrors(envelope));
    }
    if (response.ok && envelope.success === false) {
      throw new WorkersApiError(operation, response.status, describeErrors(envelope));
    }
    return { response, envelope };
  }

  return {
    async getMigrationTag(accountId, scriptName) {
      const { response, envelope } = await call(
          `read ${scriptName}`,
          `${base}/accounts/${accountId}/workers/services/${scriptName}`,
          { method: "GET" }, [404]);
      if (response.status === 404) return undefined;
      const result = envelope.result as
          { default_environment?: { script?: { migration_tag?: string } } } | undefined;
      return result?.default_environment?.script?.migration_tag || undefined;
    },

    async putScript(accountId, scriptName, form) {
      await call(
          `upload ${scriptName}`,
          `${base}/accounts/${accountId}/workers/scripts/${scriptName}`,
          { method: "PUT", body: form });
    },

    async deleteScript(accountId, scriptName) {
      await call(
          `delete ${scriptName}`,
          `${base}/accounts/${accountId}/workers/scripts/${scriptName}`,
          { method: "DELETE" }, [404]);
    },
  };
}
