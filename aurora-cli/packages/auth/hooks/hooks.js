export async function beforeInstall(context) {

  context.log(
    "Preparing authentication package..."
  );

}


export async function afterInstall(context) {

  context.log(
    "Authentication package installed successfully."
  );

}