import { deepStrictEqual, ok, rejects, strictEqual, throws } from "node:assert";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FluentBundle, FluentResource } from "@fluent/bundle";
import { compile, compileFiles } from "./index.js";

// input
const ftl = await readFile("./test/files/index.ftl", { encoding: "utf8" });

// helper: compile and dynamically import
const compileAndImport = async (src, opts) => {
	const dir = await mkdtemp(join(tmpdir(), "ftl-test-"));
	const filePath = join(dir, "output.mjs");
	const js = compile(src, opts);
	await writeFile(filePath, js, "utf8");
	const mod = await import(filePath);
	await rm(dir, { recursive: true });
	return mod;
};

// helper: bundle reference
const createBundleHelper = (locale, src) => {
	const bundle = new FluentBundle(locale, { useIsolating: false });
	const errors = bundle.addResource(new FluentResource(src));
	if (errors.length) {
		throw new Error(`bundle.addResource errors: ${errors.join(", ")}`);
	}
	return (id, params) => {
		const message = bundle.getMessage(id);
		if (!message) return "error";
		const attributes = {};
		for (const attr in message.attributes) {
			attributes[attr] = bundle.formatPattern(message.attributes[attr], params);
		}
		const value = bundle.formatPattern(message.value, params);
		if (Object.keys(message.attributes).length) {
			return { value, attributes };
		}
		return value;
	};
};

// === Integration: compile fixture matches reference ===

test("Should produce output matching reference file", async () => {
	const expected = await readFile("./test/files/index.mjs", {
		encoding: "utf8",
	});
	const js = compile(ftl, { locale: "en-CA", useIsolating: false });
	deepStrictEqual(
		js,
		expected,
		"Compiled output should match test/files/index.mjs",
	);
});

// === Multi-file joining ===

test("Should join an array of sources into one module", () => {
	const js = compile(["-brand = Firefox\n", "hello = Hi { -brand }\n"], {
		locale: "en-CA",
	});
	ok(js.includes("const brand = `Firefox`"));
	ok(js.includes("export const hello = `Hi ") && js.includes("brand}`"));
});

test("Should let later sources reference earlier sources", async () => {
	const mod = await compileAndImport(
		[
			"-product = Firefox\ncommon-hello = Hello from common.\n",
			"brand-tagline = Welcome to { -product }!\n",
			"app-greeting = { brand-tagline } Hello, { $name }.\n",
		],
		{ locale: "en-CA", useIsolating: false },
	);
	strictEqual(
		mod.default("app-greeting", { name: "world" }),
		"Welcome to Firefox! Hello, world.",
	);
});

test("Should throw on duplicate ids across joined sources", () => {
	throws(
		() =>
			compile(["greeting = Hi from A.\n", "greeting = Hi from B.\n"], {
				locale: "en-CA",
			}),
		{ message: /Duplicate id\(s\) found:[\s\S]*"greeting"/ },
	);
});

test("Should compile multiple files with compileFiles", async () => {
	const js = await compileFiles(
		[
			"./test/files/joined/common.ftl",
			"./test/files/joined/brand.ftl",
			"./test/files/joined/app.ftl",
		],
		{ locale: "en-CA", useIsolating: false },
	);
	ok(js.includes("export const appGreeting"));
	ok(js.includes("export const brandTagline"));
	ok(js.includes("export const commonHello"));
});

test("Should surface file paths in compileFiles duplicate errors", async () => {
	await rejects(
		() =>
			compileFiles(
				["./test/files/joined/dup-a.ftl", "./test/files/joined/dup-b.ftl"],
				{ locale: "en-CA" },
			),
		{
			message:
				/Duplicate id\(s\) found:[\s\S]*"greeting"[\s\S]*dup-a\.ftl[\s\S]*dup-b\.ftl/,
		},
	);
});

// === Error handling ===

test("Should throw error when Junk is parsed with errorOnJunk:true", () => {
	throws(
		() => compile("-brand-name = {}", { locale: "en-CA", errorOnJunk: true }),
		{ message: "Junk found" },
	);
});

