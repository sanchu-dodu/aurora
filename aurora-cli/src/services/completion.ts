import type {
  Command,
} from "commander";

export const COMPLETION_SHELLS = [
  "bash",
  "zsh",
  "fish",
  "powershell",
] as const;

export type CompletionShell =
  typeof COMPLETION_SHELLS[number];

interface CompletionGroup {
  readonly command: string;
  readonly candidates: string[];
}

function getCommandNames(
  command: Command
): string[] {
  return command.commands
    .map(
      (candidate) =>
        candidate.name()
    )
    .sort();
}

function getCompletionGroups(
  program: Command
): CompletionGroup[] {
  return program.commands
    .map((command) => ({
      command: command.name(),
      candidates: [
        ...getCommandNames(command),
        "-h",
        "--help",
      ],
    }))
    .filter(
      (group) =>
        group.candidates.length > 2
    )
    .sort(
      (left, right) =>
        left.command.localeCompare(
          right.command
        )
    );
}

function getRootCandidates(
  program: Command
): string[] {
  return [
    ...getCommandNames(program),
    "-h",
    "--help",
    "-V",
    "--version",
  ];
}

function generateBashCompletion(
  program: Command
): string {
  const rootCandidates =
    getRootCandidates(program)
      .join(" ");

  const cases =
    getCompletionGroups(program)
      .map(
        (group) =>
          `    ${group.command}) candidates="${group.candidates.join(" ")}" ;;`
      )
      .join("\n");

  return [
    "# bash completion for Aurora CLI",
    "_aurora_completion() {",
    "  local current candidates",
    "  current=\"${COMP_WORDS[COMP_CWORD]}\"",
    "  case \"${COMP_WORDS[1]}\" in",
    cases,
    `    *) candidates="${rootCandidates}" ;;`,
    "  esac",
    "  COMPREPLY=( $(compgen -W \"$candidates\" -- \"$current\") )",
    "}",
    "complete -F _aurora_completion aurora",
    "",
  ].filter(Boolean).join("\n");
}

function generateZshCompletion(
  program: Command
): string {
  const rootCandidates =
    getRootCandidates(program)
      .join(" ");

  const cases =
    getCompletionGroups(program)
      .map(
        (group) =>
          `    ${group.command}) candidates=(${group.candidates.join(" ")}) ;;`
      )
      .join("\n");

  return [
    "#compdef aurora",
    "# zsh completion for Aurora CLI",
    "_aurora() {",
    "  local -a candidates",
    "  case \"${words[2]}\" in",
    cases,
    `    *) candidates=(${rootCandidates}) ;;`,
    "  esac",
    "  _describe 'aurora command' candidates",
    "}",
    "compdef _aurora aurora",
    "",
  ].filter(Boolean).join("\n");
}

function generateFishCompletion(
  program: Command
): string {
  const lines = [
    "# fish completion for Aurora CLI",
    "complete -c aurora -f",
  ];

  for (const command of getCommandNames(program)) {
    lines.push(
      `complete -c aurora -n '__fish_use_subcommand' -a '${command}'`
    );
  }

  for (const group of getCompletionGroups(program)) {
    for (const candidate of group.candidates) {
      if (candidate.startsWith("-")) {
        continue;
      }

      lines.push(
        `complete -c aurora -n '__fish_seen_subcommand_from ${group.command}' -a '${candidate}'`
      );
    }
  }

  lines.push("");

  return lines.join("\n");
}

function generatePowerShellCompletion(
  program: Command
): string {
  const rootCandidates =
    getRootCandidates(program)
      .map(
        (candidate) =>
          `"${candidate}"`
      )
      .join(", ");

  const groupEntries =
    getCompletionGroups(program)
      .map((group) => {
        const candidates =
          group.candidates
            .map(
              (candidate) =>
                `"${candidate}"`
            )
            .join(", ");

        return `  "${group.command}" = @(${candidates})`;
      });

  return [
    "# PowerShell completion for Aurora CLI",
    `$auroraRootCandidates = @(${rootCandidates})`,
    "$auroraSubcommands = @{",
    ...groupEntries,
    "}",
    "Register-ArgumentCompleter -Native -CommandName aurora -ScriptBlock {",
    "  param($wordToComplete, $commandAst, $cursorPosition)",
    "  $elements = @($commandAst.CommandElements | ForEach-Object { $_.Extent.Text })",
    "  $rootCommand = if ($elements.Count -gt 1) { $elements[1] } else { $null }",
    "  $candidates = if ($rootCommand -and $auroraSubcommands.ContainsKey($rootCommand)) {",
    "    $auroraSubcommands[$rootCommand]",
    "  } else {",
    "    $auroraRootCandidates",
    "  }",
    "  $candidates | Where-Object { $_ -like \"$wordToComplete*\" } | ForEach-Object {",
    "    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)",
    "  }",
    "}",
    "",
  ].join("\n");
}

export function generateCompletionScript(
  program: Command,
  shell: CompletionShell
): string {
  switch (shell) {
    case "bash":
      return generateBashCompletion(
        program
      );

    case "zsh":
      return generateZshCompletion(
        program
      );

    case "fish":
      return generateFishCompletion(
        program
      );

    case "powershell":
      return generatePowerShellCompletion(
        program
      );
  }
}
