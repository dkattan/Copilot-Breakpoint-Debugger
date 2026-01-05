The new version is ${{ steps.version.outputs.version }}.
The previous tag is ${{ steps.version.outputs.previous_tag }}.

I have prepared some context for you:

## Recent Commits
${{ steps.context.outputs.commits }}

## Changed Files Statistics
${{ steps.context.outputs.stats }}

Task:
1. Analyze the changes provided in the context.
2. Run `git diff ${{ steps.version.outputs.previous_tag }}` to inspect the actual code changes.
3. Verify that the tool descriptions in `package.json` match the implementation. Update them if necessary.
4. Update CHANGELOG.md with a new section for ${{ steps.version.outputs.version }}.
5. Update README.md if necessary based on the changes.
6. Update package.json description if the project scope has evolved significantly.
7. Create a file named RELEASE_NOTES.md containing the release notes body for this version.