test("Should not throw when Junk is parsed with errorOnJunk:false", () => {
	const js = compile("-brand-name = {}", {
		locale: "en-CA",
		errorOnJunk: false,
	});
	ok(typeof js === "string");
});

test("Should throw on unknown AST type", () => {
	// Force an error by passing invalid src that produces an unknown type
	throws(() =>
		compile("valid = { $x }", { locale: "en-CA", variableNotation: "invalid" }),
	);
});

// === Comments ===

test("Should include comments when comments:true", () => {
	const js = compile(
		`
# Comment
## GroupComment
### ResourceComment
`,
		{ locale: "en-CA", comments: true },
	);
	ok(js.includes("// # Comment"));
	ok(js.includes("// ## GroupComment"));
	ok(js.includes("// ### ResourceComment"));
});

test("Should exclude comments when comments:false", () => {
	const js = compile(
		`
# Comment
## GroupComment
### ResourceComment
`,
		{ locale: "en-CA", comments: false },
	);
	ok(!js.includes("// # Comment"));
	ok(!js.includes("// ## GroupComment"));
	ok(!js.includes("// ### ResourceComment"));
});

// === includeKey ===

test("Should only include specified keys with includeKey", () => {
	const js = compile(
		`
msg-one = Hello
msg-two = World
msg-three = Foo
`,
		{ locale: "en-CA", includeKey: ["msgOne"] },
	);
	ok(js.includes("export const msgOne"));
	ok(!js.includes("export const msgTwo"));
	ok(!js.includes("export const msgThree"));
});

test("Should handle includeKey as a single string", () => {
	const js = compile(
		`
msg-one = Hello
msg-two = World
`,
		{ locale: "en-CA", includeKey: "msgOne" },
	);
	ok(js.includes("export const msgOne"));
	ok(!js.includes("export const msgTwo"));
});

// === excludeKey ===

test("Should exclude specified keys with excludeKey", () => {
	const js = compile(
		`
msg-one = Hello
msg-two = World
msg-three = Foo
`,
		{ locale: "en-CA", excludeKey: ["msgTwo"] },
	);
	ok(js.includes("export const msgOne"));
	ok(!js.includes("export const msgTwo"));
	ok(js.includes("export const msgThree"));
});

test("Should handle excludeKey as a single string", () => {
	const js = compile(
		`
msg-one = Hello
msg-two = World
`,
		{ locale: "en-CA", excludeKey: "msgTwo" },
	);
	ok(js.includes("export const msgOne"));
	ok(!js.includes("export const msgTwo"));
});

// === excludeValue ===

test("Should replace messages matching excludeValue with empty string", () => {
	const js = compile(
		`
msg-one = PLACEHOLDER
msg-two = Real value
`,
		{ locale: "en-CA", excludeValue: "PLACEHOLDER" },
	);
	ok(js.includes("export const msgOne = ``"));
	ok(js.includes("export const msgTwo = `Real value`"));
});

// === disableMinify ===

test("Should use consistent interface when disableMinify:true", () => {
	const js = compile(
		`
simple = Hello
with-param = Hello { $name }
`,
		{ locale: "en-CA", disableMinify: true },
	);
	// Both should use arrow function with ({value, attributes}) pattern
	ok(js.includes("export const simple = () => ({"));
	ok(js.includes("export const withParam = (params) => ({"));
});

test("Should use minified output when disableMinify:false (default)", () => {
	const js = compile(
		`
simple = Hello
with-param = Hello { $name }
`,
		{ locale: "en-CA", disableMinify: false },
	);
	// simple should be just a template literal, not an arrow function
	ok(js.includes("export const simple = `Hello`"));
	ok(js.includes("export const withParam = (params) =>"));
});

// === useIsolating ===

test("Should wrap placeables with Unicode isolating chars when useIsolating:true", () => {
	const js = compile("msg = Hello { $name }", {
		locale: "en-CA",
		useIsolating: true,
	});
	ok(js.includes("\u2068"));
	ok(js.includes("\u2069"));
});

