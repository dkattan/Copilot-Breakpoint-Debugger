const { getInput, setFailed, info, setOutput } = require('@actions/core');
const { context, getOctokit } = require('@actions/github');
const { Anthropic } = require('@anthropic-ai/sdk');

function parseInputs() {
  const anthropicApiKey = getInput('anthropic-api-key');
  const language = getInput('language');
  const model = getInput('model');
  const token = getInput('token');
  const version = getInput('version');
  return { anthropicApiKey, language, model, token, version };
}

async function getPRsFromCommit(octokit, sha) {
  try {
    const pr = await octokit.rest.repos.listPullRequestsAssociatedWithCommit({
      owner: context.repo.owner,
      repo: context.repo.repo,
      commit_sha: sha,
    });
    return pr.data.map(p => ({ label: `#${p.number}`, url: p.html_url }));
  } catch (e) {
    info(`Failed to fetch PRs for commit ${sha}: ${e.message}`);
    return [];
  }
}

function buildPrompt(language, commitsData) {
  return [
    'You are a DEV OPS engineer; write a concise changelog for the new software version.',
    'The changelog lists new features (use verb "Add"), changes/improvements/updates (also start with "Add"), and bug fixes (start lines with "Fix").',
    'Order sections: features/changes first, then fixes.',
    "Format exactly as:\n```\n## What's Changed\n- Add <feature/change>\n- Fix <bug>\n```",
    'Do not invent items. Use ONLY the following commit data (message, author, PRs).',
    'If no features or fixes are present, provide a minimal placeholder like "- Add internal refactors".',
    `Return output in language: ${language}. Translate commit-derived content.`,
    'Commit data JSON follows:',
    JSON.stringify(commitsData, null, 2),
  ].join('\n');
}

async function run() {
  info('Running Anthropic release notes action');
  const { anthropicApiKey, language, model, token, version } = parseInputs();
  const octokit = getOctokit(token);

  // Gather commits since last release
  let latestRelease = null;
  try {
    latestRelease = await octokit.rest.repos.getLatestRelease({
      owner: context.repo.owner,
      repo: context.repo.repo,
    });
  } catch (e) {
    info(`No previous release found; using all recent commits (${e.message})`);
  }

  let commits = [];
  try {
    if (latestRelease) {
      const base = latestRelease.data.tag_name;
      const compare = await octokit.rest.repos.compareCommits({
        owner: context.repo.owner,
        repo: context.repo.repo,
        base,
        head: context.sha,
      });
      commits = compare.data.commits;
    } else {
      // fallback: list recent commits (first page)
      const list = await octokit.rest.repos.listCommits({
        owner: context.repo.owner,
        repo: context.repo.repo,
        per_page: 100,
      });
      commits = list.data;
    }
  } catch (error) {
    return setFailed(
      `Failed to gather commits: ${error.message || 'unknown error'}`
    );
  }

  if (!commits.length) {
    return setFailed('No commits found to generate release notes');
  }

  // Build commit data with PR associations
  const commitsStructured = [];
  for (const c of commits) {
    const prs = await getPRsFromCommit(octokit, c.sha);
    commitsStructured.push({
      sha: c.sha,
      message: c.commit?.message,
      author: c.author?.login || c.commit?.author?.name || 'unknown',
      authorUrl: c.author?.html_url || null,
      prs,
    });
  }

  const prompt = buildPrompt(language || 'en', commitsStructured);

  try {
    const anthropic = new Anthropic({ apiKey: anthropicApiKey });
    const completion = await anthropic.messages.create({
      model: model || 'claude-3-5-sonnet-latest',
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }],
    });

    const contentBlock = completion.content && completion.content[0];
    const responseText =
      contentBlock && contentBlock.text ? contentBlock.text : null;
    if (!responseText) {
      throw new Error('Anthropic did not return content');
    }

    // Create release
    await octokit.rest.repos.createRelease({
      owner: context.repo.owner,
      repo: context.repo.repo,
      tag_name: version,
      name: version,
      body: responseText,
    });

    setOutput('releaseNotes', responseText);
    info('Release created successfully.');
  } catch (error) {
    setFailed(error.message || 'Failed to generate release notes');
  }
}

run();
