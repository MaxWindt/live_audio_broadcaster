#!/usr/bin/env node

const { execSync } = require('child_process');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function askQuestion(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

function getNextVersion(latestTag) {
  if (!latestTag) return 'v0.1.0'; // first tag if none exist
  latestTag = latestTag.replace(/^v\./, 'v');
  const match = latestTag.match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    const numericSuffix = latestTag.match(/^(.*?)(\d+)$/);
    if (numericSuffix) {
      const [, prefix, num] = numericSuffix;
      return `${prefix}${Number(num) + 1}`;
    }
    return `${latestTag}.1`; // fallback
  }
  let [, major, minor, patch] = match.map(Number);
  patch += 1; // bump patch
  return `v${major}.${minor}.${patch}`;
}

async function createAndPushTag() {
  try {
    // Get latest tag
    let latestTag = '';
    try {
      latestTag = execSync('git describe --tags --abbrev=0', { stdio: 'pipe' })
        .toString()
        .trim();
    } catch {
      latestTag = '';
    }

    // Get tag name from argument or suggest next
    let tagName = process.argv[2];
    if (!tagName) {
      const suggested = getNextVersion(latestTag);
      tagName = await askQuestion(`Enter tag name (default: ${suggested}): `);
      if (!tagName) tagName = suggested;
    }

    // Get optional tag message
    let tagMessage = process.argv[3];
    if (!tagMessage) {
      tagMessage = await askQuestion(
        `Enter tag message (optional, press enter to skip): `
      );
    }

    console.log(`Creating tag: ${tagName}`);

    // Check if tag already exists
    try {
      execSync(`git rev-parse ${tagName}`, { stdio: 'pipe' });
      console.error(`Tag "${tagName}" already exists`);
      process.exit(1);
    } catch {
      // Tag doesn’t exist, good
    }

    // Create tag
    if (tagMessage) {
      execSync(`git tag -a ${tagName} -m "${tagMessage}"`, {
        stdio: 'inherit'
      });
    } else {
      execSync(`git tag ${tagName}`, { stdio: 'inherit' });
    }

    console.log(`Tag "${tagName}" created successfully`);

    // Create version file
    console.log('Creating version file...');
    const publicDir = path.join(__dirname, '..', 'public');
    if (!fs.existsSync(publicDir)) {
      fs.mkdirSync(publicDir, { recursive: true });
    }
    const versionData = {
      version: tagName,
      buildDate: new Date().toISOString()
    };
    fs.writeFileSync(
      path.join(publicDir, 'version.json'),
      JSON.stringify(versionData, null, 2)
    );
    console.log('Version file created at public/version.json');

    // Push tag
    console.log(`Pushing tag to remote...`);
    execSync(`git push origin ${tagName}`, { stdio: 'inherit' });

    console.log(`Tag "${tagName}" pushed to remote successfully`);
  } catch (error) {
    console.error('Error creating or pushing tag:', error.message);
    process.exit(1);
  } finally {
    rl.close();
  }
}

// Show help
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
Usage: npm run tag [tag-name] [tag-message]

Examples:
  npm run tag                    # Interactive mode (suggests next version)
  npm run tag v1.0.0             # Create and push tag v1.0.0
  npm run tag v1.0.0 "Release"   # Create annotated tag with message

Options:
  --help, -h    Show this help message
`);
  process.exit(0);
}

createAndPushTag();
