// Copyright 2026 will Farrell, and fluent-transpiler contributors.
// SPDX-License-Identifier: MIT

import { readFile } from "node:fs/promises";
import { parse } from "@fluent/syntax";

// Identifiers that would break the generated module: JavaScript reserved
// words (a `const` declaration would not parse) plus the globals the emitted
// runtime helpers reference (a top-level `const` would shadow them).
const reservedWords = new Set([
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
	"Date",
	"Intl",
	"JSON",
	"Math",
	"Number",
	"isNaN",
]);

const exportDefault = `(id, params) => {
  const source = __exports[id]
  if (typeof source === 'undefined') return '*** '+id+' ***'
  if (typeof source === 'function') return source(params)
  return source
}
`;
export const compile = (src, opts) => {
	if (Array.isArray(src)) {
		src = src.join("\n\n");
	}
	const options = {
		comments: true,
		errorOnJunk: true,
		includeKey: [],
		// Stryker disable next-line ArrayDeclaration: equivalent mutant — a bogus
		// exclude key can never match a generated message id, so seeding the
		// default with an entry produces identical output.
		excludeKey: [],
		excludeValue: undefined,
		variableNotation: "camelCase",
		disableMinify: false,
		useIsolating: false,
		params: "params",
		exportDefault,
		...opts,
	};
	if (!Array.isArray(options.locale)) options.locale = [options.locale];
	if (!Array.isArray(options.includeKey))
		options.includeKey = [options.includeKey];
	if (!Array.isArray(options.excludeKey))
		options.excludeKey = [options.excludeKey];
	if (options.excludeValue) {
		// cast to template literal
		options.excludeValue = `\`${options.excludeValue}\``;
	}

	const metadata = {};
	const exports = [];
	const functions = {}; // global functions
	let variable;

	const compileAssignment = (data, kind) => {
		variable = compileType(data);
		if (metadata[variable] !== undefined) {
			// Two declarations of one name (repeated id, term/message overlap, or
			// ids that merge under the notation transform) would emit duplicate
			// `const` declarations — an unloadable module.
			throw new Error(`Duplicate identifier "${variable}"`, {
				cause: { id: data.name },
			});
		}
		metadata[variable] = {
			id: data.name,
			kind,
			params: false,
		};
		return variable;
	};

	// A reference resolves to the referenced entry's value. Entries carrying
	// attributes are emitted as {value, attributes} records, and disableMinify
	// makes every *message* such a record — terms keep their natural shape
	// because they are never exported.
	const compileReference = (name, attribute, args) => {
		if (name === variable) {
			// `const x = ${x}` is a temporal dead zone error at import time.
			throw new Error(`Self reference "${metadata[name].id}"`);
		}
		const entry = metadata[name];
		const alwaysRecord = options.disableMinify && entry.kind === "Message";
		let base = name;
		if (entry.params) {
			base = `${name}(${args ?? options.params})`;
		} else if (alwaysRecord) {
			base = `${name}()`;
		}
		if (attribute) {
			if (!entry.attributes.includes(attribute.name)) {
				throw new Error(`Unknown attribute "${entry.id}.${attribute.name}"`);
			}
			// attribute keys are emitted verbatim, so dashed names need brackets
			const key = attribute.name.includes("-")
				? `[${JSON.stringify(attribute.name)}]`
				: `.${attribute.name}`;
			return `${base}.attributes${key}`;
		}
		return entry.attributes.length || alwaysRecord ? `${base}.value` : base;
	};

	// Records the attribute names on the entry and returns the object literal.
	// Must run after the value is compiled: both contribute to `params`.
	const compileAttributes = (data, assignment) => {
		metadata[assignment].attributes = data.attributes.map((a) => a.id.name);
		if (!metadata[assignment].attributes.length) {
			return "{}";
		}
		return `{\n${data.attributes
			.map((data) => {
				return `  ${compileType(data)}`;
			})
			.join(",\n")}\n  }`;
	};

	const compileFunctionArguments = (data) => {
		const positional = data.arguments?.positional.map((data) => {
			return compileType(data);
		});
		const named = data.arguments?.named.reduce((obj, data) => {
			// `NamedArgument` uses `name` instead of `id`; never transform it
			obj[data.name.name] = compileType(data.value, data.type);
			return obj;
		}, {});
		return { positional, named };
	};

	const compileType = (data, parent) => {
		try {
			return types[data.type](data, parent);
		} catch (e) {
			throw new Error(e.message, { cause: { error: e, data } });
		}
	};

	const types = {
		Identifier: (data, parent) => {
			// Attribute names are object literal keys, never declarations: they
			// keep their source spelling, need no reserved-word guard (`{default:
			// 1}` is valid), and only dashes force quoting.
			if (parent === "Attribute") {
				return data.name.includes("-") ? `'${data.name}'` : data.name;
			}
			// Every notation strips dashes, so only reserved words need handling.
			const value = variableNotation[options.variableNotation](data.name);
			return reservedWords.has(value) ? `_${value}` : value;
		},
		Attribute: (data) => {
			const key = compileType(data.id, data.type);
			const value = compileType(data.value, data.type);
			return `  ${key}: ${value}`;
		},
		Pattern: (data, parent) => {
			// Parity with @fluent/bundle: placeables are only isolated when the
			// pattern mixes them with other elements.
			const isolate = options.useIsolating && data.elements.length > 1;
			return (
				"`" +
				data.elements
					.map((data) => {
						const value = compileType(data, parent);
						if (isolate && data.type === "Placeable") {
							return `\u2068${value}\u2069`;
						}
						return value;
					})
					.join("") +
				"`"
			);
		},
		// resources
		Term: (data) => {
			const assignment = compileAssignment(data.id, data.type);
			const templateStringLiteral = compileType(data.value, data.type);
			const attributes = compileAttributes(data, assignment);

			// A term carrying attributes becomes a {value, attributes} record so
			// selectors can reach them; a plain term stays a bare string.
			if (metadata[assignment].attributes.length) {
				if (metadata[assignment].params) {
					return `const ${assignment} = (${options.params}) => ({
  value:${templateStringLiteral},
  attributes:${attributes}
})\n`;
				}
				return `const ${assignment} = {
  value: ${templateStringLiteral},
  attributes: ${attributes}
}\n`;
			}
			if (metadata[assignment].params) {
				return `const ${assignment} = (${options.params}) => ${templateStringLiteral}\n`;
			}
			return `const ${assignment} = ${templateStringLiteral}\n`;
		},
		Message: (data) => {
			const assignment = compileAssignment(data.id, data.type);

			let templateStringLiteral =
				data.value && compileType(data.value, data.type);

			if (options.excludeValue === templateStringLiteral) {
				templateStringLiteral = "``";
			}

			const attributes = compileAttributes(data, assignment);

			let message;
			if (!options.disableMinify) {
				if (metadata[assignment].attributes.length) {
					if (metadata[assignment].params) {
						message = `(${options.params}) => ({
  value:${templateStringLiteral},
  attributes:${attributes}
})\n`;
					} else {
						message = `{
  value: ${templateStringLiteral},
  attributes: ${attributes}
}\n`;
					}
				} else if (metadata[assignment].params) {
					message = `(${options.params}) => ${templateStringLiteral}\n`;
				} else {
					message = `${templateStringLiteral}\n`;
				}
			} else {
				// consistent API
				message = `(${metadata[assignment].params ? options.params : ""}) => ({
  value:${templateStringLiteral},
  attributes:${attributes}
})\n`;
			}

			// Filters match the exported name or the original FTL id.
			const id = metadata[assignment].id;
			if (
				(options.includeKey.length &&
					!options.includeKey.includes(assignment) &&
					!options.includeKey.includes(id)) ||
				options.excludeKey.includes(assignment) ||
				options.excludeKey.includes(id)
			) {
				// Filtered messages stay as private consts: other messages may
				// reference them, so dropping the declaration entirely would
				// break the generated module.
				return `const ${assignment} = ${message}`;
			}

			if (assignment === id) {
				exports.push(`${assignment}`);
			} else {
				exports.push(`'${id}': ${assignment}`);
			}
			return `export const ${assignment} = ${message}`;
		},
		Comment: (data) => {
			if (options.comments) return `// # ${data.content}\n`;
			return "";
		},
		GroupComment: (data) => {
			if (options.comments) return `// ## ${data.content}\n`;
			return "";
		},
		ResourceComment: (data) => {
			if (options.comments) return `// ### ${data.content}\n`;
			return "";
		},
		Junk: (data) => {
			if (options.errorOnJunk) {
				throw new Error("Junk found", { cause: data });
			}
			return "";
		},
		// Element
		TextElement: (data) => {
			// escape for template literal; backslashes first so the escapes
			// added for backticks are not themselves escaped
			return data.value.replaceAll("\\", "\\\\").replaceAll("`", "\\`");
		},
		Placeable: (data, parent) => {
			return `\${${compileType(data.expression, parent)}}`;
		},
		// Expression
		StringLiteral: (data, parent) => {
			// `value` is the raw source between the quotes; `parse()` resolves
			// Fluent's escapes. They are not all JavaScript escapes — `\UXXXXXX`
			// would otherwise reach the JS parser and degrade to `UXXXXXX`.
			const { value } = data.parse();
			// JSON.stringify at parent level
			if (parent === "NamedArgument") {
				return value;
			}
			return JSON.stringify(value);
		},
		NumberLiteral: (data, parent) => {
			const number = Number.parseFloat(data.value);
			// Pattern text positions display the locale-formatted number (as a
			// string literal: bare `1,000` inside `${}` is a comma expression).
			// Argument, selector, and variant-key positions need the raw value
			// for Intl options and variant matching.
			if (["Message", "Term", "Variant", "Attribute"].includes(parent)) {
				return JSON.stringify(Intl.NumberFormat(options.locale).format(number));
			}
			return number;
		},
		VariableReference: (data, parent) => {
			functions.__formatVariable = true;
			metadata[variable].params = true;
			// Fluent identifiers allow dashes; those need bracket access in JS
			const value = data.id.name.includes("-")
				? `${options.params}?.[${JSON.stringify(data.id.name)}]`
				: `${options.params}?.${data.id.name}`;
			if (["Message", "Variant", "Attribute"].includes(parent)) {
				return `__formatVariable(${value}, ${JSON.stringify(data.id.name)})`;
			}
			return value;
		},
		MessageReference: (data) => {
			const messageName = compileType(data.id);
			if (metadata[messageName] === undefined) {
				throw new Error(
					`Unknown reference "${data.id.name}" (messages and terms must be defined before they are referenced)`,
				);
			}
			metadata[variable].params ||= metadata[messageName].params;
			return compileReference(messageName, data.attribute);
		},
		TermReference: (data) => {
			const termName = compileType(data.id);
			if (metadata[termName] === undefined) {
				throw new Error(
					`Unknown reference "${data.id.name}" (messages and terms must be defined before they are referenced)`,
				);
			}
			metadata[variable].params ||= metadata[termName].params;

			let { named } = compileFunctionArguments(data);
			named = JSON.stringify(named);
			// named arguments override the caller's params for this term only
			const params = named
				? `{ ...${options.params}, ${named.substring(1, named.length - 1)} }`
				: undefined;
			return compileReference(termName, data.attribute, params);
		},
		SelectExpression: (data) => {
			functions.__select = true;
			metadata[variable].params = true;
			const value = compileType(data.selector);
			let fallback;
			const cases = data.variants
				.filter((data) => {
					if (data.default) {
						fallback = compileType(data.value, data.type);
					}
					return !data.default;
				})
				.map((data) => {
					return `  ${compileType(data)}`;
				});
			// `__proto__: null` keeps a hostile selector value (`constructor`,
			// `toString`, ...) from resolving up the prototype chain instead of
			// falling back to the default variant.
			return `__select(\n    ${value},\n    {\n${["      __proto__: null", ...cases].join(",\n")}\n    },\n    ${fallback}\n  )`;
		},
		Variant: (data) => {
			// Variant keys are runtime match keys (plural categories, selector
			// values), never identifiers — emit them verbatim. Numeric keys use
			// the raw value so `cases[1000]` can match (`'1,000'` never would).
			const key =
				data.key.type === "Identifier"
					? data.key.name
					: Number.parseFloat(data.key.value);
			const value = compileType(data.value, data.type);
			return `    '${key}': ${value}`;
		},
		FunctionReference: (data) => {
			const fn = functionTypes[data.id.name];
			if (fn === undefined) {
				throw new Error(
					`Unknown function "${data.id.name}" (supported: DATETIME, NUMBER, RELATIVETIME)`,
				);
			}
			return fn(compileFunctionArguments(data));
		},
	};

	const functionTypes = {
		DATETIME: (data) => {
			functions.__formatDateTime = true;
			const { positional, named } = data;
			const value = positional[0];
			return `__formatDateTime(${value}, ${JSON.stringify(named)})`;
		},
		RELATIVETIME: (data) => {
			functions.__formatRelativeTime = true;
			const { positional, named } = data;
			const value = positional[0];
			return `__formatRelativeTime(${value}, ${JSON.stringify(named)})`;
		},
		NUMBER: (data) => {
			functions.__formatNumber = true;
			const { positional, named } = data;
			const value = positional[0];
			return `__formatNumber(${value}, ${JSON.stringify(named)})`;
		},
	};

	// Fluent does not accept tabs as indentation. Normalize leading tabs only —
	// a tab inside a message value is content and must survive.
	src = src.replaceAll(/^\t+/gm, (tabs) => "    ".repeat(tabs.length));

	const { body } = parse(src);
	let translations = ``;
	for (const data of body) {
		translations += compileType(data);
	}

	let output = `// Generated by fluent-transpiler. Do not edit.\n`;
	if (
		functions.__formatVariable ||
		functions.__formatDateTime ||
		functions.__formatNumber ||
		functions.__formatRelativeTime ||
		functions.__select
	) {
		output += `const __locales = ${JSON.stringify(options.locale)}\nconst __intlCache = {}\n`;
	}
	if (functions.__formatRelativeTime) {
		output += `
const __relativeTimeDiff = (d) => {
  const msPerMinute = 60 * 1000
  const msPerHour = msPerMinute * 60
  const msPerDay = msPerHour * 24
  const msPerWeek = msPerDay * 7
  const msPerMonth = msPerDay * 30
  const msPerYear = msPerDay * 365.25
  const elapsed = d - new Date()

  if (Math.abs(elapsed) < msPerMinute) {
    return [Math.round(elapsed / 1000), 'second']
  }
  if (Math.abs(elapsed) < msPerHour) {
    return [Math.round(elapsed / msPerMinute), 'minute']
  }
  if (Math.abs(elapsed) < msPerDay) {
    return [Math.round(elapsed / msPerHour), 'hour']
  }
  if (Math.abs(elapsed) < msPerWeek * 2) {
    return [Math.round(elapsed / msPerDay), 'day']
  }
  if (Math.abs(elapsed) < msPerMonth) {
    return [Math.round(elapsed / msPerWeek), 'week']
  }
  if (Math.abs(elapsed) < msPerYear) {
    return [Math.round(elapsed / msPerMonth), 'month']
  }
  return [Math.round(elapsed / msPerYear), 'year']
}
const __formatRelativeTime = (value, options) => {
  if (!(value instanceof Date)) value = new Date(value)
  if (isNaN(value.getTime())) return value
  try {
    const [duration, unit] = __relativeTimeDiff(value)
    const k = JSON.stringify(options) ?? ''
    return (__intlCache['R'+k] ??= new Intl.RelativeTimeFormat(__locales, options)).format(duration, unit)
  } catch (e) {
    // RelativeTimeFormat unsupported or invalid options, fall back to DateTimeFormat
  }
  const k = JSON.stringify(options) ?? ''
  return (__intlCache['D'+k] ??= new Intl.DateTimeFormat(__locales, options)).format(value)
}
`;
	}
	if (functions.__formatDateTime) {
		output += `
const __formatDateTime = (value, options) => {
  if (!(value instanceof Date)) value = new Date(value)
  if (isNaN(value.getTime())) return value
  const k = JSON.stringify(options) ?? ''
  return (__intlCache['D'+k] ??= new Intl.DateTimeFormat(__locales, options)).format(value)
}
`;
	}
	if (functions.__formatVariable || functions.__formatNumber) {
		output += `
const __formatNumber = (value, options) => {
  const k = JSON.stringify(options) ?? ''
  return (__intlCache['N'+k] ??= new Intl.NumberFormat(__locales, options)).format(value)
}
`;
	}
	if (functions.__formatVariable) {
		output += `
const __formatVariable = (value, name) => {
  if (typeof value === 'string') return value
  if (value === undefined || value === null) return '{$'+name+'}'
  const decimal = Number.parseFloat(value)
  const number = Number.isInteger(decimal) ? Number.parseInt(value, 10) : decimal
  return __formatNumber(number)
}
`;
	}
	if (functions.__select) {
		output += `
const __select = (value, cases, fallback) => {
  const rule = (__intlCache.P ??= new Intl.PluralRules(__locales)).select(value)
  return cases[value] ?? cases[rule] ?? fallback
}
`;
	}
	output += `\n${translations}`;
	// `__proto__: null` keeps a lookup for an inherited name (`constructor`,
	// `toString`, ...) reporting an unknown id instead of returning — or
	// calling — something off Object.prototype.
	output += `const __exports = {\n  ${["__proto__: null", ...exports].join(",\n  ")}\n}`;
	output += `\nexport default ${options.exportDefault}`;

	return output;
};

