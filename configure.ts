import * as p from "@clack/prompts"
import pc from "picocolors"
import { loadConfig, saveConfig, CONFIG_PATH, DEFAULT_MERGE_STRATEGY, type MergeStrategy } from "./config.ts"

export async function runConfigure(): Promise<void> {
	const config = loadConfig()
	const current = config.mergeStrategy ?? DEFAULT_MERGE_STRATEGY

	p.log.info(`Current config ${pc.dim(CONFIG_PATH)}`)
	p.log.info(`  Merge strategy:  ${pc.cyan(current)}`)

	const strategy = await p.select({
		message: "Merge strategy for PRs",
		options: [
			{ value: "merge" as const, label: "merge" },
			{ value: "squash" as const, label: "squash" },
			{ value: "rebase" as const, label: "rebase" },
		],
		initialValue: current,
	})
	if (p.isCancel(strategy)) { p.cancel("Config cancelled."); return }

	config.mergeStrategy = strategy as MergeStrategy
	saveConfig(config)
	p.outro(pc.green("Config saved to ") + pc.dim(CONFIG_PATH))
}
