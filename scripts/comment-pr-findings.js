#!/usr/bin/env node

/**
 * Script to comment on PRs with findings from OpenRouter analysis.
 * Adapted from anthropics/claude-code-security-review.
 */

const fs = require('fs');
const { spawnSync } = require('child_process');

// Parse GitHub context from environment
const context = {
  repo: {
    owner: process.env.GITHUB_REPOSITORY?.split('/')[0] || '',
    repo: process.env.GITHUB_REPOSITORY?.split('/')[1] || ''
  },
  issue: {
    number: parseInt(process.env.GITHUB_EVENT_PATH ? JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')).pull_request?.number : '') || 0
  },
  payload: {
    pull_request: process.env.GITHUB_EVENT_PATH ? JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')).pull_request : {}
  }
};

// GitHub API helper using gh CLI
function ghApi(endpoint, method = 'GET', data = null) {
  const args = ['api', endpoint, '--method', method];
  if (data) {
    args.push('--input', '-');
  }
  try {
    const result = spawnSync('gh', args, {
      encoding: 'utf8',
      input: data ? JSON.stringify(data) : undefined,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    if (result.error) {
      throw new Error(`Failed to spawn gh process: ${result.error.message}`);
    }
    if (result.status !== 0) {
      console.error(`Error calling GitHub API: ${result.stderr}`);
      throw new Error(`gh process exited with code ${result.status}: ${result.stderr}`);
    }
    return JSON.parse(result.stdout);
  } catch (error) {
    console.error(`Error calling GitHub API: ${error.message}`);
    throw error;
  }
}

function addReactionsToReview(reviewId) {
  try {
    const reviewComments = ghApi(`/repos/${context.repo.owner}/${context.repo.repo}/pulls/${context.issue.number}/reviews/${reviewId}/comments`);
    if (reviewComments && Array.isArray(reviewComments)) {
      for (const comment of reviewComments) {
        if (comment.id) {
          for (const reaction of ['+1', '-1']) {
            try {
              ghApi(`/repos/${context.repo.owner}/${context.repo.repo}/pulls/comments/${comment.id}/reactions`, 'POST', { content: reaction });
            } catch (e) {
              console.error(`Failed to add ${reaction} reaction:`, e.message);
            }
          }
        }
      }
    }
  } catch (error) {
    console.error(`Failed to get review comments for review ${reviewId}:`, error.message);
  }
}

const MODE_ICONS = { security: '🔒', bugs: '🐛', performance: '⚡' };
const COMMENT_MARKER = '🤖 **Code Review Issue:';

async function run() {
  try {
    const findings = loadFindings();
    if (findings.length === 0) return;

    const prFiles = ghApi(`/repos/${context.repo.owner}/${context.repo.repo}/pulls/${context.issue.number}/files?per_page=100`);
    const reviewComments = mapFindingsToComments(findings, prFiles);

    if (reviewComments.length === 0) {
      console.log('No findings map to PR diff lines');
      return;
    }

    if (hasExistingBotComments()) {
      console.log('Existing review comments found — skipping to avoid duplicates');
      return;
    }

    postReviewWithFallback(reviewComments);
  } catch (error) {
    console.error('Failed to comment on PR:', error);
    process.exit(1);
  }
}

function loadFindings() {
  try {
    const findingsData = fs.readFileSync('findings.json', 'utf8');
    const findings = JSON.parse(findingsData);
    if (findings.length === 0) console.log('No findings to comment on');
    return findings;
  } catch (e) {
    console.log('Could not read findings.json — nothing to comment');
    return [];
  }
}

function mapFindingsToComments(findings, prFiles) {
  const fileMap = {};
  prFiles.forEach(file => { fileMap[file.filename] = file; });

  return findings.filter(f => {
    const file = f.file || f.path;
    if (!fileMap[file]) {
      console.log(`File ${file} not in PR diff, skipping`);
      return false;
    }
    return true;
  }).map(finding => {
    const file = finding.file || finding.path;
    const line = finding.line || (finding.start && finding.start.line) || 1;
    const icon = MODE_ICONS[finding.mode] || '🔍';

    let body = `${icon} ${COMMENT_MARKER} ${finding.description || 'Issue detected'}**\n\n`;
    body += `**Severity:** ${finding.severity || 'MEDIUM'}\n`;
    body += `**Category:** ${finding.category || 'unknown'}\n`;
    body += `**Mode:** ${finding.mode || 'security'}\n`;
    body += `**Tool:** OpenRouter AI Analysis\n`;
    if (finding.exploit_scenario && finding.exploit_scenario !== 'Not provided') {
      body += `\n**Exploit Scenario:** ${finding.exploit_scenario}\n`;
    }
    if (finding.recommendation && finding.recommendation !== 'Not provided') {
      body += `\n**Recommendation:** ${finding.recommendation}\n`;
    }

    return { path: file, line, side: 'RIGHT', body };
  });
}

function hasExistingBotComments() {
  const existingComments = ghApi(`/repos/${context.repo.owner}/${context.repo.repo}/pulls/${context.issue.number}/comments`);
  return existingComments.some(c =>
    c.user.type === 'Bot' && c.body && c.body.includes(COMMENT_MARKER)
  );
}

function postReviewWithFallback(reviewComments) {
  try {
    const reviewData = {
      commit_id: context.payload.pull_request.head.sha,
      event: 'COMMENT',
      comments: reviewComments
    };
    const reviewResponse = ghApi(`/repos/${context.repo.owner}/${context.repo.repo}/pulls/${context.issue.number}/reviews`, 'POST', reviewData);
    console.log(`Created review with ${reviewComments.length} inline comments`);
    if (reviewResponse && reviewResponse.id) {
      addReactionsToReview(reviewResponse.id);
    }
  } catch (error) {
    console.error('Error creating review, falling back to individual comments:', error.message);
    reviewComments.forEach(comment => {
      try {
        const commentData = { ...comment, commit_id: context.payload.pull_request.head.sha };
        ghApi(`/repos/${context.repo.owner}/${context.repo.repo}/pulls/${context.issue.number}/comments`, 'POST', commentData);
      } catch (e) {
        console.log(`Could not comment on ${comment.path}:${comment.line} — line may not be in diff context`);
      }
    });
  }
}

run();
