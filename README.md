# CTK GEE: Gemini Extension Enhancer

 ## Features

This extension provides a convenient way to manage a collection of rules that guide the behavior of an AI coding assistant.
*   **Sidebar GUI**: Manage rules (add, edit, delete) for both User (Global) and Workspace settings through dedicated tree views in the VS Code activity bar.
*   **Add Rule**: Easily add a new key-value rule pair to your collection via the sidebar or command palette for both scopes.
*   **Edit Rule**: Modify existing key-value rule pairs in your collection via the sidebar or command palette for both scopes.
*   **Delete Rule**: Remove unwanted key-value rule pairs from your collection via the sidebar or command palette for both scopes.
*   **View Rules**: Quickly see all currently configured key-value pairs via a command for both scopes.
*   **Automatic Syncing**: Rules managed in `ctk.ruleSet` (keys and order) are automatically combined with their values (stored in `geminicodeassist.rules`) and synced to the `geminicodeassist.rules` setting.
*   **Configuration Integrity**: The extension monitors both `ctk.ruleSet` and `geminicodeassist.rules`. If `geminicodeassist.rules` is modified externally, the extension prompts the user on how to reconcile the differences. It also cleans `ctk.ruleSet` to ensure unique IDs and keys.
*   **Initial Import**: On first activation or if `ctk.ruleSet` is empty, the extension can import existing keys from `geminicodeassist.rules` into `ctk.ruleSet`.



*   `ctk.ruleSet`:
    *   Type: `array`
    *   Scope: User, Workspace
    *   Items:
        *   Type: `object`
        *   Properties:
            *   `id`:
                *   Type: `number`
                *   Description: "A unique identifier for the rule, managed by the extension."
            *   `key`:
                *   Type: `string`
                *   Description: "The key for the rule. Must be unique within its scope."
    *   Default: `[]`
    *   Description: "Manages the identifiers and keys for rules. The actual rule *values* are stored and synced with `geminicodeassist.rules`. These are combined by the 'CTK GEE' extension to populate `geminicodeassist.rules`."
*   `geminicodeassist.rules`:
    *   Type: `string`
    *   Scope: User, Workspace
    *   Default: `""`
    *   Description: "The combined rules string (e.g., 'key1: value1\\n\\n\\n\\nkey2: value2'), managed by the 'CTK GEE' extension based on 'ctk.ruleSet' and the values from this setting. Direct edits may trigger a reconciliation prompt by 'CTK GEE'."

## Commands

*   `CTK GEE: Add Global/Workspace Rule`: Prompts for a new rule key and value and adds it.
*   `CTK GEE: Edit Global/Workspace Rule`: Allows selecting and editing an existing rule's key and value.
*   `CTK GEE: Delete Global/Workspace Rule`: Allows selecting and deleting a rule.
*   `CTK GEE: View Global/Workspace Rules`: Displays the current rules.
*   `CTK GEE: Force Sync Global/Workspace Rules`: Manually re-synchronizes `ctk.ruleSet` with `geminicodeassist.rules`.

 ## Release Notes
 
### 0.0.1 (Planned - Corresponds to current state)
 
*   Initial release of `ctk-gee`.
*   Rule management for key-value pairs: Add, Edit, Delete, View rules for Global and Workspace scopes.
*   Dedicated Tree Views in the sidebar for User (Global) and Workspace rules.
*   Automatic synchronization between `ctk.ruleSet` (keys, order) and `geminicodeassist.rules` (values).
*   Initial import of keys from `geminicodeassist.rules` to `ctk.ruleSet`.
*   Reconciliation mechanism for external changes to `geminicodeassist.rules`.
*   Integrity checks for `ctk.ruleSet` (unique IDs, unique keys).
 
 ---

