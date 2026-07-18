import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
import { MetricsCollector } from './metrics';
import { localBasicDataset } from './datasets/local-basic';
import { execSync } from 'child_process';
import * as fs from 'fs';

import { AutonomousAgent, FileWriteTool, ShellExecuteTool, FileReadTool, FileEditTool } from '@vortex/engine';

async function runAgent(cwd: string, prompt: string): Promise<{ steps: number, tokens: number, error?: string }> {
  try {
    const agent = new AutonomousAgent();

    // Give the agent tools mapped to the sandboxed directory
    agent.registerTools([
      new FileWriteTool(cwd),
      new ShellExecuteTool(cwd),
      new FileReadTool(cwd),
      new FileEditTool(cwd)
    ]);

    let steps = 0;

    await agent.run({
      diff: prompt,
      contextChunks: []
    }, {
      onToolCall: () => { steps++; },
      maxSteps: 15
    });

    // Mock tokens for now, as BaseAgent doesn't bubble up token usage natively yet
    return { steps, tokens: 0 };
  } catch (err: any) {
    return { steps: 0, tokens: 0, error: err.message };
  }
}

async function main() {
  const metrics = new MetricsCollector();

  console.log('Starting Evaluation Harness...\n');

  for (const task of localBasicDataset) {
    console.log(`[Task: ${task.id}] ${task.description}`);

    // Create a sandbox dir
    const sandboxDir = path.join('/tmp', `vortex-eval-${Date.now()}-${task.id}`);
    fs.mkdirSync(sandboxDir, { recursive: true });

    const startTime = Date.now();
    const agentResult = await runAgent(sandboxDir, task.description);
    const durationMs = Date.now() - startTime;

    let success = false;
    let errorMsg = agentResult.error;

    if (!errorMsg) {
      try {
        // Run verify cmd
        execSync(task.verifyCmd, { cwd: sandboxDir, stdio: 'pipe' });
        success = true;
      } catch (err: any) {
        success = false;
        const stdout = err.stdout ? err.stdout.toString().trim() : '';
        const stderr = err.stderr ? err.stderr.toString().trim() : '';
        errorMsg = `Verification command failed.`;
        if (stdout) errorMsg += `\n  STDOUT: ${stdout}`;
        if (stderr) errorMsg += `\n  STDERR: ${stderr}`;
      }
    }

    metrics.addResult({
      taskId: task.id,
      success,
      stepsTaken: agentResult.steps,
      tokensUsed: agentResult.tokens,
      durationMs,
      error: errorMsg
    });

    console.log(`Finished ${task.id} - Success: ${success}`);

    // Cleanup
    fs.rmSync(sandboxDir, { recursive: true, force: true });
  }

  metrics.printSummary();
}

main().catch(console.error);
