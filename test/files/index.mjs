const __locales = "en-CA"

const __formatDateTime = (value, options) => {
	return new Intl.DateTimeFormat(__locales, options).format(value)
}

const __formatNumber = (value, options) => {
	return new Intl.NumberFormat(__locales, options).format(value)
}

const __formatVariable = (value) => {
  if (typeof value === 'string') return value
  const decimal =  Number.parseFloat(value)
  const number = Number.isInteger(decimal) ? Number.parseInt(value) : decimal
  return __formatNumber(number)
}

const __select = (value, cases, fallback, options) => {
	const pluralRules = new Intl.PluralRules(__locales, options)
	const rule = pluralRules.select(value)
	return cases[value] ?? cases[rule] ?? fallback
}

export const text = `text: hard coded.`
// ## Placeables
export const replaceParam = (params) => `param: ${__formatVariable(params?.string)} | ${__formatVariable(params?.integer)} | ${__formatVariable(params?.decimal)} | ${__formatVariable(params?.number)} .`
const term = `Firefox`
export const replaceTerm = `term: ${term}.`
const brandName = (params) => `${__select(
    params?.case,
    {
      'locative': `Firefoksie`
    },
    `Firefox`
  )}`
export const parameterizedTerms = (params) => `Informacje o ${brandName({ ...params, "case":"locative" })}.`
const termWithVar = (params) => `${params?.number}`
export const termWithVariable = (params) => `${termWithVar(params)}`
// ### Message References
export const messageValue = `message: ${replaceTerm}`
export const messageNestedParamValue = (params) => `message: ${replaceParam(params)}`
// ## Special Characters
export const openingBrace = `This message features an opening curly brace: ${"{"}.`
export const closingBrace = `This message features a closing curly brace: ${"}"}.`
export const blankIsRemoved = `This message starts with no blanks.`
export const blankIsPreserved = `${"    "}This message starts with 4 spaces.`
export const leadingBracket = `This message has an opening square bracket
at the beginning of the third line:
${"["}.`
export const literalQuote = `Text in "double quotes".`
export const literalEscapedQuote = `Text in ${"\""}double quotes${"\""}.`
export const privacyLabel = `Privacy${"\u00A0"}Policy`
export const dash = `It's a dash—or is it?`
export const dashUnicode = `It's a dash${"\u2014"}or is it?`
export const emoji = `😂`
export const emojiUnicode = `${"\u01F602"}`
// ## Multiline Text
export const singleLine = `Text can be written in a single line.`
export const multiLine = `Text can also span multiple lines
as long as each new line is indented
by at least one space.`
export const block = `Sometimes it's more readable to format
multiline text as a "block", which means
starting it on a new line. All lines must
be indented by at least one space.`
export const leadingBlankSpaces = `This message's value starts with the word "This".`
export const leadingBlankLines = `This message's value starts with the word "This".
The blank lines under the identifier are ignored.`
export const blankLines = `The blank line above this line is ignored.
This is a second line of the value.

The blank line above this line is preserved.`
export const multiLineIndent = `This message has 4 spaces of indent
on the second line of its value.`
// ## Functions
export const timeElapsed = (params) => `Time elapsed: ${__formatNumber(params?.number, {"maximumFractionDigits":"0"})}s.`
export const todayIs = (params) => `Today is ${__formatDateTime(params?.date, {})}`
// ## Selectors
export const selectorNumberCardinal = (params) => `${__select(
    params?.number,
    {
      'zero': `There are ${__formatVariable(params?.number)} (zero).`,
      'one': `There are ${__formatVariable(params?.number)} (one).`
    },
    `There are ${__formatVariable(params?.number)} (other).`
  )}`
export const selectorNumberOrdinal = (params) => `${__select(
    __formatNumber(params?.number, {"type":"ordinal"}),
    {
      '-1': `There are ${__formatVariable(params?.number)} (-1).`,
      'zero': `There are ${__formatVariable(params?.number)} (zero).`,
      'one': `There are ${__formatVariable(params?.number)} (one).`,
      'two': `There are ${__formatVariable(params?.number)} (two).`,
      '3': `There are ${__formatVariable(params?.number)} (3).`,
      'few': `There are ${__formatVariable(params?.number)} (few).`,
      'many': `There are ${__formatVariable(params?.number)} (many).`,
      'toomany': `There are ${__formatVariable(params?.number)} (toomany).`
    },
    `There are ${__formatVariable(params?.number)} (other).`
  )}`
export const subSelector = (params) => `${selectorNumberOrdinal(params)}`
// ## Attributes
export const loginInput = {
  value: `Predefined value`,
  attributes: {
    placeholder: `email@example.com`,
    ariaLabel: `Login input value`,
    title: `Type your login email`
  }
}
export const attributeHowTo = {
  value: `To add an attribute to this messages, write
${".attr = Value"} on a new line.`,
  attributes: {
    attr: `An actual attribute (not part of the text value above)`
  }
}
const __exports = {
  text,
  replaceParam,
  replaceTerm,
  'parameterized-terms': parameterizedTerms,
  termWithVariable,
  messageValue,
  messageNestedParamValue,
  openingBrace,
  closingBrace,
  blankIsRemoved,
  blankIsPreserved,
  leadingBracket,
  literalQuote,
  literalEscapedQuote,
  privacyLabel,
  dash,
  dashUnicode,
  emoji,
  emojiUnicode,
  singleLine,
  multiLine,
  block,
  leadingBlankSpaces,
  leadingBlankLines,
  blankLines,
  multiLineIndent,
  timeElapsed,
  todayIs,
  selectorNumberCardinal,
  selectorNumberOrdinal,
  subSelector,
  loginInput,
  attributeHowTo
}
export default (id, params) => {
	const source = __exports[id] ?? __exports['_'+id]
	if (typeof source === 'undefined') return '*** '+id+' ***'
	if (typeof source === 'function') return source(params)
	return source
}
