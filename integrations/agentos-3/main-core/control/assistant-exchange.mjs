#!/usr/bin/env node

// Provider-specific Markdown exchange implementations remain compatibility
// adapters. The portable name is the only name exposed to the kernel.
export * from "./gpt-assist.mjs";
