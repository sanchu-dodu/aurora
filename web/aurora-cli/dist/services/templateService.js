import { getTemplates } from "../core/templateRegistry.js";
export async function getAllTemplates() {
    return getTemplates();
}
export async function getTemplateById(id) {
    return getTemplates().find(template => template.id === id);
}
export async function searchTemplates(query) {
    const search = query.toLowerCase();
    return getTemplates().filter(template => template.id.toLowerCase().includes(search) ||
        template.displayName.toLowerCase().includes(search) ||
        template.description.toLowerCase().includes(search) ||
        template.framework.toLowerCase().includes(search) ||
        template.author.toLowerCase().includes(search) ||
        template.tags.some(tag => tag.toLowerCase().includes(search)));
}
export async function installTemplate(id) {
    return getTemplateById(id);
}
//# sourceMappingURL=templateService.js.map