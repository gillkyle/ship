export function run(cmd: string[]): string {
	const result = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe" })
	return result.stdout.toString().trim()
}

export function runOk(cmd: string[]): boolean {
	return Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe" }).exitCode === 0
}

export function runLive(cmd: string[]) {
	const result = Bun.spawnSync(cmd, { stdout: "inherit", stderr: "inherit" })
	if (result.exitCode !== 0) {
		throw new Error(`Command failed: ${cmd.join(" ")}`)
	}
}
