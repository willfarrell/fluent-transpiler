import { parse } from '@fluent/syntax'
import { camelCase, pascalCase, constantCase, snakeCase } from 'change-case'

const exportDefault = `(id, params) => {
	const source = __exports[id] ?? __exports['_'+id]
	if (typeof source === 'undefined') return '*** '+id+' ***'
	if (typeof source === 'function') return source(params)
	return source
}
`
export const compile = (src, opts) => {
	const options = {
		variableNotation: 'camelCase',
		disableMinify: false, // TODO needs better name
		params: 'params',
		comments: true,
		errorOnJunk: true,
		useIsolating: false,
		exportDefault,
		...opts,
	}
	if (!Array.isArray(options.locale)) options.locale = [options.locale]
	
	const metadata = {}
	const functions = {} // global functions
	let variable
	
	const regexpValidVariable = /^[a-zA-Z]+[a-zA-Z0-9]*$/
	const compileAssignment = (data) => {
		variable = compileType(data)
		metadata[variable] = {
			id: data.name,
			term: false,
			params: false
		}
		return variable
	}
	
	const compileFunctionArguments = (data) => {
		const positional = data.arguments?.positional.map(data => {
			return types[data.type](data)
		})
		const named = data.arguments?.named.reduce((obj, data) => {
			// NamedArgument
			const key = data.name.name
			const value = compileType(data.value, data.type)
			obj[key] = value
			return obj
		}, {})
		return {positional, named}
	}
	
	const compileType = (data, parent) => {
		try {
			return types[data.type](data, parent)
		} catch(e) {
			console.error('Error:', e.message, data, e.stack)
			throw new Error(e.message, {cause:data, stack:e.stack})
		}
	}
	
	const types = {
		Identifier: (data) => {
			const value = variableNotation[options.variableNotation](data.name)
			// Check for reserved words - TODO add in rest
			if (['const','default','enum','if'].includes(value)) {
				return '_'+value
			}
			return value
		},
		Attribute: (data) => {
			const key = compileType(data.id)
			const value = compileType(data.value, data.type)
			return `  ${key}: ${value}`
		},
		Pattern: (data, parent) => {
			return '`' + data.elements.map(data => {
				return compileType(data, parent)
			}).join('') + '`'
		},
		// resources
		Term: (data) => {
			const  assignment = compileAssignment(data.id)
			const templateStringLiteral = compileType(data.value)
			metadata[variable].term = true
			if (metadata[assignment].params) {
				return `const ${assignment} = (${options.params}) => ${templateStringLiteral}\n`
			}
			return `const ${assignment} = ${templateStringLiteral}\n`
		},
		Message: (data) => {
			const assignment = compileAssignment(data.id)
			const templateStringLiteral = data.value && compileType(data.value, data.type)
			metadata[assignment].attributes = data.attributes.length
			let attributes = {}
			if (metadata[assignment].attributes) {
				// use Object.create(null) ?
				attributes = `{\n${data.attributes.map(data => {
						return '  '+compileType(data)
					}).join(',\n')}\n  }`
			}
			//
			if (!options.disableMinify) {
				if (metadata[variable].attributes) {
					if (metadata[assignment].params) {
						return `export const ${assignment} = (${options.params}) => ({
  value:${templateStringLiteral},
  attributes:${attributes}
})\n`
					}
					return `export const ${assignment} = {
  value: ${templateStringLiteral},
  attributes: ${attributes}
}\n`
				}
				if (metadata[assignment].params) {
					return `export const ${assignment} = (${options.params}) => ${templateStringLiteral}\n`
				}
				return `export const ${assignment} = ${templateStringLiteral}\n`
			}
			// consistent API
			return `export const ${variable} = (${metadata[assignment].params ? options.params : ''}) => ({
  value:${templateStringLiteral},
  attributes:${attributes}
})\n`
		},
		Comment: (data) => {
			if (options.comments) return `// # ${data.content}\n`
			return ''
		},
		GroupComment: (data) => {
			if (options.comments) return `// ## ${data.content}\n`
			return ''
		},
		ResourceComment: (data) => {
			if (options.comments) return `// ### ${data.content}\n`
			return ''
		},
		Junk: (data) => {
			if (options.errorOnJunk) {
				throw new Error('Junk found', {cause:data})
			}
			console.error('Error: Skipping Junk', JSON.stringify(data, null, 2))
			return ''
		},
		// Element
		TextElement: (data) => {
			return data.value
		},
		Placeable: (data, parent) => {
			return `${options.useIsolating ? '\u2068' : '' }\${${compileType(data.expression, parent)}}${options.useIsolating ? '\u2069' : '' }`
		},
		// Expression
		StringLiteral: (data, parent) => {
			// JSON.stringify at parent level
			if (['NamedArgument'].includes(parent)) {
				return `${data.value}`
			}
			return `"${data.value}"`
		},
		NumberLiteral: (data) => {
			const decimal =  Number.parseFloat(data.value)
			const number = Number.isInteger(decimal) ? Number.parseInt(data.value) : decimal 
			return Intl.NumberFormat(options.locale).format(number)
		},
		VariableReference: (data, parent) => {
			functions.__formatVariable = true
			metadata[variable].params = true
			const value = `${options.params}?.${data.id.name}`
			if (['Message','Variant','Attribute'].includes(parent)) {
				return `__formatVariable(${value})`
			}
			return value
		},
		MessageReference: (data) => {
			const messageName = compileType(data.id)
			metadata[variable].params ||= metadata[messageName].params
			if (!options.disableMinify) {
				if (metadata[messageName].params) {
					return `${messageName}(${options.params})`
				}
				return `${messageName}`
			}
			return `${messageName}(${metadata[messageName].params ? options.params : ''})`
		},
		TermReference: (data) => {
			const termName = compileType(data.id)
			const {named} = compileFunctionArguments(data)
			if (!options.disableMinify) {
				if (metadata[termName].params) {
					return `${termName}(${JSON.stringify(named)})`
				}
				return `${termName}`
			}
			return `${termName}(${named ? JSON.stringify(named) : ''})`
		},
		NamedArgument:(data) => {
			// Inconsistent: `NamedArgument` uses `name` instead of `id` for Identifier
			const key = data.name.name // Don't transform value
			const value = compileType(data.value, data.type)
			return `${key}: ${value}`
		},
		SelectExpression: (data) => {
			functions.__select = true
			metadata[variable].params = true
			const value = compileType(data.selector)
			//const options = data.selector
			let fallback
			return `__select(\n    ${value},\n    {\n${data.variants.filter(data => {
					if (data.default) {
						fallback = compileType(data.value, data.type)
					}
					return !data.default
				}).map(data => {
					return '  '+compileType(data)
				}).join(',\n')}\n    },\n    ${fallback}\n  )`
		},
		Variant: (data, parent) => {
			// Inconsistent: `Variant` uses `key` instead of `id` for Identifier
			const key = compileType(data.key)
			const value = compileType(data.value, data.type)
			return `    '${key}': ${value}`
		},
		FunctionReference: (data) => {
			return `${types[data.id.name](compileFunctionArguments(data))}`
		},
		// Functions
		DATETIME: (data) => {
			functions.__formatDateTime = true
			const {positional, named} = data
			const value = positional.shift()
			return `__formatDateTime(${value}, ${JSON.stringify(named)})`
		},
		NUMBER: (data) => {
			functions.__formatNumber = true
			const {positional, named} = data
			const value = positional.shift()
			return `__formatNumber(${value}, ${JSON.stringify(named)})`
		},
	}
	
	if (/\t/.test(src)) {
		console.error('Source file contains tab characters (\t), replacing with <space>x4')
		src = src.replace(/\t/g, '    ')
	}
	
	const {body} = parse(src)
	
	let translations = ``
	for(const data of body) {
		translations += compileType(data)
	}
	
	let output = ``
	if (functions.__formatVariable || functions.__formatDateTime || functions.__formatNumber) {
		output += `const __locales = ${JSON.stringify(opts.locale)}\n`
	}

	if (functions.__formatDateTime) {
		output += `
const __formatDateTime = (value, options) => {
	return new Intl.DateTimeFormat(__locales, options).format(value)
}
`
	}
	if (functions.__formatVariable || functions.__formatNumber) {
		output += `
const __formatNumber = (value, options) => {
	return new Intl.NumberFormat(__locales, options).format(value)
}
`
	}
	if (functions.__formatVariable) {
			output += `
const __formatVariable = (value) => {
  if (typeof value === 'string') return value
  const decimal =  Number.parseFloat(value)
  const number = Number.isInteger(decimal) ? Number.parseInt(value) : decimal
  return __formatNumber(number)
}
`
	}
	if (functions.__select) {
		output += `
const __select = (value, cases, fallback, options) => {
	const pluralRules = new Intl.PluralRules(__locales, options)
	const rule = pluralRules.select(value)
	return cases[value] ?? cases[rule] ?? fallback
}
`
	}
	output += `\n`+translations
	output += `const __exports = {${Object.keys(metadata)
			.filter(key => !metadata[key].term)
			.map(key => {
				if (key === metadata[key].id) return key
				return `'${metadata[key].id}':${key}`
			})
			.join(', ')
		}}\n`
	output += `\nexport default ${options.exportDefault}`
	
	return output
}


const variableNotation = {
	camelCase,
	pascalCase,
	snakeCase, 
	constantCase
}
// for `export defaults`

export default compile