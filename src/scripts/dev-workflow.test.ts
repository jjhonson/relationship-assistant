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
    `#!/usr/bin/env bash
echo "$@" >> "${tmp}/gh.log"
if [ "$1" != "codespace" ]; then echo "unsupported gh command: $*" >&2; exit 97; fi
case "$2" in
  list) printf '%b' '${listOutput}' ;;
  ssh)
    if [ "$3" != "-c" ] || [ "$5" != "--" ]; then echo "invalid ssh invocation: $*" >&2; exit 98; fi
    if [ "$6" = "true" ]; then exit 0; fi
    if [ "$6" = "bash" ] && [ "$7" = "-s" ] && [ "$8" = "--" ]; then shift 5; exec "$@"; fi
    echo "unsupported ssh command: $*" >&2; exit 99
    ;;
  ports)
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

  it("cleans up a Codespace it woke when the remote server fails before forwarding", () => {
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
    const m = { pid: String(pid), start, codespace: "cs-one", port: "3000", ...fields };
    mkdirSync(path.join(tmp, "state"), { recursive: true });
    writeFileSync(path.join(tmp, "state/forward-cs-one.meta"), Object.entries(m).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
  }
  function fakeForward(args = "codespace ports forward 3000:3000 -c cs-one") {
    return spawn(path.join(bin, "gh"), args.split(" "));
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

  it("uses the documented gh codespace ssh command and pipes bash -s arguments", () => {
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
  });
});

describe("remote-dev.sh", () => {
  const PORT = String(38000 + (process.pid % 1000));
  let pidFile: string;
  let work: string;
  const sh = (cmd: string, cwd = work) => spawnSync("bash", ["-c", cmd], { cwd, encoding: "utf8" });
  const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

  function remote(action: string, extra: Record<string, string> = {}, force = "0", runId = "test-run") {
    return spawnSync("bash", [path.join(scripts, "remote-dev.sh"), action, work, PORT, force, runId], {
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
