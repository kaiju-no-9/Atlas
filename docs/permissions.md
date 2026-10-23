# Browser permissions

The extension requests permissions only for features present in the build. Optional permissions are requested only when a user starts a workflow that needs them.

| Permission | Purpose | If unavailable |
|---|---|---|
| `activeTab` | Temporarily grant access to the user-invoked tab so `chrome.scripting.executeScript` can inject the isolated observer/actuator on demand | The current page cannot be observed or controlled. |
| `sidePanel` | Host conversation, task timeline, and approval UI | The primary interface cannot open. |
| `storage` | Keep local settings and task history | Data is unavailable across worker restarts. |
| `tabs` | Read tab metadata and manage bounded task tabs | Operate only in the currently granted tab. |
| `scripting` | Inject the isolated observer/actuator | Browser interaction is unavailable. |
| `alarms` | Schedule bounded recovery work | Interrupted work waits for a later user or browser event. |
| `offscreen` (optional) | Process screenshots locally | Disable visual perception and use DOM observation only. |

The local companion's loopback HTTP connection is an optional integration and does not justify broad website host access. Direct BYOK provider requests originate from the extension and do not pass through the companion.

Atlas injects its isolated page code only after an explicit user invocation. It does not register a persistent `<all_urls>` content script or request broad host permissions; this keeps observation and control within Chrome's `activeTab` grant.
