export interface EvalResult {
  taskId: string;
  success: boolean;
  stepsTaken: number;
  tokensUsed: number;
  durationMs: number;
  error?: string;
}

export class MetricsCollector {
  private results: EvalResult[] = [];

  addResult(result: EvalResult) {
    this.results.push(result);
  }

  printSummary() {
    const total = this.results.length;
    const successful = this.results.filter((r) => r.success).length;
    const successRate = total > 0 ? (successful / total) * 100 : 0;

    console.log('\n--- Evaluation Summary ---');
    console.log(`Total Tasks: ${total}`);
    console.log(`Successful: ${successful} (${successRate.toFixed(2)}%)`);
    
    for (const r of this.results) {
      console.log(`\nTask: ${r.taskId}`);
      console.log(`  Success: ${r.success ? '✅' : '❌'}`);
      console.log(`  Steps: ${r.stepsTaken}`);
      console.log(`  Duration: ${(r.durationMs / 1000).toFixed(2)}s`);
      if (r.error) {
        console.log(`  Error: ${r.error}`);
      }
    }
  }
}
