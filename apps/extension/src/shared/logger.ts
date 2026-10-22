const SECRET_PATTERNS = [
  /(?:sk-[A-Za-z0-9_-]{12,})/g,
  /(?:Bearer\s+)[A-Za-z0-9._~+/=-]+/gi,
  /(?:api[_-]?key\s*[=:]\s*)[^\s,]+/gi,
];

function redact(value: unknown): unknown {
  if (typeof value === "string") {
    return SECRET_PATTERNS.reduce((text, pattern) => text.replace(pattern, "[REDACTED]"), value);
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      /key|token|authorization/i.test(key) ? "[REDACTED]" : redact(item),
    ]));
  }
  return value;
}

export const logger = {
  info(message: string, data?: unknown) {
    console.info(`[Atlas] ${message}`, redact(data ?? {}));
  },
  error(message: string, data?: unknown) {
    console.error(`[Atlas] ${message}`, redact(data ?? {}));
  },
};
