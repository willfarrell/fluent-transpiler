<div align="center">

<h1>fluent-transpiler</h1>
<p>Transpile Fluent (ftl) files into optimized, tree-shakable, JavaScript EcmaScript Modules (esm).</p>
<br />
<p>
  <a href="https://github.com/willfarrell/fluent-transpiler/actions/workflows/test-unit.yml"><img src="https://github.com/willfarrell/fluent-transpiler/actions/workflows/test-unit.yml/badge.svg" alt="GitHub Actions unit test status"></a>
  <a href="https://github.com/willfarrell/fluent-transpiler/actions/workflows/test-dast.yml"><img src="https://github.com/willfarrell/fluent-transpiler/actions/workflows/test-dast.yml/badge.svg" alt="GitHub Actions dast test status"></a>
  <a href="https://github.com/willfarrell/fluent-transpiler/actions/workflows/test-perf.yml"><img src="https://github.com/willfarrell/fluent-transpiler/actions/workflows/test-perf.yml/badge.svg" alt="GitHub Actions perf test status"></a>
  <a href="https://github.com/willfarrell/fluent-transpiler/actions/workflows/test-sast.yml"><img src="https://github.com/willfarrell/fluent-transpiler/actions/workflows/test-sast.yml/badge.svg" alt="GitHub Actions SAST test status"></a>
  <a href="https://github.com/willfarrell/fluent-transpiler/actions/workflows/test-lint.yml"><img src="https://github.com/willfarrell/fluent-transpiler/actions/workflows/test-lint.yml/badge.svg" alt="GitHub Actions lint test status"></a>
  <br/>
  <a href="https://www.npmjs.com/package/fluent-transpiler"><img alt="npm version" src="https://img.shields.io/npm/v/fluent-transpiler.svg"></a>
  <a href="https://packagephobia.com/result?p=fluent-transpiler"><img src="https://packagephobia.com/badge?p=fluent-transpiler" alt="npm install size"></a>
  <a href="https://www.npmjs.com/package/fluent-transpiler">
  <img alt="npm weekly downloads" src="https://img.shields.io/npm/dw/fluent-transpiler.svg"></a>
  <a href="https://www.npmjs.com/package/fluent-transpiler#provenance">
  <img alt="npm provenance" src="https://img.shields.io/badge/provenance-Yes-brightgreen"></a>
  <br/>
  <a href="https://scorecard.dev/viewer/?uri=github.com/willfarrell/fluent-transpiler"><img src="https://api.scorecard.dev/projects/github.com/willfarrell/fluent-transpiler/badge" alt="Open Source Security Foundation (OpenSSF) Scorecard"></a>
  <a href="https://slsa.dev"><img src="https://slsa.dev/images/gh-badge-level3.svg" alt="SLSA 3"></a>
  <a href="https://biomejs.dev"><img alt="Checked with Biome" src="https://img.shields.io/badge/Checked_with-Biome-60a5fa?style=flat&logo=biome"></a>
  <a href="https://conventionalcommits.org"><img alt="Conventional Commits" src="https://img.shields.io/badge/Conventional%20Commits-1.0.0-%23FE5196?logo=conventionalcommits&logoColor=white"></a>
  <a href="https://github.com/willfarrell/fluent-transpiler/blob/main/package.json#L15">
  <img alt="code coverage" src="https://img.shields.io/badge/code%20coverage-100%25-brightgreen"></a>
</p>
</div>

## Install

```bash
npm i -D fluent-transpiler
```

## CLI

```bash
Usage: ftl [options] <inputs...>

Compile Fluent (.ftl) files to JavaScript (.js or .mjs)

Arguments:
  inputs                                  Paths to the Fluent file(s) to compile. Multiple files are joined in order; ids must be unique across the set.

Options:
  --locale <locale...>                    What locale(s) to be used. Multiple can be set to allow for fallback. i.e. en-CA
  --comments                              Include comments in output file.
  --include-key <includeMessageKey...>    Allowed messages to be included. Default to include all.
  --exclude-key <excludeMessageKey...>    Ignored messages to be excluded. Default to exclude none.
  --exclude-value <excludeMessageValue>   Set message to an empty string when it equals this value. Default to not allowing empty strings.
  --variable-notation <variableNotation>  What variable notation to use with exports (choices: "camelCase", "pascalCase", "constantCase", "snakeCase", default: "camelCase")
  --disable-minify                        If disabled, all exported messages will have the same interface `(params) => ({value, attributes})`.
  --use-isolating                         Wrap placeable with \u2068 and \u2069.
  --no-error-on-junk                      Skip `Junk` instead of throwing an error.
  -o, --output <output>                   Path to store the resulting JavaScript file. Will be in ESM.
  -h, --help                              display help for command
```

