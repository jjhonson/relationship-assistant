import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, chmodSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const scripts = path.resolve(__dirname, "../../scripts");
let tmp: string;
let bin: string;

function fakeGh(listOutput: string) {
  const file = path.join(bin, "gh");
  writeFileSync(
    file,
    `#!/usr/bin/env bash\necho "$@" >> "${tmp}/gh.log"\nif [ "$2" = "list" ]; then printf '%b' '${listOutput}'; fi\n`,
  );
  chmodSync(file, 0o755);
}

function run(script: string, args: string[], extraEnv: Record<string, string> = {}) {
  return spawnSync("bash", [path.join(scripts, script), ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      RA_STATE_DIR: path.join(tmp, "state"),
      ...extraEnv,
    },
  });
}

const ghCalls = () => (existsSync(`${tmp}/gh.log`) ? readFileSync(`${tmp}/gh.log`, "utf8") : "");

beforeEach(() => {
  tmp = mkdtempSync(path.join(tmpdir(), "ra-dev-"));
  bin = path.join(tmp, "bin");
  mkdirSync(bin);
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe("dev-start / dev-stop (dry run)", () => {
  it("starts a stopped Codespace and forwards without side effects in dry-run", () => {
    fakeGh("cs-one\\tShutdown\\n");
    const r = run("dev-start.sh", ["--dry-run"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("[dry-run] gh codespace start -c cs-one");
    expect(r.stdout).toContain("[dry-run] gh codespace ports forward 3000:3000 -c cs-one");
    expect(ghCalls()).not.toContain("start");
    expect(ghCalls()).not.toContain("ports");
  });

  it("does not start an already running Codespace", () => {
    fakeGh("cs-one\\tAvailable\\n");
    const r = run("dev-start.sh", ["--dry-run"]);
    expect(r.stdout).toContain("already running");
    expect(r.stdout).not.toContain("gh codespace start");
  });

  it("refuses to guess between multiple Codespaces, accepts an explicit name", () => {
    fakeGh("a\\tAvailable\\nb\\tShutdown\\n");
    const r = run("dev-start.sh", ["--dry-run"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("multiple Codespaces");
    const ok = run("dev-start.sh", ["--dry-run", "--name", "b"]);
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain("start -c b");
  });

  it("fails safely for an unknown name or no Codespace", () => {
    fakeGh("a\\tAvailable\\n");
    expect(run("dev-start.sh", ["--dry-run", "--name", "zzz"]).stderr).toContain("not found");
    fakeGh("");
    expect(run("dev-start.sh", ["--dry-run"]).stderr).toContain("no Codespace found");
  });

  it("does not reuse or kill a forward pid that is not a gh port forward", () => {
    fakeGh("cs-one\\tAvailable\\n");
    const sleeper = spawn("sleep", ["30"]);
    try {
      mkdirSync(path.join(tmp, "state"));
      writeFileSync(path.join(tmp, "state/forward.pid"), String(sleeper.pid));
      const r = run("dev-stop.sh", ["--dry-run"]);
      expect(r.stdout).not.toContain("Closing port forward");
      expect(() => process.kill(sleeper.pid!, 0)).not.toThrow();
    } finally {
      sleeper.kill();
    }
  });

  it("stop only stops the intended Codespace", () => {
    fakeGh("a\\tAvailable\\nb\\tAvailable\\n");
    const r = run("dev-stop.sh", ["--dry-run", "--name", "b"]);
    expect(r.stdout).toContain("[dry-run] gh codespace stop -c b");
    expect(r.stdout).not.toContain("stop -c a");
  });
});

describe("remote-dev.sh", () => {
  const remote = (action: string, dir: string, env: Record<string, string>) =>
    spawnSync("bash", [path.join(scripts, "remote-dev.sh"), action, dir, "3999"], { encoding: "utf8", env: { ...process.env, ...env } });

  it("never kills an unrelated process named in a stale pid file", () => {
    const sleeper = spawn("sleep", ["30"]);
    try {
      const pidFile = path.join(tmp, "dev.pid");
      writeFileSync(pidFile, String(sleeper.pid));
      const r = remote("stop", tmp, { RA_PID_FILE: pidFile });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("No dev server owned");
      expect(() => process.kill(sleeper.pid!, 0)).not.toThrow();
    } finally {
      sleeper.kill();
    }
  });

  it("restores generated-only next-env.d.ts changes but keeps user edits", () => {
    const g = (...a: string[]) => spawnSync("git", a, { cwd: tmp, encoding: "utf8" });
    g("init", "-q");
    g("config", "user.email", "t@example.com");
    g("config", "user.name", "t");
    const f = path.join(tmp, "next-env.d.ts");
    const original = 'import "./.next/types/routes.d.ts";\n';
    writeFileSync(f, original);
    g("add", ".");
    g("commit", "-qm", "x");
    const env = { RA_PID_FILE: path.join(tmp, "none.pid") };

    writeFileSync(f, 'import "./.next/dev/types/routes.d.ts";\n');
    remote("stop", tmp, env);
    expect(readFileSync(f, "utf8")).toBe(original);

    writeFileSync(f, 'import "./.next/dev/types/routes.d.ts";\nconst mine = 1;\n');
    const r = remote("stop", tmp, env);
    expect(r.stdout).toContain("non-generated edits");
    expect(readFileSync(f, "utf8")).toContain("const mine");
  });
});
