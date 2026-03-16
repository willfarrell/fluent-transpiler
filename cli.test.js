import { ok, strictEqual } from "node:assert";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const cli = join(import.meta.dirname, "cli.js");
const fixtureFile = join(import.meta.dirname, "test", "files", "index.ftl");
const testDir = join(import.meta.dirname, "test");

const run = (args) =>
	execFileAsync(process.execPath, [cli, ...args], {
		cwd: import.meta.dirname,
	});

// === Successful compilation to stdout ===

test("Should compile to stdout with --locale", async () => {
	const { stdout, stderr } = await run([fixtureFile, "--locale", "en-CA"]);
	ok(stdout.includes("export"), "stdout should contain compiled JS exports");
	strictEqual(stderr, "", "stderr should be empty");
});

test("Should compile to stdout with multiple locales", async () => {
	const { stdout } = await run([fixtureFile, "--locale", "en-CA", "en"]);
	ok(stdout.includes('["en-CA","en"]'), "stdout should contain both locales");
});

// === Successful compilation to file ===

test("Should compile to output file with --output", async () => {
	const dir = await mkdtemp(join(tmpdir(), "ftl-cli-test-"));
	const outputPath = join(dir, "output.mjs");
	try {
		const { stdout } = await run([
			fixtureFile,
			"--locale",
			"en-CA",
			"--output",
			outputPath,
		]);
		strictEqual(stdout, "", "stdout should be empty when writing to file");
		const content = await readFile(outputPath, "utf8");
		ok(content.includes("export"), "output file should contain compiled JS");
	} finally {
		await rm(dir, { recursive: true });
	}
});

test("Should compile to output file with -o shorthand", async () => {
	const dir = await mkdtemp(join(tmpdir(), "ftl-cli-test-"));
	const outputPath = join(dir, "output.mjs");
	try {
		await run([fixtureFile, "--locale", "en-CA", "-o", outputPath]);
		const content = await readFile(outputPath, "utf8");
		ok(content.includes("export"), "output file should contain compiled JS");
	} finally {
		await rm(dir, { recursive: true });
	}
});

// === Missing required --locale option ===

test("Should error when --locale is missing", async () => {
	try {
		await run([fixtureFile]);
		ok(false, "Should have thrown");
	} catch (e) {
		strictEqual(e.code, 1, "exit code should be 1");
		ok(
			e.stderr.includes("required option"),
			"stderr should mention required option",
		);
	}
});

// === Non-existent input file ===

test("Should error with exit code 1 for non-existent input file", async () => {
	try {
		await run(["nonexistent.ftl", "--locale", "en-CA"]);
		ok(false, "Should have thrown");
	} catch (e) {
		strictEqual(e.code, 1, "exit code should be 1");
		ok(e.stderr.includes("Error:"), "stderr should contain error message");
	}
});

// === Input path is a directory ===

test("Should error when input path is a directory", async () => {
	try {
		await run([testDir, "--locale", "en-CA"]);
		ok(false, "Should have thrown");
	} catch (e) {
		strictEqual(e.code, 1, "exit code should be 1");
		ok(
			e.stderr.includes("is not a file"),
			"stderr should indicate path is not a file",
		);
	}
});

// === Options: --comments ===

test("Should include comments with --comments", async () => {
	const dir = await mkdtemp(join(tmpdir(), "ftl-cli-test-"));
	const inputPath = join(dir, "input.ftl");
	try {
		const ftl = "## Group comment\nmsg = Hello\n";
		await writeFile(inputPath, ftl, "utf8");
		const { stdout } = await run([
			inputPath,
			"--locale",
			"en-CA",
			"--comments",
		]);
		ok(stdout.includes("// ## Group comment"), "output should include comment");
	} finally {
		await rm(dir, { recursive: true });
	}
});

// === Options: --variable-notation ===

test("Should use snakeCase with --variable-notation snakeCase", async () => {
	const dir = await mkdtemp(join(tmpdir(), "ftl-cli-test-"));
	const inputPath = join(dir, "input.ftl");
	try {
		const ftl = "my-message = Hello\n";
		await writeFile(inputPath, ftl, "utf8");
		const { stdout } = await run([
			inputPath,
			"--locale",
			"en-CA",
			"--variable-notation",
			"snakeCase",
		]);
		ok(
			stdout.includes("export const my_message"),
			"output should use snake_case",
		);
	} finally {
		await rm(dir, { recursive: true });
	}
});

// === Options: --include-key ===

test("Should only include specified keys with --include-key", async () => {
	const dir = await mkdtemp(join(tmpdir(), "ftl-cli-test-"));
	const inputPath = join(dir, "input.ftl");
	try {
		const ftl = "msg-one = Hello\nmsg-two = World\n";
		await writeFile(inputPath, ftl, "utf8");
		const { stdout } = await run([
			inputPath,
			"--locale",
			"en-CA",
			"--include-key",
			"msgOne",
		]);
		ok(stdout.includes("export const msgOne"), "should include msgOne");
		ok(!stdout.includes("export const msgTwo"), "should not include msgTwo");
	} finally {
		await rm(dir, { recursive: true });
	}
});

// === Options: --exclude-key ===

test("Should exclude specified keys with --exclude-key", async () => {
	const dir = await mkdtemp(join(tmpdir(), "ftl-cli-test-"));
	const inputPath = join(dir, "input.ftl");
	try {
		const ftl = "msg-one = Hello\nmsg-two = World\n";
		await writeFile(inputPath, ftl, "utf8");
		const { stdout } = await run([
			inputPath,
			"--locale",
			"en-CA",
			"--exclude-key",
			"msgTwo",
		]);
		ok(stdout.includes("export const msgOne"), "should include msgOne");
		ok(!stdout.includes("export const msgTwo"), "should not include msgTwo");
	} finally {
		await rm(dir, { recursive: true });
	}
});
