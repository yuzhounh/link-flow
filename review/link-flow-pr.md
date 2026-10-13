The README now has reproducible clone/virtual-environment setup, a license badge and a clear license section. The four Windows launch and stop helpers now prefer the repository's `.venv`, so the documented installation and double-click workflow use the same dependencies; they retain the existing Anaconda and PATH fallbacks.

Validation:

- `python -m pytest -q` — 33 passed
- `git diff --check`
- Reviewed all four launcher selection paths without starting the live server
