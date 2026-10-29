import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getBuiltinStylesMap } from "./builtin-styles.ts";
import type { OutputStyle, OutputStyleSource } from "./types.ts";

const FRONTMATTER_REGEX = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const EMPTY_FRONTMATTER_REGEX = /^\uFEFF?---\r?\n---(?:\r?\n|$)/;

export interface ParseOutputStyleOptions {
	fallbackId: string;
	fallbackName?: string;
	source: OutputStyleSource;
	filePath?: string;
	defaultKeepCodingInstructions?: boolean;
}

export interface LoadOutputStylesOptions {
	cwd: string;
	/** Whether project-local `.pi/` and `.claude/` styles are trusted to load. Default: true. */
	isProjectTrusted?: boolean;
	/** Override user home directory (for testing). Default: os.homedir(). */
	homeDir?: string;
	/** Override Pi agent config directory (for testing). Default: $PI_CODING_AGENT_DIR or ~/.pi/agent. */
	agentDir?: string;
}

export function normalizeStyleId(raw: string): string {
	return raw
		.trim()
		.toLowerCase()
		.replace(/\s+/g, "-");
}

function unquoteYamlValue(raw: string): string {
	const trimmed = raw.trim();
	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'"))
	) {
		return trimmed.slice(1, -1).trim();
	}
	// Strip trailing unquoted YAML comment (e.g. `true # comment`)
	const commentIndex = trimmed.indexOf(" #");
	if (commentIndex !== -1) {
		return trimmed.slice(0, commentIndex).trim();
	}
	return trimmed;
}

function parseYamlBoolean(raw: string | undefined, defaultValue: boolean): boolean {
	if (raw === undefined) return defaultValue;
	const normalized = unquoteYamlValue(raw).toLowerCase();
	if (normalized === "true" || normalized === "yes" || normalized === "1") return true;
	if (normalized === "false" || normalized === "no" || normalized === "0") return false;
	return defaultValue;
}

export function parseFrontmatter(content: string): {
	attributes: Record<string, string>;
	body: string;
	hasFrontmatter: boolean;
} {
	const cleanContent = content.replace(/^\uFEFF/, "");

	const emptyMatch = cleanContent.match(EMPTY_FRONTMATTER_REGEX);
	if (emptyMatch) {
		return {
			attributes: {},
			body: cleanContent.slice(emptyMatch[0].length).trim(),
			hasFrontmatter: true,
		};
	}

	const match = cleanContent.match(FRONTMATTER_REGEX);
	if (!match) {
		return {
			attributes: {},
			body: cleanContent.trim(),
			hasFrontmatter: false,
		};
	}

	const yamlBlock = match[1];
	const body = cleanContent.slice(match[0].length).trim();
	const attributes: Record<string, string> = {};

	for (const line of yamlBlock.split(/\r?\n/)) {
		const trimmedLine = line.trim();
		if (!trimmedLine || trimmedLine.startsWith("#")) continue;

		const colonIndex = trimmedLine.indexOf(":");
		if (colonIndex === -1) continue;

		const key = trimmedLine.slice(0, colonIndex).trim();
		const value = unquoteYamlValue(trimmedLine.slice(colonIndex + 1));
		if (key) {
			attributes[key] = value;
		}
	}

	return {
		attributes,
		body,
		hasFrontmatter: true,
	};
}

export function parseOutputStyleMarkdown(
	rawContent: string,
	options: ParseOutputStyleOptions,
): OutputStyle {
	const { attributes, body } = parseFrontmatter(rawContent);
	const defaultKeep = options.defaultKeepCodingInstructions ?? false;

	const rawName = attributes.name || options.fallbackName || options.fallbackId;
	const description = attributes.description || "";
	const keepCodingRaw =
		attributes["keep-coding-instructions"] ?? attributes.keepCodingInstructions;
	const keepCodingInstructions = parseYamlBoolean(keepCodingRaw, defaultKeep);

	return {
		id: normalizeStyleId(options.fallbackId),
		name: rawName,
		description,
		keepCodingInstructions,
		prompt: body,
		source: options.source,
		...(options.filePath ? { filePath: options.filePath } : {}),
	};
}

function loadStylesFromDirectory(
	dirPath: string,
	source: OutputStyleSource,
	targetMap: Map<string, OutputStyle>,
): void {
	if (!fs.existsSync(dirPath)) return;

	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dirPath, { withFileTypes: true });
	} catch {
		return;
	}

	const mdFiles = entries
		.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"))
		.map((entry) => entry.name)
		.sort((a, b) => a.localeCompare(b));

	for (const fileName of mdFiles) {
		const fullPath = path.join(dirPath, fileName);
		const baseName = fileName.slice(0, -3); // strip .md
		const id = normalizeStyleId(baseName);
		if (!id) continue;

		try {
			const content = fs.readFileSync(fullPath, "utf-8");
			const style = parseOutputStyleMarkdown(content, {
				fallbackId: id,
				fallbackName: baseName,
				source,
				filePath: fullPath,
				defaultKeepCodingInstructions: false,
			});
			targetMap.set(style.id, style);
		} catch {
			// Skip unreadable markdown files without breaking startup
		}
	}
}

export function resolveAgentDir(homeDir = os.homedir(), explicitAgentDir?: string): string {
	if (explicitAgentDir) return explicitAgentDir;
	if (process.env.PI_CODING_AGENT_DIR) return process.env.PI_CODING_AGENT_DIR;
	return path.join(homeDir, ".pi", "agent");
}

export function loadOutputStyles(options: LoadOutputStylesOptions): Map<string, OutputStyle> {
	const homeDir = options.homeDir ?? os.homedir();
	const agentDir = resolveAgentDir(homeDir, options.agentDir);
	const isProjectTrusted = options.isProjectTrusted ?? true;

	const styles = getBuiltinStylesMap();

	// 1. User-level Claude Code styles (~/.claude/output-styles/*.md)
	loadStylesFromDirectory(
		path.join(homeDir, ".claude", "output-styles"),
		"user-claude",
		styles,
	);

	// 2. User-level Pi styles (~/.pi/agent/output-styles/*.md)
	loadStylesFromDirectory(
		path.join(agentDir, "output-styles"),
		"user-pi",
		styles,
	);

	// 3 & 4. Project-level styles (only when project is trusted)
	if (isProjectTrusted) {
		loadStylesFromDirectory(
			path.join(options.cwd, ".claude", "output-styles"),
			"project-claude",
			styles,
		);
		loadStylesFromDirectory(
			path.join(options.cwd, ".pi", "output-styles"),
			"project-pi",
			styles,
		);
	}

	return styles;
}

export function findOutputStyle(
	styles: Map<string, OutputStyle> | Iterable<OutputStyle>,
	query: string,
): OutputStyle | undefined {
	const trimmed = query.trim();
	if (!trimmed) return undefined;

	const styleList = styles instanceof Map ? [...styles.values()] : [...styles];
	const lowerQuery = trimmed.toLowerCase();
	const normalizedQuery = normalizeStyleId(trimmed);

	// 1. Exact ID match
	for (const style of styleList) {
		if (style.id === lowerQuery || style.id === normalizedQuery) {
			return style;
		}
	}

	// 2. Case-insensitive display name match
	for (const style of styleList) {
		if (style.name.trim().toLowerCase() === lowerQuery) {
			return style;
		}
		if (normalizeStyleId(style.name) === normalizedQuery) {
			return style;
		}
	}

	return undefined;
}
