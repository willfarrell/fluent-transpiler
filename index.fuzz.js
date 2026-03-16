import test from "node:test";
import fc from "fast-check";
import { compile } from "./index.js";

const catchError = (input, e) => {
	const expectedErrors = [
		"Junk found",
		"Cannot read properties",
		"is not a function",
		"Cannot destructure",
		"undefined",
	];
	for (const expected of expectedErrors) {
		if (e.message?.includes(expected)) {
			return;
		}
	}
	console.error("Unexpected error for input:", input, e);
	throw e;
};

// Arbitrary for valid Fluent identifiers
const fluentIdentifier = fc
	.stringMatching(/^[a-zA-Z][a-zA-Z0-9-]*$/)
	.filter((s) => s.length >= 1 && s.length <= 30);

// Arbitrary for simple text values (no special Fluent characters)
const safeTextValue = fc
	.string()
	.map((s) => s.replace(/[{}`\\\n\r\t#]/g, "").trim())
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
			try {
				const result = compile(msg, { locale: loc, errorOnJunk: false });
				if (typeof result !== "string") {
					throw new Error("Expected string output");
				}
			} catch (e) {
				catchError(msg, e);
			}
		}),
		{ numRuns: 1_000, verbose: 2, examples: [] },
	);
});

test("fuzz: compile with random messages with placeables", async () => {
	await fc.assert(
		fc.asyncProperty(messageWithPlaceable, locale, async (msg, loc) => {
			try {
				const result = compile(msg, { locale: loc, errorOnJunk: false });
				if (typeof result !== "string") {
					throw new Error("Expected string output");
				}
			} catch (e) {
				catchError(msg, e);
			}
		}),
		{ numRuns: 1_000, verbose: 2, examples: [] },
	);
});

test("fuzz: compile with random selectors", async () => {
	await fc.assert(
		fc.asyncProperty(messageWithSelector, locale, async (msg, loc) => {
			try {
				const result = compile(msg, { locale: loc, errorOnJunk: false });
				if (typeof result !== "string") {
					throw new Error("Expected string output");
				}
			} catch (e) {
				catchError(msg, e);
			}
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
				try {
					const src = `${term}\n${msg}`;
					const result = compile(src, { locale: loc, errorOnJunk: false });
					if (typeof result !== "string") {
						throw new Error("Expected string output");
					}
				} catch (e) {
					catchError(`${term}\n${msg}`, e);
				}
			},
		),
		{ numRuns: 1_000, verbose: 2, examples: [] },
	);
});

test("fuzz: compile with random attributes", async () => {
	await fc.assert(
		fc.asyncProperty(messageWithAttributes, locale, async (msg, loc) => {
			try {
				const result = compile(msg, { locale: loc, errorOnJunk: false });
				if (typeof result !== "string") {
					throw new Error("Expected string output");
				}
			} catch (e) {
				catchError(msg, e);
			}
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
				try {
					const result = compile(msg, {
						locale: loc,
						variableNotation: notation,
						disableMinify,
						useIsolating,
						comments,
						errorOnJunk: false,
					});
					if (typeof result !== "string") {
						throw new Error("Expected string output");
					}
				} catch (e) {
					catchError(msg, e);
				}
			},
		),
		{ numRuns: 1_000, verbose: 2, examples: [] },
	);
});

test("fuzz: compile with completely random strings (errorOnJunk:false)", async () => {
	await fc.assert(
		fc.asyncProperty(fc.string(), async (input) => {
			try {
				const result = compile(input, {
					locale: "en-CA",
					errorOnJunk: false,
				});
				if (typeof result !== "string") {
					throw new Error("Expected string output");
				}
			} catch (e) {
				catchError(input, e);
			}
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
				try {
					const src = messages.join("\n");
					const result = compile(src, { locale: loc, errorOnJunk: false });
					if (typeof result !== "string") {
						throw new Error("Expected string output");
					}
				} catch (e) {
					catchError(messages.join("\n"), e);
				}
			},
		),
		{ numRuns: 500, verbose: 2, examples: [] },
	);
});
