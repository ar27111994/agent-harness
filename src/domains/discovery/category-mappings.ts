/**
 * Maps workspace demand signals to official marketplace and registry category
 * taxonomies. Used by the category-sweep harvest phase to guarantee complete
 * coverage of each relevant ecosystem segment (#291).
 *
 * Keys are normalized demand-signal tokens (languages, frameworks, concerns).
 * Values are the official category strings accepted by each marketplace's API.
 */

// ─── VS Code Marketplace categories ─────────────────────────────────────────

/**
 * Maps demand signal tokens to VS Code Marketplace category names.
 * Category names must exactly match the values accepted by `filterType: 5`
 * in the Gallery API.
 *
 * Full category list (Marketplace API, 2024):
 * AI | Azure | Chat | Data Science | Debuggers | Extension Packs |
 * Formatters | Keymaps | Language Packs | Linters | Machine Learning |
 * Notebooks | Other | Programming Languages | SCM Providers | Snippets |
 * Testing | Themes | Visualization
 */
export const DEMAND_TO_VSCODE_CATEGORIES: Readonly<
  Record<string, readonly string[]>
> = {
  typescript: ["Programming Languages", "Linters", "Formatters"],
  javascript: ["Programming Languages", "Linters", "Formatters"],
  python: [
    "Programming Languages",
    "Linters",
    "Data Science",
    "Machine Learning",
  ],
  java: ["Programming Languages", "Debuggers"],
  rust: ["Programming Languages", "Debuggers"],
  go: ["Programming Languages"],
  csharp: ["Programming Languages", "Debuggers"],
  cpp: ["Programming Languages", "Debuggers"],
  php: ["Programming Languages", "Linters"],
  ruby: ["Programming Languages"],
  swift: ["Programming Languages"],
  kotlin: ["Programming Languages"],
  dart: ["Programming Languages"],
  security: ["Linters"],
  testing: ["Testing"],
  ai: ["AI", "Chat", "Machine Learning"],
  ml: ["Machine Learning", "Data Science"],
  data: ["Data Science", "Notebooks", "Visualization"],
  git: ["SCM Providers"],
  formatting: ["Formatters"],
  linting: ["Linters"],
  notebooks: ["Notebooks"],
  azure: ["Azure"],
  snippets: ["Snippets"],
  themes: ["Themes"],
  debugging: ["Debuggers"],
};

/**
 * VS Code Marketplace sort-by constants (as used in the Gallery API body).
 * @see https://learn.microsoft.com/en-us/azure/devops/extend/develop/extension-query
 */
export const VSCODE_SORT_BY = {
  /** Default / relevance */
  Relevance: 0,
  /** Last updated date */
  LastUpdatedDate: 1,
  /** Title alphabetical */
  Title: 2,
  /** Publisher name */
  PublisherName: 5,
  /** Install count (most installed first when sortOrder = Descending) */
  InstallCount: 4,
  /** Rating (highest rated first) */
  AverageRating: 6,
  /** Weekly download count */
  WeeklyDownloads: 12,
} as const;

/** Numeric sort-by value for the VS Code Marketplace Gallery API. */
export type VsCodeSortBy = (typeof VSCODE_SORT_BY)[keyof typeof VSCODE_SORT_BY];

/** Sort order constants for the VS Code Marketplace Gallery API. */
export const VSCODE_SORT_ORDER = {
  Default: 0,
  Ascending: 1,
  Descending: 2,
} as const;

/** Numeric sort-order value for the VS Code Marketplace Gallery API. */
export type VsCodeSortOrder =
  (typeof VSCODE_SORT_ORDER)[keyof typeof VSCODE_SORT_ORDER];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Resolves the set of VS Code Marketplace category names relevant to the
 * given demand signal tokens. Deduplicates the result.
 */
export function resolveVsCodeCategories(signals: readonly string[]): string[] {
  const categories = new Set<string>();
  for (const signal of signals) {
    const normalized = signal
      .toLowerCase()
      .replace(/^(npm|pypi|detector|framework):/u, "")
      .replace(/[-_.]/gu, "");
    const mapped = DEMAND_TO_VSCODE_CATEGORIES[normalized];
    if (mapped) {
      for (const cat of mapped) {
        categories.add(cat);
      }
    }
  }
  return [...categories];
}
