# AWS CLI user installation

AWS CLI did not need a system-wide installation in this repository. The custom installer used AWS's command-line installer defaults, which put files in `/usr/local/aws-cli` and links in `/usr/local/bin`; those root-owned locations require `sudo`.

AWS supports user-local installation. Its current Linux install script defaults to `$HOME/.local/share/aws-cli` with a link in `$HOME/.local/bin`. The command-line installer also supports writable locations through `--install-dir` and `--bin-dir`. [AWS CLI install instructions](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html)

This repository uses Homebrew in a user-owned prefix on supported machines. Managing the `awscli` formula in `packages/Brewfile` gives `dot` one cross-platform, non-root installation path. The previous `/usr/local` installation can remain until the user removes it; Homebrew's bin directory is earlier in this repository's configured path. AWS documents removal of `/usr/local/bin/aws`, `/usr/local/bin/aws_completer`, and `/usr/local/aws-cli` for command-line-installer installations. [AWS CLI uninstall instructions](https://docs.aws.amazon.com/cli/latest/userguide/uninstall.html)
