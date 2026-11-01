import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, chmodSync, existsSync, symlinkSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const scripts = path.resolve(__dirname, "../../scripts");
let tmp: string;
let bin: string;
const linux = process.platform === "linux";
const linuxIt = linux ? it : it.skip;
const linuxDescribe = linux ? describe : describe.skip;

function fakeGh(listOutput: string) {
  const file = path.join(bin, "gh");
  writeFileSync(
    file,
    `#!/usr/bin/env bash
echo "$@" >> "${tmp}/gh.log"
if [ "$1" != "codespace" ]; then echo "unsupported gh command: $*" >&2; exit 97; fi
if [ -n "\${RA_FAKE_GH_DELAY:-}" ]; then sleep "$RA_FAKE_GH_DELAY"; fi
case "$2" in
  list) printf '%b' '${listOutput}' ;;
  ssh)
    if [ "$3" != "-c" ] || [ "$5" != "--" ]; then echo "invalid ssh invocation: $*" >&2; exit 98; fi
    if [ "$6" = "true" ]; then exit 0; fi
    if [ "$6" = "bash" ] && [ "$7" = "-s" ] && [ "$8" = "--" ]; then
      if [ "\${RA_FAKE_GH_REMOTE_STUB:-0}" = "1" ]; then
        [ "\${9:-}" = "start" ] && echo "RA_STATUS=started"
        exit 0
      fi
      shift 5; exec "$@"
    fi
    echo "unsupported ssh command: $*" >&2; exit 99
    ;;
  ports)
    if [ -n "\${RA_FAKE_GH_COLLISION_FILE:-}" ]; then
      cp "$RA_FAKE_GH_COLLISION_FILE" "$RA_STATE_DIR/forward-cs-one.meta"
    fi
    if [ -n "\${RA_FAKE_GH_LAUNCHED_PID_FILE:-}" ]; then
      printf '%s\\n' "$$" > "$RA_FAKE_GH_LAUNCHED_PID_FILE"
    fi
    if [ "\${RA_FAKE_GH_HTTP_SERVER:-0}" = "1" ]; then
      exec node -e 'process.title=process.env.RA_FAKE_GH_TITLE; require("http").createServer((q,r)=>r.end("ok")).listen(Number(process.env.RA_TEST_PORT))'
    fi
    if [ "\${RA_FAKE_GH_TERM_RESIST:-0}" = "1" ]; then
      exec node -e 'process.title=process.env.RA_FAKE_GH_TITLE; process.on("SIGTERM",()=>{}); setInterval(()=>{},1000)'
    fi
    trap 'kill "$child" 2>/dev/null; wait "$child" 2>/dev/null; exit 0' TERM INT
    sleep 60 & child=$!; wait "$child"
    ;;
  stop) exit 0 ;;
  *) echo "unsupported gh codespace subcommand: $2" >&2; exit 97 ;;
esac
`,
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

function runAsync(script: string, args: string[], extraEnv: Record<string, string> = {}) {
  const child = spawn("bash", [path.join(scripts, script), ...args], {
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      RA_STATE_DIR: path.join(tmp, "state"),
      ...extraEnv,
    },
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
  child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
  const done = new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
  return { child, done };
}

async function waitFor(predicate: () => boolean) {
  for (let i = 0; i < 100; i += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("timed out waiting for condition");
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
    expect(r.stdout).toContain("[dry-run] gh codespace ssh -c cs-one -- true");
    expect(r.stdout).toContain("[dry-run] gh codespace ports forward 3000:3000 -c cs-one");
    expect(ghCalls()).not.toContain("codespace start");
    expect(ghCalls()).not.toContain("ports");
    const unsupported = spawnSync(path.join(bin, "gh"), ["codespace", "start", "-c", "cs-one"], { encoding: "utf8" });
    expect(unsupported.status).toBe(97);
    expect(unsupported.stderr).toContain("unsupported gh codespace subcommand");
  });

  it("shows only verified process recovery instructions in stop help", () => {
    const help = run("dev-stop.sh", ["--help"]);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("scripts/dev-stop.sh --name NAME --force");
    expect(help.stdout).toContain("do not signal a PID copied from a record");
    expect(help.stdout).not.toContain('kill "$(sed');
    expect(help.stdout).not.toContain("kill -TERM");
  });

  it("does not start an already running Codespace", () => {
    fakeGh("cs-one\\tAvailable\\n");
    const r = run("dev-start.sh", ["--dry-run"]);
    expect(r.stdout).toContain("already running");
    expect(r.stdout).not.toContain("-- true");
  });

  it("refuses to guess between multiple Codespaces, accepts an explicit name", () => {
    fakeGh("a\\tAvailable\\nb\\tShutdown\\n");
    const r = run("dev-start.sh", ["--dry-run"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("multiple Codespaces");
    const ok = run("dev-start.sh", ["--dry-run", "--name", "b"]);
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain("ssh -c b -- true");
  });

  it("fails safely for an unknown name or no Codespace", () => {
    fakeGh("a\\tAvailable\\n");
    expect(run("dev-start.sh", ["--dry-run", "--name", "zzz"]).stderr).toContain("not found");
    fakeGh("");
    expect(run("dev-start.sh", ["--dry-run"]).stderr).toContain("no Codespace found");
  });

  it("dry-run start and stop preserve mismatched forward metadata and do not create state", () => {
    fakeGh("cs-one\\tAvailable\\n");
    const state = path.join(tmp, "state");
    mkdirSync(state);
    const metadata = path.join(state, "forward-cs-one.meta");
    const original = "pid=123\nstart=old\ncodespace=cs-one\nport=3000\n";
    writeFileSync(metadata, original);

    const unusedState = path.join(tmp, "unused-state");
    expect(run("dev-start.sh", ["--dry-run"], { RA_PORT: "3001", RA_STATE_DIR: unusedState }).status).toBe(0);
    expect(readFileSync(metadata, "utf8")).toBe(original);
    expect(run("dev-stop.sh", ["--dry-run"], { RA_PORT: "3001", RA_STATE_DIR: unusedState }).status).toBe(0);
    expect(readFileSync(metadata, "utf8")).toBe(original);
    expect(existsSync(unusedState)).toBe(false);
  });

  linuxIt("cleans up a Codespace it woke when the remote server fails before forwarding", () => {
    fakeGh("cs-one\\tShutdown\\n");
    const work = path.join(tmp, "remote");
    mkdirSync(path.join(work, "node_modules"), { recursive: true });
    writeFileSync(path.join(bin, "npm"), "#!/usr/bin/env bash\nexit 1\n");
    chmodSync(path.join(bin, "npm"), 0o755);
    const state = path.join(tmp, "state");
    const pidFile = path.join(tmp, "remote.pid");
    const port = String(45000 + (process.pid % 1000));

    const result = run("dev-start.sh", [], {
      RA_STATE_DIR: state,
      RA_REMOTE_DIR: work,
      RA_PORT: port,
      RA_REMOTE_SHELL_FLAGS: "-c",
      RA_PID_FILE: pidFile,
      RA_LOG_FILE: path.join(tmp, "remote.log"),
    });

    expect(result.status).not.toBe(0);
    expect(ghCalls()).toContain("codespace ssh -c cs-one -- true");
    expect(ghCalls()).toContain("codespace stop -c cs-one");
    expect(ghCalls()).not.toContain("codespace ports forward");
    expect(existsSync(pidFile)).toBe(false);
    expect(existsSync(path.join(state, "forward-cs-one.meta"))).toBe(false);
  });

  function writeForwardMeta(pid: number, fields: Record<string, string> = {}) {
    const start = spawnSync("ps", ["-p", String(pid), "-o", "lstart="], { encoding: "utf8" }).stdout.trim();
    const m = { pid: String(pid), start, codespace: "cs-one", port: "3000", run_id: "test-run", ...fields };
    mkdirSync(path.join(tmp, "state"), { recursive: true });
    writeFileSync(path.join(tmp, "state/forward-cs-one.meta"), Object.entries(m).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
  }
  function fakeForward(args = "codespace ports forward 3000:3000 -c cs-one", extraEnv: Record<string, string> = {}) {
    return spawn(path.join(bin, "gh"), args.split(" "), {
      env: { ...process.env, RA_FORWARD_OWNER: "test-run", ...extraEnv },
    });
  }
  const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  const live = (pid: number) => {
    const state = spawnSync("ps", ["-p", String(pid), "-o", "stat="], { encoding: "utf8" }).stdout.trim();
    return state !== "" && !/^[ZX]/.test(state);
  };

  linuxIt("does not erase or signal another run's forward record during failed startup cleanup", () => {
    fakeGh("cs-one\\tShutdown\\n");
    const work = path.join(tmp, "remote");
    mkdirSync(path.join(work, "node_modules"), { recursive: true });
    writeFileSync(path.join(bin, "npm"), "#!/usr/bin/env bash\nexit 1\n");
    chmodSync(path.join(bin, "npm"), 0o755);
    const fwd = fakeForward();
    try {
      writeForwardMeta(fwd.pid!);
      const metadata = path.join(tmp, "state/forward-cs-one.meta");
      const original = readFileSync(metadata, "utf8");
      const result = run("dev-start.sh", [], {
        RA_REMOTE_DIR: work,
        RA_PID_FILE: path.join(tmp, "remote.pid"),
        RA_REMOTE_SHELL_FLAGS: "-c",
      });
      expect(result.status).not.toBe(0);
      expect(readFileSync(metadata, "utf8")).toBe(original);
      expect(alive(fwd.pid!)).toBe(true);
    } finally {
      fwd.kill();
    }
  }, 20000);

  it("does not signal a recorded pid that is not a gh port forward", () => {
    fakeGh("cs-one\\tAvailable\\n");
    const sleeper = spawn("sleep", ["30"]);
    try {
      writeForwardMeta(sleeper.pid!);
      const r = run("dev-stop.sh", ["--dry-run"]);
      expect(r.stdout).not.toContain("Closing port forward");
      expect(r.stdout).toContain("left untouched");
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
      writeForwardMeta(fwd.pid!, { run_id: "different-run" });
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

  linuxIt("removes unchanged scoped metadata for an exited forward without signalling a reused PID", () => {
    fakeGh("cs-one\\tAvailable\\n");
    const work = path.join(tmp, "remote");
    mkdirSync(work);
    const sleeper = spawn("sleep", ["30"]);
    try {
      writeForwardMeta(sleeper.pid!, { start: "Mon Jan  1 00:00:00 2001" });
      const metadata = path.join(tmp, "state/forward-cs-one.meta");
      const original = readFileSync(metadata, "utf8");
      const result = run("dev-stop.sh", [], {
        RA_REMOTE_DIR: work,
        RA_PID_FILE: path.join(tmp, "remote.pid"),
        RA_REMOTE_SHELL_FLAGS: "-c",
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("definitively exited");
      expect(existsSync(metadata)).toBe(false);
      expect(alive(sleeper.pid!)).toBe(true);

      writeFileSync(metadata, original);
      const dryRun = run("dev-stop.sh", ["--dry-run"], {
        RA_REMOTE_DIR: work,
        RA_PID_FILE: path.join(tmp, "remote.pid"),
        RA_REMOTE_SHELL_FLAGS: "-c",
      });
      expect(dryRun.status).toBe(0);
      expect(readFileSync(metadata, "utf8")).toBe(original);
    } finally {
      sleeper.kill();
    }
  });

  it("recovers a stale scoped forward record during normal start and then stops the new forward", () => {
    fakeGh("cs-one\\tAvailable\\n");
    const port = String(47500 + (process.pid % 400));
    const state = path.join(tmp, "state");
    mkdirSync(state);
    const metadata = path.join(state, "forward-cs-one.meta");
    writeFileSync(metadata, `pid=99999999\nstart=Mon Jan  1 00:00:00 2001\ncodespace=cs-one\nport=${port}\nrun_id=old-run\n`);
    writeFileSync(path.join(bin, "curl"), "#!/usr/bin/env bash\necho 200\n");
    chmodSync(path.join(bin, "curl"), 0o755);
    const work = path.join(tmp, "remote");
    mkdirSync(work);
    const pidFile = path.join(tmp, "remote.pid");
    const env = {
      RA_PORT: port,
      RA_REMOTE_DIR: work,
      RA_PID_FILE: pidFile,
      RA_REMOTE_SHELL_FLAGS: "-c",
      RA_FAKE_GH_REMOTE_STUB: "1",
    };

    const start = run("dev-start.sh", [], env);
    expect(start.status, `${start.stdout}\n${start.stderr}`).toBe(0);
    expect(start.stdout).toContain("definitively exited");
    expect(readFileSync(metadata, "utf8")).toContain(`port=${port}\n`);
    expect(run("dev-stop.sh", [], env).status).toBe(0);
    expect(existsSync(metadata)).toBe(false);
  }, 20000);

  linuxIt("preserves a live process record whose command or owner does not match", () => {
    fakeGh("cs-one\\tAvailable\\n");
    const work = path.join(tmp, "remote");
    mkdirSync(work);
    const sleeper = spawn("sleep", ["30"]);
    try {
      writeForwardMeta(sleeper.pid!);
      const metadata = path.join(tmp, "state/forward-cs-one.meta");
      const original = readFileSync(metadata, "utf8");
      const result = run("dev-stop.sh", [], {
        RA_REMOTE_DIR: work,
        RA_PID_FILE: path.join(tmp, "remote.pid"),
        RA_REMOTE_SHELL_FLAGS: "-c",
      });
      expect(result.status).not.toBe(0);
      expect(result.stdout).toContain("not signalling it");
      expect(readFileSync(metadata, "utf8")).toBe(original);
      expect(alive(sleeper.pid!)).toBe(true);
    } finally {
      sleeper.kill();
    }
  });

  it("cleans up its unrecorded forward after a metadata link collision", async () => {
    fakeGh("cs-one\\tAvailable\\n");
    const work = path.join(tmp, "remote");
    mkdirSync(work);
    const port = String(47000 + (process.pid % 500));
    const state = path.join(tmp, "state");
    const title = `gh codespace ports forward ${port}:${port} -c cs-one`;
    const existing = fakeForward(`codespace ports forward ${port}:${port} -c cs-one`, {
      RA_FAKE_GH_TERM_RESIST: "1",
      RA_FAKE_GH_TITLE: title,
    });
    const collision = path.join(tmp, "collision.meta");
    const startedPidFile = path.join(tmp, "new-forward.pid");
    const remotePidFile = path.join(tmp, "remote.pid");
    try {
      writeForwardMeta(existing.pid!, { port });
      const metadata = path.join(state, "forward-cs-one.meta");
      const original = readFileSync(metadata, "utf8");
      writeFileSync(collision, original);
      rmSync(metadata);
      const result = run("dev-start.sh", [], {
        RA_PORT: port,
        RA_REMOTE_DIR: work,
        RA_PID_FILE: remotePidFile,
        RA_REMOTE_SHELL_FLAGS: "-c",
        RA_FAKE_GH_REMOTE_STUB: "1",
        RA_FAKE_GH_COLLISION_FILE: collision,
        RA_FAKE_GH_HTTP_SERVER: "1",
        RA_FAKE_GH_TITLE: title,
        RA_FAKE_GH_LAUNCHED_PID_FILE: startedPidFile,
        RA_TEST_PORT: port,
      });
      const launched = Number(readFileSync(startedPidFile, "utf8").trim());
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("could not be recorded and verified");
      expect(readFileSync(metadata, "utf8")).toBe(original);
      expect(live(launched)).toBe(false);
      expect(alive(existing.pid!)).toBe(true);
    } finally {
      try { process.kill(existing.pid!, "SIGKILL"); } catch { /* already gone */ }
    }
  }, 20000);

  it("waits for a delayed forwarding launcher and cleans it up when interrupted", async () => {
    fakeGh("cs-one\\tAvailable\\n");
    const port = String(46500 + (process.pid % 400));
    const state = path.join(tmp, "state");
    const gate = path.join(tmp, "forward-gate");
    const ready = path.join(tmp, "forward-ready");
    const launcherPidFile = path.join(tmp, "forward-launcher.pid");
    const realEnv = spawnSync("which", ["env"], { encoding: "utf8" }).stdout.trim();
    writeFileSync(
      path.join(bin, "env"),
      `#!/usr/bin/env bash
printf '%s\\n' "$$" > "$RA_TEST_LAUNCHER_PID_FILE"
: > "$RA_TEST_LAUNCHER_READY"
while [ ! -e "$RA_TEST_LAUNCHER_GATE" ]; do sleep 0.02; done
exec "${realEnv}" "$@"
`,
    );
    chmodSync(path.join(bin, "env"), 0o755);
    const launch = runAsync("dev-start.sh", [], {
      RA_PORT: port,
      RA_FAKE_GH_REMOTE_STUB: "1",
      RA_TEST_LAUNCHER_GATE: gate,
      RA_TEST_LAUNCHER_READY: ready,
      RA_TEST_LAUNCHER_PID_FILE: launcherPidFile,
    });
    let launcherPid = 0;
    try {
      await waitFor(() => existsSync(ready));
      launcherPid = Number(readFileSync(launcherPidFile, "utf8").trim());
      expect(launcherPid).toBeGreaterThan(0);
      expect(launch.child.exitCode).toBeNull();
      expect(existsSync(path.join(state, "forward-cs-one.meta"))).toBe(false);

      launch.child.kill("SIGTERM");
      const result = await launch.done;
      expect(result.status).not.toBe(0);
      expect(live(launcherPid)).toBe(false);
      expect(existsSync(path.join(state, "forward-cs-one.meta"))).toBe(false);
    } finally {
      writeFileSync(gate, "");
      if (launcherPid > 0 && live(launcherPid)) {
        try { process.kill(launcherPid, "SIGKILL"); } catch { /* already gone */ }
      }
      if (launch.child.exitCode === null) launch.child.kill("SIGKILL");
    }
  }, 20000);

  it("records the forward only after a delayed launcher becomes gh", async () => {
    fakeGh("cs-one\\tAvailable\\n");
    const port = String(46900 + (process.pid % 400));
    const state = path.join(tmp, "state");
    const gate = path.join(tmp, "forward-ready-gate");
    const ready = path.join(tmp, "forward-ready-marker");
    const launcherPidFile = path.join(tmp, "forward-ready-pid");
    const realEnv = spawnSync("which", ["env"], { encoding: "utf8" }).stdout.trim();
    const title = `gh codespace ports forward ${port}:${port} -c cs-one`;
    writeFileSync(
      path.join(bin, "env"),
      `#!/usr/bin/env bash
printf '%s\\n' "$$" > "$RA_TEST_LAUNCHER_PID_FILE"
: > "$RA_TEST_LAUNCHER_READY"
while [ ! -e "$RA_TEST_LAUNCHER_GATE" ]; do sleep 0.02; done
exec "${realEnv}" "$@"
`,
    );
    chmodSync(path.join(bin, "env"), 0o755);
    const launch = runAsync("dev-start.sh", [], {
      RA_PORT: port,
      RA_FAKE_GH_REMOTE_STUB: "1",
      RA_FAKE_GH_HTTP_SERVER: "1",
      RA_FAKE_GH_TITLE: title,
      RA_TEST_PORT: port,
      RA_TEST_LAUNCHER_GATE: gate,
      RA_TEST_LAUNCHER_READY: ready,
      RA_TEST_LAUNCHER_PID_FILE: launcherPidFile,
    });
    let launcherPid = 0;
    try {
      await waitFor(() => existsSync(ready));
      launcherPid = Number(readFileSync(launcherPidFile, "utf8").trim());
      expect(launch.child.exitCode).toBeNull();
      expect(existsSync(path.join(state, "forward-cs-one.meta"))).toBe(false);
      writeFileSync(gate, "");
      const result = await launch.done;
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(readFileSync(path.join(state, "forward-cs-one.meta"), "utf8")).toContain(`pid=${launcherPid}\n`);

      expect(run("dev-stop.sh", [], {
        RA_PORT: port,
        RA_FAKE_GH_REMOTE_STUB: "1",
      }).status).toBe(0);
    } finally {
      writeFileSync(gate, "");
      if (launcherPid > 0 && live(launcherPid)) {
        try { process.kill(launcherPid, "SIGKILL"); } catch { /* already gone */ }
      }
      if (launch.child.exitCode === null) launch.child.kill("SIGKILL");
    }
  }, 20000);

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

  linuxIt("shares a host lifecycle lock between overlapping start and stop", async () => {
    fakeGh("cs-one\\tShutdown\\n");
    const work = path.join(tmp, "remote");
    mkdirSync(path.join(work, "node_modules"), { recursive: true });
    writeFileSync(path.join(bin, "npm"), "#!/usr/bin/env bash\nexit 1\n");
    chmodSync(path.join(bin, "npm"), 0o755);
    const start = runAsync("dev-start.sh", [], {
      RA_FAKE_GH_DELAY: "0.5",
      RA_REMOTE_DIR: work,
      RA_PORT: String(45500 + (process.pid % 300)),
      RA_PID_FILE: path.join(tmp, "remote.pid"),
      RA_REMOTE_SHELL_FLAGS: "-c",
    });
    try {
      await waitFor(() => existsSync(path.join(tmp, "state/lifecycle.lock/owner")));
      const owner = readFileSync(path.join(tmp, "state/lifecycle.lock/owner"), "utf8");
      const stop = run("dev-stop.sh", []);
      expect(stop.status).not.toBe(0);
      expect(stop.stderr).toContain("another start/stop is in progress");
      expect(readFileSync(path.join(tmp, "state/lifecycle.lock/owner"), "utf8")).toBe(owner);
      const result = await start.done;
      expect(result.status).not.toBe(0);
      expect(existsSync(path.join(tmp, "state/lifecycle.lock"))).toBe(false);
    } finally {
      start.child.kill("SIGKILL");
    }
  }, 20000);

  linuxIt("retains a verified forward record when TERM is ignored and removes it only after forced exit", async () => {
    fakeGh("cs-one\\tAvailable\\n");
    const work = path.join(tmp, "remote");
    mkdirSync(work);
    const remotePidFile = path.join(tmp, "remote.pid");
    const title = "gh codespace ports forward 3000:3000 -c cs-one";
    const fwd = fakeForward("codespace ports forward 3000:3000 -c cs-one", {
      RA_FAKE_GH_TERM_RESIST: "1",
      RA_FAKE_GH_TITLE: title,
    });
    const metadata = path.join(tmp, "state/forward-cs-one.meta");
    const env = { RA_REMOTE_DIR: work, RA_PID_FILE: remotePidFile, RA_LOG_FILE: path.join(tmp, "remote.log") };
    try {
      writeForwardMeta(fwd.pid!);
      await waitFor(() => spawnSync("ps", ["-p", String(fwd.pid), "-o", "command="], { encoding: "utf8" }).stdout.trim() === title);
      const first = run("dev-stop.sh", [], env);
      expect(first.status).not.toBe(0);
      expect(first.stdout).toContain("ownership record retained");
      expect(existsSync(metadata)).toBe(true);
      expect(alive(fwd.pid!)).toBe(true);
      const second = run("dev-stop.sh", ["--force"], env);
      expect(second.status, `${second.stdout}\n${second.stderr}`).toBe(0);
      expect(existsSync(metadata)).toBe(false);
      if (fwd.exitCode === null && fwd.signalCode === null) {
        await new Promise<void>((resolve) => fwd.once("exit", () => resolve()));
      }
      expect(alive(fwd.pid!)).toBe(false);
    } finally {
      try { process.kill(fwd.pid!, "SIGKILL"); } catch { /* already gone */ }
    }
  }, 20000);

  it("stop only stops the intended Codespace", () => {
    fakeGh("a\\tAvailable\\nb\\tAvailable\\n");
    const r = run("dev-stop.sh", ["--dry-run", "--name", "b"]);
    expect(r.stdout).toContain("[dry-run] gh codespace stop -c b");
    expect(r.stdout).not.toContain("stop -c a");
  });

  linuxIt("uses the documented gh codespace ssh command and pipes bash -s arguments", () => {
    fakeGh("cs-one\\tAvailable\\n");
    const work = path.join(tmp, "remote");
    mkdirSync(path.join(work, "node_modules"), { recursive: true });
    const port = String(44000 + (process.pid % 1000));
    const pidFile = path.join(tmp, "remote.pid");
    const remoteScript = readFileSync(path.join(scripts, "remote-dev.sh"));
    const invoke = (action: string) => spawnSync(
      path.join(bin, "gh"),
      ["codespace", "ssh", "-c", "cs-one", "--", "bash", "-s", "--", action, work, port, "0", "pipe-test"],
      {
        encoding: "utf8",
        input: remoteScript,
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          RA_PID_FILE: pidFile,
          RA_LOG_FILE: path.join(tmp, "remote.log"),
          RA_REMOTE_SHELL_FLAGS: "-c",
        },
      },
    );
    writeFileSync(path.join(bin, "npm"), `#!/usr/bin/env bash\nnode -e "require('http').createServer((q,r)=>r.end('ok')).listen(Number(process.env.PORT))" & wait\n`);
    chmodSync(path.join(bin, "npm"), 0o755);
    try {
      const start = invoke("start");
      expect(start.status).toBe(0);
      expect(start.stdout).toContain("RA_STATUS=started");
      expect(readFileSync(pidFile, "utf8")).toContain(`port=${port}\n`);
      expect(invoke("stop").status).toBe(0);
    } finally {
      if (existsSync(pidFile)) {
        const pid = Number(readFileSync(pidFile, "utf8").match(/^pid=(\d+)$/m)?.[1]);
        if (pid > 0) { try { process.kill(-pid, "SIGKILL"); } catch { /* already gone */ } }
      }
    }
  }, 30000);
});

linuxDescribe("remote-dev.sh", () => {
  const PORT = String(38000 + (process.pid % 1000));
  let pidFile: string;
  let work: string;
  const sh = (cmd: string, cwd = work) => spawnSync("bash", ["-c", cmd], { cwd, encoding: "utf8" });
  const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  const running = (pid: number) => {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      return !/^\d+ \(.*\) [ZX]/.test(stat);
    } catch { return false; }
  };
  const liveGroup = (group: number) => {
    try {
      return readdirSync("/proc").some((entry) => {
        if (!/^\d+$/.test(entry)) return false;
        try {
          const stat = readFileSync(`/proc/${entry}/stat`, "utf8");
          const fields = stat.slice(stat.lastIndexOf(") ") + 2).split(" ");
          return fields[0] !== "Z" && fields[0] !== "X" && Number(fields[2]) === group && Number(fields[3]) === group;
        } catch { return false; }
      });
    } catch { return false; }
  };

  function remote(action: string, extra: Record<string, string> = {}, force = "0", runId = "test-run", dir = work) {
    return spawnSync("bash", [path.join(scripts, "remote-dev.sh"), action, dir, PORT, force, runId], {
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
  function remoteAsync(action: string, extra: Record<string, string> = {}, force = "0", runId = "async-run") {
    const child = spawn("bash", [path.join(scripts, "remote-dev.sh"), action, work, PORT, force, runId], {
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        RA_PID_FILE: pidFile,
        RA_LOG_FILE: path.join(tmp, "dev.log"),
        RA_REMOTE_SHELL_FLAGS: "-c",
        ...extra,
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    const done = new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
      child.on("close", (status) => resolve({ status, stdout, stderr }));
    });
    return { child, done };
  }
  const meta = (k: string) => readFileSync(pidFile, "utf8").match(new RegExp(`^${k}=(.*)$`, "m"))?.[1] ?? "";
  const listening = () => spawnSync("bash", ["-c", `(exec 3<>/dev/tcp/127.0.0.1/${PORT}) 2>/dev/null`]).status === 0;

  function fakeNpm(body: string) {
    const f = path.join(bin, "npm");
    writeFileSync(f, `#!/usr/bin/env bash\n${body}\n`);
    chmodSync(f, 0o755);
  }
  const serverNpm = `node -e "require('http').createServer((q,r)=>r.end('ok')).listen(Number(process.env.PORT))" & wait`;

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
    expect(meta("port")).toBe(PORT);

    const unrelatedCleanup = remote("stop-start", {}, "0", "different-run");
    expect(unrelatedCleanup.stdout).toContain("leaving the recorded server untouched");
    expect(alive(pid)).toBe(true);

    const stop = remote("stop");
    expect(stop.status).toBe(0);
    expect(alive(pid)).toBe(false);
    expect(listening()).toBe(false);
    expect(existsSync(pidFile)).toBe(false);
  });

  it("uses the actual npm CLI and a local Node server for start, reuse, and stop", () => {
    if (spawnSync("npm", ["--version"]).status !== 0) return;
    writeFileSync(path.join(work, "package.json"), JSON.stringify({ scripts: { dev: "node server.js" } }));
    writeFileSync(
      path.join(work, "server.js"),
      'require("http").createServer((req, res) => res.end("ok")).listen(Number(process.env.PORT));\n',
    );

    const first = remote("start", {}, "0", "real-npm-run");
    expect(first.status, `${first.stdout}\n${first.stderr}`).toBe(0);
    expect(first.stdout).toContain("RA_STATUS=started");
    expect(listening()).toBe(true);

    const second = remote("start", {}, "0", "real-npm-run");
    expect(second.status).toBe(0);
    expect(second.stdout).toContain("RA_STATUS=reused");

    const stopped = remote("stop", {}, "0", "real-npm-run");
    expect(stopped.status).toBe(0);
    expect(listening()).toBe(false);
    expect(existsSync(pidFile)).toBe(false);
  }, 30000);

  it("cleans up an interrupted launch before its ownership record is published", async () => {
    fakeNpm("sleep 60");
    const launch = remoteAsync("start", {}, "0", "interrupt-run");
    const handoff = `${pidFile}.launch.interrupt-run.${launch.child.pid}`;
    try {
      await waitFor(() => existsSync(handoff));
      const group = Number(readFileSync(handoff, "utf8").trim().split(":")[0]);
      launch.child.kill("SIGTERM");
      const result = await launch.done;
      expect(result.status).toBe(143);
      expect(result.stderr).not.toContain("could not be verified as terminated");
      expect(existsSync(pidFile)).toBe(false);
      expect(existsSync(handoff)).toBe(false);
      expect(existsSync(`${pidFile}.lock`)).toBe(false);
      expect(liveGroup(group)).toBe(false);
    } finally {
      launch.child.kill("SIGKILL");
    }
  }, 30000);

  it("terminates a live pre-session launcher before releasing the remote lock", async () => {
    fakeNpm("sleep 30");
    const realSetsid = spawnSync("which", ["setsid"], { encoding: "utf8" }).stdout.trim();
    const gate = path.join(tmp, "setsid-gate");
    const launcherPidFile = path.join(tmp, "setsid-launcher.pid");
    writeFileSync(
      path.join(bin, "setsid"),
      `#!/usr/bin/env bash
printf '%s\\n' "$$" > "$RA_TEST_SETSID_PID_FILE"
while [ ! -e "$RA_TEST_SETSID_GATE" ]; do sleep 0.02; done
exec "${realSetsid}" "$@"
`,
    );
    chmodSync(path.join(bin, "setsid"), 0o755);
    const launch = remoteAsync("start", { RA_TEST_SETSID_GATE: gate, RA_TEST_SETSID_PID_FILE: launcherPidFile });
    let launcherPid = 0;
    try {
      await waitFor(() => existsSync(launcherPidFile));
      launcherPid = Number(readFileSync(launcherPidFile, "utf8").trim());
      expect(launcherPid).toBeGreaterThan(0);

      launch.child.kill("SIGTERM");
      const result = await launch.done;
      expect(result.status).toBe(143);
      expect(running(launcherPid)).toBe(false);
      expect(existsSync(pidFile)).toBe(false);
      expect(existsSync(`${pidFile}.lock`)).toBe(false);
      expect(readdirSync(tmp).some((entry) => entry.includes(".launch."))).toBe(false);
    } finally {
      if (launcherPid > 0 && alive(launcherPid)) {
        try { process.kill(launcherPid, "SIGKILL"); } catch { /* already gone */ }
      }
      if (launch.child.exitCode === null) launch.child.kill("SIGKILL");
    }
  }, 30000);

  it("cleans up after an ownership-record write failure without publishing a server", async () => {
    fakeNpm(serverNpm);
    writeFileSync(
      path.join(bin, "mktemp"),
      '#!/usr/bin/env bash\ntarget="${1/XXXXXX/writefail}"\nln -s /dev/full "$target" || exit 1\nprintf "%s\\n" "$target"\n',
    );
    chmodSync(path.join(bin, "mktemp"), 0o755);
    const launch = remoteAsync("start", {}, "0", "write-failure");
    const handoff = `${pidFile}.launch.write-failure.${launch.child.pid}`;
    const tempRecord = `${pidFile}.tmp.writefail`;
    try {
      await waitFor(() => existsSync(handoff));
      const result = await launch.done;
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("could not write complete dev server ownership record");
      expect(existsSync(pidFile)).toBe(false);
      expect(existsSync(handoff)).toBe(false);
      expect(existsSync(tempRecord)).toBe(false);
      expect(existsSync(`${pidFile}.lock`)).toBe(false);
      expect(listening()).toBe(false);
    } finally {
      launch.child.kill("SIGKILL");
    }
  }, 30000);

  it("preserves an existing record and cleans up the launch when publication collides", () => {
    const collision = path.join(tmp, "existing.pid");
    const original = "pid=another-run\nstart=unchanged\nowner=another-owner\n";
    writeFileSync(collision, original);
    fakeNpm(`cp "\${RA_COLLISION_RECORD_SOURCE}" "\${RA_PID_FILE}"\n${serverNpm}`);
    const result = remote("start", { RA_COLLISION_RECORD_SOURCE: collision }, "0", "collision-run");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("a process record appeared during launch");
    expect(readFileSync(pidFile, "utf8")).toBe(original);
    expect(existsSync(`${pidFile}.lock`)).toBe(false);
    expect(listening()).toBe(false);
  }, 30000);

  it.each(["start", "stop"] as const)("serializes remote start against concurrent %s", async (contender) => {
    fakeNpm(`sleep 1\n${serverNpm}`);
    const first = remoteAsync("start");
    try {
      await waitFor(() => existsSync(`${pidFile}.lock/owner`));
      const competing = remote(contender, {}, "0", "other-run");
      expect(competing.status).not.toBe(0);
      expect(competing.stderr).toContain("another dev start/stop is in progress");
      const result = await first.done;
      expect(result.status).toBe(0);
      expect(existsSync(`${pidFile}.lock`)).toBe(false);
      expect(remote("stop").status).toBe(0);
    } finally {
      first.child.kill("SIGKILL");
    }
  }, 30000);

  it("normalizes trailing slash, parent and symlink workspace paths for reuse and stop", () => {
    fakeNpm(serverNpm);
    const symlink = path.join(tmp, "work-link");
    symlinkSync(work, symlink);
    try {
      const started = remote("start", {}, "0", "path-run", `${work}/`);
      expect(started.status).toBe(0);
      expect(meta("dir")).toBe(work);
      const reused = remote("start", {}, "0", "other-run", path.join(work, "..", path.basename(work)));
      expect(reused.stdout).toContain("RA_STATUS=reused");
      const stopped = remote("stop", {}, "0", "path-run", symlink);
      expect(stopped.status).toBe(0);
      expect(existsSync(pidFile)).toBe(false);
    } finally {
      if (existsSync(pidFile)) {
        const pid = Number(meta("pid"));
        if (pid > 0) { try { process.kill(-pid, "SIGKILL"); } catch { /* already gone */ } }
      }
    }
  });

  it("recognizes an npm process title padded with trailing NUL bytes", () => {
    fakeNpm(`exec node -e 'process.title="npm run dev"; require("http").createServer((q,r)=>r.end("ok")).listen(Number(process.env.PORT)); setInterval(()=>{},1000)'`);
    const start = remote("start");
    expect(start.status).toBe(0);
    const pid = Number(meta("pid"));
    expect(readFileSync(`/proc/${pid}/cmdline`).includes(0)).toBe(true);
    expect(remote("start").stdout).toContain("RA_STATUS=reused");
    expect(remote("stop").status).toBe(0);
  });

  it("waits for the whole launch group and force-kills a resistant child after its leader exits", () => {
    const childFile = path.join(tmp, "child.pid");
    fakeNpm(`node -e 'process.on("SIGTERM",()=>{}); require("http").createServer((q,r)=>r.end("ok")).listen(Number(process.env.PORT)); setInterval(()=>{},1000)' &
child=$!
echo "$child" > "$RA_CHILD_FILE"
trap 'exit 0' TERM
wait "$child"`);
    const start = remote("start", { RA_CHILD_FILE: childFile });
    expect(start.status).toBe(0);
    const leader = Number(meta("pid"));
    const child = Number(readFileSync(childFile, "utf8"));
    const stop = remote("stop", {}, "1");
    expect(stop.status).toBe(0);
    expect(stop.stdout).toContain("Dev server stopped");
    expect(listening()).toBe(false);
    expect(existsSync(pidFile)).toBe(false);
    expect(alive(child)).toBe(false);
    expect(leader).toBeGreaterThan(0);
  }, 30000);

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
        const m = { pid: String(pid), start, dir: work, port: PORT, ...o };
        writeFileSync(pidFile, Object.entries(m).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
      };
      for (const o of <Record<string, string>[]>[{}, { start: "1" }, { dir: "/nowhere" }, { port: "1" }]) {
        write(o);
        const r = remote("stop", {}, "1");
        expect(`${r.stdout}\n${r.stderr}`).toContain("not signalling");
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
    const writeMeta = () => writeFileSync(pidFile, `pid=99999999\nstart=0\ndir=${work}\nport=${PORT}\nowner=test-owner\nrun_id=test-run\n`);

    it("leaves generated-only changes for manual review", () => {
      writeMeta();
      writeFileSync(f(), generated);
      const r = remote("stop");
      expect(r.stdout).toContain("left untouched");
      expect(readFileSync(f(), "utf8")).toBe(generated);
    });

    it("preserves unstaged user edits mixed with generated changes", () => {
      writeMeta();
      writeFileSync(f(), generated + "const mine = 1;\n");
      const contents = readFileSync(f(), "utf8");
      expect(remote("stop").stdout).toContain("left untouched");
      expect(readFileSync(f(), "utf8")).toBe(contents);
    });

    it("preserves staged and unstaged edits exactly", () => {
      writeMeta();
      writeFileSync(f(), original + "const staged = 1;\n");
      sh("git add next-env.d.ts");
      writeFileSync(f(), original + "const staged = 1;\n" + generated);
      const contents = readFileSync(f(), "utf8");
      const index = sh("git show :next-env.d.ts").stdout;
      const r = remote("stop");
      expect(r.stdout).toContain("left untouched");
      expect(readFileSync(f(), "utf8")).toBe(contents);
      expect(sh("git show :next-env.d.ts").stdout).toBe(index);
      expect(sh("git diff --cached --name-only").stdout).toContain("next-env.d.ts");
    });

    it.each([
      ["a custom triple-slash type reference", '/// <reference types="node" />\n'],
      ["a user edit resembling generated output", 'import "./.next/types/user-routes.d.ts";\n'],
    ])("preserves %s with forced color and external diff configured", (_label, edit) => {
      writeMeta();
      writeFileSync(f(), edit);
      const contents = readFileSync(f(), "utf8");
      const external = path.join(tmp, "external-diff-called");
      sh(`git config color.diff always && git config diff.external '${path.join(tmp, "external-diff")}'`);
      writeFileSync(path.join(tmp, "external-diff"), `#!/usr/bin/env bash\ntouch '${external}'\n`);
      chmodSync(path.join(tmp, "external-diff"), 0o755);
      const r = remote("stop");
      expect(r.stdout).toContain("left untouched");
      expect(readFileSync(f(), "utf8")).toBe(contents);
      expect(existsSync(external)).toBe(false);
    });
  });
});