test("Should not wrap placeables with Unicode isolating chars when useIsolating:false", () => {
	const js = compile("msg = Hello { $name }", {
		locale: "en-CA",
		useIsolating: false,
	});
	ok(!js.includes("\u2068"));
	ok(!js.includes("\u2069"));
});

// === variableNotation ===

test("Should use camelCase notation by default", () => {
	const js = compile("my-message = Hello", { locale: "en-CA" });
	ok(js.includes("export const myMessage"));
});

test("Should use pascalCase notation", () => {
	const js = compile("my-message = Hello", {
		locale: "en-CA",
		variableNotation: "pascalCase",
	});
	ok(js.includes("export const MyMessage"));
});

test("Should use snakeCase notation", () => {
	const js = compile("my-message = Hello", {
		locale: "en-CA",
		variableNotation: "snakeCase",
	});
	ok(js.includes("export const my_message"));
});

test("Should use constantCase notation", () => {
	const js = compile("my-message = Hello", {
		locale: "en-CA",
		variableNotation: "constantCase",
	});
	ok(js.includes("export const MY_MESSAGE"));
});

// === Reserved words ===

test("Should prefix reserved words with underscore", () => {
	// Full reserved-word set: every entry must be prefixed so the generated
	// `const`/`export const` declarations remain valid JavaScript.
	for (const word of [
		"abstract",
		"arguments",
		"await",
		"boolean",
		"break",
		"byte",
		"case",
		"catch",
		"char",
		"class",
		"const",
		"continue",
		"debugger",
		"default",
		"delete",
		"do",
		"double",
		"else",
		"enum",
		"eval",
		"export",
		"extends",
		"false",
		"final",
		"finally",
		"float",
		"for",
		"function",
		"goto",
		"if",
		"implements",
		"import",
		"in",
		"instanceof",
		"int",
		"interface",
		"let",
		"long",
		"native",
		"new",
		"null",
		"of",
		"package",
		"private",
		"protected",
		"public",
		"return",
		"short",
		"static",
		"super",
		"switch",
		"synchronized",
		"this",
		"throw",
		"throws",
		"transient",
		"true",
		"try",
		"typeof",
		"undefined",
		"var",
		"void",
		"volatile",
		"while",
		"with",
		"yield",
	]) {
		const js = compile(`${word} = value`, { locale: "en-CA" });
		ok(
			js.includes(`export const _${word}`),
			`Should prefix "${word}" with underscore`,
		);
	}
});

// === Tab replacement ===

test("Should replace tabs with spaces", () => {
	const js = compile("msg = Hello\tworld", { locale: "en-CA" });
	ok(js.includes("Hello    world"));
	ok(!js.includes("\t"));
});

// === Backtick escaping ===

test("Should escape backticks in text", () => {
	const js = compile("msg = Hello `world`", { locale: "en-CA" });
	ok(js.includes("\\`world\\`"));
});

// === locale handling ===

test("Should handle locale as a string (auto-wraps to array)", () => {
	const js = compile("msg = Hello { $name }", { locale: "en-CA" });
	ok(js.includes('["en-CA"]'));
});

test("Should handle locale as an array", () => {
	const js = compile("msg = Hello { $name }", { locale: ["en-CA", "en"] });
	ok(js.includes('["en-CA","en"]'));
});

// === Text elements ===

test("Should handle single quotes in text", () => {
	const js = compile("msg = quote: 'hard' coded.", { locale: "en-CA" });
	ok(js.includes("'hard'"));
});

test("Should handle double quotes in text", () => {
	const js = compile('msg = quote: "hard" coded.', { locale: "en-CA" });
	ok(js.includes('"hard"'));
});

// === StringLiteral ===

test("Should handle StringLiteral in placeables", () => {
	const js = compile('msg = Opening brace: {"{"}.', { locale: "en-CA" });
	ok(js.includes('{"{"}'));
});

// === NumberLiteral ===

