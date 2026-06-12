// Copyright 2026 will Farrell, and fluent-transpiler contributors.
// SPDX-License-Identifier: MIT
import { ok, rejects, strictEqual } from "node:assert";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createProgram } from "./program.js";

const fixtureFile = join(import.meta.dirname, "test", "files", "index.ftl");
const testDir = join(import.meta.dirname, "test");

// === Packaging: the published tarball must be self-contained ===

test("Should list every locally imported module in package.json files", async () => {
	const pkg = JSON.parse(
		await readFile(join(import.meta.dirname, "package.json"), "utf8"),
	);
	const published = new Set(pkg.files);
	for (const file of pkg.files.filter((f) => f.endsWith(".js"))) {
		const src = await readFile(join(import.meta.dirname, file), "utf8");
		for (const [, specifier] of src.matchAll(/from\s+"\.\/([^"]+)"/g)) {
			ok(
				published.has(specifier),
				`${file} imports ./${specifier}, which is missing from package.json "files"`,
			);
		}
	}
});

// Build the CLI program for in-process testing: make commander throw instead of
// calling process.exit, and silence its own stdout/stderr writes.
const buildProgram = () => {
	const program = createProgram();
	program.exitOverride();
	program.configureOutput({ writeOut() {}, writeErr() {} });
	return program;
};

const run = (args) => buildProgram().parseAsync(["node", "ftl", ...args]);

// Capture console.log output produced while fn() runs.
const captureLog = async (fn) => {
	const original = console.log;
	let out = "";
	console.log = (...parts) => {
		out += `${parts.join(" ")}\n`;
	};
	try {
		await fn();
	} finally {
		console.log = original;
	}
	return out;
};

// === Successful compilation to stdout ===

test("Should compile to stdout with --locale", async () => {
	const out = await captureLog(() => run([fixtureFile, "--locale", "en-CA"]));
	ok(out.includes("export"), "stdout should contain compiled JS exports");
});

test("Should compile to stdout with multiple locales", async () => {
	const out = await captureLog(() =>
		run([fixtureFile, "--locale", "en-CA", "en"]),
	);
	ok(out.includes('["en-CA","en"]'), "stdout should contain both locales");
});

// === Successful compilation to file ===

