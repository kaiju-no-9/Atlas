# Atlas threat model

## Assets and trust boundaries

- Provider credentials and task content belong to the user and must remain in trusted extension contexts or the provider connection.
- Webpage DOM, accessible names, text, and screenshots are untrusted input.
- The Go companion is an optional local service; it is not part of direct BYOK inference.

## Threats and controls

| Threat | Control |
|---|---|
| Malicious page attempts to obtain provider credentials | Content scripts hold no provider keys; storage access is restricted to trusted extension contexts; model requests originate from the background worker. |
| Prompt injection asks the agent to override its task | Page material is framed as untrusted evidence; a local policy gate validates every proposed tool call. |
| Model proposes an ungrounded or stale action | Tools require identifiers from a current observation and revalidate the target before execution. |
| Consequential action is triggered without consent | The policy engine blocks gated actions until a single-use approval is validated against the current target/state. |
| Local companion exposed beyond the workstation | It binds only to `127.0.0.1`, requires a high-entropy bearer token on API routes, bounds request sizes, and uses timeouts. |
| Local search credential leaks to extension or logs | The credential is loaded only from the companion's process environment; provider failures return generic client errors and never include response bodies. |
| Resource exhaustion through oversized inputs | Search request body and query/result limits are bounded; HTTP server timeouts are configured. |

## Residual risks

Loopback binding and bearer authentication reduce exposure but do not defend a compromised local account or a malicious process that can read the user's environment. The companion has no persistence or model proxy in this increment. Future endpoints must preserve the same local-only and least-privilege boundary.
