import { homedir } from "node:os"
import { join } from "node:path"
import { readFileSync, mkdirSync, writeFileSync, chmodSync } from "node:fs"

export const CONFIG_PATH = join(homedir(), ".config", "ship", "config.json")

export interface ShipConfig {
	groqApiKey?: string
	anthropicApiKey?: string
}

export function loadConfig(): ShipConfig {
	try {
		return JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as ShipConfig
	} catch {
		return {}
	}
}

export function saveConfig(config: ShipConfig): void {
	const dir = join(homedir(), ".config", "ship")
	mkdirSync(dir, { recursive: true })
	writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`)
	chmodSync(CONFIG_PATH, 0o600)
}
