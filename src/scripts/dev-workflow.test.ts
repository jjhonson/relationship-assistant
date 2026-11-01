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

  function writeForwardMeta(pid: number, fields: Record<string, string> = {}) {
    const start = spawnSync("ps", ["-p", String(pid), "-o", "lstart="], { encoding: "utf8" }).stdout.trim();
    const m = { pid: String(pid), start, codespace: "cs-one", port: "3000", ...fields };
    mkdirSync(path.join(tmp, "state"), { recursive: true });
    writeFileSync(path.join(tmp, "state/forward-cs-one.meta"), Object.entries(m).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
  }
  function fakeForward(args = "codespace ports forward 3000:3000 -c cs-one") {
    const f = path.join(bin, "gh-forward");
    writeFileSync(f, `#!/usr/bin/env bash\nsleep 30 & wait\n`);
    chmodSync(f, 0o755);
    return spawn("bash", [f, ...args.split(" ")]);
  }
  const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

  it("does not signal a recorded pid that is not a gh port forward", () => {
    fakeGh("cs-one\\tAvailable\\n");
    const sleeper = spawn("sleep", ["30"]);
    try {
      writeForwardMeta(sleeper.pid!);
      const r = run("dev-stop.sh", ["--dry-run"]);
      expect(r.stdout).not.toContain("Closing port forward");
      expect(r.stdout).toContain("not signalling");
      expect(alive(sleeper.pid!)).toBe(true);
    } finally {
      sleeper.kill();
    }
  });

  it("recognises its own forward, but not after PID reuse, or for another port/Codespace", () => {
    fakeGh("cs-one\\tAvailable\\n");
    const fwd = fakeForward();
    try {
      writeForwardMeta(fwd.pid!);
      expect(run("dev-stop.sh", ["--dry-run"]).stdout).toContain("Closing port forward");
      writeForwardMeta(fwd.pid!, { start: "Mon Jan  1 00:00:00 2001" });
      expect(run("dev-stop.sh", ["--dry-run"]).stdout).not.toContain("Closing port forward");
      writeForwardMeta(fwd.pid!, { port: "3001" });
      expect(run("dev-stop.sh", ["--dry-run"]).stdout).not.toContain("Closing port forward");
      writeForwardMeta(fwd.pid!, { codespace: "other" });
      expect(run("dev-stop.sh", ["--dry-run"]).stdout).not.toContain("Closing port forward");
      expect(alive(fwd.pid!)).toBe(true);
    } finally {
      fwd.kill();
    }
  });

  it("does not match a forward that belongs to a different Codespace", () => {
    fakeGh("cs-one\\tAvailable\\ncs-two\\tAvailable\\n");
    const fwd = fakeForward("codespace ports forward 3000:3000 -c cs-two");
    try {
      writeForwardMeta(fwd.pid!);
      const r = run("dev-stop.sh", ["--dry-run", "--name", "cs-one"]);
      expect(r.stdout).not.toContain("Closing port forward");
    } finally {
      fwd.kill();
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
  const PORT = String(38000 + (process.pid % 1000));
  let pidFile: string;
  let work: string;
  const sh = (cmd: string, cwd = work) => spawnSync("bash", ["-c", cmd], { cwd, encoding: "utf8" });
  const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

  function remote(action: string, extra: Record<string, string> = {}, force = "0") {
    return spawnSync("bash", [path.join(scripts, "remote-dev.sh"), action, work, PORT, force], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        RA_PID_FILE: pidFile,
        RA_LOG_FILE: path.join(tmp, "dev.log"),
        RA_REMOTE_SHELL_FLAGS: "-c",
        ...extra,
      },
    });
  }
  const meta = (k: string) => readFileSync(pidFile, "utf8").match(new RegExp(`^${k}=(.*)$`, "m"))?.[1] ?? "";
  const listening = () => spawnSync("bash", ["-c", `(exec 3<>/dev/tcp/127.0.0.1/${PORT}) 2>/dev/null`]).status === 0;

  function fakeNpm(body: string) {
    const f = path.join(bin, "npm");
    writeFileSync(f, `#!/usr/bin/env bash\n${body}\n`);
    chmodSync(f, 0o755);
  }
  const serverNpm = `node -e "require('http').createServer((q,r)=>r.end('ok')).listen(${PORT})" & wait`;

  beforeEach(() => {
    work = path.join(tmp, "work");
    mkdirSync(work);
    pidFile = path.join(tmp, "dev.pid");
    sh("git init -q && git config user.email t@example.com && git config user.name t");
    writeFileSync(path.join(work, "next-env.d.ts"), 'import "./.next/types/routes.d.ts";\n');
    sh("mkdir node_modules && git add . && git commit -qm x");
  });
  afterEach(() => {
    if (existsSync(pidFile)) {
      const pid = Number(meta("pid"));
      if (pid > 0) { try { process.kill(-pid, "SIGKILL"); } catch { /* already gone */ } }
    }
  });

  it("starts once, reuses on a second start, and stops its own process group", () => {
    fakeNpm(serverNpm);
    const first = remote("start");
    expect(first.stderr).toBe("");
    expect(first.stdout).toContain("RA_STATUS=started");
    const pid = Number(meta("pid"));
    expect(listening()).toBe(true);

    const second = remote("start");
    expect(second.stdout).toContain("RA_STATUS=reused");
    expect(Number(meta("pid"))).toBe(pid);

    const stop = remote("stop");
    expect(stop.status).toBe(0);
    expect(alive(pid)).toBe(false);
    expect(listening()).toBe(false);
    expect(existsSync(pidFile)).toBe(false);
  });

  it("leaves nothing behind and no record when the server exits during startup", () => {
    fakeNpm("exit 1");
    const r = remote("start");
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("exited");
    expect(existsSync(pidFile)).toBe(false);
    expect(listening()).toBe(false);
  });

  it("refuses to start when the port is held by an unrelated process", () => {
    const squatter = spawn("node", ["-e", `require('http').createServer().listen(${PORT})`]);
    try {
      spawnSync("sleep", ["1"]);
      fakeNpm(serverNpm);
      const r = remote("start");
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain("already in use");
      expect(alive(squatter.pid!)).toBe(true);
    } finally {
      squatter.kill();
    }
  });

  it("never signals a stale or mismatched record (PID reuse, wrong dir/port, wrong command)", () => {
    const sleeper = spawn("setsid", ["sleep", "30"]);
    try {
      spawnSync("sleep", ["0.3"]);
      const pid = sleeper.pid!;
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const start = stat.slice(stat.lastIndexOf(") ") + 2).split(" ")[19];
      const write = (o: Record<string, string>) => {
        const m = { pid: String(pid), start, dir: work, port: PORT, nextenv_clean: "1", ...o };
        writeFileSync(pidFile, Object.entries(m).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
      };
      for (const o of <Record<string, string>[]>[{}, { start: "1" }, { dir: "/nowhere" }, { port: "1" }]) {
        write(o);
        const r = remote("stop", {}, "1");
        expect(r.stdout).toContain("not signalling");
        expect(alive(pid)).toBe(true);
      }
    } finally {
      try { process.kill(-sleeper.pid!, "SIGKILL"); } catch { /* ignore */ }
    }
  });

  describe("next-env.d.ts", () => {
    const f = () => path.join(work, "next-env.d.ts");
    const generated = 'import "./.next/dev/types/routes.d.ts";\n';
    const original = 'import "./.next/types/routes.d.ts";\n';
    const writeMeta = (clean: string) => writeFileSync(pidFile, `pid=0\nstart=0\ndir=${work}\nport=${PORT}\nnextenv_clean=${clean}\n`);

    it("restores generated-only changes when the file was clean at start", () => {
      writeMeta("1");
      writeFileSync(f(), generated);
      expect(remote("stop").stdout).toContain("Restored");
      expect(readFileSync(f(), "utf8")).toBe(original);
    });

    it("keeps unstaged user edits mixed with generated changes", () => {
      writeMeta("1");
      writeFileSync(f(), generated + "const mine = 1;\n");
      expect(remote("stop").stdout).toContain("non-generated edits");
      expect(readFileSync(f(), "utf8")).toContain("const mine");
    });

    it("never overwrites staged user edits", () => {
      writeMeta("1");
      writeFileSync(f(), original + "const staged = 1;\n");
      sh("git add next-env.d.ts");
      writeFileSync(f(), original + "const staged = 1;\n" + generated);
      const r = remote("stop");
      expect(r.stdout).toContain("staged");
      expect(readFileSync(f(), "utf8")).toContain("const staged");
      expect(readFileSync(f(), "utf8")).toContain("dev/types");
      expect(sh("git diff --cached --name-only").stdout).toContain("next-env.d.ts");
    });

    it("leaves a file that was already modified when the server started", () => {
      writeMeta("0");
      writeFileSync(f(), generated);
      expect(remote("stop").stdout).toContain("not clean at start");
      expect(readFileSync(f(), "utf8")).toBe(generated);
    });
  });
});
