// Copyright 2026 will Farrell, and fluent-transpiler contributors.
// SPDX-License-Identifier: MIT

import { readFile } from "node:fs/promises";
import { parse } from "@fluent/syntax";
import { camelCase, constantCase, pascalCase, snakeCase } from "change-case";

const collectTopLevelIds = (src) => {
	const { body } = parse(src);
	const ids = [];
	for (const node of body) {
		if (node.type === "Message" || node.type === "Term") {
			ids.push(node.id.name);
		}
	}
	return ids;
};

const checkDuplicates = (sources) => {
	const seen = new Map();
	const duplicates = [];
	for (const { label, src } of sources) {
		for (const id of collectTopLevelIds(src)) {
			const prior = seen.get(id);
			if (prior === undefined) {
				seen.set(id, label);
			} else if (prior !== label) {
				duplicates.push({ id, a: prior, b: label });
			}
		}
	}
	if (duplicates.length) {
		const lines = duplicates.map(
			(d) => `  - "${d.id}" defined in ${d.a} and ${d.b}`,
		);
		throw new Error(`Duplicate id(s) found:\n${lines.join("\n")}`);
	}
};

const reservedWords = new Set([
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
		const sources = src.map((s, i) => ({ label: `source[${i}]`, src: s }));
		checkDuplicates(sources);
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

	const compileAssignment = (data) => {
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
			params: false,
		};
		return variable;
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
			const value =
				parent === "Attribute"
					? data.name
					: variableNotation[options.variableNotation](data.name);

			if (value.includes("-")) {
				return `'${value}'`;
			}
			// Check for reserved words
			if (reservedWords.has(value)) {
				return `_${value}`;
			}
			return value;
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
			const assignment = compileAssignment(data.id);
			const templateStringLiteral = compileType(data.value, data.type);
			if (metadata[assignment].params) {
				return `const ${assignment} = (${options.params}) => ${templateStringLiteral}\n`;
			}
			return `const ${assignment} = ${templateStringLiteral}\n`;
		},
		Message: (data) => {
			const assignment = compileAssignment(data.id);

			let templateStringLiteral =
				data.value && compileType(data.value, data.type);

			if (options.excludeValue === templateStringLiteral) {
				templateStringLiteral = "``";
			}

			metadata[assignment].attributes = data.attributes.length;
			let attributes = "{}";
			if (metadata[assignment].attributes) {
				attributes = `{\n${data.attributes
					.map((data) => {
						return `  ${compileType(data)}`;
					})
					.join(",\n")}\n  }`;
			}

			let message;
			if (!options.disableMinify) {
				if (metadata[assignment].attributes) {
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
			// JSON.stringify at parent level
			if (["NamedArgument"].includes(parent)) {
				return `${data.value}`;
			}
			return `"${data.value}"`;
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
			if (!options.disableMinify) {
				if (metadata[messageName].params) {
					return `${messageName}(${options.params})`;
				}
				return `${messageName}`;
			}
			return `${messageName}(${
				metadata[messageName].params ? options.params : ""
			})`;
		},
		TermReference: (data) => {
			const termName = compileType(data.id);
			if (metadata[termName] === undefined) {
				throw new Error(
					`Unknown reference "${data.id.name}" (messages and terms must be defined before they are referenced)`,
				);
			}
			metadata[variable].params ||= metadata[termName].params;

			let params;
			if (metadata[termName].params) {
				let { named } = compileFunctionArguments(data);
				named = JSON.stringify(named);
				if (named) {
					params = `{ ...${options.params}, ${named.substring(
						1,
						named.length - 1,
					)} }`;
				} else {
					params = options.params;
				}
			}
			if (!options.disableMinify) {
				if (metadata[termName].params) {
					return `${termName}(${params})`;
				}
				return `${termName}`;
			}
			return `${termName}(${params ? params : ""})`;
		},
		SelectExpression: (data) => {
			functions.__select = true;
			metadata[variable].params = true;
			const value = compileType(data.selector);
			let fallback;
			return `__select(\n    ${value},\n    {\n${data.variants
				.filter((data) => {
					if (data.default) {
						fallback = compileType(data.value, data.type);
					}
					return !data.default;
				})
				.map((data) => {
					return `  ${compileType(data)}`;
				})
				.join(",\n")}\n    },\n    ${fallback}\n  )`;
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

	src = src.replace(/\t/g, "    ");

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
	output += `const __exports = {\n  ${exports.join(",\n  ")}\n}`;
	output += `\nexport default ${options.exportDefault}`;

	return output;
};

const variableNotation = {
	camelCase,
	pascalCase,
	snakeCase,
	constantCase,
};

export const compileFiles = async (paths, opts) => {
	const sources = await Promise.all(
		paths.map(async (path) => ({
			label: path,
			src: await readFile(path, { encoding: "utf8" }),
		})),
	);
	checkDuplicates(sources);
	return compile(sources.map((s) => s.src).join("\n\n"), opts);
};

export default compile;
