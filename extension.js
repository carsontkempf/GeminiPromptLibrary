// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');

const CONFIG_SECTION_CTK = 'ctk'; // The configuration section identifier
const CTK_RULE_SET_KEY = 'ruleSet';   // The key for the ruleSet *within* the CONFIG_SECTION_CTK
const GEMINI_CODE_ASSIST_RULES_KEY = 'geminicodeassist.rules';
// For geminicodeassist.rules, since it's defined as a root property in package.json,
// we use getConfiguration() without a section or getConfiguration(null)
// and update it directly.

/**
 * @typedef {object} Rule
 * @property {number} id
 * @property {string} key
 * @property {string} value
 */

// --- Helper Functions ---

/**
 * Checks if a workspace is currently open.
 * @returns {boolean} True if a workspace is open, false otherwise.
 */
function isWorkspaceOpen() {
    return !!(vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0);
}

/**
 * Retrieves the current rule set from the specified configuration scope.
 * @param {vscode.ConfigurationTarget} scope The configuration scope (Global or Workspace).
 * @returns {Rule[]} The current set of rules from the specified scope.
 */
function getCtkRuleSet(scope) {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION_CTK);
    const inspection = config.inspect(CTK_RULE_SET_KEY);

    let rulesToConsider;
    if (scope === vscode.ConfigurationTarget.Global) {
        rulesToConsider = inspection?.globalValue;
    } else if (scope === vscode.ConfigurationTarget.Workspace && isWorkspaceOpen()) {
        rulesToConsider = inspection?.workspaceValue;
    } else {
        // For WorkspaceFolder or if workspace not open for Workspace scope
        // or an unsupported scope, return empty.
        return [];
    }
    return Array.isArray(rulesToConsider) ? rulesToConsider : [];
}

/**
 * Updates the rule set in the specified configuration scope.
 * @param {Rule[]} rules The new set of rules to save.
 * @param {vscode.ConfigurationTarget} scope The configuration scope to update.
 */
async function updateCtkRuleSet(rules, scope) {
    if (scope === vscode.ConfigurationTarget.Workspace && !isWorkspaceOpen()) {
        vscode.window.showErrorMessage("CTK GEE: Cannot update workspace rules as no workspace is open.");
        return;
    }
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION_CTK);
    await config.update(CTK_RULE_SET_KEY, rules, scope);
}

/**
 * Generates the combined string for geminicodeassist.rules from the ctk.ruleSet.
 * @param {Rule[]} rules The set of rules.
 * @returns {string} The combined rules string.
 */
function generateGeminiRulesString(rules) {
    if (!Array.isArray(rules) || rules.length === 0) {
        return "";
    }
    // Format: key: value, separated by four newlines
    return rules.map(rule => `${rule.key}: ${rule.value}`).join('\n\n\n\n');
}


/**
 * Syncs the ctk.ruleSet to the geminicodeassist.rules setting in the specified configuration scope.
 * @param {vscode.ConfigurationTarget} scope The configuration scope to sync.
 */
async function syncRuleSetToGeminiRules(scope) {
    if (scope === vscode.ConfigurationTarget.Workspace && !isWorkspaceOpen()) {
        // Don't attempt to sync workspace if no workspace is open
        return;
    }

    const ctkRules = getCtkRuleSet(scope);
    const geminiString = generateGeminiRulesString(ctkRules);
    const rootConfig = vscode.workspace.getConfiguration(); // For top-level settings

    const scopeName = scope === vscode.ConfigurationTarget.Global ? "global" : "workspace";

    try {
        await rootConfig.update(GEMINI_CODE_ASSIST_RULES_KEY, geminiString, scope);
        console.log(`CTK GEE: Successfully synced to ${scopeName} geminicodeassist.rules`);
    } catch (error) {
        vscode.window.showErrorMessage(`CTK GEE: Error syncing to ${scopeName} geminicodeassist.rules: ${error.message}`);
        console.error(`CTK GEE: Error syncing to ${scopeName} geminicodeassist.rules:`, error);
    }
}

/**
 * Checks for external changes to geminicodeassist.rules in the specified scope and resolves them.
 * @param {vscode.ConfigurationTarget} scope The configuration scope to check.
 */
