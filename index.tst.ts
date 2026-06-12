// Copyright 2026 will Farrell, and fluent-transpiler contributors.
// SPDX-License-Identifier: MIT

import { describe, expect, test } from "tstyche";
import { compile, compileFiles } from "./index.js";

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

	test("should accept an array of source strings", () => {
		expect(compile(["a = 1", "b = 2"], { locale: "en" })).type.toBe<string>();
	});

	test("should require locale when options are provided", () => {
		expect(compile("hello = Hello", {})).type.toRaiseError();
	});
});

describe("compileFiles", () => {
	test("should accept paths and return a Promise<string>", () => {
		expect(compileFiles(["./a.ftl", "./b.ftl"], { locale: "en" })).type.toBe<
			Promise<string>
		>();
	});
});

describe("default export", () => {
	test("should be the compile function", async () => {
		const mod = await import("./index.js");
		expect(mod.default).type.toBe<typeof compile>();
	});
});
