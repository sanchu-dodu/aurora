export async function install(context) {

  context.log(
    "Installing NextAuth..."
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