test("Should format integer NumberLiteral", () => {
	const js = compile(
		`msg =
  { 42 ->
    [one] One
   *[other] Other
  }`,
		{ locale: "en-CA" },
	);
	ok(typeof js === "string");
});

test("Should format decimal NumberLiteral", () => {
	const js = compile(
		`msg =
  { 3.14 ->
    [one] One
   *[other] Other
  }`,
		{ locale: "en-CA" },
	);
	ok(js.includes("3.14"));
});

// === Multiple locales in output ===

test("Should generate __locales when functions are used", () => {
	const js = compile("msg = { $name }", { locale: ["en-CA", "fr-CA"] });
	ok(js.includes('const __locales = ["en-CA","fr-CA"]'));
});

// === DATETIME function ===

test("Should generate __formatDateTime helper", () => {
	const js = compile("msg = { DATETIME($date) }", { locale: "en-CA" });
	ok(js.includes("const __formatDateTime"));
	ok(js.includes("__formatDateTime(params?.date"));
});

// === NUMBER function ===

test("Should generate __formatNumber helper", () => {
	const js = compile("msg = { NUMBER($num, maximumFractionDigits: 2) }", {
		locale: "en-CA",
	});
	ok(js.includes("__formatNumber(params?.num"));
});

// === RELATIVETIME function ===

test("Should generate __formatRelativeTime helper", () => {
	const js = compile("msg = { RELATIVETIME($date) }", { locale: "en-CA" });
	ok(js.includes("const __formatRelativeTime"));
	ok(js.includes("const __relativeTimeDiff"));
	ok(js.includes("__formatRelativeTime(params?.date"));
});

// === SelectExpression ===

test("Should generate __select helper for selectors", () => {
	const js = compile(
		`msg =
  { $count ->
    [one] One item
   *[other] Many items
  }`,
		{ locale: "en-CA" },
	);
	ok(js.includes("const __select"));
	ok(js.includes("__select("));
});

// === Terms ===

test("Should compile terms as const (not exported)", () => {
	const js = compile(
		`-brand = Firefox
msg = Welcome to { -brand }`,
		{ locale: "en-CA" },
	);
	ok(js.includes("const brand = `Firefox`"));
	ok(!js.includes("export const brand"));
	ok(js.includes("export const msg"));
});

test("Should compile terms with params as arrow functions", () => {
	const js = compile(
		`-brand =
    { $case ->
        *[nominative] Firefox
        [locative] Firefoksie
    }
msg = Welcome to { -brand(case: "locative") }`,
		{ locale: "en-CA" },
	);
	ok(js.includes("const brand = (params) =>"));
});

// === MessageReference ===

test("Should reference other messages", () => {
	const js = compile(
		`base = Hello
ref = { base } World`,
		{ locale: "en-CA" },
	);
	// biome-ignore lint/suspicious/noTemplateCurlyInString: testing literal output
	ok(js.includes("${base}"));
});

test("Should propagate params through message references", () => {
	const js = compile(
		`base = Hello { $name }
ref = { base } World`,
		{ locale: "en-CA" },
	);
	ok(js.includes("base(params)"));
});

// === Attributes ===

test("Should compile messages with attributes", () => {
	const js = compile(
		`login = Login
  .placeholder = Enter email
  .aria-label = Login form`,
		{ locale: "en-CA" },
	);
	ok(js.includes("value:"));
	ok(js.includes("attributes:"));
	ok(js.includes("placeholder:"));
	ok(js.includes("'aria-label':"));
});

test("Should compile attributes with params", () => {
	const js = compile(
		`login = Login
  .title = Hello { $name }`,
		{ locale: "en-CA" },
	);
	ok(js.includes("(params) => ({"));
});

test("Should compile attributes without params as object literal", () => {
	const js = compile(
		`login = Login
  .placeholder = Enter email`,
		{ locale: "en-CA" },
	);
	ok(js.includes("value: `Login`"));
});

// === Multiline text ===

