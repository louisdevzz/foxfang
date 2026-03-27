/**
 * Browser Command - Manage browser automation
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { spawn, spawnSync } from 'child_process';
import { confirm, spinner, isCancel } from '@clack/prompts';
import { loadConfig, saveConfig } from '../../config/index';
import { BrowserTool } from '../../tools/builtin/browser';

export async function registerBrowserCommand(program: Command): Promise<void> {
  const browser = program
    .command('browser')
    .description('Manage browser automation for web scraping and interaction');

  // Status command
  browser
    .command('status')
    .description('Check browser service status')
    .action(async () => {
      const config = await loadConfig();
      
      if (!config.browser?.enabled) {
        console.log(chalk.yellow('⚠ Browser automation is not enabled'));
        console.log(chalk.dim('\nTo enable:'));
        console.log(chalk.dim('  foxfang browser setup'));
        return;
      }

      const s = spinner();
      s.start('Checking browser status...');

      try {
        const browserTool = new BrowserTool();
        const result = await browserTool.execute({ action: 'status' });
        
        s.stop();

        if (result.success && result.data) {
          const status = result.data as any;
          if (status.running) {
            console.log(chalk.green('✓ Browser service is running'));
            console.log(chalk.dim(`  PID: ${status.pid}`));
            console.log(chalk.dim(`  Port: ${status.cdpPort}`));
            console.log(chalk.dim(`  Browser: ${status.chosenBrowser || 'unknown'}`));
            console.log(chalk.dim(`  Headless: ${status.headless}`));
          } else {
            console.log(chalk.yellow('⚠ Browser service is not running'));
            console.log(chalk.dim('\nTo start:'));
            console.log(chalk.dim('  foxfang browser start'));
          }
        } else {
          console.log(chalk.red('✗ Failed to get browser status'));
          console.log(chalk.dim(result.error || 'Unknown error'));
        }
      } catch (error) {
        s.stop(chalk.red('✗ Failed to check status'));
        console.error(chalk.red(error instanceof Error ? error.message : String(error)));
      }
    });

  // Setup command
  browser
    .command('setup')
    .description('Configure browser automation')
    .action(async () => {
      console.log(chalk.cyan('\n🌐 Browser Automation Setup\n'));
      
      const config = await loadConfig();
      
      const enableBrowser = await confirm({
        message: 'Enable browser automation for web scraping and interaction?',
        initialValue: config.browser?.enabled ?? false,
      });

      if (isCancel(enableBrowser)) {
        console.log(chalk.dim('Setup cancelled.'));
        return;
      }

      if (!enableBrowser) {
        config.browser = { enabled: false };
        await saveConfig(config);
        console.log(chalk.yellow('Browser automation disabled.'));
        return;
      }

      const s = spinner();
      s.start('Checking dependencies...');

      try {
        // Check if Playwright is installed
        const check = spawnSync('npx', ['playwright', '--version'], {
          stdio: ['ignore', 'pipe', 'pipe'],
          encoding: 'utf8',
          timeout: 10000,
        });
        
        if (check.status !== 0) {
          s.stop(chalk.yellow('⚠ Playwright not found'));
          
          const installPlaywright = await confirm({
            message: 'Playwright is required. Install it now?',
            initialValue: true,
          });

          if (installPlaywright && !isCancel(installPlaywright)) {
            s.start('Installing Playwright...');
            
            await new Promise<void>((resolve, reject) => {
              const child = spawn('npm', ['install', '-g', 'playwright'], {
                stdio: ['ignore', 'pipe', 'pipe'],
              });
              
              let stderr = '';
              child.stderr?.on('data', (chunk) => {
                stderr += chunk.toString();
              });
              
              child.on('close', (code) => {
                if (code === 0) {
                  resolve();
                } else {
                  reject(new Error(`npm install failed: ${stderr}`));
                }
              });
              
              child.on('error', (err) => {
                reject(err);
              });
            });
            
            s.stop(chalk.green('✓ Playwright installed'));
            s.start('Installing browser binaries...');
            
            await new Promise<void>((resolve, reject) => {
              const child = spawn('npx', ['playwright', 'install', 'chromium'], {
                stdio: ['ignore', 'pipe', 'pipe'],
              });
              
              let stderr = '';
              child.stderr?.on('data', (chunk) => {
                stderr += chunk.toString();
              });
              
              child.on('close', (code) => {
                if (code === 0) {
                  resolve();
                } else {
                  reject(new Error(`playwright install failed: ${stderr}`));
                }
              });
              
              child.on('error', (err) => {
                reject(err);
              });
            });
            
            s.stop(chalk.green('✓ Browser binaries installed'));
          } else {
            console.log(chalk.yellow('⚠ Playwright is required. Install manually:'));
            console.log(chalk.dim('  npm install -g playwright'));
            console.log(chalk.dim('  npx playwright install chromium'));
            return;
          }
        } else {
          s.stop(chalk.green('✓ Playwright is installed'));
        }

        // Configure settings
        const headless = await confirm({
          message: 'Run browser in headless mode (no visible window)?',
          initialValue: config.browser?.headless ?? true,
        });

        if (isCancel(headless)) {
          console.log(chalk.dim('Setup cancelled.'));
          return;
        }

        // Save config
        config.browser = {
          enabled: true,
          port: 9222,
          host: 'localhost',
          headless: headless,
          defaultProfile: 'default',
          autoStart: true,
        };

        await saveConfig(config);
        console.log(chalk.green('\n✓ Browser configured successfully'));
        console.log(chalk.dim('\nYou can now use browser automation:'));
        console.log(chalk.dim('  foxfang browser status'));
        console.log(chalk.dim('  foxfang browser start'));
        console.log(chalk.dim('  foxfang browser stop'));
        console.log(chalk.dim('\nOr use it in chat:'));
        console.log(chalk.dim('  "Open https://example.com and take a screenshot"'));
        
      } catch (error) {
        s.stop(chalk.red('✗ Setup failed'));
        console.error(chalk.red(error instanceof Error ? error.message : String(error)));
        console.log(chalk.dim('\nYou can configure browser manually by editing:'));
        console.log(chalk.dim('  ~/.foxfang/foxfang.json'));
      }
    });

  // Start command
  browser
    .command('start')
    .description('Start browser service')
    .action(async () => {
      const config = await loadConfig();
      
      if (!config.browser?.enabled) {
        console.log(chalk.yellow('⚠ Browser automation is not enabled'));
        console.log(chalk.dim('\nRun setup first:'));
        console.log(chalk.dim('  foxfang browser setup'));
        return;
      }

      const s = spinner();
      s.start('Starting browser service...');

      try {
        const browserTool = new BrowserTool();
        const result = await browserTool.execute({ action: 'start' });
        
        s.stop();

        if (result.success) {
          console.log(chalk.green('✓ Browser service started'));
          const status = result.data as any;
          if (status) {
            console.log(chalk.dim(`  PID: ${status.pid}`));
            console.log(chalk.dim(`  Port: ${status.cdpPort}`));
          }
        } else {
          console.log(chalk.red('✗ Failed to start browser service'));
          console.log(chalk.dim(result.error || 'Unknown error'));
        }
      } catch (error) {
        s.stop(chalk.red('✗ Failed to start'));
        console.error(chalk.red(error instanceof Error ? error.message : String(error)));
      }
    });

  // Stop command
  browser
    .command('stop')
    .description('Stop browser service')
    .action(async () => {
      const config = await loadConfig();
      
      if (!config.browser?.enabled) {
        console.log(chalk.yellow('⚠ Browser automation is not enabled'));
        return;
      }

      const s = spinner();
      s.start('Stopping browser service...');

      try {
        const browserTool = new BrowserTool();
        const result = await browserTool.execute({ action: 'stop' });
        
        s.stop();

        if (result.success) {
          console.log(chalk.green('✓ Browser service stopped'));
        } else {
          console.log(chalk.red('✗ Failed to stop browser service'));
          console.log(chalk.dim(result.error || 'Unknown error'));
        }
      } catch (error) {
        s.stop(chalk.red('✗ Failed to stop'));
        console.error(chalk.red(error instanceof Error ? error.message : String(error)));
      }
    });

  // Profiles command
  browser
    .command('profiles')
    .description('List browser profiles')
    .action(async () => {
      const config = await loadConfig();
      
      if (!config.browser?.enabled) {
        console.log(chalk.yellow('⚠ Browser automation is not enabled'));
        console.log(chalk.dim('\nRun setup first:'));
        console.log(chalk.dim('  foxfang browser setup'));
        return;
      }

      const s = spinner();
      s.start('Fetching profiles...');

      try {
        const browserTool = new BrowserTool();
        const result = await browserTool.execute({ action: 'profiles' });
        
        s.stop();

        if (result.success && result.data) {
          const data = result.data as any;
          const profiles = data.profiles || [];
          
          if (profiles.length === 0) {
            console.log(chalk.yellow('No profiles found'));
            return;
          }

          console.log(chalk.cyan(`${profiles.length} profile(s):`));
          console.log();

          for (const profile of profiles) {
            const isDefault = profile.isDefault ? chalk.green(' [default]') : '';
            const status = profile.running ? chalk.green('● running') : chalk.gray('○ stopped');
            console.log(`  ${profile.name}${isDefault}`);
            console.log(chalk.dim(`      Status: ${status}`));
            console.log(chalk.dim(`      Port: ${profile.cdpPort || 'N/A'}`));
            console.log(chalk.dim(`      Tabs: ${profile.tabCount || 0}`));
            console.log();
          }
        } else {
          console.log(chalk.red('✗ Failed to fetch profiles'));
          console.log(chalk.dim(result.error || 'Unknown error'));
        }
      } catch (error) {
        s.stop(chalk.red('✗ Failed to fetch profiles'));
        console.error(chalk.red(error instanceof Error ? error.message : String(error)));
      }
    });

  // Disable command
  browser
    .command('disable')
    .description('Disable browser automation')
    .action(async () => {
      const config = await loadConfig();
      
      if (!config.browser?.enabled) {
        console.log(chalk.yellow('Browser automation is already disabled'));
        return;
      }

      const confirmDisable = await confirm({
        message: 'Disable browser automation?',
        initialValue: false,
      });

      if (confirmDisable && !isCancel(confirmDisable)) {
        config.browser.enabled = false;
        await saveConfig(config);
        console.log(chalk.green('✓ Browser automation disabled'));
      }
    });
}