async function checkAndResolveExternalGeminiRulesChange(scope) {
    if (scope === vscode.ConfigurationTarget.Workspace && !isWorkspaceOpen()) {
        return;
    }

    const ctkRules = getCtkRuleSet(scope);
    const expectedGeminiString = generateGeminiRulesString(ctkRules);

    const rootConfig = vscode.workspace.getConfiguration();
    const inspection = rootConfig.inspect(GEMINI_CODE_ASSIST_RULES_KEY);

    let actualGeminiStringInScope;
    const scopeName = scope === vscode.ConfigurationTarget.Global ? "Global" : "Workspace";

    if (scope === vscode.ConfigurationTarget.Global) {
        actualGeminiStringInScope = typeof inspection?.globalValue === 'string' ? inspection.globalValue : "";
    } else if (scope === vscode.ConfigurationTarget.Workspace) {
        actualGeminiStringInScope = typeof inspection?.workspaceValue === 'string' ? inspection.workspaceValue : "";
    } else {
        return; // Should not happen for Global/Workspace
    }

    if (actualGeminiStringInScope !== expectedGeminiString) {
        const choice = await vscode.window.showWarningMessage(
            `CTK GEE: ${scopeName} 'geminicodeassist.rules' was modified externally. This extension manages this setting based on the ${scopeName} 'ctk.ruleSet'.`,
            { modal: true },
            `Overwrite with ${scopeName} ctk.ruleSet content`,
            "Keep external changes (not recommended)"
        );

        if (choice === `Overwrite with ${scopeName} ctk.ruleSet content`) {
            await rootConfig.update(GEMINI_CODE_ASSIST_RULES_KEY, expectedGeminiString, scope);
            vscode.window.showInformationMessage(`CTK GEE: Re-synced ${scopeName} geminicodeassist.rules from ${scopeName} ctk.ruleSet.`);
        }
    }
}

/**
 * Handles initial import of existing global geminicodeassist.rules content.
 * This is designed to run once or if ctk.ruleSet is empty.
 */
async function performInitialGlobalImport() {
    let ctkRules = getCtkRuleSet(vscode.ConfigurationTarget.Global);

    // Only attempt import if ctk.ruleSet is currently empty
    if (ctkRules.length === 0) {
        const rootConfig = vscode.workspace.getConfiguration();
        const inspection = rootConfig.inspect(GEMINI_CODE_ASSIST_RULES_KEY);
        const globalValue = inspection?.globalValue;

        if (globalValue && typeof globalValue === 'string' && globalValue.trim() !== "") {
            const userChoice = await vscode.window.showInformationMessage(
                `CTK GEE: Found existing content in global 'geminicodeassist.rules'. Would you like to import it as the first rule (ID: 1) into 'ctk.ruleSet'?`,
                { modal: true },
                "Yes, import it",
                "No, start fresh"
            );

            if (userChoice === "Yes, import it") {
                ctkRules.push({
                    id: 1, // Assigning ID 1 as requested for the inherited/imported rule
                    key: "Imported Global Rule", // Default key, user can edit later
                    value: globalValue
                });
                await updateCtkRuleSet(ctkRules, vscode.ConfigurationTarget.Global);
                vscode.window.showInformationMessage("CTK GEE: Imported existing global geminicodeassist.rules content into ctk.ruleSet.");
            }
        }
    }
}

/**
 * Handles initial import of existing workspace geminicodeassist.rules content.
 * This is designed to run once or if workspace ctk.ruleSet is empty.
 */
