// Copyright 2026 will Farrell, and fluent-transpiler contributors.
// SPDX-License-Identifier: MIT

import { parse } from "@fluent/syntax";
import { camelCase, constantCase, pascalCase, snakeCase } from "change-case";

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
  const source = __exports[id] ?? __exports['_'+id]
  if (typeof source === 'undefined') return '*** '+id+' ***'
  if (typeof source === 'function') return source(params)
  return source
}
`;
export const compile = (src, opts) => {
	const options = {
		comments: true,
		errorOnJunk: true,
		includeKey: [],
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
		metadata[variable] = {
			id: data.name,
			term: false,
			params: false,
		};
		return variable;
	};

	const compileFunctionArguments = (data) => {
		const positional = data.arguments?.positional.map((data) => {
			return types[data.type](data);
		});
		const named = data.arguments?.named.reduce((obj, data) => {
			const entry = compileType(data);
			const [key, value] = entry.split(": ");
			obj[key] = value;
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
			return (
				"`" +
				data.elements
					.map((data) => {
						return compileType(data, parent);
					})
					.join("") +
				"`"
			);
		},
		// resources
		Term: (data) => {
			const assignment = compileAssignment(data.id);
			const templateStringLiteral = compileType(data.value);
			metadata[assignment].term = true;
			if (metadata[assignment].params) {
				return `const ${assignment} = (${options.params}) => ${templateStringLiteral}\n`;
			}
			return `const ${assignment} = ${templateStringLiteral}\n`;
		},
		Message: (data) => {
			const assignment = compileAssignment(data.id);

			if (
				options.includeKey.length &&
				!options.includeKey.includes(assignment)
			) {
				return "";
			}

			if (
				options.excludeKey.length &&
				options.excludeKey.includes(assignment)
			) {
				return "";
			}

			let templateStringLiteral =
				data.value && compileType(data.value, data.type);

			if (options.excludeValue === templateStringLiteral) {
				templateStringLiteral = "``";
			}

			metadata[assignment].attributes = data.attributes.length;
			let attributes = {};
			if (metadata[assignment].attributes) {
				attributes = `{\n${data.attributes
					.map((data) => {
						return `  ${compileType(data)}`;
					})
					.join(",\n")}\n  }`;
			}

			let message = "";
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

			if (assignment === metadata[assignment].id) {
				exports.push(`${assignment}`);
			} else {
				exports.push(`'${metadata[assignment].id}': ${assignment}`);
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
			return data.value.replaceAll("`", "\\`"); // escape string literal
		},
		Placeable: (data, parent) => {
			return `${options.useIsolating ? "\u2068" : ""}\${${compileType(
				data.expression,
				parent,
			)}}${options.useIsolating ? "\u2069" : ""}`;
		},
		// Expression
		StringLiteral: (data, parent) => {
			// JSON.stringify at parent level
			if (["NamedArgument"].includes(parent)) {
				return `${data.value}`;
			}
			return `"${data.value}"`;
		},
		NumberLiteral: (data) => {
			const decimal = Number.parseFloat(data.value);
			const number = Number.isInteger(decimal)
				? Number.parseInt(data.value, 10)
				: decimal;
			return Intl.NumberFormat(options.locale).format(number);
		},
		VariableReference: (data, parent) => {
			functions.__formatVariable = true;
			metadata[variable].params = true;
			const value = `${options.params}?.${data.id.name}`;
			if (["Message", "Variant", "Attribute"].includes(parent)) {
				return `__formatVariable(${value})`;
			}
			return value;
		},
		MessageReference: (data) => {
			const messageName = compileType(data.id);
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
		NamedArgument: (data) => {
			// Inconsistent: `NamedArgument` uses `name` instead of `id` for Identifier
			const key = data.name.name; // Don't transform value
			const value = compileType(data.value, data.type);
			return `${key}: ${value}`;
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
		Variant: (data, parent) => {
			// Inconsistent: `Variant` uses `key` instead of `id` for Identifier
			const key = compileType(data.key);
			const value = compileType(data.value, data.type);
			return `    '${key}': ${value}`;
		},
		FunctionReference: (data) => {
			return `${types[data.id.name](compileFunctionArguments(data))}`;
		},
		// Functions
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

	if (/\t/.test(src)) {
		src = src.replace(/\t/g, "    ");
	}

	const { body } = parse(src);
	let translations = ``;
	for (const data of body) {
		translations += compileType(data);
	}

	let output = ``;
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
  if (typeof value === 'string') value = new Date(value)
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
  if (typeof value === 'string') value = new Date(value)
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
const __formatVariable = (value) => {
  if (typeof value === 'string') return value
  const decimal = Number.parseFloat(value)
  const number = Number.isInteger(decimal) ? Number.parseInt(value, 10) : decimal
  return __formatNumber(number)
}
`;
	}
	if (functions.__select) {
		output += `
const __select = (value, cases, fallback, options) => {
  const k = JSON.stringify(options) ?? ''
  const rule = (__intlCache['P'+k] ??= new Intl.PluralRules(__locales, options)).select(value)
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

export default compile;
