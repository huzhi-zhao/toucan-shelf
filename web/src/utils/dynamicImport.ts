// Reloads the page once when a dynamic import fails because its chunk no longer exists on the
// server (e.g. the app was redeployed after the tab was opened). Without this, the failure
// surfaces as a permanent "Failed to fetch dynamically imported module" error until the user
// manually refreshes.
export async function withChunkReload<T>(factory: () => Promise<T>): Promise<T> {
  try {
    return await factory();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isChunkError =
      message.includes("Failed to fetch dynamically imported module") || message.includes("Importing a module script failed");
    const reloadKey = "chunk-reload";
    if (isChunkError && !sessionStorage.getItem(reloadKey)) {
      sessionStorage.setItem(reloadKey, "1");
      window.location.reload();
    }
    throw error;
  }
}
