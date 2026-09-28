/** Temporary Apollo incident diagnostics. Remove after the upstream failure is identified.
 * Never log credentials, headers, request filters, response bodies or prospect data.
 */
export type ApolloDiagnostic = {
  endpoint: string;
  upstreamStatus: number | null;
  errorCategory: string | null;
  errorCode: string | null;
  durationMs: number;
  timeout: boolean;
  responseParse: "not_attempted" | "success" | "failure";
  fetchException: { class: string; message: string } | null;
};
const endpoints = new Set([
  "mixed_companies/search",
  "mixed_people/api_search",
  "organizations/enrich",
  "organizations/bulk_enrich",
  "people/match",
  "people/bulk_match",
  "usage_stats/credit_usage_stats",
  "usage_stats/api_usage_stats",
]);
export function diagnosticEndpoint(path: string) {
  return endpoints.has(path)
    ? path
    : path.startsWith("webhook_result/")
      ? "webhook_result/:request_id"
      : "other";
}
// Only canonical runtime messages are retained. Arbitrary exception text can
// contain a key, URL, response body or customer data, so it is never copied.
export function diagnosticException(
  error: unknown,
): ApolloDiagnostic["fetchException"] {
  const e = error instanceof Error ? error : null;
  const name =
    e &&
    [
      "Error",
      "TypeError",
      "SyntaxError",
      "AbortError",
      "TimeoutError",
      "RangeError",
    ].includes(e.name)
      ? e.name
      : "Error";
  const message = e?.message || "";
  const patterns: [RegExp, string][] = [
    [/illegal invocation/i, "Illegal invocation: incorrect receiver"],
    [
      /invalid.*header|header.*invalid|not a valid.*header/i,
      "Invalid HTTP header value",
    ],
    [/\bredirect/i, "Fetch redirect rejected"],
    [/\bdns\b|ENOTFOUND|EAI_AGAIN/i, "DNS resolution failure"],
    [/\btls\b|\bssl\b|certificate/i, "TLS or certificate failure"],
    [/connection.*reset|ECONNRESET/i, "Connection reset"],
    [/connection.*refused|ECONNREFUSED/i, "Connection refused"],
    [/abort/i, "Request aborted"],
    [/timed?\s*out|timeout/i, "Request timed out"],
    [/fetch failed|failed to fetch|network error/i, "Fetch network failure"],
    [/cache.*mode|cache.*not.*support/i, "Unsupported fetch cache mode"],
  ];
  return {
    class: name,
    message:
      name === "SyntaxError"
        ? "Invalid JSON response"
        : patterns.find(([pattern]) => pattern.test(message))?.[1] ||
          "Unclassified exception; raw message withheld",
  };
}
export function diagnosticErrorCode(value: unknown) {
  // Unknown upstream codes are deliberately omitted rather than trusting a
  // free-text provider field (which might echo input or credentials).
  const codes = new Set([
    "invalid_api_key",
    "invalid_credentials",
    "unauthorized",
    "forbidden",
    "rate_limit_exceeded",
    "rate_limit_error",
    "insufficient_credits",
    "credits_exhausted",
    "invalid_request",
    "invalid_request_error",
    "validation_error",
    "unprocessable_entity",
    "not_found",
    "result_pending",
    "internal_server_error",
    "service_unavailable",
  ]);
  return typeof value === "string" && codes.has(value.toLowerCase())
    ? value.toLowerCase()
    : null;
}
export function emitApolloDiagnostic(value: ApolloDiagnostic) {
  try {
    console.info("apollo_provider_diagnostic", value);
  } catch {
    /* Logging must not change the operation result. */
  }
}
