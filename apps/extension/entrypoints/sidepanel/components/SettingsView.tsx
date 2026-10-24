import { useEffect, useState, type FormEvent } from "react";
import { z } from "zod";
import { sendMessage } from "../../../src/protocol/client";

const SettingsResponseSchema = z.object({
  provider: z.enum(["openrouter", "openai", "anthropic"]),
  model: z.string(),
  rememberKey: z.boolean(),
  hasApiKey: z.boolean(),
});
type SettingsResponse = z.infer<typeof SettingsResponseSchema>;

const defaults: SettingsResponse = { provider: "openrouter", model: "openai/gpt-4o-mini", rememberKey: false, hasApiKey: false };

export function SettingsView({ onBack }: { onBack: () => void }) {
  const [settings, setSettings] = useState(defaults);
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [connection, setConnection] = useState<{ status: "idle" | "testing" | "success" | "error"; text: string }>({ status: "idle", text: "" });

  useEffect(() => {
    let active = true;
    void sendMessage({ type: "GET_SETTINGS" }).then((raw) => {
      const parsed = SettingsResponseSchema.safeParse(raw);
      if (active && parsed.success) setSettings(parsed.data);
      if (active) setLoaded(true);
    }).catch(() => {
      if (active) {
        setNotice("Could not load saved settings.");
        setLoaded(true);
      }
    });
    return () => { active = false; };
  }, []);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const result = await sendMessage({
        type: "SAVE_SETTINGS",
        settings: { provider: settings.provider, model: settings.model, apiKey, rememberKey: settings.rememberKey, clearKey: false },
      });
      const parsed = SettingsResponseSchema.parse(result);
      setSettings(parsed);
      setApiKey("");
      setNotice("Settings saved on this device.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save settings.");
    } finally {
      setBusy(false);
    }
  };

  const clearKey = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const result = await sendMessage({
        type: "SAVE_SETTINGS",
        settings: { provider: settings.provider, model: settings.model, apiKey: "", rememberKey: false, clearKey: true },
      });
      setSettings(SettingsResponseSchema.parse(result));
      setApiKey("");
      setConnection({ status: "idle", text: "" });
      setNotice("Saved API key cleared.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not clear the key.");
    } finally {
      setBusy(false);
    }
  };

  const testConnection = async () => {
    setBusy(true);
    setConnection({ status: "testing", text: "Checking OpenRouter…" });
    try {
      const raw = await sendMessage({ type: "TEST_PROVIDER_CONNECTION", provider: settings.provider, model: settings.model, apiKey: apiKey.trim() });
      const result = z.object({ success: z.boolean(), latencyMs: z.number().nonnegative(), error: z.string().optional() }).parse(raw);
      if (!result.success) throw new Error(result.error ?? "OpenRouter connection failed.");
      setConnection({ status: "success", text: `OpenRouter connected in ${result.latencyMs} ms.` });
    } catch (error) {
      setConnection({ status: "error", text: error instanceof Error ? error.message : "OpenRouter connection failed." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex-1 overflow-y-auto px-5 py-5">
      <button className="text-sm font-medium text-accent hover:underline" onClick={onBack}>← Back to tasks</button>
      <h2 className="mt-5 text-lg font-semibold text-ink">Provider settings</h2>
      <p className="mt-1 text-sm leading-5 text-muted">Your API key is sent directly to the provider. Atlas does not route it through the local companion.</p>
      <form className="mt-6 space-y-5" onSubmit={save}>
        <div>
          <label className="field-label" htmlFor="provider">Provider</label>
          <select id="provider" className="field" value={settings.provider} onChange={(event) => setSettings({ ...settings, provider: event.target.value as SettingsResponse["provider"] })}>
            <option value="openrouter">OpenRouter</option>
            <option value="openai" disabled>OpenAI (coming later)</option>
            <option value="anthropic" disabled>Anthropic (coming later)</option>
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor="model">Model ID</label>
          <input id="model" className="field" value={settings.model} onChange={(event) => setSettings({ ...settings, model: event.target.value })} required maxLength={200} />
        </div>
        <div>
          <label className="field-label" htmlFor="api-key">API key</label>
          <div className="relative">
            <input
              id="api-key"
              className="field pr-16"
              type={showKey ? "text" : "password"}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value.slice(0, 500))}
              placeholder={settings.hasApiKey ? "Saved key is protected" : "Paste provider API key"}
              autoComplete="off"
              spellCheck={false}
              maxLength={500}
            />
            <button className="absolute inset-y-0 right-3 text-xs font-medium text-muted" type="button" onClick={() => setShowKey((value) => !value)} aria-pressed={showKey}>
              {showKey ? "Hide" : "Show"}
            </button>
          </div>
        </div>
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-white p-3">
          <input className="mt-1 accent-accent" type="checkbox" checked={settings.rememberKey} onChange={(event) => setSettings({ ...settings, rememberKey: event.target.checked })} />
          <span><span className="block text-sm font-medium text-ink">Remember key on this device</span><span className="mt-1 block text-xs leading-5 text-muted">When off, Atlas keeps the key only for this browser session.</span></span>
        </label>
        <div className="flex gap-2">
          <button className="button button-secondary" type="button" onClick={() => void testConnection()} disabled={busy || !loaded || (!settings.hasApiKey && !apiKey.trim())}>{connection.status === "testing" ? "Testing…" : "Test connection"}</button>
          <button className="button button-primary flex-1" type="submit" disabled={busy || !loaded}>{busy ? "Saving…" : "Save settings"}</button>
          <button className="button button-secondary" type="button" onClick={() => void clearKey()} disabled={busy || !loaded || !settings.hasApiKey}>Clear key</button>
        </div>
      </form>
      {connection.text && <p className={`mt-4 rounded-lg px-3 py-2 text-sm ${connection.status === "success" ? "bg-green-50 text-green-800" : connection.status === "error" ? "bg-red-50 text-red-800" : "bg-blue-50 text-blue-800"}`} role="status">{connection.text}</p>}
      {notice && <p className="mt-4 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800" role="status">{notice}</p>}
      <p className="mt-6 text-xs leading-5 text-muted">Keys stay in trusted extension storage and are never exposed to webpages or content scripts.</p>
    </section>
  );
}
