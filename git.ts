export const gitRoot = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], { stdout: "pipe", stderr: "pipe" }).stdout.toString().trim()
const spawnOpts = { cwd: gitRoot }

export function run(cmd: string[]): string {
	const result = Bun.spawnSync(cmd, { ...spawnOpts, stdout: "pipe", stderr: "pipe" })
	return result.stdout.toString().trim()
}

export function runOk(cmd: string[]): boolean {
	return Bun.spawnSync(cmd, { ...spawnOpts, stdout: "pipe", stderr: "pipe" }).exitCode === 0
}

export function runLive(cmd: string[]) {
	const result = Bun.spawnSync(cmd, { ...spawnOpts, stdout: "inherit", stderr: "inherit" })
	if (result.exitCode !== 0) {
		throw new Error(`Command failed: ${cmd.join(" ")}`)
	}
}
