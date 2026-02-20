import * as vscode from 'vscode';

let currentCts = new vscode.CancellationTokenSource();

function cancelAllInFlightWork(): void {
  try {
    currentCts.cancel();
  } catch {
    // ignore
  }
}

function resetEnablementCancellationToken(): void {
  try {
    currentCts.dispose();
  } catch {
    // ignore
  }
  currentCts = new vscode.CancellationTokenSource();
}

export function cancelAndResetAllInFlightWork(): void {
  cancelAllInFlightWork();
  resetEnablementCancellationToken();
}