test("Should handle multiline text", () => {
	const js = compile(
		`msg =
  Line one
  Line two
  Line three`,
		{ locale: "en-CA" },
	);
	ok(js.includes("Line one"));
	ok(js.includes("Line two"));
	ok(js.includes("Line three"));
});

// === Default export ===

test("Should include default export function", () => {
	const js = compile("msg = Hello", { locale: "en-CA" });
	ok(js.includes("export default"));
	ok(js.includes("__exports"));
});

test("Should allow custom exportDefault", () => {
	const js = compile("msg = Hello", {
		locale: "en-CA",
		exportDefault: "(id) => __exports[id]\n",
	});
	ok(js.includes("export default (id) => __exports[id]"));
});

// === Identifier with dashes (quoted keys) ===

test("Should quote identifiers with dashes in exports map", () => {
	const js = compile("my-message = Hello", { locale: "en-CA" });
	ok(js.includes("'my-message': myMessage"));
});

// === VariableReference in different parent contexts ===

test("Should wrap VariableReference in __formatVariable for Message parent", () => {
	const js = compile("msg = Hello { $name }", { locale: "en-CA" });
	ok(js.includes("__formatVariable(params?.name)"));
});

test("Should not wrap VariableReference for non-Message parents (e.g. selector)", () => {
	const js = compile(
		`msg =
  { $count ->
    [one] One
   *[other] Other
  }`,
		{ locale: "en-CA" },
	);
	// The selector value should be raw, not wrapped
	ok(js.includes("params?.count"));
});

// === Comparison with @fluent/bundle ===

test("Should produce output matching @fluent/bundle", async () => {
	const js = compile(ftl, {
		locale: "en-CA",
		variableNotation: "camelCase",
		useIsolating: false,
	});
	// Extract the message IDs from __exports mapping
	const exportMatch = js.match(/const __exports = \{([^}]+)\}/);
	ok(exportMatch, "Should have __exports");

	const mod = await compileAndImport(ftl, {
		locale: "en-CA",
		variableNotation: "camelCase",
		useIsolating: false,
	});
	const fluentCompiled = mod.default;
	const fluentBundle = createBundleHelper("en-CA", ftl);

	const params = {
		string: "0.0",
		integer: -2,
		decimal: 3.5,
		number: 9999999.0,
		date: new Date(),
	};

	// Extract original FTL message IDs from the __exports block
	const ids = exportMatch[1]
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean)
		.map((s) => {
			// 'parameterized-terms': parameterizedTerms -> parameterized-terms
			const quoted = s.match(/^'([^']+)'/);
			if (quoted) return quoted[1];
			// text -> text (identifier matches FTL id)
			return s.split(":")[0].trim();
		});

	// termWithVariable: transpiler correctly propagates params through terms,
	// while @fluent/bundle does not pass external params to terms by design
	const skipIds = new Set(["termWithVariable"]);

	for (const id of ids) {
		if (skipIds.has(id)) continue;
		deepStrictEqual(
			fluentCompiled(id, params),
			fluentBundle(id, params),
			`Mismatch for message "${id}"`,
		);
	}
});

// === Selector comparison with @fluent/bundle ===

test("Should match @fluent/bundle for cardinal selectors", async () => {
	const mod = await compileAndImport(ftl, {
		locale: "en-CA",
		variableNotation: "camelCase",
		useIsolating: false,
	});
	const fluentCompiled = mod.default;
	const fluentBundle = createBundleHelper("en-CA", ftl);

	for (const param of [-1, 0, 1, 2, 3, 4, 5, 10]) {
		const params = {
			string: "0.0",
			integer: -2,
			decimal: 3.5,
			number: param,
			date: new Date(),
		};
		deepStrictEqual(
			fluentCompiled("selectorNumberCardinal", params),
			fluentBundle("selectorNumberCardinal", params),
			`Cardinal mismatch for number=${param}`,
		);
	}
});

