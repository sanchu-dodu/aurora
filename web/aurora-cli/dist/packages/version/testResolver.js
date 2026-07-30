import { VersionResolver } from "./versionResolver.js";
const resolver = new VersionResolver();
console.log("^");
console.log(resolver.satisfies("1.2.3", "^1.2.3"));
console.log(resolver.satisfies("1.8.0", "^1.2.3"));
console.log(resolver.satisfies("2.0.0", "^1.2.3"));
console.log();
console.log("~");
console.log(resolver.satisfies("1.2.9", "~1.2.3"));
console.log(resolver.satisfies("1.3.0", "~1.2.3"));
//# sourceMappingURL=testResolver.js.map