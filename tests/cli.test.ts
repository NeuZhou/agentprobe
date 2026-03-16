import { describe, it, expect } from 'vitest';
import { Command } from 'commander';

// We test CLI argument parsing by creating a fresh Command and verifying options
// This avoids actually running the CLI which has side effects

describe('cli', () => {
  function makeCli() {
    const program = new Command();
    program.exitOverride(); // throw instead of process.exit

    const runCmd = program
      .command('run <suite>')
      .option('-f, --format <format>', 'Output format', 'console')
      .option('-t, --tag <tags...>', 'Filter by tags')
      .option('-w, --watch', 'Watch mode')
      .option('--parallel', 'Run in parallel')
      .option('--badge <path>', 'Badge output path')
      .option('--env-file <path>', 'Env file path')
      .action(() => {});

    const initCmd = program.command('init').action(() => {});
    const secCmd = program.command('generate-security').action(() => {});

    program.version('1.0.0');

    return { program, runCmd };
  }

  it('run command parses suite path', () => {
    const { program } = makeCli();
    program.parse(['run', 'tests.yaml'], { from: 'user' });
    const cmd = program.commands.find(c => c.name() === 'run');
    expect(cmd?.args[0]).toBe('tests.yaml');
  });

  it('--format flag accepted', () => {
    const { program } = makeCli();
    program.parse(['run', 'tests.yaml', '-f', 'json'], { from: 'user' });
    const cmd = program.commands.find(c => c.name() === 'run');
    expect(cmd?.opts().format).toBe('json');
  });

  it('--tag filter', () => {
    const { program } = makeCli();
    program.parse(['run', 'tests.yaml', '-t', 'smoke', 'critical'], { from: 'user' });
    const cmd = program.commands.find(c => c.name() === 'run');
    expect(cmd?.opts().tag).toEqual(['smoke', 'critical']);
  });

  it('--watch flag', () => {
    const { program } = makeCli();
    program.parse(['run', 'tests.yaml', '-w'], { from: 'user' });
    const cmd = program.commands.find(c => c.name() === 'run');
    expect(cmd?.opts().watch).toBe(true);
  });

  it('--parallel flag', () => {
    const { program } = makeCli();
    program.parse(['run', 'tests.yaml', '--parallel'], { from: 'user' });
    const cmd = program.commands.find(c => c.name() === 'run');
    expect(cmd?.opts().parallel).toBe(true);
  });

  it('--badge output path', () => {
    const { program } = makeCli();
    program.parse(['run', 'tests.yaml', '--badge', 'badge.svg'], { from: 'user' });
    const cmd = program.commands.find(c => c.name() === 'run');
    expect(cmd?.opts().badge).toBe('badge.svg');
  });

  it('--env-file path', () => {
    const { program } = makeCli();
    program.parse(['run', 'tests.yaml', '--env-file', '.env.test'], { from: 'user' });
    const cmd = program.commands.find(c => c.name() === 'run');
    expect(cmd?.opts().envFile).toBe('.env.test');
  });

  it('init command exists', () => {
    const { program } = makeCli();
    program.parse(['init'], { from: 'user' });
    const cmd = program.commands.find(c => c.name() === 'init');
    expect(cmd).toBeDefined();
  });

  it('--version flag', () => {
    const { program } = makeCli();
    expect(program.version()).toBe('1.0.0');
  });

  it('generate-security command exists', () => {
    const { program } = makeCli();
    const cmd = program.commands.find(c => c.name() === 'generate-security');
    expect(cmd).toBeDefined();
  });

  it('default format is console', () => {
    const { program } = makeCli();
    program.parse(['run', 'tests.yaml'], { from: 'user' });
    const cmd = program.commands.find(c => c.name() === 'run');
    expect(cmd?.opts().format).toBe('console');
  });
});
