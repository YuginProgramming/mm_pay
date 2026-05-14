# Cursor workspace metadata

Ця текка **є частиною репозиторію**: правила в `rules/*.mdc` мають бути в git, щоб уся команда бачила однакові підказки для агента.

- Не додавайте `.cursor/` до `.gitignore`.
- Після змін у правилах робіть звичайний `git add .cursor/`, commit і push разом із кодом (або окремим комітом «cursor rules»).

This folder is versioned on purpose; keep rules in sync via normal git workflow.
