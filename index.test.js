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
		{ message: /Duplicate identifier "greeting"/ },
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

test("Should throw on duplicate ids across files in compileFiles", async () => {
	await rejects(
		() =>
			compileFiles(
				["./test/files/joined/dup-a.ftl", "./test/files/joined/dup-b.ftl"],
				{ locale: "en-CA" },
			),
		{ message: /Duplicate identifier "greeting"/ },
	);
});

test("Should name the offending path when an input cannot be read", async () => {
	// Node's EISDIR carries no path at all, so with several inputs the bare
	// error would not say which one failed.
	await rejects(() => compileFiles(["./test/files"], { locale: "en-CA" }), {
		message: /test\/files.*EISDIR/,
	});
	await rejects(() => compileFiles(["./nope.ftl"], { locale: "en-CA" }), {
		message: /nope\.ftl.*ENOENT/,
	});
	// the original fs error stays reachable for programmatic handling
	await rejects(
		() => compileFiles(["./nope.ftl"], { locale: "en-CA" }),
		(e) => {
			strictEqual(e.cause.code, "ENOENT");
			return true;
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

// === Unknown functions ===

test("Should throw a clear error for unknown functions", () => {
	throws(() => compile("msg = { FOO($x) }", { locale: "en-CA" }), {
		message: /Unknown function "FOO"/,
	});
});

// === Reference ordering ===

test("Should explain when a message is referenced before its definition", () => {
	throws(
		() => compile("ref = { base } World\nbase = Hello", { locale: "en-CA" }),
		{ message: /Unknown reference "base"/ },
	);
});

test("Should explain when a term is referenced before its definition", () => {
	throws(() => compile("msg = { -brand }\n-brand = X", { locale: "en-CA" }), {
		message: /Unknown reference "brand"/,
	});
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

test("Should not isolate a pattern that is a single placeable", () => {
	// Parity with @fluent/bundle: isolation marks only apply when a placeable
	// sits alongside other elements.
	const js = compile("msg = { $name }", {
		locale: "en-CA",
		useIsolating: true,
	});
	ok(!js.includes("\u2068"));
	ok(!js.includes("\u2069"));
});

test("Should isolate only the placeable, not surrounding text", () => {
	const js = compile("msg = Hello { $name }", {
		locale: "en-CA",
		useIsolating: true,
	});
	ok(js.includes("\u2068${"), "isolation should open before the placeable");
	ok(js.includes("}\u2069"), "isolation should close after the placeable");
	ok(!js.includes("\u2068Hello"), "text elements must not be isolated");
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

test("Should produce a loadable module for ids that collide with JavaScript", async () => {
	// The property that matters is not *how* a name is mangled but that the
	// generated module still parses and evaluates: a bare `const class = ...`
	// will not parse, and a bare `const Date = ...` shadows a global the
	// emitted Intl helpers depend on.
	const hazards = [
		"class",
		"const",
		"return",
		"typeof",
		"await",
		"import",
		"export",
		"default",
		"this",
		"null",
		"true",
		"false",
		"undefined",
		"arguments",
		"eval",
		"let",
		"static",
		"yield",
		"date",
		"intl",
		"json",
		"math",
		"number",
	];
	for (const word of hazards) {
		for (const notation of ["camelCase", "pascalCase"]) {
			const mod = await compileAndImport(
				`${word} = value\nwhen = { DATETIME($d) } { NUMBER($n) } { $v }`,
				{ locale: "en-CA", variableNotation: notation },
			);
			strictEqual(
				mod.default(word),
				"value",
				`"${word}" (${notation}) should round-trip`,
			);
			ok(
				mod.default("when", { d: 0, n: 1, v: 2 }).length > 0,
				`"${word}" (${notation}) should not break the Intl helpers`,
			);
		}
	}
});

// === Backtick escaping ===

test("Should escape backticks in text", () => {
	const js = compile("msg = Hello `world`", { locale: "en-CA" });
	ok(js.includes("\\`world\\`"));
});

// === Backslash escaping ===

test("Should preserve backslashes in text verbatim", async () => {
	// `\u` is an invalid template-literal escape (SyntaxError) and `\n` would
	// silently become a newline if backslashes leaked into the output unescaped.
	const mod = await compileAndImport("msg = see \\u below and C:\\new\\test", {
		locale: "en-CA",
	});
	strictEqual(mod.default("msg"), "see \\u below and C:\\new\\test");
});

test("Should escape backslashes before backticks (no double escaping)", async () => {
	const mod = await compileAndImport("msg = mix \\` of both", {
		locale: "en-CA",
	});
	strictEqual(mod.default("msg"), "mix \\` of both");
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

// === NumberLiteral by position ===

test("Should locale-format number literals in every pattern text position", async () => {
	// Message, Term, Attribute, and Variant patterns are display positions —
	// 1000 must render with en-CA grouping in each of them.
	const mod = await compileAndImport(
		`-term = T { 1000 }
inTerm = { -term }
inMessage = M { 1000 }
withAttr = W
  .a = A { 1000 }
inVariant =
  { $count ->
   *[other] V { 1000 }
  }`,
		{ locale: "en-CA" },
	);
	strictEqual(mod.default("inMessage"), "M 1,000");
	strictEqual(mod.default("inTerm"), "T 1,000");
	deepStrictEqual(mod.default("withAttr"), {
		value: "W",
		attributes: { a: "A 1,000" },
	});
	strictEqual(mod.default("inVariant", { count: 5 }), "V 1,000");
});

test("Should keep selector number literals raw so variants match", async () => {
	const mod = await compileAndImport(
		`msg =
  { 1000 ->
    [1000] Match
   *[other] Other
  }`,
		{ locale: "en-CA" },
	);
	strictEqual(mod.default("msg"), "Match");
});

test("Should pass positional and named number arguments raw to NUMBER", async () => {
	// A formatted positional ("1,234.5678") is NaN to Intl; named options must
	// arrive as numbers so Intl applies them.
	const mod = await compileAndImport(
		"msg = { NUMBER(1234.5678, maximumFractionDigits: 2) }",
		{ locale: "en-CA" },
	);
	strictEqual(mod.default("msg"), "1,234.57");
});

test("Should pass numeric named arguments to terms raw", async () => {
	// If the named 1000 were locale-formatted to "1,000", the variant key
	// '1000' could never match.
	const mod = await compileAndImport(
		`-sized =
  { $size ->
    [1000] big
   *[other] small
  }
msg = { -sized(size: 1000) }`,
		{ locale: "en-CA" },
	);
	strictEqual(mod.default("msg"), "big");
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

// === DATETIME / RELATIVETIME value coercion ===

test("Should accept numeric timestamps in DATETIME and RELATIVETIME", async () => {
	const mod = await compileAndImport(
		"when = { DATETIME($date) }\nago = { RELATIVETIME($date) }",
		{ locale: "en-CA" },
	);
	const timestamp = Date.UTC(2026, 0, 2);
	strictEqual(
		mod.default("when", { date: timestamp }),
		mod.default("when", { date: new Date(timestamp) }),
	);
	strictEqual(
		mod.default("ago", { date: timestamp }),
		mod.default("ago", { date: new Date(timestamp) }),
	);
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

// === Reserved-word ids resolve through the default export ===

test("Should resolve reserved-word message ids via the default export", async () => {
	// The export map keys reserved words by their original id ('class': _class),
	// so the default export resolves them directly.
	const mod = await compileAndImport("class = Classroom", { locale: "en-CA" });
	strictEqual(mod.default("class"), "Classroom");
});

// === Generated header ===

test("Should stamp generated output with a do-not-edit header", () => {
	const js = compile("msg = Hello", { locale: "en-CA" });
	ok(js.startsWith("// Generated by fluent-transpiler. Do not edit.\n"));
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

// === Variables with dashes in their names ===

test("Should bracket-access variables whose names contain dashes", async () => {
	// Fluent identifiers allow dashes; `params?.first-name` is invalid JS.
	// Found by fuzzing.
	const mod = await compileAndImport("msg = Hello { $first-name }", {
		locale: "en-CA",
	});
	strictEqual(mod.default("msg", { "first-name": "Ada" }), "Hello Ada");
	strictEqual(mod.default("msg"), "Hello {$first-name}");
});

test("Should bracket-access dashed variables in selector position", async () => {
	const mod = await compileAndImport(
		`msg =
  { $item-count ->
    [one] One
   *[other] Many
  }`,
		{ locale: "en-CA" },
	);
	strictEqual(mod.default("msg", { "item-count": 1 }), "One");
});

// === Missing variables ===

test("Should render missing variables as {$name} placeholders", async () => {
	// Matches @fluent/bundle's recovery behavior; previously rendered "NaN".
	const mod = await compileAndImport("msg = Hello { $name }", {
		locale: "en-CA",
	});
	strictEqual(mod.default("msg"), "Hello {$name}");
	strictEqual(mod.default("msg", {}), "Hello {$name}");
	strictEqual(mod.default("msg", { name: null }), "Hello {$name}");
	strictEqual(mod.default("msg", { name: "world" }), "Hello world");
});

// === VariableReference in different parent contexts ===

test("Should wrap VariableReference in __formatVariable for Message parent", () => {
	const js = compile("msg = Hello { $name }", { locale: "en-CA" });
	ok(js.includes('__formatVariable(params?.name, "name")'));
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
		})
		// the null-prototype sentinel is not a message id
		.filter((id) => id !== "__proto__");

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
	ok(js.includes('__formatVariable(params?.count, "count")'));
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
		{ message: /Duplicate identifier "brand"/ },
	);
});

test("Should throw on duplicate ids within a single source", () => {
	// Two declarations of the same id would emit two `const greeting`
	// declarations — an unloadable module.
	throws(
		() => compile("greeting = Hi.\ngreeting = Hey.", { locale: "en-CA" }),
		{
			message: /Duplicate identifier "greeting"/,
		},
	);
});

test("Should throw when a term and a message share a name", () => {
	throws(() => compile("-brand = X\nbrand = Y", { locale: "en-CA" }), {
		message: /Duplicate identifier "brand"/,
	});
});

test("Should throw when ids collide after the notation transform", () => {
	throws(() => compile("my-message = A\nmyMessage = B", { locale: "en-CA" }), {
		message: /Duplicate identifier "myMessage"/,
	});
});

test("Should carry the colliding FTL id on the duplicate error cause", () => {
	// The message names the transformed identifier; the cause names the FTL id
	// of the colliding declaration so it can be found in the source.
	throws(
		() => compile("my-message = A\nmyMessage = B", { locale: "en-CA" }),
		(err) => {
			// compileType rewraps: outer cause carries the original error.
			strictEqual(err.cause.error.cause.id, "myMessage");
			return true;
		},
	);
});

test("Should report intra-source repeats in array input as duplicate identifiers", () => {
	// A repeat inside one source is not a cross-source duplicate: it must reach
	// the compile-level check, not the cross-source labelled report.
	throws(
		() => compile(["greeting = Hi.\ngreeting = Hey.\n"], { locale: "en-CA" }),
		{ message: /^Duplicate identifier "greeting"/ },
	);
});

test("Should report the first duplicate id when a source has several", () => {
	// Compilation stops at the first collision rather than collecting them all.
	throws(
		() => compile(["a = 1\nb = 2\n", "a = 3\nb = 4\n"], { locale: "en-CA" }),
		{
			message: /Duplicate identifier "a"/,
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

// === includeKey / excludeKey accept original FTL ids ===

test("Should accept the original FTL id in includeKey", () => {
	const js = compile("msg-one = Hello\nmsg-two = World", {
		locale: "en-CA",
		includeKey: "msg-one",
	});
	ok(js.includes("export const msgOne"), "msg-one should be included");
	ok(!js.includes("export const msgTwo"), "msg-two should not be included");
});

test("Should accept the original FTL id in excludeKey", () => {
	const js = compile("msg-one = Hello\nmsg-two = World", {
		locale: "en-CA",
		excludeKey: "msg-two",
	});
	ok(js.includes("export const msgOne"), "msg-one should remain included");
	ok(!js.includes("export const msgTwo"), "msg-two should be excluded");
});

// === Filtered messages remain referenceable ===

test("Should keep excluded messages as private consts so references work", async () => {
	const mod = await compileAndImport("base = Hello\nref = { base } World", {
		locale: "en-CA",
		excludeKey: "base",
	});
	strictEqual(mod.default("ref"), "Hello World");
	strictEqual(mod.default("base"), "*** base ***");
});

test("Should keep non-included messages as private consts so references work", async () => {
	const mod = await compileAndImport("base = Hello\nref = { base } World", {
		locale: "en-CA",
		includeKey: "ref",
	});
	strictEqual(mod.default("ref"), "Hello World");
	strictEqual(mod.default("base"), "*** base ***");
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

// === comments default ===

test("Should include comments by default (comments option defaults to true)", () => {
	// Every other comment test passes `comments` explicitly; this pins the
	// default so flipping it to false is caught.
	const js = compile("# Comment", { locale: "en-CA" });
	ok(js.includes("// # Comment"), "comments should default to on");
});

// === exports map: matching identifier uses a bare key ===

test("Should export a matching identifier as a bare key, not 'id': name", () => {
	// `hello` needs no notation transform, so assignment === id and the export
	// must be the bare `hello`, never the redundant `'hello': hello`.
	const js = compile("hello = World", { locale: "en-CA" });
	ok(!js.includes("'hello': hello"), "matching id should not be quoted/mapped");
	ok(js.includes("\n  hello\n}"), "matching id should appear as a bare key");
});

// === VariableReference inside an Attribute value ===

test("Should wrap VariableReference in __formatVariable for Attribute parent", () => {
	// Message and Variant parents are covered elsewhere; this pins the Attribute
	// branch of the parent whitelist.
	const js = compile(
		`login = Login
  .title = Hello { $name }`,
		{ locale: "en-CA" },
	);
	ok(
		js.includes('__formatVariable(params?.name, "name")'),
		"a variable inside an attribute value should be formatted",
	);
});

// === Parameterized term referenced without named arguments ===

test("Should pass the params object to a parameterized term referenced without args", () => {
	// The term takes params (via $case) but is referenced with no named args, so
	// the term call must receive the whole `params` object, not `undefined`.
	const js = compile(
		`-brand =
    { $case ->
        *[nominative] Firefox
        [locative] Firefoksie
    }
msg = Welcome to { -brand }`,
		{ locale: "en-CA" },
	);
	ok(
		js.includes("brand(params)"),
		"term should be called with the params object",
	);
	ok(
		!js.includes("brand(undefined)"),
		"term must not be called with undefined",
	);
});

// === SelectExpression: default variant is the fallback, not a case ===

test("Should omit the default variant from the __select cases", () => {
	// The default (`*[other]`) becomes the fallback argument and must not also be
	// listed as a `'other':` case.
	const js = compile(
		`msg =
  { $count ->
    [one] One item
   *[other] Many items
  }`,
		{ locale: "en-CA" },
	);
	ok(js.includes("'one':"), "non-default variant should be a case");
	ok(!js.includes("'other':"), "default variant should not be a case");
});

test("Should keep variant keys verbatim regardless of variableNotation", async () => {
	// Variant keys are runtime match keys (plural categories, selector values),
	// not exported identifiers — the notation transform must not touch them.
	const mod = await compileAndImport(
		`msg =
  { $count ->
    [one] One item
   *[other] Many items
  }`,
		{ locale: "en-CA", variableNotation: "constantCase" },
	);
	strictEqual(mod.default("msg", { count: 1 }), "One item");
	strictEqual(mod.default("msg", { count: 5 }), "Many items");
});

test("Should match string variant keys verbatim under pascalCase", async () => {
	const mod = await compileAndImport(
		`msg =
  { $case ->
    [locative] Firefoksie
   *[nominative] Firefox
  }`,
		{ locale: "en-CA", variableNotation: "pascalCase" },
	);
	strictEqual(mod.default("msg", { case: "locative" }), "Firefoksie");
});

test("Should match numeric variant keys exactly (no locale grouping)", async () => {
	// `[1000]` must compile to the key '1000', not the en-CA formatted '1,000',
	// or the runtime value 1000 can never match it.
	const mod = await compileAndImport(
		`msg =
  { $count ->
    [1000] Exactly one thousand
   *[other] Other
  }`,
		{ locale: "en-CA" },
	);
	strictEqual(mod.default("msg", { count: 1000 }), "Exactly one thousand");
	strictEqual(mod.default("msg", { count: 7 }), "Other");
});

test("Should normalize decimal variant keys to their numeric value", async () => {
	// `[3.0]` and a runtime value of 3 are the same number.
	const mod = await compileAndImport(
		`msg =
  { $count ->
    [3.0] Three
   *[other] Other
  }`,
		{ locale: "en-CA" },
	);
	strictEqual(mod.default("msg", { count: 3 }), "Three");
});

test("Should use the default variant (not the last) as the __select fallback", () => {
	// Default is declared first; the fallback is the trailing positional arg to
	// __select and must be the default's value regardless of source order.
	const js = compile(
		`msg =
  { $count ->
   *[other] Many items
    [one] One item
  }`,
		{ locale: "en-CA" },
	);
	ok(
		js.includes("`Many items`\n  )"),
		"the default value should be the fallback argument",
	);
	ok(
		!js.includes("`One item`\n  )"),
		"a non-default variant must not become the fallback",
	);
});

// === Selector lookups must not reach Object.prototype ===

test("Should use the fallback for selector values that name Object.prototype members", async () => {
	// `cases` is an object literal, so `cases['constructor']` would otherwise
	// resolve up the prototype chain and render an internal function.
	const mod = await compileAndImport(
		`msg =
  { $x ->
    [one] One item
   *[other] Many items
  }`,
		{ locale: "en-CA" },
	);
	strictEqual(mod.msg({ x: "one" }), "One item");
	for (const hostile of [
		"__proto__",
		"constructor",
		"toString",
		"hasOwnProperty",
		"valueOf",
	]) {
		strictEqual(
			mod.msg({ x: hostile }),
			"Many items",
			`selector value "${hostile}" should fall back to the default variant`,
		);
	}
});

test("Should report unknown ids for default-export lookups that name Object.prototype members", async () => {
	// `__exports[id]` would otherwise resolve up the prototype chain and either
	// return or *call* an inherited function.
	const mod = await compileAndImport("a = A", { locale: "en-CA" });
	strictEqual(mod.default("a"), "A");
	for (const hostile of [
		"__proto__",
		"constructor",
		"toString",
		"hasOwnProperty",
		"valueOf",
	]) {
		strictEqual(
			mod.default(hostile),
			`*** ${hostile} ***`,
			`id "${hostile}" should be reported as unknown`,
		);
	}
});

// === Fluent string-literal escapes ===

test("Should resolve every Fluent string-literal escape", async () => {
	// StringLiteral.value is raw source, so Fluent's escapes have to be
	// resolved rather than handed to the JavaScript parser: `\UXXXXXX` is a
	// Fluent escape but not a JavaScript one.
	const cases = [
		[String.raw`\u0041`, "A", "4-digit unicode escape"],
		[String.raw`\U01F600`, "\u{1F600}", "6-digit unicode escape"],
		[String.raw`\"`, '"', "escaped quote"],
		[String.raw`\\`, "\\", "escaped backslash"],
	];
	for (const [sequence, expected, label] of cases) {
		const mod = await compileAndImport(`msg = { "${sequence}" }`, {
			locale: "en-CA",
		});
		strictEqual(mod.msg, expected, label);
	}
});

// === Tabs ===

test("Should preserve tabs inside a message value", async () => {
	// Tabs are normalized so tab-indented FTL still parses, but that must not
	// reach the message content itself.
	const mod = await compileAndImport("msg = a" + "\t" + "b", {
		locale: "en-CA",
	});
	strictEqual(mod.msg, "a" + "\t" + "b");
});

test("Should still accept tab-indented continuation lines", async () => {
	// The normalization exists so tab indentation does not become Junk. Every
	// leading tab has to go: leaving one behind puts it in the value.
	const mod = await compileAndImport(
		"msg =" + "\n" + "\t\t" + "one" + "\n" + "\t\t" + "two",
		{ locale: "en-CA" },
	);
	strictEqual(mod.msg, "one" + "\n" + "two");
});

// === Attribute references ===

test("Should render the value when referencing a message that has attributes", async () => {
	// The reference must resolve to the message's value; emitting the whole
	// {value, attributes} record stringifies as "[object Object]".
	const src = `other = Hi
    .alt = Alt text
msg = { other } there`;
	const mod = await compileAndImport(src, { locale: "en-CA" });
	const reference = createBundleHelper("en-CA", src);
	strictEqual(mod.msg, "Hi there");
	strictEqual(mod.msg, reference("msg"));
});

// === disableMinify references resolve to real values ===

test("Should resolve a paramless term reference when disableMinify:true", async () => {
	// Terms are never exported, so disableMinify does not make them callable;
	// calling one that compiled to a string const throws at runtime.
	const src = `-brand = Firefox
msg = Welcome to { -brand }`;
	const mod = await compileAndImport(src, {
		locale: "en-CA",
		disableMinify: true,
	});
	strictEqual(mod.msg().value, "Welcome to Firefox");
	strictEqual(mod.msg().value, createBundleHelper("en-CA", src)("msg"));
});

test("Should resolve a message reference when disableMinify:true", async () => {
	// Every message is a {value, attributes} record under disableMinify, so a
	// reference must reach for the value.
	const src = `base = Hello
ref = { base } World`;
	const mod = await compileAndImport(src, {
		locale: "en-CA",
		disableMinify: true,
	});
	strictEqual(mod.ref().value, "Hello World");
	strictEqual(mod.ref().value, createBundleHelper("en-CA", src)("ref"));
});

test("Should resolve a message attribute reference", async () => {
	const src = `other = Hi
    .alt = Alt text
msg = Shows { other.alt }`;
	const mod = await compileAndImport(src, { locale: "en-CA" });
	strictEqual(mod.msg, "Shows Alt text");
	strictEqual(mod.msg, createBundleHelper("en-CA", src)("msg"));
});

test("Should resolve a message attribute reference with a dashed name", async () => {
	const src = `login = Login
    .aria-label = Login input
msg = Shows { login.aria-label }`;
	const mod = await compileAndImport(src, { locale: "en-CA" });
	strictEqual(mod.msg, "Shows Login input");
	strictEqual(mod.msg, createBundleHelper("en-CA", src)("msg"));
});

test("Should reject a reference to an attribute that does not exist", () => {
	throws(
		() =>
			compile(
				`other = Hi
    .alt = Alt text
msg = { other.missing }`,
				{ locale: "en-CA" },
			),
		{ message: /Unknown attribute "other\.missing"/ },
	);
});

test("Should select on a term attribute", async () => {
	// Term attributes are only valid in selector position per the Fluent spec;
	// this is the gendered-term pattern.
	const src = `-brand = Firefox
    .gender = masculine
msg =
    { -brand.gender ->
        [masculine] el { -brand }
       *[feminine] la { -brand }
    }`;
	const mod = await compileAndImport(src, { locale: "en-CA" });
	strictEqual(mod.msg(), "el Firefox");
	strictEqual(mod.msg(), createBundleHelper("en-CA", src)("msg"));
});

// === Identifiers that would break the generated module ===

test("Should not rename ids that are legal JavaScript identifiers", async () => {
	// These are Java keywords, not JavaScript ones; prefixing them produced
	// needlessly mangled export names.
	const src = "float = a\nbyte = b\ngoto = c\nnative = d\nsynchronized = e";
	const mod = await compileAndImport(src, { locale: "en-CA" });
	deepStrictEqual(
		{ ...mod, default: undefined },
		{
			float: "a",
			byte: "b",
			goto: "c",
			native: "d",
			synchronized: "e",
			default: undefined,
		},
	);
});

test("Should rename ids that collide with JavaScript reserved words", () => {
	const js = compile("class = a\nreturn = b\ntypeof = c", { locale: "en-CA" });
	for (const word of ["class", "return", "typeof"]) {
		ok(js.includes(`export const _${word} =`), `${word} should be prefixed`);
	}
});

test("Should rename ids that would shadow a global the runtime helpers use", async () => {
	// pascalCase turns `date` into `Date`; an unprefixed `const Date` shadows
	// the global that __formatDateTime depends on.
	const src = "date = Today\nwhen = It is { DATETIME($d) }";
	const mod = await compileAndImport(src, {
		locale: "en-CA",
		variableNotation: "pascalCase",
	});
	strictEqual(mod._Date, "Today");
	ok(mod.When({ d: "2020-01-02T00:00:00Z" }).startsWith("It is "));
});

// === variableNotation transforms ===

test("Should map ids to export names consistently across notations", () => {
	// Characterization of the notation transforms. The digit and acronym rules
	// are the non-obvious ones: a word cannot start with an uppercased digit,
	// so `msg-2` gains a delimiter instead.
	const table = [
		["msg", "msg", "Msg", "msg", "MSG"],
		["msg-one", "msgOne", "MsgOne", "msg_one", "MSG_ONE"],
		["msg-one-two", "msgOneTwo", "MsgOneTwo", "msg_one_two", "MSG_ONE_TWO"],
		["msgOne", "msgOne", "MsgOne", "msg_one", "MSG_ONE"],
		["MSG_ONE", "msgOne", "MsgOne", "msg_one", "MSG_ONE"],
		["msg_one", "msgOne", "MsgOne", "msg_one", "MSG_ONE"],
		["a", "a", "A", "a", "A"],
		["msg2", "msg2", "Msg2", "msg2", "MSG2"],
		["msg-2", "msg_2", "Msg_2", "msg_2", "MSG_2"],
		["msg2x", "msg2x", "Msg2x", "msg2x", "MSG2X"],
		["msg-0", "msg_0", "Msg_0", "msg_0", "MSG_0"],
		["msg-9", "msg_9", "Msg_9", "msg_9", "MSG_9"],
		["msg-x2", "msgX2", "MsgX2", "msg_x2", "MSG_X2"],
		["HTTPServer", "httpServer", "HttpServer", "http_server", "HTTP_SERVER"],
		["aB", "aB", "AB", "a_b", "A_B"],
		["a-b-c", "aBC", "ABC", "a_b_c", "A_B_C"],
		["x1y2", "x1y2", "X1y2", "x1y2", "X1Y2"],
		["aria-label", "ariaLabel", "AriaLabel", "aria_label", "ARIA_LABEL"],
		[
			"XMLHttpRequest",
			"xmlHttpRequest",
			"XmlHttpRequest",
			"xml_http_request",
			"XML_HTTP_REQUEST",
		],
		["msg--one", "msgOne", "MsgOne", "msg_one", "MSG_ONE"],
	];
	const notations = ["camelCase", "pascalCase", "snakeCase", "constantCase"];
	for (const [id, ...expected] of table) {
		notations.forEach((variableNotation, i) => {
			const js = compile(`${id} = v`, { locale: "en-CA", variableNotation });
			ok(
				js.includes(`export const ${expected[i]} = `),
				`${id} under ${variableNotation} should export ${expected[i]}`,
			);
		});
	}
});

test("Should select on the attribute of a parameterized term", async () => {
	// A term that has both params and attributes becomes a callable record.
	const src = `-brand =
    { $case ->
       *[nominative] Firefox
        [locative] Firefoksie
    }
    .gender = masculine
msg =
    { -brand.gender ->
        [masculine] el { -brand(case: "locative") }
       *[feminine] la
    }`;
	const mod = await compileAndImport(src, { locale: "en-CA" });
	strictEqual(mod.msg(), "el Firefoksie");
	strictEqual(mod.msg(), createBundleHelper("en-CA", src)("msg"));
});

test("Should prefix every name that would break the generated module", () => {
	// Each entry needs an FTL id and notation that actually produces it, so the
	// globals are reached via the notation that yields their exact casing.
	const keywords = [
		"arguments",
		"await",
		"break",
		"case",
		"catch",
		"class",
		"const",
		"continue",
		"debugger",
		"default",
		"delete",
		"do",
		"else",
		"enum",
		"eval",
		"export",
		"extends",
		"false",
		"finally",
		"for",
		"function",
		"if",
		"implements",
		"import",
		"in",
		"instanceof",
		"interface",
		"let",
		"new",
		"null",
		"package",
		"private",
		"protected",
		"public",
		"return",
		"static",
		"super",
		"switch",
		"this",
		"throw",
		"true",
		"try",
		"typeof",
		"undefined",
		"var",
		"void",
		"while",
		"with",
		"yield",
	];
	const cases = [
		...keywords.map((word) => [word, "camelCase", word]),
		// globals the emitted Intl helpers reference
		["date", "pascalCase", "Date"],
		["intl", "pascalCase", "Intl"],
		["json", "constantCase", "JSON"],
		["math", "pascalCase", "Math"],
		["number", "pascalCase", "Number"],
		["is-na-n", "camelCase", "isNaN"],
	];
	for (const [id, variableNotation, expected] of cases) {
		const js = compile(`${id} = value`, { locale: "en-CA", variableNotation });
		ok(
			js.includes(`export const _${expected} = `),
			`"${id}" under ${variableNotation} should export _${expected}`,
		);
	}
});

test("Should use dot access for plain attribute names and brackets for dashed", () => {
	const plain = compile("o = Hi\n    .alt = A\nm = { o.alt }", {
		locale: "en-CA",
	});
	ok(plain.includes(".attributes.alt"), "plain names should use dot access");
	const dashed = compile("o = Hi\n    .aria-label = A\nm = { o.aria-label }", {
		locale: "en-CA",
	});
	ok(
		dashed.includes('.attributes["aria-label"]'),
		"dashed names are not valid after a dot",
	);
});

test("Should reject a message that references itself", () => {
	// `const msg = ${msg}` is a temporal dead zone error at import time.
	throws(() => compile("msg = { msg }", { locale: "en-CA" }), {
		message: /Self reference "msg"/,
	});
	throws(() => compile("-brand = { -brand }", { locale: "en-CA" }), {
		message: /Self reference "brand"/,
	});
});

test("Should keep reserved words usable as attribute names", async () => {
	// Attribute names are object literal keys, where `default` and friends are
	// perfectly legal, so they must not be given the identifier `_` prefix.
	const src = `msg = v
    .default = fallback
    .class = c
    .Date = d
ref = { msg.default } { msg.class } { msg.Date }`;
	const mod = await compileAndImport(src, { locale: "en-CA" });
	deepStrictEqual(mod.msg.attributes, {
		default: "fallback",
		class: "c",
		Date: "d",
	});
	strictEqual(mod.ref, "fallback c d");
	strictEqual(mod.ref, createBundleHelper("en-CA", src)("ref"));
});
