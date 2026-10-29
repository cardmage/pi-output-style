import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { UserMessage } from "@earendil-works/pi-ai";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { parseFrontmatter, parseOutputStyleMarkdown, resolveAgentDir } from "./loader.ts";
import type { OutputStyle, OutputStyleSource } from "./types.ts";

const STYLE_GENERATOR_SYSTEM_PROMPT = `You are an expert prompt engineer creating an Output Style markdown file for the Pi coding agent (compatible with Claude Code Output Styles).

Given a user's description of their desired style, output ONLY a valid Markdown document with YAML frontmatter and system prompt instructions. Do NOT wrap your output in outer code fences.

Required YAML frontmatter fields:
---
slug: <ascii-kebab-case-filename-without-extension, e.g. socratic-mentor>
name: <Human-readable display name>
description: <Concise 1-sentence summary shown in the /output-style selector>
keep-coding-instructions: <true or false>
---

Guidelines for \`keep-coding-instructions\`:
- Set to \`true\` if the style is still meant for software engineering / coding tasks (e.g., explanatory coding, Socratic code mentor, strict code reviewer, TDD coach).
- Set to \`false\` if the style transforms the assistant into a non-coding persona (e.g., research analyst, technical writer, product manager, translator).

Guidelines for the Markdown body:
- Write clear, actionable instructions in second person ("You are...", "When responding...").
- Structure with concise headings: Role/Persona, Response Format, Behavioral Rules, and Do's/Don'ts.
- Avoid fluff; make every rule specific and verifiable.`;

