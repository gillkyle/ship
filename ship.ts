#!/usr/bin/env bun
import * as p from "@clack/prompts"
import pc from "picocolors"
import { isTerminal } from "./states.ts"
import type { State, Effect, Event, CliMode } from "./states.ts"
import { transition } from "./transitions.ts"
import { EffectExecutor } from "./effects.ts"
import { createLlmProvider } from "./llm.ts"
import { runSetup } from "./setup.ts"

// ── Argument parsing ───────────────────────────────────────────────

function parseArgs(argv: string[]): CliMode {
	const args = argv.slice(2)
	const hasLocal = args.includes("--local")
	const hasPush = args.includes("--push")
	const hasPr = args.includes("--pr")
	const hasStack = args.includes("--stack")

	const goalCount = [hasLocal, hasPush, hasPr].filter(Boolean).length
	if (goalCount > 1) {
		p.log.error("--local, --push, and --pr are mutually exclusive.")
		process.exit(1)
	}
	if (hasStack && !hasPush && !hasPr) {
		p.log.error("--stack requires --push or --pr.")
		process.exit(1)
	}

	const positional = args.filter(a => !a.startsWith("--"))
	if (positional[0] === "setup") return { kind: "setup" }

	if (hasLocal) return { kind: "auto", goal: "local", stack: false }
	if (hasPush) return { kind: "auto", goal: "push", stack: hasStack }
	if (hasPr) return { kind: "auto", goal: "pr", stack: hasStack }
	return { kind: "interactive" }
}

// ── Run loop ───────────────────────────────────────────────────────

const mode = parseArgs(process.argv)

if (mode.kind === "setup") {
	const { version } = await import("./package.json")
	p.intro(pc.bgCyan(pc.black(" ship setup ")) + pc.dim(` v${version}`))
	await runSetup()
	process.exit(0)
}

const { version } = await import("./package.json")

const modeLabel = mode.kind === "auto"
	? ` ${pc.dim(`--${mode.goal}${mode.stack ? " --stack" : ""}`)}`
	: ""
p.intro(pc.bgCyan(pc.black(" ship ")) + pc.dim(` v${version}`) + modeLabel)

const executor = new EffectExecutor(createLlmProvider(mode), mode)

let state: State = { kind: "preflight" }
let effects: Effect[] = [{ kind: "check_tools" }]

while (!isTerminal(state)) {
	let event: Event | null = null

	for (const eff of effects) {
		try {
			const result = await executor.execute(eff)
			if (result !== null) event = result
		} catch (err) {
			state = { kind: "error", message: err instanceof Error ? err.message : String(err) }
			break
		}
	}

	if (isTerminal(state)) break
	if (!event) {
		state = { kind: "error", message: "No event produced — state machine stalled." }
		break
	}

	const next = transition(state, event)
	state = next.state
	effects = next.effects
}

// ── Terminal rendering ─────────────────────────────────────────────

switch (state.kind) {
	case "done":
		p.outro(pc.green(state.message))
		break
	case "cancelled":
		p.cancel(state.message)
		break
	case "error":
		p.log.error(state.message)
		process.exit(1)
	case "nothing_to_ship":
		p.log.warn("Nothing to ship. Working tree is clean and no unmerged commits.")
		break
	case "merge_conflict":
		p.log.warn("Merge conflict detected. Resolve manually, then run ship again.")
		p.log.info(state.message)
		process.exit(1)
}
