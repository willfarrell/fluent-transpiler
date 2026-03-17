// Copyright 2026 will Farrell, and fluent-transpiler contributors.
// SPDX-License-Identifier: MIT

export interface CompileOptions {
	/** What locale(s) to be used. Multiple can be set to allow for fallback. */
	locale?: string | string[];
	/** Include comments in output file. Default: `true` */
	comments?: boolean;
	/** Throw error when `Junk` is parsed. Default: `true` */
	errorOnJunk?: boolean;
	/** Array of message keys to include. Default: `[]` (include all) */
	includeKey?: string | string[];
	/** Array of message keys to exclude. Default: `[]` (exclude none) */
	excludeKey?: string | string[];
	/** Set message to an empty string when it contains this value. */
	excludeValue?: string;
	/** What variable notation to use with exports. Default: `"camelCase"` */
	variableNotation?: "camelCase" | "pascalCase" | "snakeCase" | "constantCase";
	/** If true, all exported messages will have the same interface `(params) => ({value, attributes})`. Default: `false` */
	disableMinify?: boolean;
	/** Wrap placeable with Unicode isolating characters. Default: `false` */
	useIsolating?: boolean;
	/** Parameter name used in generated functions. Default: `"params"` */
	params?: string;
	/** Allows overwriting the `export default` to allow for custom uses. */
	exportDefault?: string;
}

/**
 * Compile Fluent (.ftl) source into a JavaScript ESM string.
 */
export declare function compile(src: string, opts?: CompileOptions): string;

export default compile;
