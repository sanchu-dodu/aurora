export async function install(context) {

  context.log(
    "Installing NextAuth..."
  );

  await context.env.addVariables([
    "AUTH_SECRET",
    "AUTH_URL"
  ]);

  await context.config.addDependency(
  "next-auth",
  "^4.24.11"
);

  await context.createFile(
    "src/auth.ts",
`
export function auth() {
  return "Aurora Authentication";
}
`
  );

}