import { deepStrictEqual } from "node:assert";
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

// Substrings that only appear when a reference or a lookup resolved to
// something that is not a translation.
const hazards = ["[object Object]", "[native code]"];

// Every shape an export can take: a bare string, a {value, attributes} record,
// or a function returning either. Returns every string the export renders.
const renderStrings = (source, params) => {
	const result = typeof source === "function" ? source(params) : source;
	if (typeof result === "string") {
		return [result];
	}
	// a message with attributes but no value compiles to a null value
	if (result === null || result === undefined) {
		return [];
	}
	if (typeof result !== "object") {
		throw new Error(`Unexpected export shape "${typeof result}"`);
	}
	const strings = [];
	const attributes = Object.values(result.attributes ?? {});
	for (const value of [result.value, ...attributes]) {
		if (value === null || value === undefined) continue;
		if (typeof value !== "string") {
			throw new Error(`Unexpected rendered value "${typeof value}"`);
		}
		strings.push(value);
	}
	return strings;
};

const assertNoHazards = (src, id, strings) => {
	for (const rendered of strings) {
		for (const hazard of hazards) {
			// random inputs are allowed to contain the hazard as literal text
			if (rendered.includes(hazard) && !src.includes(hazard)) {
				throw new Error(`"${id}" rendered ${hazard}: ${rendered}`);
			}
		}
	}
};

// Compile the input, prove the generated module parses and evaluates, then
// render every export — loading a module never runs its message bodies.
const assertCompiles = async (src, opts, params = {}) => {
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
	let mod;
	try {
		mod = await import(`data:text/javascript,${encodeURIComponent(js)}`);
	} catch (e) {
		console.error("Generated module failed to load for input:", src, e);
		throw e;
	}
	try {
		for (const id of Object.keys(mod)) {
			if (id === "default") continue;
			assertNoHazards(src, id, renderStrings(mod[id], params));
			assertNoHazards(src, id, renderStrings(mod.default(id, params), params));
		}
	} catch (e) {
		console.error("Generated module failed to render for input:", src, e);
		throw e;
	}
	return mod;
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

// Text fragments that are inert in FTL but hazardous once they land inside the
// generated template literal
const hazardFragment = fc.constantFrom(
	"`",
	"\\",
	"\\`",
	"${",
	"$",
	"$$",
	"{",
	"}",
	"\\${",
	"\\u0041",
	'"',
	"'",
	"é",
	"中",
	"😀",
	"\u2028", // a line terminator to JavaScript, plain text to Fluent
	"\u00a0",
	"\u200b",
);

// Text carrying those hazards. `{`/`}` cannot appear literally in FTL text, and
// a string literal placeable is the only escape hatch — so the FTL form and the
// form it is expected to render travel together.
const hazardText = fc
	.array(fc.oneof(hazardFragment, fc.string()), {
		minLength: 1,
		maxLength: 8,
	})
	.map((parts) => {
		const expected = parts
			.join("")
			.replace(/[\n\r]/g, "")
			.trim();
		return {
			expected,
			// one pass: a second would escape the braces the first just added
			ftl: expected.replace(/[{}]/g, (brace) => `{"${brace}"}`),
		};
	})
	.filter(({ expected }) => expected.length > 0);

// Property keys that resolve up Object.prototype: a lookup that reaches them
// hands back an inherited function or object instead of a translation.
const hostileKeys = [
	"__proto__",
	"constructor",
	"toString",
	"toLocaleString",
	"valueOf",
	"hasOwnProperty",
	"isPrototypeOf",
	"propertyIsEnumerable",
	"prototype",
];
const hostileKey = fc.constantFrom(...hostileKeys);

// Fluent variables are strings, numbers, and dates; objects are left out
// because a term pattern interpolates them raw and `[object Object]` would then
// be the caller's doing, not the compiler's.
const paramValue = fc.oneof(
	safeTextValue,
	fc.integer(),
	fc.double({ noDefaultInfinity: true, noNaN: true }),
	fc.boolean(),
	fc.constant(null),
	fc.constant(undefined),
);

const fuzzParams = fc.dictionary(
	fc.oneof(fluentIdentifier, hostileKey),
	paramValue,
	{ maxKeys: 6 },
);

// Values a caller may hand a selector, including the ones that used to resolve
// off Object.prototype
const selectorValue = fc.oneof(
	hostileKey,
	fc.constantFrom("zero", "one", "two", "few", "many", "other"),
	safeTextValue,
	fc.integer({ min: -5, max: 100 }),
	fc.boolean(),
	fc.constant(null),
	fc.constant(undefined),
);

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

// Arbitrary for messages with a select expression, carrying the declared
// variant values alongside so a caller can check what came back
const messageWithVariants = fc
	.tuple(
		fluentIdentifier.filter((id) => !hostileKeys.includes(id)),
		fluentIdentifier,
		fc.uniqueArray(
			fc.tuple(
				fc.constantFrom("zero", "one", "two", "few", "many"),
				safeTextValue,
			),
			{ minLength: 1, maxLength: 4, selector: ([key]) => key },
		),
		safeTextValue,
	)
	.map(([id, varName, variants, otherValue]) => ({
		id,
		varName,
		values: [...variants.map(([, value]) => value), otherValue],
		src: `${id} =
  { $${varName} ->
${variants.map(([key, value]) => `    [${key}] ${value}`).join("\n")}
   *[other] ${otherValue}
  }`,
	}));

// Arbitrary for a program touching every construct whose compiled shape depends
// on disableMinify: paramless and parameterised terms, message and attribute
// references, attributes, and selectors. Ids are fixed so the notation
// transform cannot merge two of them into a duplicate identifier.
const compoundProgram = fc
	.tuple(
		fc.array(safeTextValue, { minLength: 8, maxLength: 8 }),
		fluentIdentifier,
	)
	.map(([values, varName]) => ({
		varName,
		ids: [
			"plain",
			"termRef",
			"termCallRef",
			"varRef",
			"attributed",
			"messageRef",
			"picker",
		],
		src: `-brand = ${values[0]}
-owner = ${values[1]} { $${varName} }
plain = ${values[2]}
termRef = { -brand } ${values[3]}
termCallRef = { -owner(${varName}: "fuzz") }
varRef = { $${varName} }
attributed = ${values[4]}
  .label = ${values[5]}
messageRef = { plain } { attributed } { attributed.label }
picker =
  { $${varName} ->
    [one] ${values[6]}
   *[other] ${values[7]}
  }`,
	}));

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
		{
			numRuns: 1_000,
			verbose: 2,
			// a reserved word as an attribute name once compiled to a key the
			// reference could not reach; too rare to hit reliably at random
			examples: [
				["msg = v\n  .default = attr\nref = { msg.default }", "en-CA"],
			],
		},
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
			fuzzParams,
			async (messages, loc, params) => {
				await assertCompiles(messages.join("\n"), { locale: loc }, params);
			},
		),
		{ numRuns: 500, verbose: 2, examples: [] },
	);
});

