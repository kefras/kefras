#!/usr/bin/env node

const fs = require('fs/promises');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const configPath = path.join(rootDir, 'profile.config.json');
const readmePath = path.join(rootDir, 'README.md');
const githubApi = 'https://api.github.com';

async function loadConfig() {
  const data = await fs.readFile(configPath, 'utf8');
  return JSON.parse(data);
}

function getHeaders(token, extra = {}) {
  const headers = {
    'User-Agent': 'profile-readme-generator',
    Accept: 'application/vnd.github+json',
    ...extra
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

async function requestJson(url, token, extraHeaders = {}) {
  const response = await fetch(url, { headers: getHeaders(token, extraHeaders) });

  if (!response.ok) {
    throw new Error(`GitHub API request failed (${response.status}) for ${url}`);
  }

  return response.json();
}

async function safeRequestJson(url, token, extraHeaders = {}) {
  try {
    return await requestJson(url, token, extraHeaders);
  } catch (error) {
    console.warn(`Warning: ${error.message}`);
    return null;
  }
}

async function paginate(endpoint, token) {
  const all = [];
  let page = 1;

  while (true) {
    const data = await safeRequestJson(`${githubApi}${endpoint}${endpoint.includes('?') ? '&' : '?'}per_page=100&page=${page}`, token);
    if (!Array.isArray(data) || data.length === 0) {
      break;
    }

    all.push(...data);
    if (data.length < 100) {
      break;
    }

    page += 1;
  }

  return all;
}

async function getStats(config) {
  const token = process.env.GITHUB_TOKEN;
  const username = process.env.GITHUB_USERNAME || config.username;
  const excludeForks = Boolean(config.settings?.excludeForks);

  const [repos, pullRequests, issues, commits] = await Promise.all([
    paginate(`/users/${username}/repos?type=owner&sort=updated`, token),
    safeRequestJson(`${githubApi}/search/issues?q=author:${username}+type:pr+is:public&per_page=1`, token),
    safeRequestJson(`${githubApi}/search/issues?q=author:${username}+type:issue+is:public&per_page=1`, token),
    safeRequestJson(`${githubApi}/search/commits?q=author:${username}&per_page=1`, token, {
      Accept: 'application/vnd.github.cloak-preview+json'
    })
  ]);

  const ownedRepos = repos.filter((repo) => !excludeForks || !repo.fork);
  const totalStars = ownedRepos.reduce((sum, repo) => sum + repo.stargazers_count, 0);

  const languageTotals = {};
  for (const repo of ownedRepos) {
    const languageStats = await safeRequestJson(repo.languages_url, token);
    if (!languageStats || typeof languageStats !== 'object') {
      continue;
    }
    for (const [language, bytes] of Object.entries(languageStats)) {
      languageTotals[language] = (languageTotals[language] || 0) + bytes;
    }
  }

  const totalLanguageBytes = Object.values(languageTotals).reduce((sum, bytes) => sum + bytes, 0);
  const topLanguages = Object.entries(languageTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, config.settings?.topLanguagesCount || 8)
    .map(([name, bytes]) => ({
      name,
      bytes,
      percent: totalLanguageBytes === 0 ? 0 : (bytes / totalLanguageBytes) * 100
    }));

  return {
    username,
    totalStars,
    totalRepos: ownedRepos.length,
    totalCommits: commits?.total_count || 0,
    totalPRs: pullRequests?.total_count || 0,
    totalIssues: issues?.total_count || 0,
    topLanguages
  };
}

function progressBar(percent) {
  const width = 20;
  const filled = Math.max(0, Math.min(width, Math.round((percent / 100) * width)));
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`;
}

function socialBadge(link) {
  const label = encodeURIComponent(link.label);
  const icon = encodeURIComponent(link.icon || 'github');
  const color = encodeURIComponent(link.color || '0d1117');
  return `<a href="${link.url}" target="_blank"><img alt="${link.label}" src="https://img.shields.io/badge/${label}-${color}?style=for-the-badge&logo=${icon}&logoColor=00eaff" /></a>`;
}

function renderReadme(config, stats) {
  const theme = config.theme || {};
  const accent = theme.accent || '00eaff';
  const statsTheme = theme.statsTheme || 'tokyonight';
  const social = (config.socialLinks || []).map(socialBadge).join('\n    ');
  const customBadges = (config.customBadges || [])
    .map((badge) => `<img alt="${badge.label}" src="${badge.url}" />`)
    .join('\n    ');

  const languageRows = stats.topLanguages
    .map((lang) => `| ${lang.name} | ${progressBar(lang.percent)} | ${lang.percent.toFixed(1)}% |`)
    .join('\n');

  const techIcons = (config.techStack || []).join(',');

  return `<!-- AUTO-GENERATED: Run \`node scripts/generate-readme.js\` -->
<div align="center">
  <img src="https://capsule-render.vercel.app/api?type=waving&color=0:${accent},100:0a0f1e&height=220&section=header&text=${encodeURIComponent(config.name)}&fontSize=52&fontColor=ffffff&animation=fadeIn" />

  <h1>${config.greeting}</h1>
  <h3>${config.role}</h3>

  <p>
    ${social}
  </p>

  <p>
    ${customBadges}
  </p>
</div>

---

## About

- 🌍 **Location:** ${config.about?.location || 'N/A'}
- 🎓 **Education:** ${config.about?.education || 'N/A'}
- 🔭 **Currently:** ${config.about?.currently || 'N/A'}
- 📚 **Learning:** ${config.about?.learning || 'N/A'}

${config.bio}

---

## 📈 GitHub Stats

<table>
  <tr>
    <td>
      <img width="100%" src="https://github-readme-stats.vercel.app/api?username=${stats.username}&show_icons=true&theme=${statsTheme}&hide_border=true&count_private=true&include_all_commits=true&bg_color=0d1117&title_color=${accent}&icon_color=${accent}&text_color=${theme.text || 'c9d1d9'}" />
    </td>
    <td>
      <img width="100%" src="https://github-readme-stats.vercel.app/api/top-langs/?username=${stats.username}&layout=compact&theme=${statsTheme}&hide_border=true&bg_color=0d1117&title_color=${accent}&text_color=${theme.text || 'c9d1d9'}" />
    </td>
  </tr>
</table>

<table>
  <tr>
    <td>⭐ <b>Total Stars</b><br/>${stats.totalStars}</td>
    <td>🧾 <b>Total Commits</b><br/>${stats.totalCommits}</td>
    <td>🔀 <b>Total PRs</b><br/>${stats.totalPRs}</td>
    <td>🐞 <b>Total Issues</b><br/>${stats.totalIssues}</td>
    <td>📦 <b>Public Repos</b><br/>${stats.totalRepos}</td>
  </tr>
</table>

---

## 💻 Most Used Languages (Public Repositories)

| Language | Usage | Share |
|---|---|---|
${languageRows || '| N/A | ░░░░░░░░░░░░░░░░░░░░ | 0.0% |'}

---

## 🧰 Technology Stack

<p align="center">
  <img src="https://skillicons.dev/icons?i=${techIcons}&theme=dark" />
</p>

---

## 🏆 Achievements

<p align="center">
  <img src="https://github-profile-trophy.vercel.app/?username=${stats.username}&theme=onestar&row=1&column=7&margin-w=8&margin-h=8&no-frame=true&title_color=${accent}" />
</p>

---

## 📊 Contribution Graph

<p align="center">
  <img src="https://github-readme-activity-graph.vercel.app/graph?username=${stats.username}&bg_color=0d1117&color=${accent}&line=${accent}&point=ffffff&area=true&hide_border=true" alt="Contribution Graph" />
</p>

---

## ⚙️ Customization

- Update profile content, tech stack, badges, and social links in \`profile.config.json\`
- Regenerate locally with \`node scripts/generate-readme.js\`
- Workflow \`.github/workflows/update-profile-readme.yml\` updates this README daily and on push to \`main\`/\`master\`

---

## 🌐 Social Links

<p align="center">
  ${social}
</p>
`;
}

async function main() {
  try {
    const config = await loadConfig();
    const stats = await getStats(config);
    const readme = renderReadme(config, stats);
    await fs.writeFile(readmePath, readme);
    console.log('README.md generated successfully.');
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

main();
