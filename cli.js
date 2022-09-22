#!/usr/bin/env node

import { createReadStream } from 'fs'
import { stat, readFile, writeFile } from 'node:fs/promises'
import { Command, Option } from 'commander'
import compile from './index.js'

const fileExists = async (filepath) => {
	const stats = await stat(filepath)
	if (!stats.isFile()) {
	  throw new Error(`${filepath} is not a file`)
	}
}

new Command()
  .name('ftl')
  .description('Compile Fluent (.ftl) files to JavaScript (.js or .mjs)')
  //.version(package.version)
  .argument('<input>', 'Path to the Fluent file to compile')
  .requiredOption('--locale <locale...>', 'What locale(s) to be used. Multiple can be set to allow for fallback. i.e. en-CA')
  .addOption(new Option('--comments', 'Include comments in output file.')
    .preset(true)
  )
  .addOption(new Option('--include <includeMessages...>', 'Allowed messages to be included. Default to include all.'))
  .addOption(new Option('--exclude <excludeMessages...>', 'Ignored messages to be excluded. Default to exclude none.'))
  /*.addOption(new Option('--tree-shaking', 'Export all messages to allow tree shaking')
    .preset(true)
  )*/
  .addOption(new Option('--variable-notation <variableNotation>', 'What variable notation to use with exports')
    .choices(['camelCase','pascalCase','constantCase','snakeCase'])
	  .default('camelCase')
  )
  .addOption(new Option('--disable-minify', 'If disabled, all exported messages will have the same interface `(params) => ({value, attributes})`.')
	.preset(true)
  )
  .addOption(new Option('--use-isolating', 'Wrap placeable with \\u2068 and \\u2069.')
  	.preset(true)
  )
  .addOption(new Option('-o, --output <output>', 'Path to store the resulting JavaScript file. Will be in ESM.'))
  .action(async (input, options) => {
	await fileExists(input)
	
	const ftl = await readFile(input, {encoding:'utf8'})
	
	const js = compile(ftl, options)
	if (options.output) {
		await writeFile(options.output, js, 'utf8')
	} else {
		console.log(js)
	}
	
  })
  .parse()

