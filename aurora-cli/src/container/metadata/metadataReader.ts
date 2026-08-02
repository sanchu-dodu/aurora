import {
  metadataStorage,
} from "./metadataStorage.js";

export class MetadataReader {

  get(target: Function) {
    return metadataStorage.get(target);
  }

  has(target: Function) {
    return metadataStorage.has(target);
  }

  getAll() {
    return metadataStorage.getAll();
  }

}

export const metadataReader =
  new MetadataReader();