# fluent-transpiler

Transpile Fluent (ftl) files into optimized, tree-shakable, JavaScript EcmaScript Modules (esm).

## Install

```bash
npm i -D fluent-transpiler
```

## CLI

```bash
Usage: ftl [options] <input>

Compile Fluent (.ftl) files to JavaScript (.js or .mjs)

Arguments:
  input                                   Path to the Fluent file to compile

Options:
  --locale <locale...>                    What locale(s) to be used. Multiple can be set to allow for fallback. i.e. en-CA
  --comments                              Include comments in output file.
  --variable-notation <variableNotation>  What variable notation to use with exports (choices: "camelCase", "pascalCase", "constantCase",
                                          "snakeCase", default: "camelCase")
  --disable-minify                        If disabled, all exported messages will have the same interface `(params) => ({value, attributes})`.
  --use-isolating                         Wrap placeable with \u2068 and \u2069.
  -o, --output <output>                   Path to store the resulting JavaScript file. Will be in ESM.
  -h, --help                              display help for command
```

## NodeJS

| Option           | Description                                                                                                                                                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| locale           | What locale(s) to be used. Multiple can be set to allow for fallback. i.e. en-CA                                                                                                                                                                             |
| comments         | Include comments in output file. Default: true                                                                                                                                                                                                               |
| disableMinify    | If disabled, all exported messages will have the same interface `(params) => ({value, attributes})`. Default: each exported message could be a different type based on what is needed to generate the message (`string`, `object`, `() => ''`, `() => ({})`) |
| errorOnJunk      | Throw error when `Junk` is parsed. Default: true                                                                                                                                                                                                             |
| variableNotation | What variable notation to use with exports. Default: `camelCase`                                                                                                                                                                                             |
| useIsolating     | Wrap placeable with \u2068 and \u2069. Default: false                                                                                                                                                                                                        |
| exportDefault    | Allows the overwriting of the `export default` to allow for custom uses. Default: See code                                                                                                                                                                   |

```javascript
import { readFile, writeFile } from 'node:fs/promises'
import fluentTranspiler from 'fluent-transpiler'

const ftl = await readFile('./path/to/en.ftl', { encoding: 'utf8' })
const js = fluentTranspiler(ftl, { locale: 'en-CA' })
await writeFile('./path/to/en.mjs', js, 'utf8')
```
