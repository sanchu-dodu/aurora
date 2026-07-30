import {
  metadataStorage,
} from "../metadata/metadataStorage.js";

export function injectable() {

  return function (
    target: Function
  ) {

    metadataStorage.register({
      target,
      singleton: false,
    });

  };

}