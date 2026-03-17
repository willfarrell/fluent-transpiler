// Copyright 2026 will Farrell, and fluent-transpiler contributors.
// SPDX-License-Identifier: MIT

import { describe, expect, test } from "tstyche";
import { compile } from "./index.js";

describe("compile", () => {
	test("should accept source string and optional options", () => {
		expect(compile("hello = Hello")).type.toBe<string>();
	});

	test("should accept source with options object", () => {
		expect(
			compile("hello = Hello", {
				locale: ["en"],
				comments: true,
				errorOnJunk: true,
				variableNotation: "camelCase",
			}),
		).type.toBe<string>();
	});
});

describe("default export", () => {
	test("should be the compile function", async () => {
		const mod = await import("./index.js");
		expect(mod.default).type.toBe<typeof compile>();
	});
});
