import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NormalizedBuildSystemPromptOptions } from "@earendil-works/pi-coding-agent";
import { getBuiltinStylesMap } from "../src/builtin-styles.ts";
import outputStyleExtension, {
	applyOutputStyleToPromptOptions,
	OUTPUT_STYLE_ENTRY_TYPE,
} from "../src/index.ts";
import type { OutputStyle } from "../src/types.ts";

function createMockPromptOptions(): NormalizedBuildSystemPromptOptions {
	return {
		customPrompt: undefined,
		forceSystemPrompt: undefined,
		selectedTools: ["read", "bash", "edit", "write"],
		hiddenTools: [],
		toolSnippets: {
			read: "Read file contents",
			bash: "Execute bash commands",
			edit: "Make precise file edits",
			write: "Create or overwrite files",
			mcp: "MCP gateway",
		},
		toolGuidelines: {
			read: ["Use read to examine files instead of cat or sed."],
			edit: ["Use edit for precise changes (edits[].oldText must match exactly)"],
		},
		promptGuidelines: ["Always verify before concluding."],
		appendSystemPrompt: "",
		sections: {},
		cwd: "/workspace/demo",
		contextFiles: [],
		skills: [],
	};
}

describe("prompt transformation (applyOutputStyleToPromptOptions)", () => {
	it("injects output_style section for keepCodingInstructions: true and clears it on Default", () => {
		const builtins = getBuiltinStylesMap();
		const explanatory = builtins.get("explanatory")!;
		const learning = builtins.get("learning")!;
		const defaultStyle = builtins.get("default")!;

		const options = createMockPromptOptions();

		// 1. Apply Explanatory
		applyOutputStyleToPromptOptions(options, explanatory);
		assert.equal(options.customPrompt, undefined);
		assert.ok(options.sections.output_style);
		assert.match(options.sections.output_style, /# Output Style: Explanatory/);
		assert.match(options.sections.output_style, /★ Insight/);
		assert.match(
			options.sections.output_style,
			/take precedence over the default "Be concise in your responses" rule/,
		);

		// 2. Apply Learning
		applyOutputStyleToPromptOptions(options, learning);
		assert.ok(options.sections.output_style);
		assert.match(options.sections.output_style, /TODO\(human\)/);
		assert.match(options.sections.output_style, /STOP IMMEDIATELY/);

		// 3. Switch back to Default
		applyOutputStyleToPromptOptions(options, defaultStyle);
		assert.equal(options.sections.output_style, undefined);
	});

	it("replaces coding preamble and preserves active tools + tool guidelines when keepCodingInstructions: false", () => {
		const options = createMockPromptOptions();
		options.hiddenTools = ["write"];

		const customStyle: OutputStyle = {
			id: "research-analyst",
			name: "Research Analyst",
			description: "Deep research persona",
			keepCodingInstructions: false,
			prompt: "You are a thorough research analyst who synthesizes complex topics.",
			source: "project-pi",
		};

		// Pass dynamically active tools (including "mcp", excluding hidden "write")
		applyOutputStyleToPromptOptions(options, customStyle, [
			"read",
			"bash",
			"edit",
			"write",
			"mcp",
		]);

		assert.equal(
			options.customPrompt,
			"You are a thorough research analyst who synthesizes complex topics.",
		);
		assert.equal(options.sections.output_style, undefined);

		// Tools section includes read, bash, edit, mcp, but NOT hidden tool "write"
		assert.ok(options.sections.tools);
		assert.match(options.sections.tools, /- read: Read file contents/);
		assert.match(options.sections.tools, /- mcp: MCP gateway/);
		assert.doesNotMatch(options.sections.tools, /- write:/);

		// Rules section preserves toolGuidelines & promptGuidelines, but omits "Be concise in your responses"
		assert.ok(options.sections.rules);
		assert.match(
			options.sections.rules,
			/Use read to examine files instead of cat or sed\./,
		);
		assert.match(options.sections.rules, /Always verify before concluding\./);
		assert.doesNotMatch(options.sections.rules, /Be concise in your responses/);
	});

	it("preserves existing user SYSTEM.md customPrompt and guards against empty prompt when keepCodingInstructions: false", () => {
		const options = createMockPromptOptions();
		options.customPrompt = "Base system prompt from .pi/SYSTEM.md";

		const emptyBodyStyle: OutputStyle = {
			id: "minimalist",
			name: "Minimalist",
			description: "",
			keepCodingInstructions: false,
			prompt: "",
			source: "user-pi",
		};

		applyOutputStyleToPromptOptions(options, emptyBodyStyle);
		assert.equal(options.customPrompt, "Base system prompt from .pi/SYSTEM.md");

		// When both existing customPrompt and style.prompt are empty, still sets a non-empty customPrompt
		const optionsNoBase = createMockPromptOptions();
		applyOutputStyleToPromptOptions(optionsNoBase, emptyBodyStyle);
		assert.equal(optionsNoBase.customPrompt, "# Output Style: Minimalist");
	});

	it("wires session_start, session_tree, /output-style command, and before_agent_start end-to-end", async () => {
		const handlers = new Map<string, Function[]>();
		const commands = new Map<string, any>();
		const entries: Array<{ type: string; customType: string; data: unknown }> = [];
		const statuses = new Map<string, string | undefined>();
		const notifications: Array<{ message: string; type?: string }> = [];

		const mockPi: any = {
			registerFlag() {},
			getFlag() {
				return undefined;
			},
			on(event: string, handler: Function) {
				const list = handlers.get(event) ?? [];
				list.push(handler);
				handlers.set(event, list);
				return () => {};
			},
			registerCommand(name: string, options: any) {
				commands.set(name, options);
			},
			appendEntry(customType: string, data: unknown) {
				entries.push({ type: "custom", customType, data });
			},
			getActiveTools() {
				return ["read", "bash", "edit", "write"];
			},
		};

		outputStyleExtension(mockPi);

		assert.ok(commands.has("output-style"));
		assert.ok(commands.has("output-style:new"));
		assert.ok(handlers.has("session_start"));
		assert.ok(handlers.has("session_tree"));
		assert.ok(handlers.has("before_agent_start"));

		const mockCtx: any = {
			cwd: process.cwd(),
			hasUI: true,
			mode: "tui",
			isProjectTrusted: () => false,
			sessionManager: {
				getBranch: () => entries,
			},
			ui: {
				setStatus(key: string, text: string | undefined) {
					statuses.set(key, text);
				},
				notify(message: string, type?: string) {
					notifications.push({ message, type });
				},
			},
		};

		// 1. session_start -> Default
		await handlers.get("session_start")![0]({ type: "session_start", reason: "startup" }, mockCtx);
		assert.equal(statuses.get("output-style"), undefined);

		// 2. /output-style explanatory
		await commands.get("output-style").handler("explanatory", mockCtx);
		assert.equal(statuses.get("output-style"), "Style: Explanatory");
		assert.equal(entries.length, 1);
		assert.deepEqual(entries[0].data, { styleId: "explanatory" });

		// 3. before_agent_start -> injects <output_style> section
		const promptOptions = createMockPromptOptions();
		await handlers.get("before_agent_start")![0](
			{
				type: "before_agent_start",
				messageType: "user",
				prompt: "Hello",
				systemPrompt: "",
				systemPromptOptions: promptOptions,
			},
			mockCtx,
		);
		assert.ok(promptOptions.sections.output_style);
		assert.match(promptOptions.sections.output_style, /# Output Style: Explanatory/);

		// 4. Simulate /tree navigating to an earlier branch point with no entries
		const savedEntries = entries.splice(0, entries.length);
		await handlers.get("session_tree")![0]({ type: "session_tree" }, mockCtx);
		assert.equal(statuses.get("output-style"), undefined);

		// Restore entry and verify session_tree restores Explanatory
		entries.push(...savedEntries);
		await handlers.get("session_tree")![0]({ type: "session_tree" }, mockCtx);
		assert.equal(statuses.get("output-style"), "Style: Explanatory");
	});
});
