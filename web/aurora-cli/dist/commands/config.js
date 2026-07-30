import { loadConfig, saveConfig, } from "../config/configManager.js";
export async function configListCommand() {
    const config = await loadConfig();
    console.log("");
    console.log("Aurora Configuration");
    console.log("====================");
    console.log(JSON.stringify(config, null, 2));
}
export async function configGetCommand(key) {
    const config = await loadConfig();
    if (!(key in config)) {
        console.log(`Unknown configuration key '${key}'.`);
        return;
    }
    console.log(config[key]);
}
export async function configSetCommand(key, value) {
    const config = await loadConfig();
    if (!(key in config)) {
        console.log(`Unknown configuration key '${key}'.`);
        return;
    }
    const current = config[key];
    let newValue = value;
    if (typeof current === "boolean") {
        newValue = value === "true";
    }
    config[key] = newValue;
    await saveConfig(config);
    console.log(`✅ Updated ${key} = ${newValue}`);
}
//# sourceMappingURL=config.js.map