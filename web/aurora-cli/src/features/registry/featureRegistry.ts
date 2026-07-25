import { AuroraFeature } from "../feature.js";

const features = new Map<
  string,
  AuroraFeature
>();

export function registerFeature(
  feature: AuroraFeature
): void {

  features.set(
    feature.id,
    feature
  );

}

export function getFeature(
  id: string
): AuroraFeature {

  const feature =
    features.get(id);

  if (!feature) {

    throw new Error(
      `Unknown feature '${id}'.`
    );

  }

  return feature;

}

export function getFeatures(): AuroraFeature[] {

  return [
    ...features.values()
  ];

}