import { ServiceCollection } from "../serviceCollection.js";
import { ServiceProvider } from "../serviceProvider.js";

import { registerCoreServices } from "./registerCoreServices.js";

export function createContainer(): ServiceProvider {

  const services = new ServiceCollection();

  registerCoreServices(services);

  return services.build();

}