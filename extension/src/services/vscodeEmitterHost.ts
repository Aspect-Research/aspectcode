import * as path from 'path';
import * as vscode from 'vscode';
import type { EmitterHost } from '@aspectcode/emitters';

function uriForFsPath(fsPath: string): vscode.Uri {
  // Use file URI for absolute paths.
  return vscode.Uri.file(fsPath);
}

export function createVsCodeEmitterHost(): EmitterHost {
  return {
    async readFile(filePath: string): Promise<string> {
      const bytes = await vscode.workspace.fs.readFile(uriForFsPath(filePath));
      return Buffer.from(bytes).toString('utf8');
    },

    async writeFile(filePath: string, content: string): Promise<void> {
      const dir = path.dirname(filePath);
      await vscode.workspace.fs.createDirectory(uriForFsPath(dir));
      await vscode.workspace.fs.writeFile(uriForFsPath(filePath), Buffer.from(content, 'utf8'));
    },

    async exists(filePath: string): Promise<boolean> {
      try {
        await vscode.workspace.fs.stat(uriForFsPath(filePath));
        return true;
      } catch {
        return false;
      }
    },

    async mkdirp(dirPath: string): Promise<void> {
      await vscode.workspace.fs.createDirectory(uriForFsPath(dirPath));
    },

    async rename(fromPath: string, toPath: string): Promise<void> {
      await vscode.workspace.fs.rename(uriForFsPath(fromPath), uriForFsPath(toPath), {
        overwrite: true,
      });
    },

    async rmrf(targetPath: string): Promise<void> {
      try {
        await vscode.workspace.fs.delete(uriForFsPath(targetPath), {
          recursive: true,
          useTrash: false,
        });
      } catch {
        // ignore
      }
    },

    join(...segments: string[]): string {
      return path.join(...segments);
    },

    relative(from: string, to: string): string {
      return path.relative(from, to).replace(/\\/g, '/');
    },
  };
}
