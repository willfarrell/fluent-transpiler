import { bench, suite } from "node:bench";
import { readFile } from "node:fs/promises";
import { compile } from "./index.js";

const options = { warmup: 10, samples: 30 };

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

// Measure `ops` calls per sample
const run = (ops, fn) => (b) => {
	b.start();
	for (let i = 0; i < ops; i++) fn();
	b.end(ops);
};

suite("fluent-transpiler", () => {
	// compile simple message
	bench(
		"simple FTL (1 message)",
		options,
		run(10_000, () => compile(simpleFtl, { locale: "en-CA" })),
	);

	// compile complex messages
	bench(
		"complex FTL (terms, functions, selectors, attributes)",
		options,
		run(1_000, () => compile(complexFtl, { locale: "en-CA" })),
	);

	// compile full test fixture
	bench(
		`full fixture (${ftl.length} chars)`,
		options,
		run(100, () => compile(ftl, { locale: "en-CA" })),
	);

	// compile with options
	bench(
		"default options",
		options,
		run(100, () => compile(ftl, { locale: "en-CA" })),
	);
	bench(
		"disableMinify:true",
		options,
		run(100, () => compile(ftl, { locale: "en-CA", disableMinify: true })),
	);
	bench(
		"useIsolating:true",
		options,
		run(100, () => compile(ftl, { locale: "en-CA", useIsolating: true })),
	);
	bench(
		"comments:false",
		options,
		run(100, () => compile(ftl, { locale: "en-CA", comments: false })),
	);
	bench(
		"multiple locales",
		options,
		run(100, () => compile(ftl, { locale: ["en-CA", "en", "fr-CA"] })),
	);

	// compile scaling
	for (const count of [10, 50, 100, 500]) {
		const largeFtl = generateLargeFtl(count);
		bench(
			`${count} messages`,
			options,
			run(Math.max(10, 10_000 / count), () =>
				compile(largeFtl, { locale: "en-CA" }),
			),
		);
	}
});
