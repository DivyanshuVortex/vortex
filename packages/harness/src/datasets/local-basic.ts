export interface EvalTask {
  id: string;
  description: string;
  verifyCmd: string;
}

export const localBasicDataset: EvalTask[] = [
  {
    id: "task-001",
    description:
      "Create a Python script named calc.py that takes two integers and an operator (+, -, *, /) as CLI args (sys.argv) and prints only the numeric result (as an integer when possible). It must handle division by zero by printing 'Error: division by zero' to stderr and exiting with code 1, and must handle invalid operators by printing 'Error: invalid operator' to stderr and exiting with code 1.",
    verifyCmd: [
      "python3 << 'PYEOF'",
      "import subprocess, sys",
      "def run(*args):",
      "    return subprocess.run([sys.executable, 'calc.py'] + list(args), capture_output=True, text=True)",
      "r = run('10', '3', '+')",
      "assert r.returncode == 0 and float(r.stdout.strip()) == 13, f'add failed: {r.stdout.strip()!r}'",
      "r = run('10', '3', '*')",
      "assert r.returncode == 0 and float(r.stdout.strip()) == 30, f'mul failed: {r.stdout.strip()!r}'",
      "r = run('10', '0', '/')",
      "assert r.returncode == 1, f'div0 should exit 1, got {r.returncode}'",
      "assert 'division by zero' in r.stderr.lower(), f'div0 stderr: {r.stderr!r}'",
      "r = run('10', '3', '%')",
      "assert r.returncode == 1, f'invalid op should exit 1, got {r.returncode}'",
      "assert 'invalid operator' in r.stderr.lower(), f'invalid op stderr: {r.stderr!r}'",
      "print('OK')",
      "PYEOF",
    ].join("\n"),
  },
  {
    id: "task-002",
    description:
      "Create config.json with keys 'name' (string), 'version' (semver string like '1.0.0'), and 'dependencies' (object mapping package names to version strings, at least 3 entries). Then write validate.py that reads config.json, validates the schema (all three keys present, version matches X.Y.Z pattern, dependencies is a non-empty object), and prints 'VALID' if valid or 'INVALID' otherwise.",
    verifyCmd:
      "python3 -c \"import json; d=json.load(open('config.json')); assert set(['name','version','dependencies']) <= set(d.keys()); import re; assert re.match(r'^\\d+\\.\\d+\\.\\d+$', d['version']); assert len(d['dependencies']) >= 3\" && test \"$(python3 validate.py)\" = 'VALID'",
  },
  {
    id: "task-003",
    description:
      "Create a Node.js script server.js that starts an HTTP server on port 4321 with two routes: GET /health returning JSON {\"status\":\"ok\"} with status 200, and GET /sum?a=<num>&b=<num> returning JSON {\"result\": a+b}. Missing or non-numeric query params must return status 400 with JSON {\"error\":\"invalid input\"}. The server must not crash on malformed requests.",
    verifyCmd: [
      "python3 << 'PYEOF'",
      "import subprocess, time, json, sys",
      "from urllib.request import urlopen",
      "from urllib.error import HTTPError",
      "p = subprocess.Popen(['node', 'server.js'], stdout=subprocess.PIPE, stderr=subprocess.PIPE)",
      "time.sleep(2)",
      "try:",
      "    r = urlopen('http://localhost:4321/health')",
      "    d = json.loads(r.read())",
      "    assert d.get('status') == 'ok', f'health: {d}'",
      "    r = urlopen('http://localhost:4321/sum?a=4&b=5')",
      "    d = json.loads(r.read())",
      "    assert d.get('result') == 9, f'sum: {d}'",
      "    try:",
      "        urlopen('http://localhost:4321/sum?a=x&b=5')",
      "        assert False, 'expected 400 but got 200'",
      "    except HTTPError as e:",
      "        assert e.code == 400, f'expected 400, got {e.code}'",
      "    print('OK')",
      "finally:",
      "    p.terminate()",
      "    p.wait()",
      "PYEOF",
    ].join("\n"),
  },
  {
    id: "task-004",
    description:
      "Write a Bash script backup.sh that accepts a source directory as $1 and a destination directory as $2, recursively copies all .txt and .md files preserving the relative directory structure, skips files larger than 1MB, and prints a summary line 'Copied: <N> files, Skipped: <M> files' at the end. Must handle the case where the source directory does not exist by printing 'Error: source not found' to stderr and exiting 1.",
    verifyCmd: [
      "mkdir -p src/a && echo hi > src/a/note.txt && echo hi > src/readme.md && dd if=/dev/zero of=src/a/big.txt bs=1M count=2 2>/dev/null",
      "&& bash backup.sh src dst | grep -qiE 'Copied:\\s*2\\s+files?,\\s*Skipped:\\s*1\\s+files?'",
      "&& test -f dst/a/note.txt && test -f dst/readme.md && ! test -f dst/a/big.txt",
      "&& bash backup.sh nonexistent dst2 2>&1 >/dev/null | grep -qi 'source not found'",
    ].join(" "),
  },
  {
    id: "task-005",
    description:
      "Create a Python module inventory.py implementing a thread-safe Inventory class with methods add(item_id, qty), remove(item_id, qty) that raises ValueError if resulting quantity would go negative, and get(item_id) returning current quantity (0 if unknown). Add a script that spawns 10 threads concurrently calling add('widget', 1) 100 times each, then prints the final quantity for 'widget', which must equal exactly 1000 (no race conditions allowed).",
    verifyCmd:
      "python3 -c \"from inventory import Inventory; import threading; inv=Inventory(); \nfns=[lambda: [inv.add('widget',1) for _ in range(100)] for _ in range(10)]\nthreads=[threading.Thread(target=f) for f in fns]\n[t.start() for t in threads]\n[t.join() for t in threads]\nassert inv.get('widget')==1000, inv.get('widget')\nprint('OK')\" | grep -q OK",
  },
];