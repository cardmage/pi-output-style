import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import { parseGeneratedStyleOutput, sanitizeStyleSlug } from "../src/generator.ts";
import {
	findOutputStyle,
	loadOutputStyles,
	parseOutputStyleMarkdown,
} from "../src/loader.ts";

describe("loader & frontmatter parser", () => {
	it("parses standard LF frontmatter and defaults keep-coding-instructions to false for custom styles", () => {
		const raw = [
			"---",
			"name: Technical Writer",
			"description: Documentation-first persona",
			"---",
			"",
			"You are a senior technical writer.",
		].join("\n");

		const style = parseOutputStyleMarkdown(raw, {
			fallbackId: "tech-writer",
			source: "project-pi",
		});

		assert.equal(style.id, "tech-writer");
		assert.equal(style.name, "Technical Writer");
		assert.equal(style.description, "Documentation-first persona");
		assert.equal(style.keepCodingInstructions, false);
		assert.equal(style.prompt, "You are a senior technical writer.");
	});

	it("parses Windows CRLF (\\r\\n), BOM, quotes, and keep-coding-instructions: true", () => {
		const raw = [
			"\uFEFF---",
			'name: "Socratic Mentor"',
			"description: 'Guides through questions'",
			'keep-coding-instructions: "true" # inline comment',
			"---",
			"",
			"Ask guiding questions before giving answers.\r\nSecond line.",
		].join("\r\n");

		const style = parseOutputStyleMarkdown(raw, {
			fallbackId: "socratic-mentor",
			source: "user-pi",
		});

		assert.equal(style.id, "socratic-mentor");
		assert.equal(style.name, "Socratic Mentor");
		assert.equal(style.description, "Guides through questions");
		assert.equal(style.keepCodingInstructions, true);
		assert.equal(style.prompt, "Ask guiding questions before giving answers.\r\nSecond line.");
	});

	it("handles markdown files without frontmatter", () => {
		const raw = "# Pure Markdown Style\n\nAlways reply in bullet points.";
		const style = parseOutputStyleMarkdown(raw, {
			fallbackId: "bullet-only",
			fallbackName: "bullet-only",
			source: "user-claude",
		});

		assert.equal(style.id, "bullet-only");
		assert.equal(style.name, "bullet-only");
		assert.equal(style.description, "");
		assert.equal(style.keepCodingInstructions, false);
		assert.equal(style.prompt, "# Pure Markdown Style\n\nAlways reply in bullet points.");
	});

	it("loads styles in 5-level priority order and respects isProjectTrusted guard", () => {
		const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-output-style-test-"));
		try {
			const homeDir = path.join(tempRoot, "home");
			const agentDir = path.join(homeDir, ".pi", "agent");
			const cwd = path.join(tempRoot, "project");

			const userClaudeDir = path.join(homeDir, ".claude", "output-styles");
			const userPiDir = path.join(agentDir, "output-styles");
			const projectClaudeDir = path.join(cwd, ".claude", "output-styles");
			const projectPiDir = path.join(cwd, ".pi", "output-styles");

			fs.mkdirSync(userClaudeDir, { recursive: true });
			fs.mkdirSync(userPiDir, { recursive: true });
			fs.mkdirSync(projectClaudeDir, { recursive: true });
			fs.mkdirSync(projectPiDir, { recursive: true });

			// Same ID ("reviewer") across all 4 custom layers to verify override priority
			fs.writeFileSync(
				path.join(userClaudeDir, "reviewer.md"),
				"---\nname: Reviewer User Claude\n---\nFrom user-claude",
			);
			fs.writeFileSync(
				path.join(userPiDir, "reviewer.md"),
				"---\nname: Reviewer User Pi\n---\nFrom user-pi",
			);
			fs.writeFileSync(
				path.join(projectClaudeDir, "reviewer.md"),
				"---\nname: Reviewer Project Claude\n---\nFrom project-claude",
			);
			fs.writeFileSync(
				path.join(projectPiDir, "reviewer.md"),
				"---\nname: Reviewer Project Pi\n---\nFrom project-pi",
			);

			// Unique style only in project-claude
			fs.writeFileSync(
				path.join(projectClaudeDir, "claude-only.md"),
				"---\nname: Claude Project Style\nkeep-coding-instructions: true\n---\nClaude prompt",
			);

			// 1. When project is trusted: project-pi wins over project-claude > user-pi > user-claude
			const trustedStyles = loadOutputStyles({
				cwd,
				homeDir,
				agentDir,
				isProjectTrusted: true,
			});

			assert.ok(trustedStyles.has("default"));
			assert.ok(trustedStyles.has("explanatory"));
			assert.ok(trustedStyles.has("learning"));
			assert.ok(trustedStyles.has("claude-only"));

			const reviewer = trustedStyles.get("reviewer")!;
			assert.equal(reviewer.name, "Reviewer Project Pi");
			assert.equal(reviewer.source, "project-pi");
			assert.equal(reviewer.prompt, "From project-pi");

			// 2. When project is NOT trusted: project styles are ignored, user-pi wins over user-claude
			const untrustedStyles = loadOutputStyles({
				cwd,
				homeDir,
				agentDir,
				isProjectTrusted: false,
			});

			assert.equal(untrustedStyles.has("claude-only"), false);
			const untrustedReviewer = untrustedStyles.get("reviewer")!;
			assert.equal(untrustedReviewer.name, "Reviewer User Pi");
			assert.equal(untrustedReviewer.source, "user-pi");

			// 3. Case-insensitive matching by id or display name
			assert.equal(findOutputStyle(trustedStyles, "EXPLANATORY")?.id, "explanatory");
			assert.equal(
				findOutputStyle(trustedStyles, "Claude Project Style")?.id,
				"claude-only",
			);
		} finally {
			fs.rmSync(tempRoot, { recursive: true, force: true });
		}
	});

	it("sanitizes slugs safely against path traversal and handles Korean/Unicode names", () => {
		assert.equal(sanitizeStyleSlug("../../etc/passwd.md"), "passwd");
		assert.equal(sanitizeStyleSlug("친절한 시니어 멘토"), "친절한-시니어-멘토");

		const generated = parseGeneratedStyleOutput(
			"```markdown\n---\nslug: senior-mentor\nname: 친절한 시니어 멘토\ndescription: 한국어 멘토링 스타일\nkeep-coding-instructions: true\n---\n\n항상 친절하게 설명하세요.\n```",
			"한국어 멘토",
		);
		assert.equal(generated.slug, "senior-mentor");
		assert.match(generated.markdown, /name: 친절한 시니어 멘토/);
	});
});
