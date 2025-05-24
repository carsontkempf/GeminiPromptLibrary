// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');

const CONFIG_SECTION_CTK = 'ctk'; // The configuration section identifier
const CTK_RULE_SET_KEY = 'ruleSet';	 // The key for the ruleSet *within* the CONFIG_SECTION_CTK
const GEMINI_CODE_ASSIST_RULES_KEY = 'geminicodeassist.rules';
// For geminicodeassist.rules, since it's defined as a root property in package.json,
// we use getConfiguration() without a section or getConfiguration(null)
// and update it directly.

/**
 * @typedef {object} Rule
 * @property {number} id
 * @property {string} key
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
 * Retrieves the geminicodeassist.rules string from the specified configuration scope.
 * @param {vscode.ConfigurationTarget} scope
 * @returns {Promise<string>}
 */
async function getGeminiRulesStringFromConfig(scope) {
		const rootConfig = vscode.workspace.getConfiguration();
		const inspection = rootConfig.inspect(GEMINI_CODE_ASSIST_RULES_KEY);
		let actualGeminiStringInScope = "";

		if (scope === vscode.ConfigurationTarget.Global) {
				actualGeminiStringInScope = typeof inspection?.globalValue === 'string' ? inspection.globalValue : "";
		} else if (scope === vscode.ConfigurationTarget.Workspace && isWorkspaceOpen()) {
				actualGeminiStringInScope = typeof inspection?.workspaceValue === 'string' ? inspection.workspaceValue : "";
		} else if (scope === vscode.ConfigurationTarget.Workspace && !isWorkspaceOpen()) {
				// If asking for workspace but none is open, effectively it's an empty string for our purposes
				return "";
		}
		return actualGeminiStringInScope;
}

/**
 * Updates the geminicodeassist.rules string in the specified configuration scope.
 * @param {string} newString
 * @param {vscode.ConfigurationTarget} scope
 */
async function updateGeminiRulesStringInConfig(newString, scope) {
		if (scope === vscode.ConfigurationTarget.Workspace && !isWorkspaceOpen()) {
				return;
		}
		const rootConfig = vscode.workspace.getConfiguration();
		const scopeNameProper = scope === vscode.ConfigurationTarget.Global ? "Global" : "Workspace";
		try {
				await rootConfig.update(GEMINI_CODE_ASSIST_RULES_KEY, newString, scope);
				console.log(`CTK GEE: Successfully updated ${scopeNameProper} geminicodeassist.rules`);
		} catch (error) {
				vscode.window.showErrorMessage(`CTK GEE: Error updating ${scopeNameProper} geminicodeassist.rules: ${error.message}`);
				console.error(`CTK GEE: Error updating ${scopeNameProper} geminicodeassist.rules:`, error);
		}
}

/**
 * Parses the geminicodeassist.rules string.
 * @param {string} rulesString
 * @returns {{orderedKeyValues: {key: string, value: string}[], valueMap: Map<string, string>}}
 */
function parseGeminiRulesString(rulesString) {
		const orderedKeyValues = [];
		const valueMap = new Map();
		if (typeof rulesString !== 'string' || rulesString.trim() === "") {
				return { orderedKeyValues, valueMap };
		}

		const ruleEntries = rulesString.split(/\n\n\n\n/);
		for (const entry of ruleEntries) {
				if (entry.trim() === "") continue;
				const colonIndex = entry.indexOf(':');
				if (colonIndex > 0) { // Ensure colon is present and not the first character
						const key = entry.substring(0, colonIndex).trim();
						const value = entry.substring(colonIndex + 1).trimStart(); // trimStart to preserve leading spaces in value if intended
						if (key) { // Ensure key is not empty
								orderedKeyValues.push({ key, value });
								valueMap.set(key, value);
						}
				} else {
						// Handle entries without a colon as a key with an empty value
						const key = entry.trim();
						if (key) {
								orderedKeyValues.push({ key, value: "" });
								valueMap.set(key, "");
								console.warn(`CTK GEE: Rule entry "${key}" in geminicodeassist.rules has no value. Treating as empty value.`);
						}
				}
		}
		return { orderedKeyValues, valueMap };
}

/**
 * Builds the geminicodeassist.rules string from ordered key-value pairs.
 * @param {{key: string, value: string}[]} orderedKeyValues
 * @returns {string}
 */
function buildGeminiRulesString(orderedKeyValues) {
		if (!Array.isArray(orderedKeyValues) || orderedKeyValues.length === 0) {
				return "";
		}
		return orderedKeyValues.map(kv => `${kv.key}: ${kv.value}`).join('\n\n\n\n');
}

/**
 * Handles initial import of existing global geminicodeassist.rules content.
 * Populates ctk.ruleSet with keys and IDs. Values remain in geminicodeassist.rules.
 */
