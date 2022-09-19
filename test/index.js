import test from 'node:test'
import { deepEqual } from 'node:assert'
import {readFile,writeFile} from 'node:fs/promises'
import compile from '../index.js'

import { FluentBundle, FluentResource } from "@fluent/bundle"

// input
const ftl = await readFile('./test/files/index.ftl', {encoding:'utf8'})

// compiled
const js = compile(ftl, {locale:'en-CA', variableNotation: 'camelCase', useIsolating:false})
await writeFile('./test/files/index.mjs', js, 'utf8')
const {default:fluentCompiled} = await import('./files/index.mjs') // TODO fix default

// core
let bundle = new FluentBundle('en-CA', {useIsolating:false});
let errors = bundle.addResource(new FluentResource(ftl));
if (errors.length) {
  console.log('Error: bundle.addResource', errors)
}
const fluentBundle = (id, params) => {
  const message = bundle.getMessage(id)
  if (!message) {
    console.log('Error', id, message)
    return 'error'
  }
  const attributes = {}
  for(const attr in message.attributes) {
    attributes[attr] = bundle.formatPattern(message.attributes[attr], params)
  }
  const value = bundle.formatPattern(message.value, params)
  if (Object.keys(message.attributes).length) {
    return {value, attributes}
  }
  return value
}

// compile
test(`Should throw error when Junk is parsed`, async (t) => {
  try {
    const js = compile(`-brand-name = {}`, {locale:'en-CA', errorOnJunk:true})
    console.log(js)
    throw new Error('fail')
  } catch (e) {
    deepEqual(e.message, 'Junk found')
  }
})

test(`Should include comments`, async (t) => {
    const js = compile(`
# Comment
## GroupComment
### ResourceComment
`, {locale:'en-CA', comments:true})
    deepEqual(js.includes(`// # Comment
// ## GroupComment
// ### ResourceComment`), true)

})

// tests
const params = {string:'0.0',integer:-2, decimal: 3.5, number:9999999.00, date: new Date()}
for (const id of Object.keys(fluentCompiled)) {
  if (id === 'default') continue
  test(`Should format ${id}`, async (t) => {
    deepEqual(fluentCompiled(id, params), fluentBundle(id, params))
  })
}

// selector
for(const param of [-1,0,1,2,3,4,5,10]) {
  let id = 'selectorNumberCardinal'
  test(`Should format ${id} with ${param}`, async (t) => {
     params.number = param
    deepEqual(fluentCompiled(id, params), fluentBundle(id, params))
  })

  id = 'selectorNumberOrdinal'
  test(`Should format ${id} with ${param}`, async (t) => {
     params.number = param
    deepEqual(fluentCompiled(id, params), fluentBundle(id, params))
  })
}
