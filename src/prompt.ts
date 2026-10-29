import type { NormalizedBuildSystemPromptOptions } from "@earendil-works/pi-coding-agent";
import type { OutputStyle } from "./types.ts";

function buildToolUsageRules(
	declaredTools: string[],
	toolGuidelines: Record<string, string[]>,
	promptGuidelines: string[],
): string {
	const rules: string[] = [];
	const seen = new Set<string>();

	const addRule = (rule: string): void => {
		const normalized = rule.trim();
		if (!normalized || seen.has(normalized)) return;
		seen.add(normalized);
		rules.push(normalized);
	};

	const hasBash = declaredTools.includes("bash");
	const hasPowerShell = declaredTools.includes("powershell");
	const hasGrep = declaredTools.includes("grep");
	const hasFind = declaredTools.includes("find");
	const hasLs = declaredTools.includes("ls");

	if ((hasBash || hasPowerShell) && !hasGrep && !hasFind && !hasLs) {
		if (hasBash && hasPowerShell) {
			addRule("Use bash or PowerShell for file operations like listing, searching, and finding files");
		} else if (hasPowerShell) {
			addRule("Use PowerShell for file operations like listing, searching, and finding files");
		} else {
			addRule("Use bash for file operations like ls, rg, find");
		}
	}

	for (const name of declaredTools) {
		for (const rule of toolGuidelines[name] ?? []) {
			addRule(rule);
		}
	}

	for (const rule of promptGuidelines) {
		addRule(rule);
	}

	return rules.map((rule) => `- ${rule}`).join("\n");
}

/**
 * Mutates `options` (from `before_agent_start.systemPromptOptions`) in-place
 * according to the active `OutputStyle` and its `keepCodingInstructions` flag.
 */
export function applyOutputStyleToPromptOptions(
	options: NormalizedBuildSystemPromptOptions,
	style: OutputStyle,
	activeToolNames?: readonly string[],
): void {
	if (style.id === "default") {
		delete options.sections.output_style;
		return;
	}

	const trimmedPrompt = style.prompt.trim();

	if (style.keepCodingInstructions) {
		if (!trimmedPrompt) {
			delete options.sections.output_style;
			return;
		}
		options.sections.output_style = [
			`# Output Style: ${style.name}`,
			`Note: The output style instructions below take precedence over the default "Be concise in your responses" rule regarding explanation depth, formatting, and collaboration flow.`,
			trimmedPrompt,
		].join("\n\n");
		return;
	}

	// keepCodingInstructions === false:
	// Replace the default coding preamble & coding-specific rules with the custom style prompt,
	// while preserving existing user customPrompt (if any), active tool declarations, and tool usage guidelines.
	delete options.sections.output_style;

	const existingCustomPrompt = options.customPrompt?.trim();
	const combinedCustomPrompt = [existingCustomPrompt, trimmedPrompt]
		.filter((part): part is string => Boolean(part && part.length > 0))
		.join("\n\n");

	// Ensure customPrompt is non-empty so buildSystemPromptSections does not fall back to the default coding preamble
	options.customPrompt = combinedCustomPrompt || `# Output Style: ${style.name}`;

	const effectiveTools = activeToolNames ? [...activeToolNames] : options.selectedTools;
	const declaredTools = effectiveTools.filter((name) => !options.hiddenTools.includes(name));

	const visibleTools = declaredTools.filter((name) => Boolean(options.toolSnippets[name]));
	const toolsText =
		visibleTools.length > 0
			? visibleTools.map((name) => `- ${name}: ${options.toolSnippets[name]}`).join("\n")
			: "(none)";

	options.sections.tools = `${toolsText}\n\nIn addition to the tools above, you may have access to other custom tools depending on the project.`;

	const toolRules = buildToolUsageRules(
		declaredTools,
		options.toolGuidelines,
		options.promptGuidelines,
	);
	if (toolRules) {
		options.sections.rules = toolRules;
	} else {
		delete options.sections.rules;
	}
}
