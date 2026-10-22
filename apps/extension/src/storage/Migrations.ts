export const CURRENT_STORAGE_VERSION = 1;

export async function migrateStorage(): Promise<void> {
  const { atlas_schema_version: version = 0 } = await chrome.storage.local.get("atlas_schema_version");
  if (typeof version !== "number" || version > CURRENT_STORAGE_VERSION) {
    throw new Error("Atlas storage is from a newer version and cannot be opened safely.");
  }
  if (version < CURRENT_STORAGE_VERSION) {
    await chrome.storage.local.set({ atlas_schema_version: CURRENT_STORAGE_VERSION });
  }
}