test("Should match @fluent/bundle for ordinal selectors", async () => {
	const mod = await compileAndImport(ftl, {
		locale: "en-CA",
		variableNotation: "camelCase",
		useIsolating: false,
	});
	const fluentCompiled = mod.default;
	const fluentBundle = createBundleHelper("en-CA", ftl);

	for (const param of [-1, 0, 1, 2, 3, 4, 5, 10]) {
		const params = {
			string: "0.0",
			integer: -2,
			decimal: 3.5,
			number: param,
			date: new Date(),
		};
		deepStrictEqual(
			fluentCompiled("selectorNumberOrdinal", params),
			fluentBundle("selectorNumberOrdinal", params),
			`Ordinal mismatch for number=${param}`,
		);
	}
});

// === disableMinify with attributes ===

test("Should use consistent interface for attributes when disableMinify:true", () => {
	const js = compile(
		`login = Login
  .placeholder = Enter email`,
		{ locale: "en-CA", disableMinify: true },
	);
	ok(js.includes("() => ({"));
	ok(js.includes("value:"));
	ok(js.includes("attributes:"));
});

test("Should emit an empty object for attributes-less messages when disableMinify:true", () => {
	const js = compile("msg = Hello", { locale: "en-CA", disableMinify: true });
	ok(
		js.includes("attributes:{}"),
		"a message with no attributes should render attributes as {}",
	);
	ok(!js.includes("[object Object]"), "should not stringify a JS object");
});

test("Should use consistent interface for attributes with params when disableMinify:true", () => {
	const js = compile(
		`login = Login { $name }
  .placeholder = Enter email`,
		{ locale: "en-CA", disableMinify: true },
	);
	ok(js.includes("(params) => ({"));
});

// === MessageReference with disableMinify ===

test("Should use consistent interface for message references when disableMinify:true", () => {
	const js = compile(
		`base = Hello
ref = { base } World`,
		{ locale: "en-CA", disableMinify: true },
	);
	ok(js.includes("base()"));
});

test("Should pass params through message reference when disableMinify:true", () => {
	const js = compile(
		`base = Hello { $name }
ref = { base } World`,
		{ locale: "en-CA", disableMinify: true },
	);
	ok(js.includes("base(params)"));
});

// === TermReference with disableMinify ===

test("Should use consistent interface for term references when disableMinify:true", () => {
	const js = compile(
		`-brand = Firefox
msg = Welcome to { -brand }`,
		{ locale: "en-CA", disableMinify: true },
	);
	ok(js.includes("brand"));
});

// === Term with params and disableMinify ===

test("Should pass params through term reference when disableMinify:true", () => {
	const js = compile(
		`-brand =
    { $case ->
        *[nominative] Firefox
        [locative] Firefoksie
    }
msg = Welcome to { -brand(case: "locative") }`,
		{ locale: "en-CA", disableMinify: true },
	);
	ok(js.includes("brand("));
});

// === Empty FTL ===

test("Should handle empty FTL input", () => {
	const js = compile("", { locale: "en-CA" });
	ok(js.includes("__exports"));
	ok(js.includes("export default"));
});

// === Messages with value-only (no attributes) ===

test("Should handle message with no value (attributes only)", () => {
	const js = compile(
		`msg =
  .placeholder = Enter email`,
		{ locale: "en-CA" },
	);
	ok(js.includes("export const msg"));
});

// === VariableReference in Variant ===

test("Should wrap VariableReference in __formatVariable for Variant parent", () => {
	const js = compile(
		`msg =
  { $count ->
    [one] There is { $count } item
   *[other] There are { $count } items
  }`,
		{ locale: "en-CA" },
	);
	// Inside variant value, variable should be formatted
	ok(js.includes("__formatVariable(params?.count)"));
});

// === TermReference without params ===

test("Should handle term reference without params (minified)", () => {
	const js = compile(
		`-brand = Firefox
msg = { -brand } browser`,
		{ locale: "en-CA" },
	);
	// biome-ignore lint/suspicious/noTemplateCurlyInString: testing literal output
	ok(js.includes("${brand}"));
	ok(!js.includes("brand("));
});

// === Identifier mapping in exports ===

