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

// === Multi-file input ===

test("Should compile multiple files joined in order", async () => {
	const { stdout } = await run([
		join(testDir, "files", "joined", "common.ftl"),
		join(testDir, "files", "joined", "brand.ftl"),
		join(testDir, "files", "joined", "app.ftl"),
		"--locale",
		"en-CA",
	]);
	ok(stdout.includes("export const commonHello"));
	ok(stdout.includes("export const brandTagline"));
	ok(stdout.includes("export const appGreeting"));
});

test("Should error with file paths on duplicate ids across files", async () => {
	try {
		await run([
			join(testDir, "files", "joined", "dup-a.ftl"),
			join(testDir, "files", "joined", "dup-b.ftl"),
			"--locale",
			"en-CA",
		]);
		ok(false, "Should have thrown");
	} catch (e) {
		strictEqual(e.code, 1);
		ok(e.stderr.includes('"greeting"'));
		ok(e.stderr.includes("dup-a.ftl"));
		ok(e.stderr.includes("dup-b.ftl"));
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

// === Help output: program metadata and option descriptions ===

test("Should describe the program and every option in --help", async () => {
	const { stdout } = await run(["--help"]);
	// program name (usage line) and description
	ok(stdout.includes("Usage: ftl"), "usage line should show the program name");
	ok(
		stdout.includes("Compile Fluent (.ftl) files to JavaScript"),
		"should show the program description",
	);
	// argument + option descriptions
	ok(stdout.includes("Paths to the Fluent file(s) to compile"));
	ok(stdout.includes("What locale(s) to be used"));
	ok(stdout.includes("Include comments in output file."));
	ok(stdout.includes("Allowed messages to be included"));
	ok(stdout.includes("Ignored messages to be excluded"));
	ok(stdout.includes("Set message to an empty string when it contains"));
	ok(stdout.includes("What variable notation to use with exports"));
	ok(stdout.includes("all exported messages will have the same interface"));
	ok(stdout.includes("Wrap placeable with"));
	ok(stdout.includes("Path to store the resulting JavaScript file"));
});

// === Default: comments are off unless --comments is passed ===

test("Should exclude comments by default (no --comments)", async () => {
	const dir = await mkdtemp(join(tmpdir(), "ftl-cli-test-"));
	const inputPath = join(dir, "input.ftl");
	try {
		await writeFile(inputPath, "## Group comment\nmsg = Hello\n", "utf8");
		const { stdout } = await run([inputPath, "--locale", "en-CA"]);
		ok(
			!stdout.includes("// ## Group comment"),
			"comments should be omitted without --comments",
		);
	} finally {
		await rm(dir, { recursive: true });
	}
});

// === Flag presets ===

test("Should enable disableMinify interface with --disable-minify", async () => {
	const dir = await mkdtemp(join(tmpdir(), "ftl-cli-test-"));
	const inputPath = join(dir, "input.ftl");
	try {
		await writeFile(inputPath, "msg = Hello\n", "utf8");
		const { stdout } = await run([
			inputPath,
			"--locale",
			"en-CA",
			"--disable-minify",
		]);
		ok(
			stdout.includes("export const msg = () => ({"),
			"--disable-minify should force the consistent ({value, attributes}) interface",
		);
	} finally {
		await rm(dir, { recursive: true });
	}
});

test("Should wrap placeables with isolating chars with --use-isolating", async () => {
	const dir = await mkdtemp(join(tmpdir(), "ftl-cli-test-"));
	const inputPath = join(dir, "input.ftl");
	try {
		await writeFile(inputPath, "msg = Hello { $name }\n", "utf8");
		const { stdout } = await run([
			inputPath,
			"--locale",
			"en-CA",
			"--use-isolating",
		]);
		ok(stdout.includes("\u2068"), "should include isolating start char");
		ok(stdout.includes("\u2069"), "should include isolating end char");
	} finally {
		await rm(dir, { recursive: true });
	}
});

// === variable-notation choices are all accepted ===

for (const notation of [
	"camelCase",
	"pascalCase",
	"constantCase",
	"snakeCase",
]) {
	test(`Should accept --variable-notation ${notation}`, async () => {
		const dir = await mkdtemp(join(tmpdir(), "ftl-cli-test-"));
		const inputPath = join(dir, "input.ftl");
		try {
			await writeFile(inputPath, "my-message = Hello\n", "utf8");
			const { stdout } = await run([
				inputPath,
				"--locale",
				"en-CA",
				"--variable-notation",
				notation,
			]);
			ok(
				stdout.includes("export const"),
				`${notation} should be a valid choice`,
			);
		} finally {
			await rm(dir, { recursive: true });
		}
	});
}
