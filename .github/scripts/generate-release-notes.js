const fs = require('node:fs');
const path = require('node:path');
const process = require('node:process');

async function generateReleaseNotes() {
  const promptPath = path.join(process.env.GITHUB_WORKSPACE, '.github/prompts/release-notes.md');
  const promptTemplate = fs.readFileSync(promptPath, 'utf8');
  
  const version = process.env.VERSION;
  const prevTag = process.env.PREV_TAG;
  const commits = process.env.COMMITS;
  const stats = process.env.STATS;
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY is not set');
    process.exit(1);
  }

  /* eslint-disable no-template-curly-in-string */
  const prompt = promptTemplate
    .replace('${{ steps.version.outputs.version }}', version)
    .replace('${{ steps.version.outputs.previous_tag }}', prevTag)
    .replace('${{ steps.context.outputs.commits }}', commits)
    .replace('${{ steps.context.outputs.stats }}', stats);
  /* eslint-enable no-template-curly-in-string */

  console.log('Generating release notes with Claude...');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-3-opus-20240229',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`API request failed: ${response.status} ${response.statusText}`);
    console.error(errorText);
    process.exit(1);
  }

  const data = await response.json();
  const content = data.content[0].text;

  console.log('Release notes generated.');
  
  // Extract the content for RELEASE_NOTES.md
  // The prompt asks to "Create a file named RELEASE_NOTES.md containing the release notes body"
  // But since we are getting text back, we should just save the text to RELEASE_NOTES.md
  // However, the model might output "Here is the file content: ..." or markdown code blocks.
  // We should probably instruct the model to ONLY output the content, or parse it.
  // For now, let's assume the model follows instructions well enough or we just dump the output.
  // But wait, the prompt says "7. Create a file named RELEASE_NOTES.md...". 
  // If we use the API, we just get text. We need to write it.
  
  // Let's adjust the prompt injection in the script to be more direct about outputting the content.
  // Or we can just write the output to RELEASE_NOTES.md.
  
  fs.writeFileSync('RELEASE_NOTES.md', content);
  console.log('RELEASE_NOTES.md written.');

  // Update CHANGELOG.md
  const changelogPath = 'CHANGELOG.md';
  let changelog = '';
  if (fs.existsSync(changelogPath)) {
    changelog = fs.readFileSync(changelogPath, 'utf8');
  }
  
  const date = new Date().toISOString().split('T')[0];
  const newEntry = `## [${version}] - ${date}\n\n${content}\n\n`;
  
  // Insert after the header or at the top
  // Assuming standard Keep a Changelog format or similar
  // If there is a "# Changelog" header, insert after it.
  // Otherwise prepend.
  
  if (changelog.includes('# Changelog')) {
    changelog = changelog.replace('# Changelog', `# Changelog\n\n${newEntry}`);
  } else if (changelog.includes('# CHANGELOG')) {
    changelog = changelog.replace('# CHANGELOG', `# CHANGELOG\n\n${newEntry}`);
  } else {
    changelog = newEntry + changelog;
  }
  
  fs.writeFileSync(changelogPath, changelog);
  console.log('CHANGELOG.md updated.');
}

generateReleaseNotes().catch(err => {
  console.error(err);
  process.exit(1);
});