async function performInitialWorkspaceImport() {
    if (!isWorkspaceOpen()) return;

    let ctkRules = getCtkRuleSet(vscode.ConfigurationTarget.Workspace);

    if (ctkRules.length === 0) {
        const rootConfig = vscode.workspace.getConfiguration();
        const inspection = rootConfig.inspect(GEMINI_CODE_ASSIST_RULES_KEY);
        const workspaceValue = inspection?.workspaceValue; // Check workspace value

        if (workspaceValue && typeof workspaceValue === 'string' && workspaceValue.trim() !== "") {
            const userChoice = await vscode.window.showInformationMessage(
                `CTK GEE: Found existing content in workspace 'geminicodeassist.rules'. Would you like to import it as the first rule (ID: 1) into workspace 'ctk.ruleSet'?`,
                { modal: true },
                "Yes, import it",
                "No, start fresh"
            );

            if (userChoice === "Yes, import it") {
                ctkRules.push({
                    id: 1,
                    key: "Imported Workspace Rule",
                    value: workspaceValue
                });
                await updateCtkRuleSet(ctkRules, vscode.ConfigurationTarget.Workspace);
                vscode.window.showInformationMessage("CTK GEE: Imported existing workspace geminicodeassist.rules content into workspace ctk.ruleSet.");
            }
        }
    }
}

/**
 * Ensures that all rules in the given array have unique IDs and unique keys.
 * IDs will be re-assigned sequentially if duplicates or non-numeric IDs are found.
 * Duplicate keys will be modified by appending a suffix (e.g., "_duplicate_1").
 * @param {Rule[]} rules The array of rules to process.
 * @param {string} scopeNameProper User-friendly scope name (e.g., "Global", "Workspace").
 * @param {vscode.ConfigurationTarget} scope The configuration scope.
 * @returns {Promise<boolean>} True if changes were made and updated, false otherwise.
 */
async function ensureUniqueIdsAndKeys(rules, scopeNameProper, scope) {
    if (!Array.isArray(rules)) return false;

    let madeChanges = false;

    // 1. Ensure unique and sequential IDs
    const idSet = new Set();
    let maxId = 0;
    let reassignIds = false;

    for (const rule of rules) {
        if (typeof rule.id !== 'number' || idSet.has(rule.id) || rule.id <= 0) {
            reassignIds = true;
            break;
        }
        idSet.add(rule.id);
        if (rule.id > maxId) maxId = rule.id;
    }

    if (reassignIds) {
        madeChanges = true;
        console.warn(`CTK GEE: Re-assigning IDs for ${scopeNameProper} rules due to duplicates, non-numeric, or non-positive values.`);
        rules.forEach((rule, index) => {
            rule.id = index + 1;
        });
    }

    // 2. Ensure unique keys
    const keyCounts = new Map();
    const originalKeysToNewKeys = new Map(); // To handle multiple duplicates of the same original key

    for (const rule of rules) {
        let currentKey = rule.key;
        let count = keyCounts.get(currentKey) || 0;

        if (count > 0) { // This key is a duplicate
            madeChanges = true;
            let newKey;
            let duplicateIndex = originalKeysToNewKeys.get(currentKey) || 0;
            do {
                duplicateIndex++;
                newKey = `${currentKey}_duplicate_${duplicateIndex}`;
            } while (keyCounts.has(newKey)); // Ensure the new suffixed key is also unique
            originalKeysToNewKeys.set(currentKey, duplicateIndex);
            console.warn(`CTK GEE: Modifying duplicate key "${currentKey}" to "${newKey}" in ${scopeNameProper} rules.`);
            rule.key = newKey;
            keyCounts.set(newKey, 1); // Add the new unique key
        } else {
            keyCounts.set(currentKey, 1);
        }
    }

    if (madeChanges) {
        await updateCtkRuleSet(rules, scope);
        vscode.window.showWarningMessage(`CTK GEE: Rules in ${scopeNameProper} settings were adjusted to ensure unique IDs and/or keys. Please review them if necessary.`);
        return true;
    }
    return false;
}

/**
 * @param {vscode.ExtensionContext} context
 */
