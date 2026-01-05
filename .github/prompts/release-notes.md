The new version is ${{ steps.version.outputs.version }}.
The previous tag is ${{ steps.version.outputs.previous_tag }}.

I have prepared some context for you:

## Recent Commits
${{ steps.context.outputs.commits }}

## Changed Files Statistics
${{ steps.context.outputs.stats }}

Task:
Generate release notes for version ${{ steps.version.outputs.version }}.
The release notes should be in Markdown format.
Include:
- A summary of changes.
- A list of new features, bug fixes, and improvements.
- Any breaking changes.

Output ONLY the content of the release notes. Do not include any conversational text or code blocks wrapping the content.