export function sanitizeStyleSlug(raw: string): string {
	const base = path.basename(raw.trim(), ".md");
	const ascii = base
		.toLowerCase()
		.replace(/['"`]/g, "")
		.replace(/[^a-z0-9\u00a0-\uffff_-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.replace(/-{2,}/g, "-");

	return ascii || "custom-style";
}

export function stripOuterCodeFences(text: string): string {
	const trimmed = text.trim();
	const fenceMatch = trimmed.match(/^```(?:markdown|md|yaml)?\r?\n([\s\S]*?)\r?\n```$/i);
	return fenceMatch ? fenceMatch[1].trim() : trimmed;
}

export function formatOutputStyleMarkdown(params: {
	name: string;
	description: string;
	keepCodingInstructions: boolean;
	prompt: string;
}): string {
	return [
		"---",
		`name: ${params.name}`,
		`description: ${params.description}`,
		`keep-coding-instructions: ${params.keepCodingInstructions ? "true" : "false"}`,
		"---",
		"",
		params.prompt.trim(),
		"",
	].join("\n");
}

export function buildStarterTemplate(userDescription: string): {
	slug: string;
	markdown: string;
} {
	const trimmed = userDescription.trim() || "Custom Style";
	const words = trimmed.split(/\s+/).slice(0, 4).join(" ");
	const slug = sanitizeStyleSlug(words);
	const name = words.charAt(0).toUpperCase() + words.slice(1);

	const markdown = formatOutputStyleMarkdown({
		name,
		description: trimmed,
		keepCodingInstructions: true,
		prompt: `You are operating with the "${name}" output style.\n\n## Core Objective\n\n${trimmed}\n\n## Response Guidelines\n\n- Follow the persona and formatting expectations described above.\n- Maintain accuracy and verify claims with available tools when needed.`,
	});

	return { slug, markdown };
}

export function parseGeneratedStyleOutput(
	rawOutput: string,
	fallbackDescription: string,
): {
	slug: string;
	markdown: string;
} {
	const unwrapped = stripOuterCodeFences(rawOutput);
	const { attributes, body, hasFrontmatter } = parseFrontmatter(unwrapped);

	if (!hasFrontmatter || !body) {
		return buildStarterTemplate(fallbackDescription);
	}

	const name = attributes.name || "Custom Style";
	const description = attributes.description || fallbackDescription.trim();
	const keepRaw =
		attributes["keep-coding-instructions"] ?? attributes.keepCodingInstructions ?? "true";
	const keepCodingInstructions = keepRaw.toLowerCase() !== "false";

	const rawSlug = attributes.slug || name;
	const slug = sanitizeStyleSlug(rawSlug);

	const markdown = formatOutputStyleMarkdown({
		name,
		description,
		keepCodingInstructions,
		prompt: body,
	});

	return { slug, markdown };
}

async function generateStyleWithModel(
	description: string,
	ctx: ExtensionCommandContext,
): Promise<{ slug: string; markdown: string } | null> {
	if (!ctx.model) {
		return buildStarterTemplate(description);
	}

	const userMessage: UserMessage = {
		role: "user",
		content: [
			{
				type: "text",
				text: `Create an Output Style for the following request:\n\n${description}`,
			},
		],
		timestamp: Date.now(),
	};

	if (ctx.mode === "tui") {
		const { BorderedLoader } = await import("@earendil-works/pi-coding-agent");
		return ctx.ui.custom<{ slug: string; markdown: string } | null>((tui, theme, _kb, done) => {
			const loader = new BorderedLoader(
				tui,
				theme,
				`Generating output style with ${ctx.model!.id}...`,
			);
			loader.onAbort = () => done(null);

			ctx.modelRegistry
				.complete(
					ctx.model!,
					{ systemPrompt: STYLE_GENERATOR_SYSTEM_PROMPT, messages: [userMessage] },
					{ signal: loader.signal },
				)
				.then((response) => {
					if (response.stopReason === "aborted") {
						done(null);
						return;
					}
					const text = response.content
						.filter((c): c is { type: "text"; text: string } => c.type === "text")
						.map((c) => c.text)
						.join("\n")
						.trim();
					if (!text) {
						done(buildStarterTemplate(description));
						return;
					}
					done(parseGeneratedStyleOutput(text, description));
				})
				.catch(() => {
					done(buildStarterTemplate(description));
				});

			return loader;
		});
	}

	try {
		const response = await ctx.modelRegistry.complete(ctx.model, {
			systemPrompt: STYLE_GENERATOR_SYSTEM_PROMPT,
			messages: [userMessage],
		});
		const text = response.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("\n")
			.trim();
		return text
			? parseGeneratedStyleOutput(text, description)
			: buildStarterTemplate(description);
	} catch {
		return buildStarterTemplate(description);
	}
}

export interface CreatedOutputStyleResult {
	style: OutputStyle;
	filePath: string;
	scope: "project" | "global";
}

export async function createNewOutputStyleInteractive(
	initialDescription: string,
	ctx: ExtensionCommandContext,
	options?: { homeDir?: string; agentDir?: string },
): Promise<CreatedOutputStyleResult | undefined> {
	if (!ctx.hasUI) {
		ctx.ui.notify("/output-style:new requires an interactive UI.", "error");
		return undefined;
	}

	let description = initialDescription.trim();
	if (!description) {
		const input = await ctx.ui.input(
			"Describe the new output style",
			"e.g., Socratic mentor that asks guiding questions and explains trade-offs",
		);
		if (!input || !input.trim()) {
			ctx.ui.notify("Output style creation cancelled.", "info");
			return undefined;
		}
		description = input.trim();
	}

	const projectOption = "Project (.pi/output-styles/)";
	const globalOption = "Global (~/.pi/agent/output-styles/)";
	const locationChoices = ctx.isProjectTrusted()
		? [projectOption, globalOption]
		: [globalOption];

	const selectedLocation =
		locationChoices.length === 1
			? globalOption
			: await ctx.ui.select("Where should the new output style be saved?", locationChoices);

	if (!selectedLocation) {
		ctx.ui.notify("Output style creation cancelled.", "info");
		return undefined;
	}

	const scope: "project" | "global" =
		selectedLocation === projectOption ? "project" : "global";

	const generated = await generateStyleWithModel(description, ctx);
	if (!generated) {
		ctx.ui.notify("Output style generation cancelled.", "info");
		return undefined;
	}

	const editedMarkdown = await ctx.ui.editor(
		"Review and edit generated output style (.md)",
		generated.markdown,
	);
	if (editedMarkdown === undefined || !editedMarkdown.trim()) {
		ctx.ui.notify("Output style creation cancelled.", "info");
		return undefined;
	}

	const { attributes } = parseFrontmatter(editedMarkdown);
	const finalSlug = sanitizeStyleSlug(attributes.slug || attributes.name || generated.slug);

	const homeDir = options?.homeDir ?? os.homedir();
	const agentDir = resolveAgentDir(homeDir, options?.agentDir);
	const targetDir =
		scope === "project"
			? path.join(ctx.cwd, ".pi", "output-styles")
			: path.join(agentDir, "output-styles");
	const filePath = path.join(targetDir, `${finalSlug}.md`);

	if (fs.existsSync(filePath)) {
		const overwrite = await ctx.ui.confirm(
			"Overwrite existing output style?",
			`File already exists at ${filePath}. Overwrite it?`,
		);
		if (!overwrite) {
			ctx.ui.notify("Output style creation cancelled.", "info");
			return undefined;
		}
	}

	fs.mkdirSync(targetDir, { recursive: true });
	fs.writeFileSync(filePath, `${editedMarkdown.trim()}\n`, "utf-8");

	const source: OutputStyleSource = scope === "project" ? "project-pi" : "user-pi";
	const style = parseOutputStyleMarkdown(editedMarkdown, {
		fallbackId: finalSlug,
		fallbackName: finalSlug,
		source,
		filePath,
		defaultKeepCodingInstructions: false,
	});

	return { style, filePath, scope };
}