// Word splitting, matching change-case (which this replaced): break on
// lower/digit -> upper, on the tail of an acronym run (`HTTPServer` -> HTTP,
// Server), and on any run of non-alphanumerics. The notation table in
// index.test.js pins every rule below.
const SPLIT_LOWER_UPPER = /([\p{Ll}\d])(\p{Lu})/gu;
const SPLIT_UPPER_UPPER = /(\p{Lu})([\p{Lu}][\p{Ll}])/gu;
const SPLIT_NON_WORD = /[^\p{L}\d]/giu;

const splitWords = (value) =>
	value
		.replace(SPLIT_LOWER_UPPER, "$1\0$2")
		.replace(SPLIT_UPPER_UPPER, "$1\0$2")
		.replace(SPLIT_NON_WORD, "\0")
		.split("\0")
		.filter(Boolean);

const STARTS_WITH_DIGIT = /^\d/;

const capitalize = (word, index) => {
	// A digit cannot be uppercased, so it is delimited instead: `msg-2` would
	// otherwise collapse to an ambiguous `msg2`.
	// Stryker disable next-line ConditionalExpression,EqualityOperator: equivalent
	// mutant — a Fluent id must start with a letter, so the first word never
	// starts with a digit and the index guard cannot be observed.
	const delimit = index > 0 && STARTS_WITH_DIGIT.test(word);
	const initial = delimit ? `_${word[0]}` : word[0].toLocaleUpperCase();
	return initial + word.slice(1).toLocaleLowerCase();
};

const variableNotation = {
	camelCase: (id) =>
		splitWords(id)
			.map((word, index) =>
				index === 0 ? word.toLocaleLowerCase() : capitalize(word, index),
			)
			.join(""),
	pascalCase: (id) => splitWords(id).map(capitalize).join(""),
	snakeCase: (id) =>
		splitWords(id)
			.map((word) => word.toLocaleLowerCase())
			.join("_"),
	constantCase: (id) =>
		splitWords(id)
			.map((word) => word.toLocaleUpperCase())
			.join("_"),
};

export const compileFiles = async (paths, opts) => {
	const sources = await Promise.all(
		paths.map((path) =>
			// Node's EISDIR carries no path, so name it here or a failing input
			// is unidentifiable among several.
			// Stryker disable next-line ObjectLiteral,StringLiteral: equivalent
			// mutant — the sources are joined into a string, and Buffer#toString
			// already defaults to utf8, so dropping the encoding changes nothing.
			readFile(path, { encoding: "utf8" }).catch((e) => {
				throw new Error(`${path}: ${e.message}`, { cause: e });
			}),
		),
	);
	return compile(sources.join("\n\n"), opts);
};

export default compile;
