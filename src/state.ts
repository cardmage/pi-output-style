import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { findOutputStyle, resolveAgentDir } from "./loader.ts";
import type {
	OutputStyle,
	OutputStyleEntryData,
	ResolvedOutputStyle,
	StyleResolutionOrigin,
} from "./types.ts";

export const OUTPUT_STYLE_ENTRY_TYPE = "output-style";

export interface SessionEntryLike {
	type: string;
	customType?: string;
	data?: unknown;
}

export interface ResolveActiveStyleOptions {
	styles: Map<string, OutputStyle>;
	cwd: string;
	branchEntries?: readonly SessionEntryLike[];
	flagStyle?: string;
	isProjectTrusted?: boolean;
	homeDir?: string;
	agentDir?: string;
}

export interface SaveStyleConfigOptions {
	cwd: string;
	homeDir?: string;
	agentDir?: string;
}

function readJsonOutputStyle(filePath: string): string | undefined {
	if (!fs.existsSync(filePath)) return undefined;
	try {
		const raw = fs.readFileSync(filePath, "utf-8");
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		const value = parsed?.outputStyle ?? parsed?.styleId ?? parsed?.style;
		if (typeof value === "string" && value.trim().length > 0) {
			return value.trim();
		}
	} catch {
		// Ignore malformed JSON files
	}
	return undefined;
}

export function getBranchOutputStyleId(
	branchEntries: readonly SessionEntryLike[] = [],
): string | undefined {
	for (let i = branchEntries.length - 1; i >= 0; i--) {
		const entry = branchEntries[i];
		if (entry.type === "custom" && entry.customType === OUTPUT_STYLE_ENTRY_TYPE) {
			const data = entry.data as Partial<OutputStyleEntryData> | undefined;
			if (data && typeof data.styleId === "string" && data.styleId.trim().length > 0) {
				return data.styleId.trim();
			}
		}
	}
	return undefined;
}

export function resolveActiveOutputStyle(
	options: ResolveActiveStyleOptions,
): ResolvedOutputStyle {
	const homeDir = options.homeDir ?? os.homedir();
	const agentDir = resolveAgentDir(homeDir, options.agentDir);
	const isProjectTrusted = options.isProjectTrusted ?? true;
	const defaultStyle = options.styles.get("default")!;

	const candidates: Array<{ query: string | undefined; origin: StyleResolutionOrigin }> = [
		{
			query: options.flagStyle?.trim() || undefined,
			origin: "flag",
		},
		{
			query: getBranchOutputStyleId(options.branchEntries),
			origin: "session",
		},
	];

	if (isProjectTrusted) {
		candidates.push(
			{
				query: readJsonOutputStyle(path.join(options.cwd, ".pi", "output-style.json")),
				origin: "project-pi",
			},
			{
				query:
					readJsonOutputStyle(path.join(options.cwd, ".claude", "settings.local.json")) ??
					readJsonOutputStyle(path.join(options.cwd, ".claude", "settings.json")),
				origin: "project-claude",
			},
		);
	}

	candidates.push(
		{
			query: readJsonOutputStyle(path.join(agentDir, "output-style.json")),
			origin: "global-pi",
		},
		{
			query: readJsonOutputStyle(path.join(homeDir, ".claude", "settings.json")),
			origin: "global-claude",
		},
	);

	for (const candidate of candidates) {
		if (!candidate.query) continue;

		const matched = findOutputStyle(options.styles, candidate.query);
		if (matched) {
			return {
				style: matched,
				origin: candidate.origin,
			};
		}

		// The highest-priority configured style does not exist; fall back to default with warning
		return {
			style: defaultStyle,
			origin: "default",
			missingStyleId: candidate.query,
		};
	}

	return {
		style: defaultStyle,
		origin: "default",
	};
}

export function saveOutputStyleConfig(
	scope: "project" | "global",
	styleId: string,
	options: SaveStyleConfigOptions,
): string {
	const homeDir = options.homeDir ?? os.homedir();
	const agentDir = resolveAgentDir(homeDir, options.agentDir);

	const targetFile =
		scope === "project"
			? path.join(options.cwd, ".pi", "output-style.json")
			: path.join(agentDir, "output-style.json");

	fs.mkdirSync(path.dirname(targetFile), { recursive: true });
	fs.writeFileSync(
		targetFile,
		`${JSON.stringify({ outputStyle: styleId }, null, 2)}\n`,
		"utf-8",
	);
	return targetFile;
}
