import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import { loadOutputStyles } from "../src/loader.ts";
import {
	OUTPUT_STYLE_ENTRY_TYPE,
	resolveActiveOutputStyle,
	saveOutputStyleConfig,
} from "../src/state.ts";

describe("state resolution & persistence", () => {
	it("resolves active style according to strict precedence and Claude Code fallback", () => {
		const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-output-style-state-"));
		try {
			const homeDir = path.join(tempRoot, "home");
			const agentDir = path.join(homeDir, ".pi", "agent");
			const cwd = path.join(tempRoot, "project");

			fs.mkdirSync(path.join(homeDir, ".claude"), { recursive: true });
			fs.mkdirSync(agentDir, { recursive: true });
			fs.mkdirSync(path.join(cwd, ".claude"), { recursive: true });
			fs.mkdirSync(path.join(cwd, ".pi", "output-styles"), { recursive: true });

			fs.writeFileSync(
				path.join(cwd, ".pi", "output-styles", "custom-mentor.md"),
				"---\nname: Custom Mentor\nkeep-coding-instructions: true\n---\nMentor prompt",
			);

			const styles = loadOutputStyles({ cwd, homeDir, agentDir, isProjectTrusted: true });

			// 1. Default when nothing is configured
			let resolved = resolveActiveOutputStyle({ styles, cwd, homeDir, agentDir });
			assert.equal(resolved.style.id, "default");
			assert.equal(resolved.origin, "default");

			// 2. Global Claude settings.json fallback
			fs.writeFileSync(
				path.join(homeDir, ".claude", "settings.json"),
				JSON.stringify({ outputStyle: "Explanatory" }),
			);
			resolved = resolveActiveOutputStyle({ styles, cwd, homeDir, agentDir });
			assert.equal(resolved.style.id, "explanatory");
			assert.equal(resolved.origin, "global-claude");

			// 3. Global Pi output-style.json overrides Global Claude
			saveOutputStyleConfig("global", "learning", { cwd, homeDir, agentDir });
			resolved = resolveActiveOutputStyle({ styles, cwd, homeDir, agentDir });
			assert.equal(resolved.style.id, "learning");
			assert.equal(resolved.origin, "global-pi");

			// 4. Project Claude settings.local.json overrides Global Pi (when trusted)
			fs.writeFileSync(
				path.join(cwd, ".claude", "settings.local.json"),
				JSON.stringify({ outputStyle: "Explanatory" }),
			);
			resolved = resolveActiveOutputStyle({
				styles,
				cwd,
				homeDir,
				agentDir,
				isProjectTrusted: true,
			});
			assert.equal(resolved.style.id, "explanatory");
			assert.equal(resolved.origin, "project-claude");

			// 5. Project untrusted ignores project config and falls back to Global Pi
			resolved = resolveActiveOutputStyle({
				styles,
				cwd,
				homeDir,
				agentDir,
				isProjectTrusted: false,
			});
			assert.equal(resolved.style.id, "learning");
			assert.equal(resolved.origin, "global-pi");

			// 6. Project Pi output-style.json overrides Project Claude
			saveOutputStyleConfig("project", "custom-mentor", { cwd, homeDir, agentDir });
			resolved = resolveActiveOutputStyle({
				styles,
				cwd,
				homeDir,
				agentDir,
				isProjectTrusted: true,
			});
			assert.equal(resolved.style.id, "custom-mentor");
			assert.equal(resolved.origin, "project-pi");

			// 7. Session branch entry overrides Project Pi (takes the last entry on the branch)
			const branchEntries = [
				{
					type: "custom",
					customType: OUTPUT_STYLE_ENTRY_TYPE,
					data: { styleId: "explanatory" },
				},
				{
					type: "custom",
					customType: OUTPUT_STYLE_ENTRY_TYPE,
					data: { styleId: "learning" },
				},
			];
			resolved = resolveActiveOutputStyle({
				styles,
				cwd,
				homeDir,
				agentDir,
				branchEntries,
				isProjectTrusted: true,
			});
			assert.equal(resolved.style.id, "learning");
			assert.equal(resolved.origin, "session");

			// 8. CLI flag overrides everything
			resolved = resolveActiveOutputStyle({
				styles,
				cwd,
				homeDir,
				agentDir,
				branchEntries,
				flagStyle: "explanatory",
				isProjectTrusted: true,
			});
			assert.equal(resolved.style.id, "explanatory");
			assert.equal(resolved.origin, "flag");
		} finally {
			fs.rmSync(tempRoot, { recursive: true, force: true });
		}
	});

	it("falls back to Default and reports missingStyleId when configured style does not exist", () => {
		const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-output-style-missing-"));
		try {
			const styles = loadOutputStyles({
				cwd: tempRoot,
				homeDir: tempRoot,
				agentDir: tempRoot,
			});

			const resolved = resolveActiveOutputStyle({
				styles,
				cwd: tempRoot,
				homeDir: tempRoot,
				agentDir: tempRoot,
				branchEntries: [
					{
						type: "custom",
						customType: OUTPUT_STYLE_ENTRY_TYPE,
						data: { styleId: "deleted-style" },
					},
				],
			});

			assert.equal(resolved.style.id, "default");
			assert.equal(resolved.origin, "default");
			assert.equal(resolved.missingStyleId, "deleted-style");
		} finally {
			fs.rmSync(tempRoot, { recursive: true, force: true });
		}
	});
});
