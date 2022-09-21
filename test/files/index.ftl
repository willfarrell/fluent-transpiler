# https://projectfluent.org/fluent/guide/
# Writing Text
text = text: hard coded.

## Placeables
replaceParam = param: { $string } | { $integer } | {$decimal} | {$number} .

-term = Firefox
replaceTerm = term: { -term }.

-brand-name = 
    { $case ->
        *[nominative] Firefox
        [locative] Firefoksie
    }
parameterized-terms = Informacje o { -brand-name(case: "locative") }.


-term-with-var = {$number}
termWithVariable = {-term-with-var}

### Message References
messageValue = message: { replaceTerm }
messageNestedParamValue = message: { replaceParam }


## Special Characters
openingBrace = This message features an opening curly brace: {"{"}.
closingBrace = This message features a closing curly brace: {"}"}.

blankIsRemoved =     This message starts with no blanks.
blankIsPreserved = {"    "}This message starts with 4 spaces.

leadingBracket =
  This message has an opening square bracket
  at the beginning of the third line:
  {"["}.

literalQuote = Text in "double quotes".
# This is OK, but cryptic and hard to read and edit.
literalEscapedQuote = Text in {"\""}double quotes{"\""}.


privacyLabel = Privacy{"\u00A0"}Policy

# The dash character is an EM DASH but depending on the font face,
# it might look like an EN DASH.
dash = It's a dash—or is it?

dashUnicode = It's a dash{"\u2014"}or is it?

emoji = 😂
emojiUnicode = {"\u01F602"}

## Multiline Text
singleLine = Text can be written in a single line.

multiLine = Text can also span multiple lines
  as long as each new line is indented
  by at least one space.

block =
  Sometimes it's more readable to format
  multiline text as a "block", which means
  starting it on a new line. All lines must
  be indented by at least one space.
  
leadingBlankSpaces =     This message's value starts with the word "This".
leadingBlankLines =


  This message's value starts with the word "This".
  The blank lines under the identifier are ignored.

blankLines =

  The blank line above this line is ignored.
  This is a second line of the value.
  
  The blank line above this line is preserved.

multiLineIndent =
    This message has 4 spaces of indent
    on the second line of its value.

## Functions
timeElapsed = Time elapsed: { NUMBER($number, maximumFractionDigits: 0) }s.

todayIs = Today is { DATETIME($date) }

## Selectors
selectorNumberCardinal =
{ $number ->
  [zero] There are {$number} (zero).
  [one] There are {$number} (one).
   *[other] There are { $number } (other).
}

selectorNumberOrdinal =
{ NUMBER($number, type: "ordinal") ->
  [-1] There are {$number} (-1).
  [zero] There are {$number} (zero).
  [one] There are {$number} (one).
  [two] There are {$number} (two).
  [3.0] There are {$number} (3).
  [few] There are {$number} (few).
  [many] There are {$number} (many).
  [toomany] There are {$number} (toomany).
   *[other] There are { $number } (other).
}

subSelector = {selectorNumberOrdinal}

## Attributes
loginInput = Predefined value
  .placeholder = email@example.com
  .ariaLabel = Login input value
  .title = Type your login email

attributeHowTo =
    To add an attribute to this messages, write
    {".attr = Value"} on a new line.
    .attr = An actual attribute (not part of the text value above)
