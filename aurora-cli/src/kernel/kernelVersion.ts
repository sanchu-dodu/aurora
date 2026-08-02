export const KernelVersion = {

  major: 1,

  minor: 0,

  patch: 0,

  codename: "Genesis",

  version() {

    return `${this.major}.${this.minor}.${this.patch}`;

  }

};