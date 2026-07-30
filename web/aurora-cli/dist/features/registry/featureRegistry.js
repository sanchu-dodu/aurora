const features = new Map();
export function registerFeature(feature) {
    features.set(feature.id, feature);
}
export function getFeature(id) {
    const feature = features.get(id);
    if (!feature) {
        throw new Error(`Unknown feature '${id}'.`);
    }
    return feature;
}
export function getFeatures() {
    return [
        ...features.values()
    ];
}
//# sourceMappingURL=featureRegistry.js.map