async function performInitialGlobalImport() {
		let ctkRules = getCtkRuleSet(vscode.ConfigurationTarget.Global);

		// Only attempt import if ctk.ruleSet is currently empty
		if (ctkRules.length === 0) {
				const rootConfig = vscode.workspace.getConfiguration();
				const geminiString = await getGeminiRulesStringFromConfig(vscode.ConfigurationTarget.Global);
				const { orderedKeyValues } = parseGeminiRulesString(geminiString);

				if (orderedKeyValues.length > 0) {
						const userChoice = await vscode.window.showInformationMessage(
								`CTK GEE: Found existing content in global 'geminicodeassist.rules'. Would you like to import its keys into 'ctk.ruleSet'? (Values remain in geminicodeassist.rules)`,
								{ modal: true },
								"Yes, import keys",
								"No, start fresh"
						);

						if (userChoice === "Yes, import keys") {
								const newCtkRules = orderedKeyValues.map((kv, index) => ({
										id: index + 1,
										key: kv.key
								}));
								// No need to update geminiString here, as it's the source.
								// We just need to ensure the newCtkRules are clean.
								const { cleanedCtkRules, keyRenames } = await ensureAndCleanCtkRuleSet(newCtkRules, "Global", false);
								await updateCtkRuleSet(cleanedCtkRules, vscode.ConfigurationTarget.Global);

								if (keyRenames.size > 0) { // If cleaning ctkRules changed keys, gemini.rules needs update
										await syncRules(vscode.ConfigurationTarget.Global); // This will use cleanedCtkRules and original values
										vscode.window.showWarningMessage("CTK GEE: Imported global keys and cleaned them. geminicodeassist.rules was updated to reflect unique keys.");
								} else {
										vscode.window.showInformationMessage("CTK GEE: Imported keys from global geminicodeassist.rules into ctk.ruleSet.");
								}
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
				const geminiString = await getGeminiRulesStringFromConfig(vscode.ConfigurationTarget.Workspace);
				const { orderedKeyValues } = parseGeminiRulesString(geminiString);

				if (orderedKeyValues.length > 0) {
						const userChoice = await vscode.window.showInformationMessage(
								`CTK GEE: Found existing content in workspace 'geminicodeassist.rules'. Would you like to import its keys into workspace 'ctk.ruleSet'?`,
								{ modal: true },
								"Yes, import keys",
								"No, start fresh"
						);

						if (userChoice === "Yes, import keys") {
								const newCtkRules = orderedKeyValues.map((kv, index) => ({
										id: index + 1,
										key: kv.key
								}));
								const { cleanedCtkRules, keyRenames } = await ensureAndCleanCtkRuleSet(newCtkRules, "Workspace", false);
								await updateCtkRuleSet(cleanedCtkRules, vscode.ConfigurationTarget.Workspace);

								if (keyRenames.size > 0) {
										await syncRules(vscode.ConfigurationTarget.Workspace);
										vscode.window.showWarningMessage("CTK GEE: Imported workspace keys and cleaned them. geminicodeassist.rules was updated.");
								} else {
										vscode.window.showInformationMessage("CTK GEE: Imported keys from workspace geminicodeassist.rules into workspace ctk.ruleSet.");
								}
						}
				}
		}
}

/**
 * Syncs ctk.ruleSet (keys and order) with geminicodeassist.rules (values).
 * @param {vscode.ConfigurationTarget} scope
 * @param {Map<string, string>} [keyRenames=new Map()] Optional map of oldKey -> newKey.
 */
async function syncRules(scope, keyRenames = new Map()) {
		if (scope === vscode.ConfigurationTarget.Workspace && !isWorkspaceOpen()) return;

		const ctkRules = getCtkRuleSet(scope); // These are [{id, key}]
		const currentGeminiString = await getGeminiRulesStringFromConfig(scope);
		const { valueMap: currentGeminiValueMap } = parseGeminiRulesString(currentGeminiString);

		const newOrderedKeyValues = ctkRules.map(ctkRule => {
				let valueToUse = currentGeminiValueMap.get(ctkRule.key);

				// If ctkRule.key might be a renamed key, try to find its original value
				if (valueToUse === undefined) {
						for (const [originalKey, renamedKey] of keyRenames.entries()) {
								if (renamedKey === ctkRule.key) {
										valueToUse = currentGeminiValueMap.get(originalKey);
										break;
								}
						}
				}
				return { key: ctkRule.key, value: valueToUse || "" }; // Default to empty string if no value found
		});

		const newGeminiString = buildGeminiRulesString(newOrderedKeyValues);

		if (newGeminiString !== currentGeminiString) {
				await updateGeminiRulesStringInConfig(newGeminiString, scope);
				console.log(`CTK GEE: Synced rules for ${scope === vscode.ConfigurationTarget.Global ? "Global" : "Workspace"} scope.`);
		}
}

/**
 * Reconciles ctk.ruleSet with external changes in geminicodeassist.rules.
 * @param {vscode.ConfigurationTarget} scope
 */
async function reconcileCtkWithExternalGeminiChange(scope) {
		if (scope === vscode.ConfigurationTarget.Workspace && !isWorkspaceOpen()) return;

		const scopeNameProper = scope === vscode.ConfigurationTarget.Global ? "Global" : "Workspace";
		const geminiString = await getGeminiRulesStringFromConfig(scope);
		const { orderedKeyValues: geminiKeyValues, valueMap: geminiValueMap } = parseGeminiRulesString(geminiString);
		let currentCtkRules = getCtkRuleSet(scope);

		// Construct what gemini.rules *should* look like based on current ctk.ruleSet and current gemini values
		const ctkDerivedGeminiString = buildGeminiRulesString(
				currentCtkRules.map(r => ({ key: r.key, value: geminiValueMap.get(r.key) || "" }))
		);

		if (ctkDerivedGeminiString === geminiString) {
				console.log(`CTK GEE: ${scopeNameProper} geminicodeassist.rules matches ctk.ruleSet derived content. No reconciliation needed.`);
				return;
		}

		const choice = await vscode.window.showWarningMessage(
				`CTK GEE: ${scopeNameProper} 'geminicodeassist.rules' appears to have been modified externally or is out of sync.`,
				{ modal: true },
				`Update ${scopeNameProper} ctk.ruleSet from geminicodeassist.rules`,
				`Overwrite ${scopeNameProper} geminicodeassist.rules with ctk.ruleSet content`
		);

		if (choice === `Update ${scopeNameProper} ctk.ruleSet from geminicodeassist.rules`) {
				let nextId = currentCtkRules.length > 0 ? Math.max(0, ...currentCtkRules.map(r => r.id)) + 1 : 1;
				const newCtkRules = geminiKeyValues.map(kv => {
						const existingRule = currentCtkRules.find(r => r.key === kv.key);
						return { id: existingRule ? existingRule.id : nextId++, key: kv.key };
				});

				const { cleanedCtkRules, keyRenames } = await ensureAndCleanCtkRuleSet(newCtkRules, scopeNameProper, false);
				await updateCtkRuleSet(cleanedCtkRules, scope);

				if (keyRenames.size > 0) { // Duplicates in gemini.rules forced key changes in ctk.ruleSet
						const finalGeminiValues = new Map(geminiKeyValues.map(item => [item.key, item.value])); // Use original values from geminiString
						const correctedOrderedKeyValues = cleanedCtkRules.map(ctkRule => {
								let valueToUse, originalKeyForValue = ctkRule.key;
								 for (const [originalInputKey, newlyCleanedKey] of keyRenames.entries()) { // Find original key if ctkRule.key was renamed
										if (newlyCleanedKey === ctkRule.key) { originalKeyForValue = originalInputKey; break; }
								}
								valueToUse = finalGeminiValues.get(originalKeyForValue);
								return { key: ctkRule.key, value: valueToUse || "" };
						});
						await updateGeminiRulesStringInConfig(buildGeminiRulesString(correctedOrderedKeyValues), scope);
						vscode.window.showInformationMessage(`CTK GEE: ${scopeNameProper} ctk.ruleSet and geminicodeassist.rules updated and cleaned from external changes.`);
				} else {
						vscode.window.showInformationMessage(`CTK GEE: ${scopeNameProper} ctk.ruleSet updated from geminicodeassist.rules.`);
				}
		} else if (choice === `Overwrite ${scopeNameProper} geminicodeassist.rules with ctk.ruleSet content`) {
				await syncRules(scope); // This will use current ctk.ruleSet to rebuild gemini.rules
				vscode.window.showInformationMessage(`CTK GEE: ${scopeNameProper} geminicodeassist.rules overwritten by ctk.ruleSet content.`);
		}
}

/**
 * Ensures unique IDs and keys in a ctk.ruleSet array.
 * @param {Rule[]} ctkRulesArray The array of ctk rules ({id, key}) to process.
 * @param {string} scopeNameProper User-friendly scope name (e.g., "Global", "Workspace").
 * @param {boolean} [showMessage=true] Whether to show a warning message.
 * @returns {Promise<{cleanedCtkRules: Rule[], keyRenames: Map<string, string>, madeChanges: boolean}>}
 */
async function ensureAndCleanCtkRuleSet(ctkRulesArray, scopeNameProper, showMessage = true) {
		if (!Array.isArray(ctkRulesArray)) return { cleanedCtkRules: [], keyRenames: new Map(), madeChanges: false };

		const rules = JSON.parse(JSON.stringify(ctkRulesArray)); // Deep copy
		let madeChanges = false;
		const keyRenames = new Map(); // Map<originalKey, newKey>

		// 1. Ensure unique and sequential IDs
		const idSet = new Set();
		let reassignIds = false;
		for (const rule of rules) {
				if (typeof rule.id !== 'number' || idSet.has(rule.id) || rule.id <= 0) {
						reassignIds = true;
						break;
				}
				idSet.add(rule.id);
		}

		if (reassignIds) {
				madeChanges = true;
				console.warn(`CTK GEE: Re-assigning IDs for ${scopeNameProper} ctk.ruleSet.`);
				rules.forEach((rule, index) => {
						rule.id = index + 1;
				});
		}

		// 2. Ensure unique keys in ctk.ruleSet
		const finalKeySet = new Set(); // Tracks keys already processed and finalized

		for (const rule of rules) {
				const originalRuleKey = rule.key; // Keep track of the key as it was when this rule was first encountered in this loop
				let currentKey = rule.key;
				let occurrences = 0;
				// Count occurrences of this key *before* potential renaming
				for(const r of rules) {
						if (r.key === currentKey) occurrences++;
				}
				
				if (finalKeySet.has(currentKey) || occurrences > 1) { // If it's a duplicate among remaining rules or conflicts with an already processed one
						madeChanges = true;
						let newKey;
						let duplicateIndex = 0;
						// Find a unique name based on the original key to avoid long chains like key_dup_1_dup_1
						const baseKeyForDuplicates = originalRuleKey; 
						do {
								duplicateIndex++;
								newKey = `${baseKeyForDuplicates}_duplicate_${duplicateIndex}`;
						} while (rules.some(r => r.key === newKey && r !== rule) || finalKeySet.has(newKey) ); // Check against other rules and already finalized keys
						
						console.warn(`CTK GEE: Modifying duplicate key "${currentKey}" to "${newKey}" in ${scopeNameProper} ctk.ruleSet.`);
						rule.key = newKey;
						if (originalRuleKey !== newKey) {
								 // If originalRuleKey was already a renamed key, we need to trace back
								let ultimateOriginalKey = originalRuleKey;
								for(const [o, n] of keyRenames.entries()){
										if(n === originalRuleKey) {
												ultimateOriginalKey = o;
												break;
										}
								}
								keyRenames.set(ultimateOriginalKey, newKey);
						}
				}
				finalKeySet.add(rule.key);
		}

		if (madeChanges && showMessage) {
				vscode.window.showWarningMessage(`CTK GEE: Rules in ${scopeNameProper} ctk.ruleSet were adjusted to ensure unique IDs and/or keys. Review if necessary.`);
		}
		return { cleanedCtkRules: rules, keyRenames, madeChanges };
}

// --- TreeView Classes ---

class RuleTreeItem extends vscode.TreeItem {
	/**
	 * @param {object} ruleSpec The specification for the rule.
	 * @param {number} ruleSpec.id Unique ID for the rule.
	 * @param {string} ruleSpec.key The key for the rule.
	 * @param {string} ruleSpec.value The value of the rule.
	 * @param {vscode.ConfigurationTarget} ruleSpec.scope The scope of the rule.
	 * @param {vscode.TreeItemCollapsibleState} [collapsibleState=vscode.TreeItemCollapsibleState.None] The collapsible state of the tree item.
	 */
	constructor(
		ruleSpec,
		collapsibleState = vscode.TreeItemCollapsibleState.None
	) {
		super(`${ruleSpec.key}`, collapsibleState);
		this.ruleSpec = ruleSpec; // Assign to instance property

		const valueSnippet = ruleSpec.value.substring(0, 70);
		this.description = `${valueSnippet}${ruleSpec.value.length > 70 ? '...' : ''}`;
		this.tooltip = new vscode.MarkdownString(`**Key:** \`${ruleSpec.key}\`\n\n**Value:**\n\`\`\`\n${ruleSpec.value}\n\`\`\``);
		this.id = `${ruleSpec.scope === vscode.ConfigurationTarget.Global ? 'global' : 'workspace'}-${ruleSpec.id}`; // Unique ID for the tree item
		this.contextValue = 'ctkRuleItem'; // Used in package.json for menu contributions
	}
}

class MessageTreeItem extends vscode.TreeItem {
	constructor(message) {
		super(message, vscode.TreeItemCollapsibleState.None);
		this.contextValue = 'ctkMessageItem';
	}
}

class CtkRulesProvider { // implements vscode.TreeDataProvider<RuleTreeItem | MessageTreeItem>
	_onDidChangeTreeData = new vscode.EventEmitter();
	onDidChangeTreeData = this._onDidChangeTreeData.event;

	constructor(scope) {
		this.scope = scope;
		this.scopeNameProper = scope === vscode.ConfigurationTarget.Global ? "User" : "Workspace";
	}

	refresh() {
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element) {
		return element;
	}

	async getChildren(element) {
		// If an element is provided, it means it's a RuleTreeItem or MessageTreeItem.
		// These are leaf nodes and have no children.
		if (element) {
			return [];
		}

		// If no element is provided, we are at the root of this TreeView
		// (either "User Rules" or "Workspace Rules").
		// We directly return the list of rules or relevant messages for the current scope.

		if (this.scope === vscode.ConfigurationTarget.Workspace && !isWorkspaceOpen()) {
			return [new MessageTreeItem("No workspace open.")];
		}

		const ctkRules = getCtkRuleSet(this.scope);
		if (ctkRules.length === 0) {
			return [new MessageTreeItem(`No ${this.scopeNameProper.toLowerCase()} rules defined. Click '+' to add.`)];
		}

		const geminiString = await getGeminiRulesStringFromConfig(this.scope);
		const { valueMap } = parseGeminiRulesString(geminiString);

		return ctkRules.map(rule => {
			const value = valueMap.get(rule.key) || "";
			return new RuleTreeItem({ ...rule, value, scope: this.scope }, vscode.TreeItemCollapsibleState.None);
		}).sort((a, b) => a.ruleSpec.key.localeCompare(b.ruleSpec.key)); // Sort by key for consistent display
	}
}

// Store providers globally within the activate function's scope
let userRulesProvider;
let workspaceRulesProvider;

/**
 * @param {vscode.ExtensionContext} context
 */
async function activate(context) {
		console.log('CTK GEE: Extension "ctk" is now active!');

		// --- DIAGNOSTIC LOGS FOR WORKSPACE ---
		if (isWorkspaceOpen()) {
			console.log("CTK GEE DIAGNOSTIC: Workspace is open.");
			vscode.workspace.workspaceFolders.forEach((folder, index) => {
				console.log(`CTK GEE DIAGNOSTIC: Workspace Folder ${index}: Name='${folder.name}', URI='${folder.uri.toString()}', Path='${folder.uri.fsPath}'`);
			});

			const ctkConfig = vscode.workspace.getConfiguration(CONFIG_SECTION_CTK, vscode.workspace.workspaceFolders[0].uri);
			const ctkInspect = ctkConfig.inspect(CTK_RULE_SET_KEY);
			console.log(`CTK GEE DIAGNOSTIC: Inspection of '${CONFIG_SECTION_CTK}.${CTK_RULE_SET_KEY}' for workspace:`, JSON.stringify(ctkInspect, null, 2));
			if (ctkInspect && ctkInspect.workspaceValue !== undefined) {
				console.log(`CTK GEE DIAGNOSTIC: ctk.ruleSet (WorkspaceValue):`, ctkInspect.workspaceValue);
			} else {
				console.log(`CTK GEE DIAGNOSTIC: ctk.ruleSet (WorkspaceValue) is UNDEFINED.`);
			}

			const rootConfig = vscode.workspace.getConfiguration(null, vscode.workspace.workspaceFolders[0].uri);
			const geminiInspect = rootConfig.inspect(GEMINI_CODE_ASSIST_RULES_KEY);
			console.log(`CTK GEE DIAGNOSTIC: Inspection of '${GEMINI_CODE_ASSIST_RULES_KEY}' for workspace:`, JSON.stringify(geminiInspect, null, 2));
		} else {
			console.log("CTK GEE DIAGNOSTIC: No workspace is open according to isWorkspaceOpen().");
		}
		// --- END DIAGNOSTIC LOGS ---

		// --- Initialize TreeView Providers ---
		userRulesProvider = new CtkRulesProvider(vscode.ConfigurationTarget.Global);
		context.subscriptions.push(vscode.window.createTreeView('ctk-gee-user-rules', { treeDataProvider: userRulesProvider, showCollapseAll: true }));

		workspaceRulesProvider = new CtkRulesProvider(vscode.ConfigurationTarget.Workspace);
		context.subscriptions.push(vscode.window.createTreeView('ctk-gee-workspace-rules', { treeDataProvider: workspaceRulesProvider, showCollapseAll: true }));

		try {
				console.log('CTK GEE: Performing initial imports and data cleaning...');
				await performInitialGlobalImport();
				let { cleanedCtkRules: globalClean, keyRenames: globalKeyRenames } = await ensureAndCleanCtkRuleSet(getCtkRuleSet(vscode.ConfigurationTarget.Global), "Global");
				await updateCtkRuleSet(globalClean, vscode.ConfigurationTarget.Global);
				await syncRules(vscode.ConfigurationTarget.Global, globalKeyRenames);

				if (isWorkspaceOpen()) {
						await performInitialWorkspaceImport();
						let { cleanedCtkRules: wsClean, keyRenames: wsKeyRenames } = await ensureAndCleanCtkRuleSet(getCtkRuleSet(vscode.ConfigurationTarget.Workspace), "Workspace");
						await updateCtkRuleSet(wsClean, vscode.ConfigurationTarget.Workspace);
						await syncRules(vscode.ConfigurationTarget.Workspace, wsKeyRenames);
				}
				if (userRulesProvider) userRulesProvider.refresh();
				if (workspaceRulesProvider) workspaceRulesProvider.refresh();
				console.log('CTK GEE: Initial setup completed.');

		} catch (error) {
				console.error("CTK GEE: Error during initial setup (imports/syncs):", error);
				vscode.window.showErrorMessage("CTK GEE: Error during initial setup. Some features might be affected. Check Developer Tools Console (Help > Toggle Developer Tools).");
		}

		// --- Register Commands ---
		try {
				console.log('CTK GEE: Registering commands...');
				// Helper to register CRUD commands for a given scope
				const registerCrudCommandsForScope = (scope, scopeNameProper, commandSuffix) => {
						const targetScope = scope;

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
								if (keyInput === undefined) return;
								const key = keyInput.trim();

								let ctkRules = getCtkRuleSet(targetScope);
								if (ctkRules.some(r => r.key === key)) {
										vscode.window.showErrorMessage(`CTK GEE: A rule with key "${key}" already exists in ${scopeNameProper} ctk.ruleSet. Keys must be unique.`);
										return;
								}

								const value = await vscode.window.showInputBox({ prompt: `Enter the rule value for ${scopeNameProper} settings`, validateInput: text => text !== undefined ? null : "Value cannot be null (can be empty string)." });
								if (value === undefined) return; // User cancelled

								// Update ctk.ruleSet
								const newId = ctkRules.length > 0 ? Math.max(0, ...ctkRules.map(r => r.id)) + 1 : 1;
								ctkRules.push({ id: newId, key: key });
								await updateCtkRuleSet(ctkRules, targetScope);

								// Update geminicodeassist.rules
								const currentGeminiString = await getGeminiRulesStringFromConfig(targetScope);
								const { orderedKeyValues } = parseGeminiRulesString(currentGeminiString);
								orderedKeyValues.push({ key, value }); // Add new rule at the end
								const newGeminiString = buildGeminiRulesString(orderedKeyValues);
								await updateGeminiRulesStringInConfig(newGeminiString, targetScope);

								vscode.window.showInformationMessage(`CTK GEE: ${scopeNameProper} Rule ID ${newId} (Key: ${key}) added.`);
								if (targetScope === vscode.ConfigurationTarget.Global && userRulesProvider) {
									userRulesProvider.refresh();
								} else if (targetScope === vscode.ConfigurationTarget.Workspace && workspaceRulesProvider) {
									workspaceRulesProvider.refresh();
								}
						}));

						// View Rules Command
						context.subscriptions.push(vscode.commands.registerCommand(`ctk.view${commandSuffix}Rules`, async () => {
								if (targetScope === vscode.ConfigurationTarget.Workspace && !isWorkspaceOpen()) {
										vscode.window.showInformationMessage(`CTK GEE: A workspace must be open to view ${scopeNameProper} rules.`);
										return;
								}
								const ctkRules = getCtkRuleSet(targetScope);
								if (ctkRules.length === 0) {
										vscode.window.showInformationMessage(`CTK GEE: No rules configured in ${scopeNameProper} ctk.ruleSet.`);
										return;
								}

								const geminiString = await getGeminiRulesStringFromConfig(targetScope);
								const { valueMap } = parseGeminiRulesString(geminiString);

								const ruleDisplayItems = ctkRules.map(r => {
										const val = valueMap.get(r.key) || "[Value not found in geminicodeassist.rules]";
										return `ID: ${r.id}\nKey: ${r.key}\nValue: ${val}`;
								});

								const ruleDisplay = ruleDisplayItems.join('\n----------\n');
								vscode.window.showInformationMessage(`CTK GEE: Current ${scopeNameProper} Rules (see Output > CTK GEE for all):`);
								console.log(`--- CTK GEE: Current ${scopeNameProper} Rules ---`);
								ctkRules.forEach(r => console.log(`ID: ${r.id}, Key: ${r.key}, Value: ${valueMap.get(r.key) || "[N/A]"}`));
								console.log("-----------------------------");
								vscode.workspace.openTextDocument({ content: ruleDisplay, language: 'text' })
										.then(doc => vscode.window.showTextDocument(doc));
						}));

						// Edit Rule Command
						context.subscriptions.push(vscode.commands.registerCommand(`ctk.edit${commandSuffix}Rule`, async () => {
								if (targetScope === vscode.ConfigurationTarget.Workspace && !isWorkspaceOpen()) {
										vscode.window.showInformationMessage(`CTK GEE: A workspace must be open to edit a ${scopeNameProper} rule.`);
										return;
								}
								let ctkRules = getCtkRuleSet(targetScope);
								if (ctkRules.length === 0) {
										vscode.window.showInformationMessage(`CTK GEE: No ${scopeNameProper} rules to edit.`);
										return;
								}

								const geminiString = await getGeminiRulesStringFromConfig(targetScope);
								const { valueMap: currentValuesMap } = parseGeminiRulesString(geminiString);

								const ruleItems = ctkRules.map(r => ({
										label: `ID ${r.id}: ${r.key}`,
										description: (currentValuesMap.get(r.key) || "").substring(0, 50) + ((currentValuesMap.get(r.key) || "").length > 50 ? '...' : ''),
										ruleId: r.id,
										originalKey: r.key // Store original key for lookup
								}));
								const selectedItem = await vscode.window.showQuickPick(ruleItems, { placeHolder: `Select a ${scopeNameProper} rule to edit` });

						if (!selectedItem) return; // User cancelled

						const ruleToEdit = ctkRules.find(r => r.id === selectedItem.ruleId);
						if (!ruleToEdit) {
										vscode.window.showErrorMessage(`CTK GEE: Selected ${scopeNameProper} rule not found.`);
								return;
						}
						const originalKey = ruleToEdit.key;
						const originalValue = currentValuesMap.get(originalKey) || "";

						const newKeyInput = await vscode.window.showInputBox({
								prompt: `Enter the new rule key for ${scopeNameProper} (Original: ${originalKey})`,
								value: originalKey,
								validateInput: text => text && text.trim() !== "" ? null : "Key cannot be empty."
						});
						if (newKeyInput === undefined) return;
						const newKey = newKeyInput.trim();

						// Check for key uniqueness (excluding the current rule being edited if its key hasn't changed)
						if (newKey !== originalKey && ctkRules.some(r => r.id !== ruleToEdit.id && r.key === newKey)) {
								vscode.window.showErrorMessage(`CTK GEE: A rule with key "${newKey}" already exists in ${scopeNameProper} ctk.ruleSet. Keys must be unique.`);
								return;
						}

						const newValue = await vscode.window.showInputBox({
								prompt: `Enter the new rule value for ${scopeNameProper} (Original Value: ${originalValue.substring(0, 50)}...)`,
								value: originalValue,
								validateInput: text => text !== undefined ? null : "Value cannot be null."
						});
						if (newValue === undefined) return;

						// Update ctk.ruleSet
						ruleToEdit.key = newKey;
						await updateCtkRuleSet(ctkRules, targetScope);

						// Update geminicodeassist.rules
						const { orderedKeyValues } = parseGeminiRulesString(await getGeminiRulesStringFromConfig(targetScope)); // Re-fetch to be safe
						const updatedOrderedKeyValues = orderedKeyValues.map(kv => {
								if (kv.key === originalKey) { // Find by original key
										return { key: newKey, value: newValue };
								}
								return kv;
						});
						const newGeminiString = buildGeminiRulesString(updatedOrderedKeyValues);
						await updateGeminiRulesStringInConfig(newGeminiString, targetScope);

						vscode.window.showInformationMessage(`CTK GEE: ${scopeNameProper} Rule ID ${ruleToEdit.id} updated.`);
						if (targetScope === vscode.ConfigurationTarget.Global && userRulesProvider) {
							userRulesProvider.refresh();
						} else if (targetScope === vscode.ConfigurationTarget.Workspace && workspaceRulesProvider) {
							workspaceRulesProvider.refresh();
						}
						}));

						// Delete Rule Command
						context.subscriptions.push(vscode.commands.registerCommand(`ctk.delete${commandSuffix}Rule`, async () => {
								if (targetScope === vscode.ConfigurationTarget.Workspace && !isWorkspaceOpen()) {
										vscode.window.showInformationMessage(`CTK GEE: A workspace must be open to delete a ${scopeNameProper} rule.`);
										return;
								}
								let ctkRules = getCtkRuleSet(targetScope);
								if (ctkRules.length === 0) {
										vscode.window.showInformationMessage(`CTK GEE: No ${scopeNameProper} rules to delete.`);
										return;
								}

								const geminiString = await getGeminiRulesStringFromConfig(targetScope);
								const { valueMap } = parseGeminiRulesString(geminiString);

								const ruleItems = ctkRules.map(r => ({
										label: `ID ${r.id}: ${r.key}`,
										description: (valueMap.get(r.key) || "").substring(0, 50) + '...',
										ruleId: r.id,
										keyToDelete: r.key
								}));
								const selectedItem = await vscode.window.showQuickPick(ruleItems, { placeHolder: `Select a ${scopeNameProper} rule to delete` });

						if (!selectedItem) return; // User cancelled

								const confirm = await vscode.window.showWarningMessage(`Are you sure you want to delete ${scopeNameProper} rule ID ${selectedItem.ruleId} (Key: "${selectedItem.keyToDelete}")?`, { modal: true }, "Yes, delete it");
						if (confirm !== "Yes, delete it") return;

						// Update ctk.ruleSet
						const updatedCtkRules = ctkRules.filter(r => r.id !== selectedItem.ruleId);
						await updateCtkRuleSet(updatedCtkRules, targetScope);

						// Update geminicodeassist.rules
						const { orderedKeyValues } = parseGeminiRulesString(await getGeminiRulesStringFromConfig(targetScope)); // Re-fetch
						const filteredGeminiKeyValues = orderedKeyValues.filter(kv => kv.key !== selectedItem.keyToDelete);
						const newGeminiString = buildGeminiRulesString(filteredGeminiKeyValues);
						await updateGeminiRulesStringInConfig(newGeminiString, targetScope);

						vscode.window.showInformationMessage(`CTK GEE: ${scopeNameProper} Rule ID ${selectedItem.ruleId} (Key: ${selectedItem.keyToDelete}) deleted.`);
						if (targetScope === vscode.ConfigurationTarget.Global && userRulesProvider) {
							userRulesProvider.refresh();
						} else if (targetScope === vscode.ConfigurationTarget.Workspace && workspaceRulesProvider) {
							workspaceRulesProvider.refresh();
						}
						}));

						// Force Sync Command
						context.subscriptions.push(vscode.commands.registerCommand(`ctk.forceSync${commandSuffix}Rules`, async () => {
								if (targetScope === vscode.ConfigurationTarget.Workspace && !isWorkspaceOpen()) {
										vscode.window.showInformationMessage(`CTK GEE: A workspace must be open to sync ${scopeNameProper} rules.`);
										return;
								}
								// Ensure ctk.ruleSet is clean first, then sync
								const currentCtkRules = getCtkRuleSet(targetScope);
								const { cleanedCtkRules, keyRenames } = await ensureAndCleanCtkRuleSet(currentCtkRules, scopeNameProper);
								await updateCtkRuleSet(cleanedCtkRules, targetScope); // Save cleaned ctk.ruleSet
								await syncRules(targetScope, keyRenames); // Sync to geminicodeassist.rules
								vscode.window.showInformationMessage(`CTK GEE: ${scopeNameProper} rules manually synced.`);
								if (targetScope === vscode.ConfigurationTarget.Global && userRulesProvider) {
									userRulesProvider.refresh();
								} else if (targetScope === vscode.ConfigurationTarget.Workspace && workspaceRulesProvider) {
									workspaceRulesProvider.refresh();
								}
						}));
				};

				// Register commands for Global scope
				registerCrudCommandsForScope(vscode.ConfigurationTarget.Global, "Global", "Global");

				// Register commands for Workspace scope
				registerCrudCommandsForScope(vscode.ConfigurationTarget.Workspace, "Workspace", "Workspace");
				console.log('CTK GEE: All commands registered.');

				// --- Register TreeView specific commands ---
				context.subscriptions.push(vscode.commands.registerCommand('ctk.tree.refreshUserRules', () => {
					if (userRulesProvider) userRulesProvider.refresh();
				}));
				context.subscriptions.push(vscode.commands.registerCommand('ctk.tree.addUserRule', () => {
					vscode.commands.executeCommand('ctk.addGlobalRule'); // Existing command handles logic and refresh
				}));

				context.subscriptions.push(vscode.commands.registerCommand('ctk.tree.refreshWorkspaceRules', () => {
					if (workspaceRulesProvider) workspaceRulesProvider.refresh();
				}));
				context.subscriptions.push(vscode.commands.registerCommand('ctk.tree.addWorkspaceRule', () => {
					vscode.commands.executeCommand('ctk.addWorkspaceRule'); // Existing command handles logic and refresh
				}));

				context.subscriptions.push(vscode.commands.registerCommand('ctk.tree.editRule', async (item) => {
					if (!item || !item.ruleSpec) {
						vscode.window.showErrorMessage("CTK GEE: No rule selected for editing from tree.");
						return;
					}
					const { id: ruleId, key: originalKey, value: originalValue, scope } = item.ruleSpec;
					const scopeNameProper = scope === vscode.ConfigurationTarget.Global ? "Global" : "Workspace";

					if (scope === vscode.ConfigurationTarget.Workspace && !isWorkspaceOpen()) {
						vscode.window.showInformationMessage(`CTK GEE: A workspace must be open to edit a ${scopeNameProper} rule.`);
						return;
					}

					// Delegate to existing edit command by finding the rule and then calling a modified version
					// Or, replicate logic here:
					let ctkRules = getCtkRuleSet(scope);
					const ruleToEdit = ctkRules.find(r => r.id === ruleId);
					if (!ruleToEdit) {
						vscode.window.showErrorMessage(`CTK GEE: Rule ID ${ruleId} not found in ${scopeNameProper} ctk.ruleSet.`);
						return;
					}

					const newKeyInput = await vscode.window.showInputBox({ prompt: `Enter new key for '${originalKey}'`, value: originalKey, validateInput: text => text && text.trim() !== "" ? null : "Key cannot be empty." });
					if (newKeyInput === undefined) return;
					const newKey = newKeyInput.trim();

					if (newKey !== originalKey && ctkRules.some(r => r.id !== ruleId && r.key === newKey)) {
						vscode.window.showErrorMessage(`CTK GEE: A rule with key "${newKey}" already exists in ${scopeNameProper}.`);
						return;
					}

					const newValue = await vscode.window.showInputBox({ prompt: `Enter new value for '${newKey}'`, value: originalValue, validateInput: text => text !== undefined ? null : "Value cannot be null." });
					if (newValue === undefined) return;

					ruleToEdit.key = newKey;
					await updateCtkRuleSet(ctkRules, scope);

					const geminiKVs = parseGeminiRulesString(await getGeminiRulesStringFromConfig(scope)).orderedKeyValues;
					const updatedGeminiKVs = geminiKVs.map(kv => (kv.key === originalKey ? { key: newKey, value: newValue } : kv));
					if (!updatedGeminiKVs.find(kv => kv.key === newKey) && originalKey !== newKey) { // If originalKey wasn't found, add new one
						updatedGeminiKVs.push({ key: newKey, value: newValue });
					}
					await updateGeminiRulesStringInConfig(buildGeminiRulesString(updatedGeminiKVs), scope);

					vscode.window.showInformationMessage(`CTK GEE: ${scopeNameProper} Rule ID ${ruleId} updated via tree.`);
					if (scope === vscode.ConfigurationTarget.Global && userRulesProvider) userRulesProvider.refresh();
					if (scope === vscode.ConfigurationTarget.Workspace && workspaceRulesProvider) workspaceRulesProvider.refresh();
				}));

				context.subscriptions.push(vscode.commands.registerCommand('ctk.tree.deleteRule', async (item) => {
					if (!item || !item.ruleSpec) {
						vscode.window.showErrorMessage("CTK GEE: No rule selected for deletion from tree.");
						return;
					}
					const { id: ruleId, key: keyToDelete, scope } = item.ruleSpec;
					const scopeNameProper = scope === vscode.ConfigurationTarget.Global ? "Global" : "Workspace";

					if (scope === vscode.ConfigurationTarget.Workspace && !isWorkspaceOpen()) {
						vscode.window.showInformationMessage(`CTK GEE: A workspace must be open to delete a ${scopeNameProper} rule.`);
						return;
					}

					const confirm = await vscode.window.showWarningMessage(`Delete ${scopeNameProper} rule "${keyToDelete}"?`, { modal: true }, "Yes");
					if (confirm !== "Yes") return;

					let ctkRules = getCtkRuleSet(scope);
					const updatedCtkRules = ctkRules.filter(r => r.id !== ruleId);
					await updateCtkRuleSet(updatedCtkRules, scope);

					const geminiKVs = parseGeminiRulesString(await getGeminiRulesStringFromConfig(scope)).orderedKeyValues;
					const filteredGeminiKVs = geminiKVs.filter(kv => kv.key !== keyToDelete);
					await updateGeminiRulesStringInConfig(buildGeminiRulesString(filteredGeminiKVs), scope);

					vscode.window.showInformationMessage(`CTK GEE: ${scopeNameProper} Rule "${keyToDelete}" deleted via tree.`);
					if (scope === vscode.ConfigurationTarget.Global && userRulesProvider) userRulesProvider.refresh();
					if (scope === vscode.ConfigurationTarget.Workspace && workspaceRulesProvider) workspaceRulesProvider.refresh();
				}));

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
						
						// Determine if the change affects global or workspace settings
						let affectedScope = null;
						// Check if the event affects the configuration in the global scope or any workspace scope
						if (event.affectsConfiguration(ctkRuleSetKeyScoped, null) || event.affectsConfiguration(geminiRulesKey, null)) {
								 // If a workspace is open, check if the change is specific to the workspace
								if (isWorkspaceOpen() && (event.affectsConfiguration(ctkRuleSetKeyScoped, vscode.workspace.workspaceFolders[0].uri) || event.affectsConfiguration(geminiRulesKey, vscode.workspace.workspaceFolders[0].uri))) {
										affectedScope = vscode.ConfigurationTarget.Workspace;
								} else if (!isWorkspaceOpen() || 
													!(event.affectsConfiguration(ctkRuleSetKeyScoped, vscode.workspace.workspaceFolders?.[0].uri) || 
														event.affectsConfiguration(geminiRulesKey, vscode.workspace.workspaceFolders?.[0].uri))
													) {
										// If no workspace is open, or if the change is not specific to the workspace (when one is open),
										// assume it's a global change.
										affectedScope = vscode.ConfigurationTarget.Global;
								}
						}

						if (!affectedScope) return; // Change didn't affect our settings or relevant scope

						const scopeNameProper = affectedScope === vscode.ConfigurationTarget.Global ? "Global" : "Workspace";

						if (event.affectsConfiguration(ctkRuleSetKeyScoped, affectedScope === vscode.ConfigurationTarget.Workspace ? vscode.workspace.workspaceFolders[0].uri : undefined)) {
								console.log(`CTK GEE: ${ctkRuleSetKeyScoped} changed for ${scopeNameProper}. Ensuring integrity and syncing.`);
								const currentCtkRules = getCtkRuleSet(affectedScope);
								const { cleanedCtkRules, keyRenames, madeChanges } = await ensureAndCleanCtkRuleSet(currentCtkRules, scopeNameProper);

								if (madeChanges) { // If ensureAndCleanCtkRuleSet modified the ctkRules (e.g. deduped keys/ids)
										await updateCtkRuleSet(cleanedCtkRules, affectedScope); // Persist cleaned ctk.ruleSet
								}
								// Always sync, as order might have changed or keys might have been cleaned
								await syncRules(affectedScope, keyRenames);

								if (affectedScope === vscode.ConfigurationTarget.Global && userRulesProvider) userRulesProvider.refresh();
								if (affectedScope === vscode.ConfigurationTarget.Workspace && workspaceRulesProvider) workspaceRulesProvider.refresh();

						} else if (event.affectsConfiguration(geminiRulesKey, affectedScope === vscode.ConfigurationTarget.Workspace ? vscode.workspace.workspaceFolders[0].uri : undefined)) {
								console.log(`CTK GEE: ${geminiRulesKey} changed for ${scopeNameProper}. Reconciling with ctk.ruleSet.`);
								await reconcileCtkWithExternalGeminiChange(affectedScope);
								// Reconcile might change ctk.ruleSet and gemini.rules, so refresh
								if (affectedScope === vscode.ConfigurationTarget.Global && userRulesProvider) userRulesProvider.refresh();
								if (affectedScope === vscode.ConfigurationTarget.Workspace && workspaceRulesProvider) workspaceRulesProvider.refresh();
						}
				}));
				context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => {
					if (workspaceRulesProvider) workspaceRulesProvider.refresh(); // Refresh when workspace folders change
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
