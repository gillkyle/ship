import * as p from "@clack/prompts"
import pc from "picocolors"
import { loadConfig, saveConfig, CONFIG_PATH } from "./config.ts"

export async function runSetup(): Promise<void> {
	const config = loadConfig()

	const has = (key?: string) => key ? `${pc.green("set")} (${key.slice(0, 5)}...)` : pc.dim("not set")
	p.log.info(`Current config ${pc.dim(CONFIG_PATH)}`)
	p.log.info(`  Groq API key:      ${has(config.groqApiKey)}`)
	p.log.info(`  Anthropic API key:  ${has(config.anthropicApiKey)}`)

	const provider = await p.select({
		message: "Which provider do you want to configure?",
		options: [
			{ value: "groq", label: "Groq" },
			{ value: "anthropic", label: "Anthropic" },
			{ value: "both", label: "Both" },
		],
	})
	if (p.isCancel(provider)) { p.cancel("Setup cancelled."); return }

	if (provider === "groq" || provider === "both") {
		const key = await p.password({ message: "Groq API key:" })
		if (p.isCancel(key)) { p.cancel("Setup cancelled."); return }
		if (key) config.groqApiKey = key
	}

	if (provider === "anthropic" || provider === "both") {
		const key = await p.password({ message: "Anthropic API key:" })
		if (p.isCancel(key)) { p.cancel("Setup cancelled."); return }
		if (key) config.anthropicApiKey = key
	}

	saveConfig(config)
	p.outro(pc.green("Config saved to ") + pc.dim(CONFIG_PATH))
}