test("Should use direct name in exports when identifier matches camelCase", () => {
	const js = compile("hello = World", { locale: "en-CA" });
	ok(js.includes("hello"));
	// Should not have quoted key since 'hello' === 'hello'
});

// === __select locales ===

test("Should include __locales when __select is used", () => {
	const js = compile(
		`msg =
  { $count ->
    [one] One
   *[other] Other
  }`,
		{ locale: "en-CA" },
	);
	ok(js.includes("const __locales"));
});

// === Duplicate detection across Terms ===

test("Should detect duplicate Term ids across joined sources", () => {
	throws(
		() => compile(["-brand = A.\n", "-brand = B.\n"], { locale: "en-CA" }),
		{ message: /Duplicate id\(s\) found:[\s\S]*"brand"/ },
	);
});

test("Should not throw when the same id is repeated within a single source", () => {
	// Intra-source repeats share one label, so they are not cross-source dupes.
	const js = compile(["greeting = Hi.\ngreeting = Hey.\n"], {
		locale: "en-CA",
	});
	ok(typeof js === "string");
});

test("Should list each duplicate id on its own line", () => {
	throws(
		() => compile(["a = 1\nb = 2\n", "a = 3\nb = 4\n"], { locale: "en-CA" }),
		(err) => {
			// Two duplicates → two "  - " bullet lines joined by a newline.
			const bullets = err.message.match(/\n {2}- /g) || [];
			strictEqual(
				bullets.length,
				2,
				"should have one bullet line per duplicate",
			);
			return true;
		},
	);
});

// === includeKey / excludeKey: array vs substring semantics ===

test("Should match includeKey exactly, not as a substring", () => {
	const js = compile("msg = Short\nmsg-one = Long", {
		locale: "en-CA",
		includeKey: "msgOne",
	});
	ok(js.includes("export const msgOne"), "msgOne should be included");
	ok(!js.includes("export const msg ="), "msg should not be included");
});

test("Should match excludeKey exactly, not as a substring", () => {
	const js = compile("msg = Short\nmsg-one = Long", {
		locale: "en-CA",
		excludeKey: "msgOne",
	});
	ok(!js.includes("export const msgOne"), "msgOne should be excluded");
	ok(js.includes("export const msg ="), "msg should remain included");
});

test("Should omit excluded messages entirely (valid module output)", async () => {
	const mod = await compileAndImport("msg-one = Hello\nmsg-two = World", {
		locale: "en-CA",
		includeKey: ["msgOne"],
	});
	strictEqual(mod.default("msg-one"), "Hello");
	strictEqual(mod.default("msg-two"), "*** msg-two ***");
});

test("Should produce a valid module when keys are excluded", async () => {
	const mod = await compileAndImport("msg-one = Hello\nmsg-two = World", {
		locale: "en-CA",
		excludeKey: ["msgTwo"],
	});
	strictEqual(mod.default("msg-one"), "Hello");
	strictEqual(mod.default("msg-two"), "*** msg-two ***");
});

// === excludeValue guard when not provided ===

test("Should not blank a literal 'undefined' value when excludeValue is unset", () => {
	const js = compile("msg = undefined", { locale: "en-CA" });
	ok(js.includes("export const msg = `undefined`"));
});

// === Error cause metadata ===

test("Should attach error and data to the cause on compile failure", () => {
	throws(
		() =>
			compile("valid = { $x }", {
				locale: "en-CA",
				variableNotation: "invalid",
			}),
		(err) => {
			ok(err.cause, "error should have a cause");
			ok(err.cause.error, "cause should carry the original error");
			ok(err.cause.data, "cause should carry the offending data node");
			return true;
		},
	);
});

test("Should throw on Junk by default (errorOnJunk defaults to true)", () => {
	throws(() => compile("-brand-name = {}", { locale: "en-CA" }), {
		message: "Junk found",
	});
});

