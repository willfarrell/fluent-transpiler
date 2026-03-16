import { readFile } from "node:fs/promises";
import test from "node:test";
import { Bench } from "tinybench";
import { compile } from "./index.js";

const time = Number(process.env.BENCH_TIME ?? 5_000);

const ftl = await readFile("./test/files/index.ftl", { encoding: "utf8" });

const simpleFtl = "hello = Hello World";

const complexFtl = `
-brand = Firefox
-brand-case =
    { $case ->
        *[nominative] Firefox
        [locative] Firefoksie
    }

welcome = Welcome to { -brand }
greeting = Hello { $name }, you have { NUMBER($count, maximumFractionDigits: 0) } messages.
today = Today is { DATETIME($date) }
elapsed = Time elapsed: { RELATIVETIME($date) }

items =
  { $count ->
    [zero] No items
    [one] One item
   *[other] { $count } items
  }

login = Login
  .placeholder = email@example.com
  .aria-label = Login input
  .title = Type your { $name }
`;

test("perf: compile simple message", async () => {
	const bench = new Bench({ name: "compile simple message", time });

	bench.add("simple FTL (1 message)", () => {
		compile(simpleFtl, { locale: "en-CA" });
	});

	await bench.run();
	console.log(`\n${bench.name}`);
	console.table(bench.table());
});

test("perf: compile complex messages", async () => {
	const bench = new Bench({ name: "compile complex messages", time });

	bench.add("complex FTL (terms, functions, selectors, attributes)", () => {
		compile(complexFtl, { locale: "en-CA" });
	});

	await bench.run();
	console.log(`\n${bench.name}`);
	console.table(bench.table());
});

test("perf: compile full test fixture", async () => {
	const bench = new Bench({ name: "compile full test fixture", time });

	bench.add(`full fixture (${ftl.length} chars)`, () => {
		compile(ftl, { locale: "en-CA" });
	});

	await bench.run();
	console.log(`\n${bench.name}`);
	console.table(bench.table());
});

test("perf: compile with different options", async () => {
	const bench = new Bench({ name: "compile with options", time });

	bench.add("default options", () => {
		compile(ftl, { locale: "en-CA" });
	});

	bench.add("disableMinify:true", () => {
		compile(ftl, { locale: "en-CA", disableMinify: true });
	});

	bench.add("useIsolating:true", () => {
		compile(ftl, { locale: "en-CA", useIsolating: true });
	});

	bench.add("comments:false", () => {
		compile(ftl, { locale: "en-CA", comments: false });
	});

	bench.add("multiple locales", () => {
		compile(ftl, { locale: ["en-CA", "en", "fr-CA"] });
	});

	await bench.run();
	console.log(`\n${bench.name}`);
	console.table(bench.table());
});

// Generate a large FTL file for stress testing
const generateLargeFtl = (messageCount) => {
	const lines = [];
	for (let i = 0; i < messageCount; i++) {
		lines.push(
			`message-${i} = This is message number { $count } of ${messageCount}.`,
		);
	}
	return lines.join("\n");
};

test("perf: compile scaling", async () => {
	const bench = new Bench({ name: "compile scaling", time });

	for (const count of [10, 50, 100, 500]) {
		const largeFtl = generateLargeFtl(count);
		bench.add(`${count} messages`, () => {
			compile(largeFtl, { locale: "en-CA" });
		});
	}

	await bench.run();
	console.log(`\n${bench.name}`);
	console.table(bench.table());
});
