// Stands in for the site's zustand store inside the site modules the CLI
// compiles in. Only fileTypes.ts reaches for it (local-library cover art, which
// the CLI never touches), so an empty state is enough.
export const useStore = {
  getState: () => ({ libraryArt: {} as Record<string, string> }),
}
