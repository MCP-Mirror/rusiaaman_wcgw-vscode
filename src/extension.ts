import * as vscode from 'vscode';
import { exec } from 'child_process';
import * as path from 'path';

interface SelectionContent {
    text: string;
    path?: string;
}

export function activate(context: vscode.ExtensionContext) {
    console.log('WCGW extension is now active!');

    // Register editor command
    let editorCommand = vscode.commands.registerCommand('wcgw.sendEditorToApp', async () => {
        console.log('WCGW editor command triggered');

        try {
            const editorContent = await getEditorSelection();
            if (!editorContent.text) {
                vscode.window.showErrorMessage('No selection found in editor');
                return;
            }

            const helpfulText = await vscode.window.showInputBox({
                prompt: "Instructions or helpful text to include with the code snippet",
                placeHolder: "E.g.: This function handles user authentication..."
            });

            if (helpfulText === undefined) {
                return; // User cancelled
            }

            const formattedContent = formatEditorContent(
                helpfulText,
                editorContent,
                getWorkspacePath()
            );

            await copyToTargetApp(formattedContent);

        } catch (error: unknown) {
            console.error('Error in sendEditorToApp:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            vscode.window.showErrorMessage(`Operation failed: ${errorMessage}`);
        }
    });

    // Register terminal command
    let terminalCommand = vscode.commands.registerCommand('wcgw.sendTerminalToApp', async () => {
        console.log('WCGW terminal command triggered');

        try {
            const terminalContent = await getTerminalSelection();
            if (!terminalContent.text) {
                vscode.window.showErrorMessage('No selection found in terminal');
                return;
            }

            const helpfulText = await vscode.window.showInputBox({
                prompt: "Instructions or helpful text to include with the terminal output",
                placeHolder: "E.g.: This is the output of the build process..."
            });

            if (helpfulText === undefined) {
                return; // User cancelled
            }

            const formattedContent = formatTerminalContent(
                helpfulText,
                terminalContent,
                getWorkspacePath()
            );

            await copyToTargetApp(formattedContent);

        } catch (error: unknown) {
            console.error('Error in sendTerminalToApp:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            vscode.window.showErrorMessage(`Operation failed: ${errorMessage}`);
        }
    });

    context.subscriptions.push(editorCommand, terminalCommand);
}

async function getEditorSelection(): Promise<SelectionContent> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        return { text: '' };
    }

    const selection = editor.selection;
    return {
        text: editor.document.getText(selection).trim(),
        path: editor.document.uri.fsPath
    };
}

async function getTerminalSelection(): Promise<SelectionContent> {
    const terminal = vscode.window.activeTerminal;
    if (!terminal) {
        return { text: '' };
    }

    try {
        // Force focus on terminal first
        terminal.show(false); // false means don't take focus
        await sleep(100);

        // Save current clipboard
        const originalClipboard = await vscode.env.clipboard.readText();
        let terminalText = '';

        // Try to get existing selection
        await vscode.commands.executeCommand('workbench.action.terminal.copySelection');
        await sleep(100);
        terminalText = await vscode.env.clipboard.readText();

        // Don't try to get full content if we have a selection
        if (terminalText && terminalText.trim() && terminalText.trim() !== originalClipboard.trim()) {
            // Restore original clipboard
            await vscode.env.clipboard.writeText(originalClipboard);
            return {
                text: terminalText.trim(),
                path: 'Terminal'
            };
        }

        // If we're here, there was no selection, so restore clipboard
        await vscode.env.clipboard.writeText(originalClipboard);
        return { text: '' };
    } catch (error) {
        console.error('Failed to get terminal content:', error);
        throw new Error('Failed to get terminal content');
    }
}

function formatEditorContent(
    helpfulText: string,
    editorContent: SelectionContent,
    workspacePath: string
): { firstLine: string; restOfText: string } {
    const helpfulLines = helpfulText.split('\n');
    const firstLine = helpfulLines[0].trim();
    const otherHelpfulLines = helpfulLines.slice(1);

    let contentBlocks: string[] = [];

    // Add additional helpful text if it exists
    if (otherHelpfulLines.length > 0) {
        contentBlocks.push(otherHelpfulLines.join('\n'));
    }

    // Add separator and workspace info
    contentBlocks.push('\n---');
    contentBlocks.push(`Workspace path: ${workspacePath}`);
    contentBlocks.push('---');

    // Add file path and editor content
    contentBlocks.push(`File path: ${editorContent.path}`);
    contentBlocks.push('---');
    contentBlocks.push('Selected code:');
    contentBlocks.push('```');
    contentBlocks.push(editorContent.text);
    contentBlocks.push('```');

    // Add further instructions

    contentBlocks.push("---")
    contentBlocks.push("Read all relevant files and understand workspace structure using the available tools.")

    return {
        firstLine,
        restOfText: contentBlocks.join('\n')
    };
}

function formatTerminalContent(
    helpfulText: string,
    terminalContent: SelectionContent,
    workspacePath: string
): { firstLine: string; restOfText: string } {
    const helpfulLines = helpfulText.split('\n');
    const firstLine = helpfulLines[0].trim();
    const otherHelpfulLines = helpfulLines.slice(1);

    let contentBlocks: string[] = [];

    // Add additional helpful text if it exists
    if (otherHelpfulLines.length > 0) {
        contentBlocks.push(otherHelpfulLines.join('\n'));
    }

    // Add separator and workspace info
    contentBlocks.push('\n---');
    contentBlocks.push(`Workspace path: ${workspacePath}`);
    contentBlocks.push('---');

    // Add terminal content
    contentBlocks.push('Terminal output:');
    contentBlocks.push('```');
    contentBlocks.push(terminalContent.text);
    contentBlocks.push('```');
    contentBlocks.push("---")
    contentBlocks.push("Read all relevant files and understand workspace structure using the available tools.")

    return {
        firstLine,
        restOfText: contentBlocks.join('\n')
    };
}

function getWorkspacePath(): string {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
}

async function copyToTargetApp({ firstLine, restOfText }: { firstLine: string; restOfText: string }) {
    console.log('Writing to clipboard...');
    await vscode.env.clipboard.writeText(restOfText);
    await sleep(100);
    console.log('Clipboard write complete');

    const config = vscode.workspace.getConfiguration('wcgw');
    const targetApp = config.get<string>('targetApplication', 'Notes');

    if (process.platform !== 'darwin') {
        throw new Error('This feature is currently only supported on macOS');
    }

    console.log(`Activating ${targetApp}...`);
    return new Promise<void>((resolve, reject) => {
        exec(`osascript -e '
            tell application "${targetApp}" to activate
            delay 0.2
            tell application "System Events"
                ${firstLine.split('').map(char => 
                    `keystroke "${char.replace(/["']/g, '\\"')}"`
                ).join('\n')}
                delay 0.1
                keystroke "v" using {command down}
            end tell'`, 
        (error) => {
            if (error) {
                console.log('AppleScript error:', error);
                reject(new Error(`Failed to paste in ${targetApp}: ${error.message}`));
            } else {
                console.log('Text entry completed successfully');
                resolve();
            }
        });
    });
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function deactivate() {}