async function activate(context) {
    console.log('CTK GEE: Extension "ctk" is now active!');

    try {
        console.log('CTK GEE: Performing initial imports and syncs...');
        await performInitialGlobalImport();
        let globalRules = getCtkRuleSet(vscode.ConfigurationTarget.Global);
        await ensureUniqueIdsAndKeys(globalRules, "Global", vscode.ConfigurationTarget.Global);

        if (isWorkspaceOpen()) {
            await performInitialWorkspaceImport();
            let workspaceRules = getCtkRuleSet(vscode.ConfigurationTarget.Workspace);
            await ensureUniqueIdsAndKeys(workspaceRules, "Workspace", vscode.ConfigurationTarget.Workspace);
        }

        // Re-fetch rules after potential modifications by ensureUniqueIdsAndKeys before syncing
        globalRules = getCtkRuleSet(vscode.ConfigurationTarget.Global);
        await syncRuleSetToGeminiRules(vscode.ConfigurationTarget.Global);

        if (isWorkspaceOpen()) {
            let workspaceRules = getCtkRuleSet(vscode.ConfigurationTarget.Workspace);
            await syncRuleSetToGeminiRules(vscode.ConfigurationTarget.Workspace);
        }
        console.log('CTK GEE: Initial imports and syncs completed.');

    } catch (error) {
        console.error("CTK GEE: Error during initial setup (imports/syncs):", error);
        vscode.window.showErrorMessage("CTK GEE: Error during initial setup. Some features might be affected. Check Developer Tools Console (Help > Toggle Developer Tools).");
    }

    // --- Register Commands ---
    try {
        console.log('CTK GEE: Registering commands...');
        // Helper to register CRUD commands for a given scope
        const registerCrudCommandsForScope = (scope, scopeNameProper, commandSuffix) => {
            const targetScope = scope; // vscode.ConfigurationTarget.Global or vscode.ConfigurationTarget.Workspace

            // Add Rule Command
            context.subscriptions.push(vscode.commands.registerCommand(`ctk.add${commandSuffix}Rule`, async () => {
                if (targetScope === vscode.ConfigurationTarget.Workspace && !isWorkspaceOpen()) {
                    vscode.window.showInformationMessage(`CTK GEE: A workspace must be open to add a ${scopeNameProper} rule.`);
                    return;
                }

            const keyInput = await vscode.window.showInputBox({ 
                prompt: `Enter the rule key for ${scopeNameProper} settings`, 
                validateInput: text => text && text.trim() !== "" ? null : "Key cannot be empty." 
            });
            if (keyInput === undefined) return; // User cancelled
            const key = keyInput.trim();

            let rules = getCtkRuleSet(targetScope);
            if (rules.some(r => r.key === key)) {
                vscode.window.showErrorMessage(`CTK GEE: A rule with key "${key}" already exists in ${scopeNameProper} settings. Keys must be unique.`);
                return;
            }

            const value = await vscode.window.showInputBox({ prompt: `Enter the rule value for ${scopeNameProper} settings`, validateInput: text => text && text.trim() !== "" ? null : "Value cannot be empty." });
            if (key === undefined) return; // User cancelled
            const newId = rules.length > 0 ? Math.max(0, ...rules.map(r => r.id)) + 1 : 1;
            rules.push({ id: newId, key: key.trim(), value: value.trim() });
                await updateCtkRuleSet(rules, targetScope);
                vscode.window.showInformationMessage(`CTK GEE: ${scopeNameProper} Rule ID ${newId} added.`);
                // Sync will happen via onDidChangeConfiguration or user can force it
            }));

            // View Rules Command
            context.subscriptions.push(vscode.commands.registerCommand(`ctk.view${commandSuffix}Rules`, () => {
                if (targetScope === vscode.ConfigurationTarget.Workspace && !isWorkspaceOpen()) {
                    vscode.window.showInformationMessage(`CTK GEE: A workspace must be open to view ${scopeNameProper} rules.`);
                    return;
                }
                const rules = getCtkRuleSet(targetScope);
            if (rules.length === 0) {
                    vscode.window.showInformationMessage(`CTK GEE: No rules configured in ${scopeNameProper} ctk.ruleSet.`);
                return;
            }
            const ruleDisplay = rules.map(r => `ID: ${r.id}\nKey: ${r.key}\nValue: ${r.value}`).join('\n----------\n');
                vscode.window.showInformationMessage(`CTK GEE: Current ${scopeNameProper} Rules (see Output > CTK GEE for all):`);
                console.log(`--- CTK GEE: Current ${scopeNameProper} Rules ---`);
            rules.forEach(r => console.log(`ID: ${r.id}, Key: ${r.key}, Value: ${r.value}`));
            console.log("-----------------------------");
            // Or open a new document with the rules
            vscode.workspace.openTextDocument({ content: ruleDisplay, language: 'text' })
                .then(doc => vscode.window.showTextDocument(doc));
        }));

            // Edit Rule Command
            context.subscriptions.push(vscode.commands.registerCommand(`ctk.edit${commandSuffix}Rule`, async () => {
                if (targetScope === vscode.ConfigurationTarget.Workspace && !isWorkspaceOpen()) {
                    vscode.window.showInformationMessage(`CTK GEE: A workspace must be open to edit a ${scopeNameProper} rule.`);
                    return;
                }
                let rules = getCtkRuleSet(targetScope);
            if (rules.length === 0) {
                    vscode.window.showInformationMessage(`CTK GEE: No ${scopeNameProper} rules to edit.`);
                return;
            }

            const ruleItems = rules.map(r => ({ label: `ID ${r.id}: ${r.key}`, description: r.value.substring(0, 50) + (r.value.length > 50 ? '...' : ''), ruleId: r.id }));
                const selectedItem = await vscode.window.showQuickPick(ruleItems, { placeHolder: `Select a ${scopeNameProper} rule to edit` });

            if (!selectedItem) return; // User cancelled

            const ruleToEdit = rules.find(r => r.id === selectedItem.ruleId);
            if (!ruleToEdit) {
                    vscode.window.showErrorMessage(`CTK GEE: Selected ${scopeNameProper} rule not found.`);
                return;
            }

            const newKey = await vscode.window.showInputBox({
                prompt: `Enter the new rule key for ${scopeNameProper} (Original: ${ruleToEdit.key})`,
                value: ruleToEdit.key,
                validateInput: text => text && text.trim() !== "" ? null : "Key cannot be empty."
            });
            if (newKey === undefined) return; // User cancelled
            const trimmedNewKey = newKey.trim();

            // Check for key uniqueness (excluding the current rule being edited if its key hasn't changed)
            if (trimmedNewKey !== ruleToEdit.key && rules.some(r => r.id !== ruleToEdit.id && r.key === trimmedNewKey)) {
                vscode.window.showErrorMessage(`CTK GEE: A rule with key "${trimmedNewKey}" already exists in ${scopeNameProper} settings. Keys must be unique.`);
                return;
            }

            const newValue = await vscode.window.showInputBox({
                prompt: `Enter the new rule value for ${scopeNameProper} (Original Value: ${ruleToEdit.value.substring(0,50)}...)`,
                value: ruleToEdit.value,
                validateInput: text => text && text.trim() !== "" ? null : "Value cannot be empty."
            });
            if (newValue === undefined) return;

            ruleToEdit.key = newKey.trim();
            ruleToEdit.value = newValue.trim();
                await updateCtkRuleSet(rules, targetScope);
                vscode.window.showInformationMessage(`CTK GEE: ${scopeNameProper} Rule ID ${ruleToEdit.id} updated.`);
            }));

            // Delete Rule Command
            context.subscriptions.push(vscode.commands.registerCommand(`ctk.delete${commandSuffix}Rule`, async () => {
                if (targetScope === vscode.ConfigurationTarget.Workspace && !isWorkspaceOpen()) {
                    vscode.window.showInformationMessage(`CTK GEE: A workspace must be open to delete a ${scopeNameProper} rule.`);
                    return;
                }
                let rules = getCtkRuleSet(targetScope);
            if (rules.length === 0) {
                    vscode.window.showInformationMessage(`CTK GEE: No ${scopeNameProper} rules to delete.`);
                return;
            }

            const ruleItems = rules.map(r => ({ label: `ID ${r.id}: ${r.key}`, description: r.value.substring(0, 50) + (r.value.length > 50 ? '...' : ''), ruleId: r.id }));
                const selectedItem = await vscode.window.showQuickPick(ruleItems, { placeHolder: `Select a ${scopeNameProper} rule to delete` });

            if (!selectedItem) return; // User cancelled

                const confirm = await vscode.window.showWarningMessage(`Are you sure you want to delete ${scopeNameProper} rule ID ${selectedItem.ruleId} ("${selectedItem.label}")?`, { modal: true }, "Yes, delete it");
            if (confirm !== "Yes, delete it") return;

            const updatedRules = rules.filter(r => r.id !== selectedItem.ruleId);
                await updateCtkRuleSet(updatedRules, targetScope);
                vscode.window.showInformationMessage(`CTK GEE: ${scopeNameProper} Rule ID ${selectedItem.ruleId} deleted.`);
            }));

            // Force Sync Command
            context.subscriptions.push(vscode.commands.registerCommand(`ctk.forceSync${commandSuffix}Rules`, async () => {
                if (targetScope === vscode.ConfigurationTarget.Workspace && !isWorkspaceOpen()) {
                    vscode.window.showInformationMessage(`CTK GEE: A workspace must be open to sync ${scopeNameProper} rules.`);
                    return;
                }
                await syncRuleSetToGeminiRules(targetScope);
                vscode.window.showInformationMessage(`CTK GEE: ${scopeNameProper} rules manually synced to ${scopeNameProper} geminicodeassist.rules.`);
            }));
        };

        // Register commands for Global scope
        registerCrudCommandsForScope(vscode.ConfigurationTarget.Global, "Global", "Global");

        // Register commands for Workspace scope
        registerCrudCommandsForScope(vscode.ConfigurationTarget.Workspace, "Workspace", "Workspace");
        console.log('CTK GEE: All commands registered.');

    } catch (error) {
        console.error("CTK GEE: Error registering commands:", error);
        vscode.window.showErrorMessage("CTK GEE: Critical error registering commands. Extension may not function. Check Developer Tools Console.");
        return; // Stop activation if command registration itself fails
    }

    // --- Configuration Change Listener ---
    try {
        console.log('CTK GEE: Registering configuration listener...');
        context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(async event => {
            const ctkRuleSetKeyScoped = `${CONFIG_SECTION_CTK}.${CTK_RULE_SET_KEY}`;
            const geminiRulesKey = GEMINI_CODE_ASSIST_RULES_KEY;

            if (event.affectsConfiguration(ctkRuleSetKeyScoped)) {
                console.log(`CTK GEE: ${ctkRuleSetKeyScoped} changed. Syncing relevant scopes.`);
                // It's possible ctk.ruleSet was changed manually, so ensure uniqueness before syncing
                let globalRules = getCtkRuleSet(vscode.ConfigurationTarget.Global);
                await ensureUniqueIdsAndKeys(globalRules, "Global", vscode.ConfigurationTarget.Global);
                globalRules = getCtkRuleSet(vscode.ConfigurationTarget.Global); // Re-fetch
                await syncRuleSetToGeminiRules(vscode.ConfigurationTarget.Global);

                if (isWorkspaceOpen()) {
                    let workspaceRules = getCtkRuleSet(vscode.ConfigurationTarget.Workspace);
                    await ensureUniqueIdsAndKeys(workspaceRules, "Workspace", vscode.ConfigurationTarget.Workspace);
                    workspaceRules = getCtkRuleSet(vscode.ConfigurationTarget.Workspace); // Re-fetch
                    await syncRuleSetToGeminiRules(vscode.ConfigurationTarget.Workspace);
                }
            }

            if (event.affectsConfiguration(geminiRulesKey)) {
                console.log(`CTK GEE: ${geminiRulesKey} changed. Checking for external modifications in relevant scopes.`);
                // This check compares against the current ctk.ruleSet, which should be clean by now.
                await checkAndResolveExternalGeminiRulesChange(vscode.ConfigurationTarget.Global);
                if (isWorkspaceOpen()) {
                    await checkAndResolveExternalGeminiRulesChange(vscode.ConfigurationTarget.Workspace);
                }
            }
        }));
        console.log('CTK GEE: Configuration listener registered.');
    } catch (error) {
        console.error("CTK GEE: Error registering configuration listener:", error);
        vscode.window.showErrorMessage("CTK GEE: Error registering configuration listener. Auto-sync on config change might be affected. Check Developer Tools Console.");
    }
    console.log('CTK GEE: Activation fully completed.');
}

// This method is called when your extension is deactivated
function deactivate() {}

module.exports = {
    activate,
    deactivate
}
