import test from "node:test";
import fc from "fast-check";
import { compile } from "./index.js";

// Errors compile() throws on purpose; anything else is a bug.
const expectedErrors = [
	"Duplicate identifier",
	"Unknown reference",
	"Unknown function",
];

const catchError = (input, e) => {
	for (const expected of expectedErrors) {
		if (e.message?.includes(expected)) {
			return;
		}
	}
	console.error("Unexpected error for input:", input, e);
	throw e;
};

// Compile the input and prove the generated module parses and evaluates.
const assertCompiles = async (src, opts) => {
	let js;
	try {
		js = compile(src, { errorOnJunk: false, ...opts });
	} catch (e) {
		catchError(src, e);
		return;
	}
	if (typeof js !== "string") {
		throw new Error("Expected string output");
	}
	try {
		await import(`data:text/javascript,${encodeURIComponent(js)}`);
	} catch (e) {
		console.error("Generated module failed to load for input:", src, e);
		throw e;
	}
};

// Arbitrary for valid Fluent identifiers
const fluentIdentifier = fc
	.stringMatching(/^[a-zA-Z][a-zA-Z0-9-]*$/)
	.filter((s) => s.length >= 1 && s.length <= 30);

// Arbitrary for text values without Fluent syntax characters; backslashes,
// backticks, and quotes stay in to exercise output escaping
const safeTextValue = fc
	.string()
	.map((s) => s.replace(/[{}\n\r]/g, "").trim())
	.filter((s) => s.length > 0);

// Arbitrary for valid simple Fluent messages
const simpleMessage = fc
	.tuple(fluentIdentifier, safeTextValue)
	.map(([id, value]) => `${id} = ${value}`);

// Arbitrary for messages with placeables
const messageWithPlaceable = fc
	.tuple(fluentIdentifier, safeTextValue, fluentIdentifier)
	.map(([id, prefix, varName]) => `${id} = ${prefix} { $${varName} }`);

// Arbitrary for messages with selectors
const messageWithSelector = fc
	.tuple(fluentIdentifier, fluentIdentifier, safeTextValue, safeTextValue)
	.map(
		([id, varName, oneVal, otherVal]) => `${id} =
  { $${varName} ->
    [one] ${oneVal}
   *[other] ${otherVal}
  }`,
	);

// Arbitrary for terms
const simpleTerm = fc
	.tuple(fluentIdentifier, safeTextValue)
	.map(([id, value]) => `-${id} = ${value}`);

// Arbitrary for messages with attributes
const messageWithAttributes = fc
	.tuple(fluentIdentifier, safeTextValue, fluentIdentifier, safeTextValue)
	.map(
		([id, value, attrName, attrValue]) =>
			`${id} = ${value}\n  .${attrName} = ${attrValue}`,
	);

// Arbitrary for variable notation
const variableNotation = fc.constantFrom(
	"camelCase",
	"pascalCase",
	"snakeCase",
	"constantCase",
);

// Arbitrary for locale strings
const locale = fc.constantFrom(
	"en-CA",
	"en-US",
	"en",
	"fr-CA",
	"fr",
	"de",
	"ja",
	"zh-CN",
	"ar",
	"he",
);

test("fuzz: compile with random simple messages", async () => {
	await fc.assert(
		fc.asyncProperty(simpleMessage, locale, async (msg, loc) => {
			await assertCompiles(msg, { locale: loc });
		}),
		{ numRuns: 1_000, verbose: 2, examples: [] },
	);
});

test("fuzz: compile with random messages with placeables", async () => {
	await fc.assert(
		fc.asyncProperty(messageWithPlaceable, locale, async (msg, loc) => {
			await assertCompiles(msg, { locale: loc });
		}),
		{ numRuns: 1_000, verbose: 2, examples: [] },
	);
});

test("fuzz: compile with random selectors", async () => {
	await fc.assert(
		fc.asyncProperty(messageWithSelector, locale, async (msg, loc) => {
			await assertCompiles(msg, { locale: loc });
		}),
		{ numRuns: 1_000, verbose: 2, examples: [] },
	);
});

test("fuzz: compile with random terms", async () => {
	await fc.assert(
		fc.asyncProperty(
			simpleTerm,
			simpleMessage,
			locale,
			async (term, msg, loc) => {
				await assertCompiles(`${term}\n${msg}`, { locale: loc });
			},
		),
		{ numRuns: 1_000, verbose: 2, examples: [] },
	);
});

test("fuzz: compile with random attributes", async () => {
	await fc.assert(
		fc.asyncProperty(messageWithAttributes, locale, async (msg, loc) => {
			await assertCompiles(msg, { locale: loc });
		}),
		{ numRuns: 1_000, verbose: 2, examples: [] },
	);
});

test("fuzz: compile with random options", async () => {
	await fc.assert(
		fc.asyncProperty(
			simpleMessage,
			locale,
			variableNotation,
			fc.boolean(),
			fc.boolean(),
			fc.boolean(),
			async (msg, loc, notation, disableMinify, useIsolating, comments) => {
				await assertCompiles(msg, {
					locale: loc,
					variableNotation: notation,
					disableMinify,
					useIsolating,
					comments,
				});
			},
		),
		{ numRuns: 1_000, verbose: 2, examples: [] },
	);
});

test("fuzz: compile with completely random strings (errorOnJunk:false)", async () => {
	await fc.assert(
		fc.asyncProperty(fc.string(), async (input) => {
			await assertCompiles(input, { locale: "en-CA" });
		}),
		{ numRuns: 1_000, verbose: 2, examples: [] },
	);
});

test("fuzz: compile with multiple messages combined", async () => {
	await fc.assert(
		fc.asyncProperty(
			fc.array(simpleMessage, { minLength: 1, maxLength: 20 }),
			locale,
			async (messages, loc) => {
				await assertCompiles(messages.join("\n"), { locale: loc });
			},
		),
		{ numRuns: 500, verbose: 2, examples: [] },
	);
});