test("fuzz: render with random params", async () => {
	await fc.assert(
		fc.asyncProperty(
			fc.array(
				fc.oneof(
					simpleMessage,
					messageWithPlaceable,
					messageWithSelector,
					messageWithAttributes,
				),
				{ minLength: 1, maxLength: 6 },
			),
			locale,
			fuzzParams,
			async (messages, loc, params) => {
				await assertCompiles(messages.join("\n"), { locale: loc }, params);
			},
		),
		{ numRuns: 500, verbose: 2, examples: [] },
	);
});

test("fuzz: render with hostile selector values and lookup ids", async () => {
	await fc.assert(
		fc.asyncProperty(
			messageWithVariants,
			selectorValue,
			locale,
			async ({ id, varName, values, src }, selector, loc) => {
				const params = { [varName]: selector };
				const mod = await assertCompiles(src, { locale: loc }, params);
				// a selector that matches nothing takes the default variant; it must
				// never reach a name inherited from Object.prototype
				const rendered = mod.default(id, params);
				if (!values.includes(rendered)) {
					throw new Error(
						`selector ${JSON.stringify(selector)} rendered ${JSON.stringify(
							rendered,
						)}, expected one of ${JSON.stringify(values)}`,
					);
				}
				// an id that was never declared is unknown, however familiar it looks
				for (const key of hostileKeys) {
					const lookup = mod.default(key, params);
					if (lookup !== `*** ${key} ***`) {
						throw new Error(
							`lookup of "${key}" returned ${JSON.stringify(lookup)}`,
						);
					}
				}
			},
		),
		{ numRuns: 500, verbose: 2, examples: [] },
	);
});

test("fuzz: hazardous text renders back exactly as written", async () => {
	await fc.assert(
		fc.asyncProperty(
			fluentIdentifier.filter((id) => !hostileKeys.includes(id)),
			fluentIdentifier,
			fluentIdentifier,
			hazardText,
			hazardText,
			safeTextValue,
			locale,
			async (id, varName, attrName, value, attrValue, variable, loc) => {
				const src = `${id} = ${value.ftl} { $${varName} } ${value.ftl}
  .${attrName} = ${attrValue.ftl}`;
				const params = { [varName]: variable };
				const mod = await assertCompiles(src, { locale: loc }, params);
				const rendered = mod.default(id, params);
				// what goes into the FTL text is what comes out of the message, no
				// matter how it reads to a template literal
				deepStrictEqual(
					rendered.value,
					`${value.expected} ${variable} ${value.expected}`,
				);
				deepStrictEqual(rendered.attributes[attrName], attrValue.expected);
			},
		),
		{ numRuns: 500, verbose: 2, examples: [] },
	);
});

test("fuzz: disableMinify renders the same values as the minified module", async () => {
	await fc.assert(
		fc.asyncProperty(
			compoundProgram,
			locale,
			fuzzParams,
			paramValue,
			async ({ ids, varName, src }, loc, extra, value) => {
				const params = { ...extra, [varName]: value };
				const [minified, expanded] = await Promise.all([
					assertCompiles(src, { locale: loc, disableMinify: false }, params),
					assertCompiles(src, { locale: loc, disableMinify: true }, params),
				]);
				// disableMinify only changes the shape an export arrives in, never
				// the strings it renders
				for (const id of ids) {
					deepStrictEqual(
						renderStrings(expanded.default(id, params), params),
						renderStrings(minified.default(id, params), params),
						`"${id}" renders differently under disableMinify`,
					);
				}
			},
		),
		{ numRuns: 300, verbose: 2, examples: [] },
	);
});