test("Should compile to output file with --output", async () => {
	const dir = await mkdtemp(join(tmpdir(), "ftl-cli-test-"));
	const outputPath = join(dir, "output.mjs");
	try {
		const out = await captureLog(() =>
			run([fixtureFile, "--locale", "en-CA", "--output", outputPath]),
		);
		strictEqual(out, "", "nothing should be logged when writing to file");
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
	await rejects(
		run([fixtureFile]),
		/required option/i,
		"should report the missing required option",
	);
});

// === Missing required <inputs> argument ===

test("Should error when no input is given", async () => {
	await rejects(
		run(["--locale", "en-CA"]),
		/missing required argument/i,
		"should report the missing input argument",
	);
});

// === Non-existent input file ===

test("Should error for non-existent input file", async () => {
	await rejects(run(["nonexistent.ftl", "--locale", "en-CA"]));
});

// === Input path is a directory ===

test("Should error when input path is a directory", async () => {
	await rejects(
		run([testDir, "--locale", "en-CA"]),
		/is not a file/,
		"should indicate the path is not a file",
	);
});

// === Multi-file input ===

test("Should compile multiple files joined in order", async () => {
	const out = await captureLog(() =>
		run([
			join(testDir, "files", "joined", "common.ftl"),
			join(testDir, "files", "joined", "brand.ftl"),
			join(testDir, "files", "joined", "app.ftl"),
			"--locale",
			"en-CA",
		]),
	);
	ok(out.includes("export const commonHello"));
	ok(out.includes("export const brandTagline"));
	ok(out.includes("export const appGreeting"));
});

test("Should error with file paths on duplicate ids across files", async () => {
	await rejects(
		run([
			join(testDir, "files", "joined", "dup-a.ftl"),
			join(testDir, "files", "joined", "dup-b.ftl"),
			"--locale",
			"en-CA",
		]),
		(e) => {
			ok(e.message.includes('"greeting"'));
			ok(e.message.includes("dup-a.ftl"));
			ok(e.message.includes("dup-b.ftl"));
			return true;
		},
	);
});

// === Options: --comments ===

test("Should include comments with --comments", async () => {
	const dir = await mkdtemp(join(tmpdir(), "ftl-cli-test-"));
	const inputPath = join(dir, "input.ftl");
	try {
		await writeFile(inputPath, "## Group comment\nmsg = Hello\n", "utf8");
		const out = await captureLog(() =>
			run([inputPath, "--locale", "en-CA", "--comments"]),
		);
		ok(out.includes("// ## Group comment"), "output should include comment");
	} finally {
		await rm(dir, { recursive: true });
	}
});

// === Default: comments are off unless --comments is passed ===

test("Should exclude comments by default (no --comments)", async () => {
	const dir = await mkdtemp(join(tmpdir(), "ftl-cli-test-"));
	const inputPath = join(dir, "input.ftl");
	try {
		await writeFile(inputPath, "## Group comment\nmsg = Hello\n", "utf8");
		const out = await captureLog(() => run([inputPath, "--locale", "en-CA"]));
		ok(
			!out.includes("// ## Group comment"),
			"comments should be omitted without --comments",
		);
	} finally {
		await rm(dir, { recursive: true });
	}
});

// === Options: --variable-notation ===

test("Should use snakeCase with --variable-notation snakeCase", async () => {
	const dir = await mkdtemp(join(tmpdir(), "ftl-cli-test-"));
	const inputPath = join(dir, "input.ftl");
	try {
		await writeFile(inputPath, "my-message = Hello\n", "utf8");
		const out = await captureLog(() =>
			run([inputPath, "--locale", "en-CA", "--variable-notation", "snakeCase"]),
		);
		ok(out.includes("export const my_message"), "output should use snake_case");
	} finally {
		await rm(dir, { recursive: true });
	}
});

// === Options: --include-key ===

test("Should only include specified keys with --include-key", async () => {
	const dir = await mkdtemp(join(tmpdir(), "ftl-cli-test-"));
	const inputPath = join(dir, "input.ftl");
	try {
		await writeFile(inputPath, "msg-one = Hello\nmsg-two = World\n", "utf8");
		const out = await captureLog(() =>
			run([inputPath, "--locale", "en-CA", "--include-key", "msgOne"]),
		);
		ok(out.includes("export const msgOne"), "should include msgOne");
		ok(!out.includes("export const msgTwo"), "should not include msgTwo");
	} finally {
		await rm(dir, { recursive: true });
	}
});

// === Options: --exclude-key ===

test("Should exclude specified keys with --exclude-key", async () => {
	const dir = await mkdtemp(join(tmpdir(), "ftl-cli-test-"));
	const inputPath = join(dir, "input.ftl");
	try {
		await writeFile(inputPath, "msg-one = Hello\nmsg-two = World\n", "utf8");
		const out = await captureLog(() =>
			run([inputPath, "--locale", "en-CA", "--exclude-key", "msgTwo"]),
		);
		ok(out.includes("export const msgOne"), "should include msgOne");
		ok(!out.includes("export const msgTwo"), "should not include msgTwo");
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
		const out = await captureLog(() =>
			run([inputPath, "--locale", "en-CA", "--disable-minify"]),
		);
		ok(
			out.includes("export const msg = () => ({"),
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
		const out = await captureLog(() =>
			run([inputPath, "--locale", "en-CA", "--use-isolating"]),
		);
		ok(out.includes("\u2068"), "should include isolating start char");
		ok(out.includes("\u2069"), "should include isolating end char");
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
			const out = await captureLog(() =>
				run([inputPath, "--locale", "en-CA", "--variable-notation", notation]),
			);
			ok(out.includes("export const"), `${notation} should be a valid choice`);
		} finally {
			await rm(dir, { recursive: true });
		}
	});
}

// === Help output: program metadata and option descriptions ===

test("Should describe the program and every option in --help", () => {
	const help = buildProgram().helpInformation();
	ok(help.includes("Usage: ftl"), "usage line should show the program name");
	ok(
		help.includes("Compile Fluent (.ftl) files to JavaScript"),
		"should show the program description",
	);
	ok(help.includes("Paths to the Fluent file(s) to compile"));
	ok(help.includes("What locale(s) to be used"));
	ok(help.includes("Include comments in output file."));
	ok(help.includes("Allowed messages to be included"));
	ok(help.includes("Ignored messages to be excluded"));
	ok(help.includes("Set message to an empty string when it equals"));
	ok(help.includes("What variable notation to use with exports"));
	ok(help.includes("all exported messages will have the same interface"));
	ok(help.includes("Wrap placeable with"));
	ok(help.includes("Path to store the resulting JavaScript file"));
});
