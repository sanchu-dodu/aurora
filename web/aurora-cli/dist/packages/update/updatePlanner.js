export class UpdatePlanner {
    createPlan(packageId, currentVersion, targetVersion) {
        if (currentVersion === targetVersion) {
            return [];
        }
        return [
            {
                package: packageId,
                currentVersion,
                targetVersion
            }
        ];
    }
}
//# sourceMappingURL=updatePlanner.js.map