import {
  metadataStorage,
} from "../metadata/metadataStorage.js";

export function singleton() {

  return function (
    target: Function
  ) {

    metadataStorage.register({
      target,
      singleton: true,
    });

  };

}