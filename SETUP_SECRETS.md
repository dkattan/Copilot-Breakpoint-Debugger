# GitHub Secrets Setup Guide

This document outlines the secrets you need to configure in your GitHub repository to enable automated CI/CD.

## Required Secrets

### 1. VSCE_PAT (VS Code Extension Publishing Token)

This token is required for automated publishing to the VS Code Marketplace.

#### Steps to Create:

1. **Create Azure DevOps Account**:
   - Go to https://dev.azure.com/
   - Sign in with your Microsoft/GitHub account
   - Create a new organization if you don't have one

2. **Generate Personal Access Token**:
   - Navigate to: https://dev.azure.com/YOUR_ORG/_usersSettings/tokens
   - Click "New Token"
   - Name: "VS Code Extension Publishing"
   - Organization: Select "All accessible organizations"
   - Expiration: Set to custom (1 year recommended)
   - Scopes:
     - Select "Custom defined"
     - Check **Marketplace** → **Manage** permission
   - Click "Create"
   - **IMPORTANT**: Copy the token immediately (you won't see it again)

3. **Add to GitHub Repository**:
   - Go to: https://github.com/dkattan/vscode-copilot-debugger/settings/secrets/actions
   - Click "New repository secret"
   - Name: `VSCE_PAT`
   - Value: Paste the token from step 2
   - Click "Add secret"

#### Verification:

The token should look like: `xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` (52 characters)

### 2. GITHUB_TOKEN (Automatic)

This token is automatically provided by GitHub Actions for:
- Uploading VSIX files to GitHub Releases
- Accessing repository information

**No configuration needed** - GitHub provides this automatically.

## Publishing Your Publisher ID

Before you can publish to the VS Code Marketplace, you need to create a publisher:

1. Go to https://marketplace.visualstudio.com/manage
2. Sign in with the same Microsoft account used for Azure DevOps
3. Click "Create publisher"
4. Publisher ID: `dkattan` (already set in package.json)
5. Display name: Your preferred name
6. Verify your email

## Testing the CI/CD Pipeline

### Test Build/Lint/Format (No secrets required):

```bash
# Push to main or create a PR
git push origin main
```

This will:
- Run on Ubuntu, Windows, and macOS
- Format check with Prettier
- Lint with ESLint
- Compile TypeScript
- Run tests
- Package the extension (artifact uploaded)

### Test Publishing (Requires VSCE_PAT):

```bash
# Create a new version
npm version patch  # or minor/major

# Push changes and tags
git push origin main --tags

# Create GitHub release
gh release create v0.0.2 --title "Release v0.0.2" --notes "Bug fixes and improvements"
```

This will:
- Trigger all the build steps above
- Publish to VS Code Marketplace (if VSCE_PAT is configured)
- Upload VSIX to GitHub Release

## Troubleshooting

### "Extension already published" error:

If you see this error, increment the version in package.json:

```bash
npm version patch
git push --tags
```

### "Publisher not found" error:

Ensure your publisher ID exists at https://marketplace.visualstudio.com/manage

### "Invalid PAT" error:

1. Check that VSCE_PAT secret is correctly set in GitHub
2. Verify the token has "Marketplace: Manage" permission
3. Ensure the token hasn't expired
4. Generate a new token if needed

## Security Notes

- **Never commit secrets to the repository**
- Store VSCE_PAT only in GitHub Secrets
- Rotate tokens periodically (recommended: annually)
- Use minimum required permissions (Marketplace: Manage only)

## Additional Resources

- [VS Code Extension Publishing Guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
- [GitHub Actions Secrets](https://docs.github.com/en/actions/security-guides/encrypted-secrets)
- [Azure DevOps PAT Documentation](https://learn.microsoft.com/en-us/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate)