test("Should attach the Junk data node to the cause when errorOnJunk:true", () => {
	throws(
		() => compile("-brand-name = {}", { locale: "en-CA", errorOnJunk: true }),
		(err) => {
			strictEqual(err.message, "Junk found");
			// The Junk error is re-wrapped by compileType; the original Junk
			// node is carried as the inner error's own cause.
			ok(err.cause, "outer error should carry a cause");
			ok(err.cause.error, "cause should carry the original Junk error");
			ok(
				err.cause.error.cause,
				"original Junk error should carry the Junk data node",
			);
			return true;
		},
	);
});

// === Comments produce valid modules when stripped ===

test("Should produce a valid module with comments stripped", async () => {
	const mod = await compileAndImport(
		`# Comment
## GroupComment
### ResourceComment
msg = Hello
`,
		{ locale: "en-CA", comments: false },
	);
	strictEqual(mod.default("msg"), "Hello");
});

// === Junk produces valid module when not erroring ===

test("Should produce a valid module when Junk is dropped (errorOnJunk:false)", async () => {
	const mod = await compileAndImport("-brand-name = {}\nmsg = Hello", {
		locale: "en-CA",
		errorOnJunk: false,
	});
	strictEqual(mod.default("msg"), "Hello");
});

// === TermReference parentheses with disableMinify ===

test("Should call paramless term references with empty parens when disableMinify:true", () => {
	const js = compile(
		`-brand = Firefox
msg = Welcome to { -brand }`,
		{ locale: "en-CA", disableMinify: true },
	);
	ok(js.includes("brand()"), "paramless term ref should compile to brand()");
});

// === SelectExpression forces a params interface ===

test("Should expose a params interface for messages whose only logic is a select", () => {
	const js = compile(
		`msg =
  { 42 ->
    [one] One
   *[other] Other
  }`,
		{ locale: "en-CA" },
	);
	ok(js.includes("export const msg = (params) =>"));
});

// === NUMBER function emits its helper without a variable ===

test("Should emit __formatNumber helper for NUMBER with a literal argument", () => {
	const js = compile("msg = { NUMBER(1000) }", { locale: "en-CA" });
	ok(
		js.includes("const __formatNumber ="),
		"helper definition should be emitted",
	);
});

// === Helpers are only emitted when their function is used ===

test("Should not emit any Intl helpers or __locales for a plain message", () => {
	const js = compile("msg = Hello", { locale: "en-CA" });
	ok(!js.includes("__locales"), "no __locales for plain message");
	ok(!js.includes("const __formatDateTime"), "no DateTime helper");
	ok(!js.includes("const __formatRelativeTime"), "no RelativeTime helper");
	ok(!js.includes("const __formatNumber"), "no Number helper");
	ok(!js.includes("const __formatVariable"), "no Variable helper");
	ok(!js.includes("const __select"), "no select helper");
});

test("Should emit __formatNumber helper when only a variable is used (no NUMBER)", () => {
	// __formatVariable alone must trigger the number helper (|| not &&).
	const js = compile("msg = Hello { $name }", { locale: "en-CA" });
	ok(js.includes("const __formatVariable"));
	ok(js.includes("const __formatNumber ="));
});

// === Join separator between sources ===

test("Should join array sources with a separator so adjacent messages stay distinct", () => {
	// Sources without trailing newlines would merge into one message if joined
	// with an empty separator.
	const js = compile(["msg-a = Hello", "msg-b = World"], { locale: "en-CA" });
	ok(js.includes("export const msgA"));
	ok(js.includes("export const msgB"));
});

test("Should join files with a separator in compileFiles", async () => {
	const dir = await mkdtemp(join(tmpdir(), "ftl-join-test-"));
	try {
		const fileA = join(dir, "a.ftl");
		const fileB = join(dir, "b.ftl");
		// No trailing newlines: empty separator would merge them.
		await writeFile(fileA, "msg-a = Hello", "utf8");
		await writeFile(fileB, "msg-b = World", "utf8");
		const js = await compileFiles([fileA, fileB], { locale: "en-CA" });
		ok(js.includes("export const msgA"));
		ok(js.includes("export const msgB"));
	} finally {
		await rm(dir, { recursive: true });
	}
});
