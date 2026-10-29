export type OutputStyleSource =
	| "builtin"
	| "user-claude"
	| "user-pi"
	| "project-claude"
	| "project-pi";

export interface OutputStyle {
	/** Normalized lowercase identifier (e.g. "default", "explanatory", "learning", or filename slug). */
	id: string;
	/** Display name from YAML frontmatter `name` or filename. */
	name: string;
	/** Short description from YAML frontmatter `description`. */
	description: string;
	/**
	 * Whether to retain Pi's default software-engineering instructions (`preamble`, `tools`, `rules`, `docs`).
	 * Built-in styles default to `true`; custom styles default to `false` (matching Claude Code).
	 */
	keepCodingInstructions: boolean;
	/** Markdown body injected into the system prompt. */
	prompt: string;
	/** Origin of this style definition. */
	source: OutputStyleSource;
	/** Absolute file path for custom styles loaded from disk. */
	filePath?: string;
}

export type OutputStyleScope = "session" | "project" | "global";

export interface OutputStyleConfig {
	outputStyle: string;
}

export interface OutputStyleEntryData {
	styleId: string;
}

export type StyleResolutionOrigin =
	| "flag"
	| "session"
	| "project-pi"
	| "project-claude"
	| "global-pi"
	| "global-claude"
	| "default";

export interface ResolvedOutputStyle {
	style: OutputStyle;
	origin: StyleResolutionOrigin;
	/** Set when the configured/persisted style could not be found and fell back to "default". */
	missingStyleId?: string;
}
