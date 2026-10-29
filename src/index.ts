import type {
	AutocompleteItem,
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { createNewOutputStyleInteractive } from "./generator.ts";
import { findOutputStyle, loadOutputStyles } from "./loader.ts";
import { applyOutputStyleToPromptOptions } from "./prompt.ts";
import {
	OUTPUT_STYLE_ENTRY_TYPE,
	resolveActiveOutputStyle,
	saveOutputStyleConfig,
} from "./state.ts";
import type { OutputStyle, OutputStyleScope } from "./types.ts";

export { BUILTIN_STYLES, EXPLANATORY_PROMPT, LEARNING_PROMPT } from "./builtin-styles.ts";
export {
	buildStarterTemplate,
	formatOutputStyleMarkdown,
	parseGeneratedStyleOutput,
	sanitizeStyleSlug,
} from "./generator.ts";
export {
	findOutputStyle,
	loadOutputStyles,
	normalizeStyleId,
	parseFrontmatter,
	parseOutputStyleMarkdown,
} from "./loader.ts";
export { applyOutputStyleToPromptOptions } from "./prompt.ts";
export {
	getBranchOutputStyleId,
	OUTPUT_STYLE_ENTRY_TYPE,
	resolveActiveOutputStyle,
	saveOutputStyleConfig,
} from "./state.ts";
export type * from "./types.ts";

function parseStyleCommandArgs(rawArgs: string): {
	styleQuery: string;
	scope: OutputStyleScope;
	hasExplicitScope: boolean;
} {
	const tokens = rawArgs.trim().split(/\s+/).filter(Boolean);
	let scope: OutputStyleScope = "session";
	let hasExplicitScope = false;
	const queryTokens: string[] = [];

	for (const token of tokens) {
		if (token === "--project" || token === "-p") {
			scope = "project";
			hasExplicitScope = true;
		} else if (token === "--global" || token === "-g") {
			scope = "global";
			hasExplicitScope = true;
		} else if (token === "--session" || token === "-s") {
			scope = "session";
			hasExplicitScope = true;
		} else {
			queryTokens.push(token);
		}
	}

	return {
		styleQuery: queryTokens.join(" ").trim(),
		scope,
		hasExplicitScope,
	};
}

export default function outputStyleExtension(pi: ExtensionAPI): void {
	let activeStyleId = "default";
	let cachedStyles = loadOutputStyles({ cwd: process.cwd(), isProjectTrusted: false });

	pi.registerFlag("output-style", {
		type: "string",
		description:
			"Set active output style (e.g., default, explanatory, learning, or custom style name)",
	});

	const refreshStyles = (ctx: ExtensionContext): Map<string, OutputStyle> => {
		cachedStyles = loadOutputStyles({
			cwd: ctx.cwd,
			isProjectTrusted: ctx.isProjectTrusted(),
		});
		return cachedStyles;
	};

	const updateStatusBar = (ctx: ExtensionContext, style: OutputStyle): void => {
		if (style.id === "default") {
			ctx.ui.setStatus("output-style", undefined);
		} else {
			ctx.ui.setStatus("output-style", `Style: ${style.name}`);
		}
	};

	const syncStateFromContext = (ctx: ExtensionContext, notifyOnMissing = false): OutputStyle => {
		const styles = refreshStyles(ctx);
		const flagValue = pi.getFlag("output-style");
		const flagStyle = typeof flagValue === "string" ? flagValue : undefined;

		const resolved = resolveActiveOutputStyle({
			styles,
			cwd: ctx.cwd,
			branchEntries: ctx.sessionManager.getBranch(),
			flagStyle,
			isProjectTrusted: ctx.isProjectTrusted(),
		});

		activeStyleId = resolved.style.id;
		updateStatusBar(ctx, resolved.style);

		if (notifyOnMissing && resolved.missingStyleId && ctx.hasUI) {
			ctx.ui.notify(
				`Output style "${resolved.missingStyleId}" was not found. Reverted to Default.`,
				"warning",
			);
		}

		return resolved.style;
	};

	const activateStyle = (
		style: OutputStyle,
		scope: OutputStyleScope,
		ctx: ExtensionContext,
	): void => {
		activeStyleId = style.id;
		pi.appendEntry(OUTPUT_STYLE_ENTRY_TYPE, { styleId: style.id });
		updateStatusBar(ctx, style);

		if (scope === "project") {
			if (!ctx.isProjectTrusted()) {
				if (ctx.hasUI) {
					ctx.ui.notify(
						`Project is not trusted; applied "${style.name}" to current session only.`,
						"warning",
					);
				}
				return;
			}
			const savedPath = saveOutputStyleConfig("project", style.id, { cwd: ctx.cwd });
			if (ctx.hasUI) {
				ctx.ui.notify(
					`Output style set to "${style.name}" and saved to ${savedPath}`,
					"info",
				);
			}
			return;
		}

		if (scope === "global") {
			const savedPath = saveOutputStyleConfig("global", style.id, { cwd: ctx.cwd });
			if (ctx.hasUI) {
				ctx.ui.notify(
					`Output style set to "${style.name}" and saved to ${savedPath}`,
					"info",
				);
			}
			return;
		}

		if (ctx.hasUI) {
			ctx.ui.notify(`Output style set to "${style.name}" (current session)`, "info");
		}
	};

	const handleNewStyleCommand = async (
		descriptionArgs: string,
		ctx: ExtensionCommandContext,
	): Promise<void> => {
		const created = await createNewOutputStyleInteractive(descriptionArgs, ctx);
		if (!created) return;

		refreshStyles(ctx);
		activateStyle(created.style, created.scope, ctx);
	};

	pi.on("session_start", async (_event, ctx) => {
		syncStateFromContext(ctx, true);
	});

	pi.on("session_tree", async (_event, ctx) => {
		syncStateFromContext(ctx, false);
	});

	pi.on("before_agent_start", async (event, ctx) => {
		const styles = refreshStyles(ctx);
		const style = findOutputStyle(styles, activeStyleId) ?? styles.get("default")!;
		updateStatusBar(ctx, style);
		applyOutputStyleToPromptOptions(
			event.systemPromptOptions,
			style,
			pi.getActiveTools(),
		);
	});

	pi.registerCommand("output-style:new", {
		description: "Create a new custom Output Style (.md) with AI assistance",
		handler: async (args, ctx) => {
			await handleNewStyleCommand(args, ctx);
		},
	});

	pi.registerCommand("output-style", {
		description: "Switch or manage Claude Code-compatible Output Styles",
		getArgumentCompletions: (argumentPrefix: string): AutocompleteItem[] | null => {
			const prefix = argumentPrefix.trimStart().toLowerCase();
			const items: AutocompleteItem[] = [];

			for (const style of cachedStyles.values()) {
				const isActive = style.id === activeStyleId;
				items.push({
					value: style.id,
					label: `${isActive ? "● " : ""}${style.id}`,
					description: `${style.name} — ${style.description || style.source}`,
				});
			}

			items.push(
				{
					value: "new",
					label: "new",
					description: "Create a new custom output style (.md)",
				},
				{
					value: "--project",
					label: "--project",
					description: "Save selected style as project default (.pi/output-style.json)",
				},
				{
					value: "--global",
					label: "--global",
					description: "Save selected style as global default (~/.pi/agent/output-style.json)",
				},
			);

			const filtered = prefix
				? items.filter(
						(item) =>
							item.value.toLowerCase().startsWith(prefix) ||
							(item.description?.toLowerCase().includes(prefix) ?? false),
					)
				: items;

			return filtered.length > 0 ? filtered : null;
		},
		handler: async (args, ctx) => {
			const styles = refreshStyles(ctx);
			const trimmedArgs = args.trim();

			// Subcommand: `/output-style new [description]`
			if (
				(trimmedArgs === "new" && !styles.has("new")) ||
				trimmedArgs.toLowerCase().startsWith("new ")
			) {
				const rest = trimmedArgs.slice(3).trim();
				await handleNewStyleCommand(rest, ctx);
				return;
			}

			// Direct invocation: `/output-style <name> [--project|--global|--session]`
			if (trimmedArgs.length > 0) {
				const { styleQuery, scope } = parseStyleCommandArgs(trimmedArgs);
				if (!styleQuery) {
					ctx.ui.notify("Usage: /output-style <style-name> [--project|--global|--session]", "warning");
					return;
				}

				const matched = findOutputStyle(styles, styleQuery);
				if (!matched) {
					const available = [...styles.keys()].join(", ");
					ctx.ui.notify(
						`Unknown output style "${styleQuery}". Available styles: ${available}`,
						"error",
					);
					return;
				}

				activateStyle(matched, scope, ctx);
				return;
			}

			// Interactive menu: `/output-style`
			if (!ctx.hasUI) {
				return;
			}

			const styleList = [...styles.values()];
			const createNewLabel = "✨ Create new output style... (/output-style:new)";
			const labelToStyle = new Map<string, OutputStyle>();

			const options = styleList.map((style) => {
				const marker = style.id === activeStyleId ? "●" : "○";
				const desc = style.description ? ` — ${style.description}` : "";
				const keepBadge = style.keepCodingInstructions ? "" : " [non-coding]";
				const label = `${marker} ${style.name} (${style.id})${desc} [${style.source}]${keepBadge}`;
				labelToStyle.set(label, style);
				return label;
			});
			options.push(createNewLabel);

			const selectedOption = await ctx.ui.select("Select Output Style", options);
			if (!selectedOption) return;

			if (selectedOption === createNewLabel) {
				await handleNewStyleCommand("", ctx);
				return;
			}

			const chosenStyle = labelToStyle.get(selectedOption);
			if (!chosenStyle) return;

			const sessionScopeLabel = "Session only (current branch)";
			const projectScopeLabel = "Project default (.pi/output-style.json)";
			const globalScopeLabel = "Global default (~/.pi/agent/output-style.json)";

			const scopeChoices = ctx.isProjectTrusted()
				? [sessionScopeLabel, projectScopeLabel, globalScopeLabel]
				: [sessionScopeLabel, globalScopeLabel];

			const selectedScopeLabel = await ctx.ui.select(
				`Apply "${chosenStyle.name}" to:`,
				scopeChoices,
			);
			if (!selectedScopeLabel) return;

			const scope: OutputStyleScope =
				selectedScopeLabel === projectScopeLabel
					? "project"
					: selectedScopeLabel === globalScopeLabel
						? "global"
						: "session";

			activateStyle(chosenStyle, scope, ctx);
		},
	});
}
