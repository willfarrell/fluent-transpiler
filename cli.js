#!/usr/bin/env node
// Copyright 2026 will Farrell, and fluent-transpiler contributors.
// SPDX-License-Identifier: MIT

import { createProgram } from "./program.js";

createProgram()
	.parseAsync()
	.catch((e) => {
		console.error(`Error: ${e.message}`);
		process.exit(1);
	});
