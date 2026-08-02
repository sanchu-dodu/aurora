export class SemVer {

  constructor(

    public major: number,

    public minor: number,

    public patch: number

  ) {}

  static parse(
    version: string
  ): SemVer {

    const parts =
      version.split(".");

    if (parts.length !== 3) {

      throw new Error(
        `Invalid version: ${version}`
      );

    }

    return new SemVer(

      Number(parts[0]),

      Number(parts[1]),

      Number(parts[2])

    );

  }

  toString(): string {

    return `${this.major}.${this.minor}.${this.patch}`;

  }

}