## NodeJS

| Option           | Description                                                                                                                                                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| locale           | What locale(s) to be used. Multiple can be set to allow for fallback. i.e. `en-CA`                                                                                                                                                                           |
| comments         | Include comments in output file. Default: `true`                                                                                                                                                                                                             |
| includeKey       | Array of message keys to include; matches the exported name (`msgOne`) or the original FTL id (`msg-one`). Non-included messages remain private consts so references keep working. Default: `[]` (include all)                                                                                                                                                                                                |
| excludeKey       | Array of message keys to exclude; matches the exported name (`msgOne`) or the original FTL id (`msg-one`). Excluded messages remain private consts so references keep working. Default: `[]` (exclude none)                                                                                                                                                                                               |
| excludeValue     | Set message to an empty string when it equals this value. Default: `undefined`                                                                                                                                                                             |
| disableMinify    | If disabled, all exported messages will have the same interface `(params) => ({value, attributes})`. Default: each exported message could be a different type based on what is needed to generate the message (`string`, `object`, `() => ''`, `() => ({})`) |
| errorOnJunk      | Throw error when `Junk` is parsed. Default: `true`                                                                                                                                                                                                           |
| variableNotation | What variable notation to use with exports. Choices: `camelCase`, `pascalCase`, `snakeCase`, `constantCase`. Default: `camelCase`                                                                                                                            |
| useIsolating     | Wrap placeable with \u2068 and \u2069. Default: `false`                                                                                                                                                                                                      |
| params           | Parameter name used in generated message functions. Default: `params`                                                                                                                                                                                        |
| exportDefault    | Allows the overwriting of the `export default` to allow for custom uses. Default: See code                                                                                                                                                                   |

Messages and terms must be defined before they are referenced; referencing a
later definition is a compile error.

```javascript
import { readFile, writeFile } from 'node:fs/promises'
import fluentTranspiler from 'fluent-transpiler'

const ftl = await readFile('./path/to/en.ftl', { encoding: 'utf8' })
const js = fluentTranspiler(ftl, { locale: 'en-CA' })
await writeFile('./path/to/en.mjs', js, 'utf8')
```

### Attributes

A message that has attributes compiles to a `{value, attributes}` record.
`{ message }` resolves to its `.value` and `{ message.attr }` resolves to the
named attribute. Referencing an attribute that does not exist is a compile
error: `Unknown attribute "msg.missing"`.

```ftl
login = Sign in
    .title = Sign in to your account
tooltip = { login.title }
```

```javascript
export const login = {
  value: `Sign in`,
  attributes: {
    title: `Sign in to your account`
  }
}
export const tooltip = `${login.attributes.title}`
```

Term attributes are emitted as well. A term that has attributes compiles to a
`{value, attributes}` record; a term without attributes stays a bare string.
Per the Fluent spec a term attribute is only valid in selector position — a bare
`{ -brand.gender }` in a pattern is invalid Fluent and the parser rejects it as
`Junk`.

```ftl
-brand = Aurora
    .gender = feminine

brand-updated = { -brand.gender ->
    [feminine] { -brand } has been updated.
   *[other] The { -brand } app has been updated.
  }
```

```javascript
const brand = {
  value: `Aurora`,
  attributes: {
    gender: `feminine`
  }
}
export const brandUpdated = (params) => `${__select(
    brand.attributes.gender,
    {
      __proto__: null,
      'feminine': `${brand.value} has been updated.`
    },
    `The ${brand.value} app has been updated.`
  )}`
```

### Joining multiple files

`compile` also accepts an array of source strings, and `compileFiles` reads and
joins files from disk. Sources are concatenated in the order supplied; top-level
message and term ids must be unique across the set.

```javascript
import { writeFile } from 'node:fs/promises'
import { compileFiles } from 'fluent-transpiler'

const js = await compileFiles(
  ['./common.ftl', './brand.ftl', './app.ftl'],
  { locale: 'en-CA' },
)
await writeFile('./en.mjs', js, 'utf8')
```
